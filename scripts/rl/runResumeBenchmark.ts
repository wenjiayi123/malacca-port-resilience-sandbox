import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from '../../server/portTrainingDataset.ts';
import {
  evaluateTrainedPolicy,
  RL_ALGORITHMS,
  RL_ACTIONS,
  RL_OBSERVATION_CONTRACT,
  trainRlBenchmark,
  type RlAlgorithmId,
  type RlOperationalMetrics,
  type RlPolicyEvaluationResponse,
  type RlTrainingArtifacts,
  type RlTrainingRequest,
} from '../../server/rlTrainingEngine.ts';
import { getRlObjectivePreset, type RlObjectiveId } from '../../shared/rlObjectivePresets.ts';

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

const numberFromEnvironment = (key: string, fallback: number, minimum: number, maximum: number) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
};

const objectiveId = (process.env.RL_BENCHMARK_OBJECTIVE || 'balanced-resilience') as RlObjectiveId;
const objective = getRlObjectivePreset(objectiveId);
if (objective.id !== objectiveId || !objective.supportedByAggregateEnvironment) {
  throw new Error(`RL_BENCHMARK_OBJECTIVE ${objectiveId} is not supported by the aggregate environment`);
}
const episodes = Math.round(numberFromEnvironment('RL_BENCHMARK_EPISODES', 600, 120, 5_000));
const tuningTrials = Math.round(numberFromEnvironment('RL_BENCHMARK_TUNING_TRIALS', 3, 1, 5));
const seeds = (process.env.RL_BENCHMARK_SEEDS || '240520,240521,240522')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value));
if (seeds.length < 2) throw new Error('RL_BENCHMARK_SEEDS must contain at least two integer seeds');

interface Summary {
  mean: number;
  std: number;
  min: number;
  max: number;
  samples: number;
}

const summarize = (values: number[]): Summary => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  return {
    mean: round(mean),
    std: round(Math.sqrt(variance)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    samples: values.length,
  };
};

const dataset = await loadPortTrainingDataset();
const sourceFiles = [
  'server/rlTrainingEngine.ts',
  'server/portTrainingDataset.ts',
  'shared/rlObjectivePresets.ts',
  'scripts/rl/runResumeBenchmark.ts',
  'package.json',
  'pnpm-lock.yaml',
] as const;
const sourceFileDigests = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [
  file,
  createHash('sha256').update(await readFile(path.resolve(file))).digest('hex'),
])));
const sourceFingerprintEntries = Object.entries(sourceFileDigests).sort(([left], [right]) =>
  left.localeCompare(right));
const sourceDigest = createHash('sha256')
  .update(sourceFingerprintEntries.map(([file, digest]) => `${file}:${digest}`).join('\n'))
  .digest('hex');
const runs: Array<{ seed: number; request: RlTrainingRequest; artifacts: RlTrainingArtifacts }> = [];
for (const seed of seeds) {
  const request: RlTrainingRequest = {
    protocolVersion: 'rl-training-job.v1',
    objectiveId,
    trainingParameters: {
      maxEpisodes: episodes,
      seed,
      learningRate: 0.12,
      discountGamma: 0.97,
      tuningTrials,
    },
    scenarioSnapshot: { scenarioId: `resume-benchmark-${objectiveId}` },
  };
  const artifacts = await trainRlBenchmark(request, dataset, () => undefined);
  runs.push({ seed, request, artifacts });
}

