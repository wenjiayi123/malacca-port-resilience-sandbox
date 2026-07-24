import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  evaluateTrainedPolicy,
  inferTrainedPolicy,
  trainRlBenchmark,
  type RlAlgorithmId,
  type RlBenchmarkResponse,
  type RlPolicyEvaluationResponse,
  type RlTrainingArtifacts,
  type RlTrainingRequest,
  type TrainedPolicy,
  type TrainingProgress,
} from './rlTrainingEngine.ts';
import { loadPortTrainingDataset, type PortTrainingDataset } from './portTrainingDataset.ts';

export type RlTrainingJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RlTrainingJobSnapshot {
  protocolVersion: 'rl-training-job.v1';
  jobId: string;
  status: RlTrainingJobStatus;
  phase: 'queued' | 'loading-dataset' | TrainingProgress['phase'] | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number;
  progressPercent: number;
  currentAlgorithmId: RlAlgorithmId | null;
  completedEpisodes: number;
  totalEpisodes: number;
  environmentSteps: number;
  parameterUpdates: number;
  rewardEma: number | null;
  samplesPerSecond: number;
  message: string;
  dataset: null | {
    id: string;
    label: string;
    portId: string;
    source: string;
    license: string;
    fingerprint: string;
    samplingInterval: PortTrainingDataset['samplingInterval'];
    evidenceLevel: PortTrainingDataset['evidenceLevel'];
    quality: PortTrainingDataset['quality'];
    recordCount: number;
    trainRecordCount: number;
    validationRecordCount: number;
    testRecordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    testRange: [string, string];
  };
  result: RlBenchmarkResponse | null;
  artifactPath: string | null;
  logs: string[];
  error: string | null;
  restoredFromCheckpoint: boolean;
}

interface TrainingJobInternal extends RlTrainingJobSnapshot {
  request: RlTrainingRequest;
  datasetInternal: PortTrainingDataset | null;
  artifacts: RlTrainingArtifacts | null;
  cancelRequested: boolean;
  timedOut: boolean;
  deadlineAtEpochMs: number | null;
  startedAtEpochMs: number | null;
}

const jobs = new Map<string, TrainingJobInternal>();
const pendingJobs: TrainingJobInternal[] = [];
const ARTIFACT_DIR = path.resolve(process.env.RL_ARTIFACT_DIR || '.runtime/rl-jobs');
const boundedEnvironmentInteger = (value: string | undefined, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
};
const MAX_CONCURRENT_JOBS = boundedEnvironmentInteger(process.env.RL_MAX_CONCURRENT_JOBS, 1, 1, 8);
const MAX_QUEUED_JOBS = boundedEnvironmentInteger(process.env.RL_MAX_QUEUED_JOBS, 20, 1, 1_000);
let runningJobCount = 0;
let restorePromise: Promise<void> | null = null;
let restoredJobs = 0;
let rejectedCheckpoints = 0;

export class RlTrainingCapacityError extends Error {
  constructor() {
    super(`RL 训练队列已满（最多等待 ${MAX_QUEUED_JOBS} 个任务）`);
    this.name = 'RlTrainingCapacityError';
  }
}

const appendLog = (job: TrainingJobInternal, message: string) => {
  const time = new Date().toISOString().slice(11, 19);
  job.logs = [...job.logs, `${time} ${message}`].slice(-80);
};

const publicSnapshot = (job: TrainingJobInternal): RlTrainingJobSnapshot => ({
  protocolVersion: job.protocolVersion,
  jobId: job.jobId,
  status: job.status,
  phase: job.phase,
  createdAt: job.createdAt,
  startedAt: job.startedAt,
  completedAt: job.completedAt,
  elapsedMs: job.startedAtEpochMs ? (job.completedAt ? job.elapsedMs : Date.now() - job.startedAtEpochMs) : 0,
  progressPercent: job.progressPercent,
  currentAlgorithmId: job.currentAlgorithmId,
  completedEpisodes: job.completedEpisodes,
  totalEpisodes: job.totalEpisodes,
  environmentSteps: job.environmentSteps,
  parameterUpdates: job.parameterUpdates,
  rewardEma: job.rewardEma,
  samplesPerSecond: job.samplesPerSecond,
  message: job.message,
  dataset: job.dataset,
  result: job.result,
  artifactPath: job.artifactPath,
  logs: [...job.logs],
  error: job.error,
  restoredFromCheckpoint: job.restoredFromCheckpoint,
});