const validationByAlgorithm = Object.fromEntries(RL_ALGORITHMS.map((algorithm) => {
  const results = runs.map(({ artifacts }) =>
    artifacts.benchmark.results.find((result) => result.id === algorithm.id)!);
  return [algorithm.id, {
    family: algorithm.family,
    meanReward: summarize(results.map((result) => result.evaluation.meanReward)),
    selectedLearningRate: results.map((result) => result.hyperparameters.learningRate),
    selectedDiscountGamma: results.map((result) => result.hyperparameters.discountGamma),
    selectedScore: summarize(results.map((result) => result.tuning.selectedScore)),
    algorithmSelectionScore: summarize(results.map((result) => result.selectionScore)),
  }];
})) as Record<RlAlgorithmId, {
  family: 'reinforcement-learning' | 'control-theory';
  meanReward: Summary;
  selectedLearningRate: Array<number | null>;
  selectedDiscountGamma: Array<number | null>;
  selectedScore: Summary;
  algorithmSelectionScore: Summary;
}>;

const rankedRlAlgorithms = RL_ALGORITHMS
  .filter((algorithm) => algorithm.family === 'reinforcement-learning')
  .sort((left, right) =>
    validationByAlgorithm[right.id].algorithmSelectionScore.mean -
    validationByAlgorithm[left.id].algorithmSelectionScore.mean);
const selectedRlAlgorithmId = rankedRlAlgorithms[0].id;

const testCaseIds: RlPolicyEvaluationResponse['testCaseId'][] = [
  'closed-loop-replay',
  'peak-congestion-stress',
  'weather-disturbance-generalization',
];
const evaluatedAlgorithms: RlAlgorithmId[] = RL_ALGORITHMS.map((algorithm) => algorithm.id);
const evaluations = Object.fromEntries(evaluatedAlgorithms.map((algorithmId) => [
  algorithmId,
  Object.fromEntries(testCaseIds.map((testCaseId) => {
    const samples = runs.map(({ artifacts, request, seed }) => ({
      seed,
      evaluation: evaluateTrainedPolicy(
        `resume-${seed}`,
        algorithmId,
        testCaseId,
        artifacts,
        dataset,
        request,
      ),
    }));
    const metrics = samples.map((sample) => sample.evaluation.metrics);
    const summarizeOperational = (key: keyof RlOperationalMetrics) =>
      summarize(metrics.map((metric) => metric.modeled[key]));
    return [testCaseId, {
      delayReductionPercent: summarize(metrics.map((metric) => metric.delayReductionPercent)),
      congestionReductionPercent: summarize(metrics.map((metric) => metric.congestionReductionPercent)),
      carbonReductionPercent: summarize(metrics.map((metric) => metric.carbonReductionPercent)),
      resilienceGain: summarize(metrics.map((metric) => metric.resilienceGain)),
      meanServiceLevelPercent: summarizeOperational('meanServiceLevelPercent'),
      throughputRetentionPercent: summarizeOperational('throughputRetentionPercent'),
      p95DelayHours: summarizeOperational('p95DelayHours'),
      finalDeferredBacklogVessels: summarizeOperational('finalDeferredBacklogVessels'),
      safetyViolationRatePercent: summarizeOperational('safetyViolationRatePercent'),
    }];
  })),
])) as unknown as Partial<Record<
  RlAlgorithmId,
  Record<RlPolicyEvaluationResponse['testCaseId'], Record<string, Summary>>
>>;

const selectedRlLabel = RL_ALGORITHMS.find((algorithm) => algorithm.id === selectedRlAlgorithmId)!.label;
const selectedRlEvaluations = evaluations[selectedRlAlgorithmId]!;
const mpcEvaluations = evaluations.mpc!;
const closedLoop = selectedRlEvaluations['closed-loop-replay'];
const peakStress = selectedRlEvaluations['peak-congestion-stress'];
const mpcClosedLoop = mpcEvaluations['closed-loop-replay'];
const meanTestArrivals = dataset.testRecords.reduce(
  (sum, record) => sum + record.arrivals,
  0,
) / Math.max(1, dataset.testRecords.length);
const finalDeferredBacklogToMeanArrivalPercent =
  mpcClosedLoop.finalDeferredBacklogVessels.mean
  / Math.max(1, meanTestArrivals)
  * 100;
const claimThresholds = {
  minimumThroughputRetentionPercent: 95,
  maximumExpectedSafetyViolationRatePercent: 5,
  minimumDelayReductionPercent: 5,
  minimumCongestionReductionPercent: 5,
  maximumAcrossSeedStandardDeviationPercentagePoints: 5,
  maximumFinalDeferredBacklogToMeanArrivalPercent: 5,
};
const claimChecks = {
  throughputRetention:
    mpcClosedLoop.throughputRetentionPercent.mean >= claimThresholds.minimumThroughputRetentionPercent,
  expectedSafetyRisk:
    mpcClosedLoop.safetyViolationRatePercent.mean <=
      claimThresholds.maximumExpectedSafetyViolationRatePercent,
  delayReduction:
    mpcClosedLoop.delayReductionPercent.mean >= claimThresholds.minimumDelayReductionPercent,
  congestionReduction:
    mpcClosedLoop.congestionReductionPercent.mean >= claimThresholds.minimumCongestionReductionPercent,
  seedStability:
    mpcClosedLoop.delayReductionPercent.std <=
      claimThresholds.maximumAcrossSeedStandardDeviationPercentagePoints &&
    mpcClosedLoop.congestionReductionPercent.std <=
      claimThresholds.maximumAcrossSeedStandardDeviationPercentagePoints,
  deferredBacklog:
    finalDeferredBacklogToMeanArrivalPercent <=
      claimThresholds.maximumFinalDeferredBacklogToMeanArrivalPercent,
};
const report = {
  schemaVersion: 'resume-rl-benchmark.v1',
  generatedAt: process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1_000).toISOString()
    : new Date().toISOString(),
  evidenceLabel: 'OFFLINE_MODEL_REPLAY_NOT_FIELD_KPI',
  claimBoundary: [
    'This report is a real execution of the repository training code, not a fabricated result.',
    'The input is monthly aggregate public data; capacity is a train-only empirical proxy.',
    'ERA5 monthly P95 daily-maximum wind coverage is reported separately from complete wind/wave/visibility coverage.',
    'Wave, visibility and safety fields are absent in the default dataset; weather-stress tests add documented synthetic disturbances.',
    'Action effects are declared scenario assumptions, not coefficients calibrated from measured intervention outcomes.',
    'Deterministic test safety is the expected modeled violation rate, not a claim of observed zero incidents.',
    'Metrics are model-replay comparisons and are not field accuracy, production savings, or certified resilience.',
  ],
  modelContract: {
    observations: RL_OBSERVATION_CONTRACT,
    actions: RL_ACTIONS.map((action) => ({
      id: action.id,
      deferredDemandFraction: action.deferredDemand,
      divertedDemandFraction: action.divertedDemand,
      capacityMultiplier: action.capacityMultiplier,
      carbonMultiplier: action.carbonMultiplier,
      safetyProbabilityModifier: action.safetyModifier,
      evidenceLevel: 'declared_scenario_assumption',
    })),
    evaluationSafetyMetric: 'mean expected violation probability per time step',
  },
  dataset: runs[0].artifacts.benchmark.dataset,
  sourceFingerprint: {
    algorithm: 'sha256',
    digest: sourceDigest,
    files: sourceFileDigests,
  },
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  protocol: {
    objectiveId,
    objectiveWeights: objective.weights,
    algorithms: RL_ALGORITHMS.map(({ id, family }) => ({ id, family })),
    episodesPerCandidate: episodes,
    tuningTrials,
    seeds,
    algorithmSelection: 'mean validation-selection reward across seeds; final test never used for selection',
    selectedRlAlgorithmId,
  },
  validationByAlgorithm,
  heldOutTest: evaluations,
  provisionalResumeMetric: {
    allowedOnlyWithOfflineReplayQualifier: true,
    selectedRlAlgorithmId,
    recommendedMethodId: 'mpc',
    rationale: 'MPC is the only method with stable delay, congestion, throughput and safety results in the sealed closed-loop replay.',
    closedLoopDelayReductionPercent: mpcEvaluations['closed-loop-replay'].delayReductionPercent,
    closedLoopCongestionReductionPercent: mpcEvaluations['closed-loop-replay'].congestionReductionPercent,
    closedLoopThroughputRetentionPercent: mpcEvaluations['closed-loop-replay'].throughputRetentionPercent,
    closedLoopSafetyViolationRatePercent: mpcEvaluations['closed-loop-replay'].safetyViolationRatePercent,
    finalDeferredBacklogVessels: mpcEvaluations['closed-loop-replay'].finalDeferredBacklogVessels,
    finalDeferredBacklogToMeanArrivalPercent: round(
      finalDeferredBacklogToMeanArrivalPercent,
      3,
    ),
    selectedRlPeakStressDelayReductionPercent: peakStress.delayReductionPercent,
    selectedRlPeakStressCongestionReductionPercent: peakStress.congestionReductionPercent,
  },
  claimEligibility: {
    methodId: 'mpc',
    thresholds: claimThresholds,
    checks: claimChecks,
    passed: Object.values(claimChecks).every(Boolean),
    scope: 'offline_model_replay_only',
  },
};