const checkpointCore = (job: TrainingJobInternal) => {
  const policies = [...(job.artifacts?.policies ?? new Map()).entries()].map(([algorithmId, policy]) =>
    policy.kind === 'q-table'
      ? {
          algorithmId,
          kind: policy.kind,
          qA: [...policy.qA.entries()],
          ...(policy.qB ? { qB: [...policy.qB.entries()] } : {}),
        }
      : { algorithmId, ...policy });
  return {
    protocolVersion: 'rl-port-policy-checkpoint.v1',
    engineVersion: 'dataset-calibrated-port-control.v3',
    jobId: job.jobId,
    createdAt: job.completedAt ?? new Date().toISOString(),
    request: { ...job.request, trainingParameters: job.request.trainingParameters },
    dataset: job.dataset,
    benchmark: job.result,
    policies,
  };
};

const checkpointPayload = (job: TrainingJobInternal) => {
  const core = checkpointCore(job);
  return {
    ...core,
    integrity: {
      algorithm: 'sha256',
      digest: createHash('sha256').update(JSON.stringify(core)).digest('hex'),
    },
  };
};

type StoredPolicy = {
  algorithmId: RlAlgorithmId;
  kind: 'q-table' | 'mpc';
  qA?: Array<[number, number[]]>;
  qB?: Array<[number, number[]]>;
  forecastBias?: number;
  forecastRmse?: number;
  horizon?: number;
};