const formatSummary = (summary: Summary, suffix = '') =>
  `${summary.mean.toFixed(2)} ± ${summary.std.toFixed(2)}${suffix}`;
const validationRows = RL_ALGORITHMS.map((algorithm) => {
  const summary = validationByAlgorithm[algorithm.id];
  return `| ${algorithm.label} | ${algorithm.family === 'reinforcement-learning' ? 'RL' : '控制'} | ${formatSummary(summary.meanReward)} | ${formatSummary(summary.algorithmSelectionScore)} |`;
}).join('\n');
const closedLoopRows = RL_ALGORITHMS.map((algorithm) => {
  const metrics = evaluations[algorithm.id]!['closed-loop-replay'];
  return `| ${algorithm.label} | ${formatSummary(metrics.delayReductionPercent, '%')} | ${formatSummary(metrics.congestionReductionPercent, '%')} | ${formatSummary(metrics.carbonReductionPercent, '%')} | ${formatSummary(metrics.meanServiceLevelPercent, '%')} |`;
}).join('\n');
const markdown = `# RL 简历指标证据报告

> 证据等级：**离线模型回放，不是现场业务 KPI，也不是“韧性模型准确率”**。

## 实验协议

- 数据：${dataset.records.length} 条 MPA 月度聚合到港记录，并按月对齐 Open-Meteo ERA5 10 m 风速特征；${dataset.split.trainRange.join(' → ')} 训练、${dataset.split.validationRange.join(' → ')} 验证、${dataset.split.testRange.join(' → ')} 最终测试。
- 数据指纹：\`${dataset.fingerprint}\`；港口范围：\`${dataset.portId}\`；容量：\`${dataset.quality.capacityMode}\`，且只用训练段校准。
- 方法：Q-Learning、SARSA、Expected SARSA、Dyna-Q 与 MPC；每个 RL 超参数候选 ${episodes} episodes，${tuningTrials} 组候选，${seeds.length} 个随机种子。
- 目标：\`${objectiveId}\`；验证前段调参，验证后段选算法，最终测试不参与调参或选择。
- 跨种子验证集最优 RL：**${selectedRlLabel}**。
- 核心代码指纹：\`${sourceDigest}\`。
- 状态：${RL_OBSERVATION_CONTRACT.length} 维离散观测（队列/能力、延误、碳指数、递延积压/能力、需求趋势、天气风险）；递延积压进入状态以避免非马尔可夫状态混叠。
- 安全：确定性测试报告逐步期望违规概率的均值，不用有利随机种子制造“零事故”。
- 拥堵：按现场队列 + 0.65×递延积压计算有效压力，避免把错峰需求移出可见队列后误报为拥堵消失。

## 验证段透明对比

| 方法 | 分类 | 平均奖励 | 约束选择分 |
|---|---|---:|---:|
${validationRows}

## 全算法留出闭环回放

| 方法 | 延误变化 | 拥堵变化 | 碳指数变化 | 服务率 |
|---|---:|---:|---:|---:|
${closedLoopRows}

## 留出测试诊断

| 场景 | 方法 | 延误变化 | 拥堵变化 | 碳指数变化 | 服务率 | P95 延误 |
|---|---|---:|---:|---:|---:|---:|
| 闭环回放 | ${selectedRlLabel} | ${formatSummary(closedLoop.delayReductionPercent, '%')} | ${formatSummary(closedLoop.congestionReductionPercent, '%')} | ${formatSummary(closedLoop.carbonReductionPercent, '%')} | ${formatSummary(closedLoop.meanServiceLevelPercent, '%')} | ${formatSummary(closedLoop.p95DelayHours, 'h')} |
| 峰值拥堵压力 | ${selectedRlLabel} | ${formatSummary(peakStress.delayReductionPercent, '%')} | ${formatSummary(peakStress.congestionReductionPercent, '%')} | ${formatSummary(peakStress.carbonReductionPercent, '%')} | ${formatSummary(peakStress.meanServiceLevelPercent, '%')} | ${formatSummary(peakStress.p95DelayHours, 'h')} |
| 闭环回放 | MPC | ${formatSummary(mpcEvaluations['closed-loop-replay'].delayReductionPercent, '%')} | ${formatSummary(mpcEvaluations['closed-loop-replay'].congestionReductionPercent, '%')} | ${formatSummary(mpcEvaluations['closed-loop-replay'].carbonReductionPercent, '%')} | ${formatSummary(mpcEvaluations['closed-loop-replay'].meanServiceLevelPercent, '%')} | ${formatSummary(mpcEvaluations['closed-loop-replay'].p95DelayHours, 'h')} |

正数“变化”表示相对保持计划基线下降，负数表示恶化。所有数字是 ${seeds.length} 个随机种子的均值 ± 标准差。

当前验证选优 RL 在最终闭环回放中的延误和碳指标不稳定，不适合作为简历收益主张。MPC 在同一
封存测试段的延误、拥堵、吞吐和安全指标方向一致，因此简历只建议引用 MPC，并明确它是确定性
控制基线而不是强化学习结果。

## 简历使用边界

- 不可写“网络韧性评估模型准确率 89%”：仓库没有带真实韧性标签的监督学习任务，无法定义或验证 accuracy。
- 可以写“在 MPA+ERA5 公开数据的留出离线模型回放中，三步 MPC……”，并引用其稳定的延误、
  拥堵、吞吐保持率和期望安全风险率；不得把验证选优 RL 的不稳定闭环结果包装成收益。
- 五个动作的错峰、分流、能力与碳系数是公开的情景假设，并非来自真实干预 A/B 或因果估计；
  收益必须与这些参数及本报告的 \`claimEligibility\` 门禁一起解释。
- 默认数据容量、风速、完整风浪能见度、安全覆盖率分别为 ${dataset.quality.capacityCoveragePercent}% / ${dataset.quality.windCoveragePercent}% / ${dataset.quality.weatherCoveragePercent}% / ${dataset.quality.safetyCoveragePercent}%，因此不能外推为泊位级实时业务收益。
`;

const reportDirectory = path.resolve('reports');
await mkdir(reportDirectory, { recursive: true });
const reportBaseName = `rl-benchmark-${objectiveId}`;
await writeFile(path.join(reportDirectory, `${reportBaseName}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(path.join(reportDirectory, `${reportBaseName}.md`), markdown, 'utf8');
process.stdout.write(`${path.join(reportDirectory, `${reportBaseName}.json`)}\n${path.join(reportDirectory, `${reportBaseName}.md`)}\n`);