type StoredCheckpoint = ReturnType<typeof checkpointPayload> & { policies: StoredPolicy[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateJobId = (jobId: string) => /^rl-[a-zA-Z0-9-]{8,80}$/.test(jobId);

const hydratePolicy = (stored: StoredPolicy): TrainedPolicy => {
  if (!['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'].includes(stored.algorithmId)) {
    throw new Error(`unknown checkpoint algorithm ${stored.algorithmId}`);
  }
  if (stored.kind === 'q-table' && stored.algorithmId !== 'mpc') {
    if (!Array.isArray(stored.qA) || stored.qA.some((entry) =>
      !Array.isArray(entry) || !Number.isInteger(entry[0]) || !Array.isArray(entry[1]) ||
      entry[1].some((value) => !Number.isFinite(value)))) {
      throw new Error(`invalid q-table for ${stored.algorithmId}`);
    }
    return {
      kind: 'q-table',
      algorithmId: stored.algorithmId,
      qA: new Map(stored.qA),
      ...(stored.qB ? { qB: new Map(stored.qB) } : {}),
    };
  }
  if (stored.kind === 'mpc' && stored.algorithmId === 'mpc' &&
    Number.isFinite(stored.forecastBias) && Number.isFinite(stored.forecastRmse) &&
    Number.isInteger(stored.horizon)) {
    return {
      kind: 'mpc',
      algorithmId: 'mpc',
      forecastBias: stored.forecastBias!,
      forecastRmse: stored.forecastRmse!,
      horizon: stored.horizon!,
    };
  }
  throw new Error(`invalid checkpoint policy ${stored.algorithmId}`);
};

const hydrateCheckpoint = (value: unknown, dataset: PortTrainingDataset): TrainingJobInternal => {
  if (!isRecord(value) || value.protocolVersion !== 'rl-port-policy-checkpoint.v1' ||
    value.engineVersion !== 'dataset-calibrated-port-control.v3' ||
    typeof value.jobId !== 'string' || !validateJobId(value.jobId) ||
    !Array.isArray(value.policies) || !isRecord(value.integrity) ||
    value.integrity.algorithm !== 'sha256' || typeof value.integrity.digest !== 'string') {
    throw new Error('invalid checkpoint envelope');
  }
  const { integrity, ...core } = value;
  const actualDigest = createHash('sha256').update(JSON.stringify(core)).digest('hex');
  if (actualDigest !== integrity.digest) throw new Error('checkpoint integrity mismatch');
  const stored = value as unknown as StoredCheckpoint;
  if (!stored.dataset || stored.dataset.fingerprint !== dataset.fingerprint || stored.dataset.portId !== dataset.portId) {
    throw new Error('checkpoint dataset does not match configured dataset and port');
  }
  if (!stored.benchmark || stored.benchmark.selectionSplit !== 'validation' || !isRecord(stored.request)) {
    throw new Error('checkpoint benchmark metadata is incomplete');
  }
  const benchmark = {
    ...stored.benchmark,
    dataset: { ...stored.benchmark.dataset, quality: dataset.quality },
  };
  const policies = new Map<RlAlgorithmId, TrainedPolicy>();
  for (const policy of stored.policies) {
    const hydrated = hydratePolicy(policy);
    if (policies.has(policy.algorithmId)) throw new Error(`duplicate checkpoint policy ${policy.algorithmId}`);
    policies.set(policy.algorithmId, hydrated);
  }
  if (!policies.has(benchmark.bestAlgorithmId)) throw new Error('checkpoint misses selected policy');
  const totalEpisodes = benchmark.results.reduce(
    (sum, result) => sum + (result.training.executedEpisodes ?? result.training.episodes),
    0,
  );
  const environmentSteps = benchmark.results.reduce((sum, result) => sum + result.training.environmentSteps, 0) +
    benchmark.results.length * dataset.validationRecords.length;
  const parameterUpdates = benchmark.results.reduce((sum, result) => sum + result.training.parameterUpdates, 0);
  const elapsedMs = benchmark.results.reduce((sum, result) => sum + result.training.elapsedMs, 0);
  const createdAt = typeof stored.createdAt === 'string' ? stored.createdAt : benchmark.generatedAt;
  const bestResult = benchmark.results.find((result) => result.id === benchmark.bestAlgorithmId);
  const restoredDatasetMetadata = { ...stored.dataset, quality: dataset.quality };
  return {
    protocolVersion: 'rl-training-job.v1',
    jobId: stored.jobId,
    status: 'completed',
    phase: 'completed',
    createdAt,
    startedAt: createdAt,
    completedAt: createdAt,
    elapsedMs,
    progressPercent: 100,
    currentAlgorithmId: benchmark.bestAlgorithmId,
    completedEpisodes: totalEpisodes,
    totalEpisodes,
    environmentSteps,
    parameterUpdates,
    rewardEma: bestResult?.evaluation.meanReward ?? null,
    samplesPerSecond: 0,
    message: `已从完整性校验通过的检查点恢复 · 验证集最优 ${benchmark.bestAlgorithmId}`,
    dataset: restoredDatasetMetadata,
    result: benchmark,
    artifactPath: `/api/rl/jobs/${encodeURIComponent(stored.jobId)}/checkpoint`,
    logs: [`${new Date().toISOString().slice(11, 19)} 服务启动时已恢复检查点，最终测试段仍需显式执行`],
    error: null,
    restoredFromCheckpoint: true,
    request: stored.request,
    datasetInternal: dataset,
    artifacts: { benchmark, policies },
    cancelRequested: false,
    timedOut: false,
    deadlineAtEpochMs: null,
    startedAtEpochMs: Date.parse(createdAt),
  };
};

export const ensureRlTrainingJobsRestored = async () => {
  if (!restorePromise) {
    restorePromise = (async () => {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      const dataset = await loadPortTrainingDataset();
      const files = (await readdir(ARTIFACT_DIR)).filter((file) => /^rl-[a-zA-Z0-9-]{8,80}\.json$/.test(file));
      for (const file of files) {
        try {
          const payload = JSON.parse(await readFile(path.join(ARTIFACT_DIR, file), 'utf8')) as unknown;
          const job = hydrateCheckpoint(payload, dataset);
          jobs.set(job.jobId, job);
          restoredJobs += 1;
        } catch {
          rejectedCheckpoints += 1;
        }
      }
    })();
  }
  await restorePromise;
};

const runJob = async (job: TrainingJobInternal) => {
  job.status = 'running';
  job.phase = 'loading-dataset';
  job.startedAt = new Date().toISOString();
  job.startedAtEpochMs = Date.now();
  const wallClockHours = Math.min(24, Math.max(0.01, job.request.trainingParameters?.wallClockHours ?? 1));
  job.deadlineAtEpochMs = job.startedAtEpochMs + wallClockHours * 60 * 60 * 1_000;
  job.progressPercent = 1;
  job.message = '正在校验训练集字段、时间顺序与训练/验证/最终测试边界';
  appendLog(job, job.message);
  try {
    const dataset = await loadPortTrainingDataset();
    job.datasetInternal = dataset;
    job.dataset = {
      id: dataset.id,
      label: dataset.label,
      portId: dataset.portId,
      source: dataset.source,
      license: dataset.license,
      fingerprint: dataset.fingerprint,
      samplingInterval: dataset.samplingInterval,
      evidenceLevel: dataset.evidenceLevel,
      quality: dataset.quality,
      recordCount: dataset.records.length,
      trainRecordCount: dataset.trainRecords.length,
      validationRecordCount: dataset.validationRecords.length,
      testRecordCount: dataset.testRecords.length,
      trainRange: dataset.split.trainRange,
      validationRange: dataset.split.validationRange,
      testRange: dataset.split.testRange,
    };
    job.progressPercent = 6;
    appendLog(job, `数据集 ${dataset.id} 校验通过 · SHA256 ${dataset.fingerprint}`);
    appendLog(job, `港口 ${dataset.portId} · 时间切分：训练 ${dataset.split.trainRange.join(' → ')} / 验证 ${dataset.split.validationRange.join(' → ')} / 测试 ${dataset.split.testRange.join(' → ')}`);
    appendLog(job, `数据质量：容量 ${dataset.quality.capacityMode} / 覆盖 ${dataset.quality.capacityCoveragePercent}% · 风速 ${dataset.quality.windCoveragePercent}% / 完整气象 ${dataset.quality.weatherCoveragePercent}% · 测试需求漂移 ${dataset.quality.testArrivalDriftPercent}%`);
    const progress = (update: TrainingProgress) => {
      job.phase = update.phase;
      job.progressPercent = Math.min(99.8, update.progressPercent);
      job.currentAlgorithmId = update.currentAlgorithmId;
      job.completedEpisodes = update.completedEpisodes;
      job.totalEpisodes = update.totalEpisodes;
      job.environmentSteps = update.environmentSteps;
      job.parameterUpdates = update.parameterUpdates;
      job.rewardEma = update.rewardEma;
      job.samplesPerSecond = update.samplesPerSecond;
      job.message = update.message;
      if (job.logs.at(-1)?.slice(9) !== update.message) appendLog(job, update.message);
    };
    const artifacts = await trainRlBenchmark(job.request, dataset, progress, () => {
      if (job.cancelRequested) return true;
      if (job.deadlineAtEpochMs && Date.now() >= job.deadlineAtEpochMs) {
        job.timedOut = true;
        return true;
      }
      return false;
    });
    if (job.cancelRequested) throw new Error('training cancelled');
    job.artifacts = artifacts;
    job.result = artifacts.benchmark;
    job.phase = 'checkpointing';
    job.progressPercent = 99;
    job.message = '正在写入可复现检查点';
    appendLog(job, job.message);
    await mkdir(ARTIFACT_DIR, { recursive: true });
    const artifactPath = path.join(ARTIFACT_DIR, `${job.jobId}.json`);
    const temporaryArtifactPath = `${artifactPath}.tmp`;
    await writeFile(temporaryArtifactPath, JSON.stringify(checkpointPayload(job), null, 2), 'utf8');
    await rename(temporaryArtifactPath, artifactPath);
    job.artifactPath = `/api/rl/jobs/${encodeURIComponent(job.jobId)}/checkpoint`;
    job.status = 'completed';
    job.phase = 'completed';
    job.progressPercent = 100;
    job.completedAt = new Date().toISOString();
    job.elapsedMs = Date.now() - job.startedAtEpochMs;
    job.currentAlgorithmId = artifacts.benchmark.bestAlgorithmId;
    job.message = `训练完成 · 验证集最优 ${artifacts.benchmark.bestAlgorithmId} · 最终测试待显式执行`;
    appendLog(job, job.message);
  } catch (error) {
    const cancelled = !job.timedOut && (job.cancelRequested || (error instanceof Error && error.message === 'training cancelled'));
    job.status = cancelled ? 'cancelled' : 'failed';
    job.phase = cancelled ? 'cancelled' : 'failed';
    job.completedAt = new Date().toISOString();
    job.elapsedMs = job.startedAtEpochMs ? Date.now() - job.startedAtEpochMs : 0;
    job.error = cancelled
      ? null
      : job.timedOut
        ? 'training job exceeded its wall-clock timeout'
        : error instanceof Error ? error.message : 'unknown training error';
    job.message = cancelled ? '训练任务已取消' : `训练失败：${job.error}`;
    appendLog(job, job.message);
  }
};

const pumpTrainingQueue = () => {
  while (runningJobCount < MAX_CONCURRENT_JOBS && pendingJobs.length) {
    const job = pendingJobs.shift()!;
    if (job.status === 'cancelled' || job.cancelRequested) continue;
    runningJobCount += 1;
    setImmediate(() => {
      void runJob(job).finally(() => {
        runningJobCount -= 1;
        pumpTrainingQueue();
      });
    });
  }
};

export const createRlTrainingJob = (request: RlTrainingRequest) => {
  if (pendingJobs.filter((job) => job.status === 'queued').length >= MAX_QUEUED_JOBS) {
    throw new RlTrainingCapacityError();
  }
  const jobId = `rl-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const episodes = Math.min(5_000, Math.max(120, Math.round(request.trainingParameters?.maxEpisodes ?? 600)));
  const tuningTrials = Math.min(5, Math.max(1, Math.round(request.trainingParameters?.tuningTrials ?? 3)));
  const job: TrainingJobInternal = {
    protocolVersion: 'rl-training-job.v1',
    jobId,
    status: 'queued',
    phase: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    elapsedMs: 0,
    progressPercent: 0,
    currentAlgorithmId: null,
    completedEpisodes: 0,
    totalEpisodes: episodes * 4 * tuningTrials,
    environmentSteps: 0,
    parameterUpdates: 0,
    rewardEma: null,
    samplesPerSecond: 0,
    message: '训练任务已排队；训练阶段不会生成沙盘渲染帧',
    dataset: null,
    result: null,
    artifactPath: null,
    logs: [],
    error: null,
    restoredFromCheckpoint: false,
    request,
    datasetInternal: null,
    artifacts: null,
    cancelRequested: false,
    timedOut: false,
    deadlineAtEpochMs: null,
    startedAtEpochMs: null,
  };
  appendLog(job, job.message);
  jobs.set(jobId, job);
  pendingJobs.push(job);
  pumpTrainingQueue();
  return publicSnapshot(job);
};

export const getRlTrainingJob = (jobId: string) => {
  const job = jobs.get(jobId);
  return job ? publicSnapshot(job) : null;
};

export const listRlTrainingJobs = () => [...jobs.values()]
  .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  .slice(0, 50)
  .map(publicSnapshot);

export const cancelRlTrainingJob = (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') {
    job.cancelRequested = true;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.phase = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.message = '排队中的训练任务已取消';
    } else {
      job.message = '已收到取消请求，当前 episode 完成后停止';
    }
    appendLog(job, job.message);
  }
  return publicSnapshot(job);
};

export const evaluateRlTrainingJob = (
  jobId: string,
  algorithmId: RlAlgorithmId,
  testCaseId: RlPolicyEvaluationResponse['testCaseId'],
) => {
  const job = jobs.get(jobId);
  if (!job) throw new Error('RL 训练任务不存在，或其检查点与当前数据集不兼容');
  if (job.status !== 'completed' || !job.artifacts || !job.datasetInternal) {
    throw new Error('RL 训练任务尚未完成，不能执行最终测试集回放');
  }
  if (!job.artifacts.policies.has(algorithmId)) throw new Error(`检查点不包含算法 ${algorithmId}`);
  return evaluateTrainedPolicy(jobId, algorithmId, testCaseId, job.artifacts, job.datasetInternal, job.request);
};

export const getRlTrainingCheckpoint = (jobId: string) => {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'completed' || !job.artifacts) return null;
  return checkpointPayload(job);
};

export const inferRlTrainingJob = (
  jobId: string,
  algorithmId: RlAlgorithmId | undefined,
  input: Parameters<typeof inferTrainedPolicy>[3],
) => {
  const job = jobs.get(jobId);
  if (!job) throw new Error('RL 训练任务不存在，或其检查点与当前数据集不兼容');
  if (job.status !== 'completed' || !job.artifacts || !job.datasetInternal || !job.result) {
    throw new Error('RL 检查点尚未就绪');
  }
  const resolvedId = algorithmId ?? job.result.bestAlgorithmId;
  const policy = job.artifacts.policies.get(resolvedId);
  if (!policy) throw new Error(`检查点不包含算法 ${resolvedId}`);
  return {
    algorithmId: resolvedId,
    benchmark: job.result,
    decision: inferTrainedPolicy(policy, job.datasetInternal, job.request, input),
  };
};

export const getRlServiceStatus = () => ({
  activeJobs: [...jobs.values()].filter((job) => job.status === 'queued' || job.status === 'running').length,
  runningJobs: runningJobCount,
  queuedJobs: pendingJobs.filter((job) => job.status === 'queued').length,
  maxConcurrentJobs: MAX_CONCURRENT_JOBS,
  maxQueuedJobs: MAX_QUEUED_JOBS,
  completedJobs: [...jobs.values()].filter((job) => job.status === 'completed').length,
  restoredJobs,
  rejectedCheckpoints,
  artifactDirectory: path.relative(process.cwd(), ARTIFACT_DIR) || '.runtime/rl-jobs',
});
