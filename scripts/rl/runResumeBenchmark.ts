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
import { RL_OPERATIONAL_CALIBRATION } from '../../shared/rlOperationalCalibration.ts';

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
const cumulativeArrivals = dataset.records.reduce((sum, record) => sum + record.arrivals, 0);
const sourceFiles = [
  'server/rlTrainingEngine.ts',
  'server/portTrainingDataset.ts',
  'shared/rlObjectivePresets.ts',
  'shared/rlOperationalCalibration.ts',
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
    const summarizeBaseline = (key: keyof RlOperationalMetrics) =>
      summarize(metrics.map((metric) => metric.baseline[key]));
    return [testCaseId, {
      delayReductionPercent: summarize(metrics.map((metric) => metric.delayReductionPercent)),
      congestionReductionPercent: summarize(metrics.map((metric) => metric.congestionReductionPercent)),
      absoluteDelayReductionHours: summarize(metrics.map((metric) =>
        metric.baseline.meanDelayHours - metric.modeled.meanDelayHours)),
      absoluteCongestionReductionPoints: summarize(metrics.map((metric) =>
        metric.baseline.meanCongestionPercent - metric.modeled.meanCongestionPercent)),
      carbonReductionPercent: summarize(metrics.map((metric) => metric.carbonReductionPercent)),
      resilienceGain: summarize(metrics.map((metric) => metric.resilienceGain)),
      baselineMeanDelayHours: summarizeBaseline('meanDelayHours'),
      modeledMeanDelayHours: summarizeOperational('meanDelayHours'),
      baselineMeanCongestionPercent: summarizeBaseline('meanCongestionPercent'),
      modeledMeanCongestionPercent: summarizeOperational('meanCongestionPercent'),
      meanServiceLevelPercent: summarizeOperational('meanServiceLevelPercent'),
      throughputRetentionPercent: summarizeOperational('throughputRetentionPercent'),
      p95DelayHours: summarizeOperational('p95DelayHours'),
      finalDeferredBacklogVessels: summarizeOperational('finalDeferredBacklogVessels'),
      safetyViolationRatePercent: summarizeOperational('safetyViolationRatePercent'),
      interventionRatePercent: summarize(samples.map((sample) =>
        sample.evaluation.trace.filter((point) => point.actionId !== 'hold-plan').length
        / Math.max(1, sample.evaluation.trace.length)
        * 100)),
    }];
  })),
])) as unknown as Partial<Record<
  RlAlgorithmId,
  Record<RlPolicyEvaluationResponse['testCaseId'], Record<string, Summary>>
>>;

const selectedRlLabel = RL_ALGORITHMS.find((algorithm) => algorithm.id === selectedRlAlgorithmId)!.label;
const mpcEvaluations = evaluations.mpc!;
const mpcClosedLoop = mpcEvaluations['closed-loop-replay'];
const mpcStress = mpcEvaluations['peak-congestion-stress'];
const temporalBlocks = Array.from({ length: 3 }, (_, blockIndex) => {
  const blockSize = Math.ceil(dataset.testRecords.length / 3);
  const records = dataset.testRecords.slice(blockIndex * blockSize, (blockIndex + 1) * blockSize);
  return {
    id: `test-block-${blockIndex + 1}`,
    range: [records[0].timestamp, records.at(-1)!.timestamp] as [string, string],
    records,
  };
});
const mpcTemporalStressSamples = temporalBlocks.map((block) => {
  const evaluation = evaluateTrainedPolicy(
    `resume-mpc-${block.id}`,
    'mpc',
    'peak-congestion-stress',
    runs[0].artifacts,
    { ...dataset, testRecords: block.records },
    runs[0].request,
  );
  return {
    id: block.id,
    range: block.range,
    metrics: evaluation.metrics,
    interventionRatePercent: round(
      evaluation.trace.filter((point) => point.actionId !== 'hold-plan').length
      / Math.max(1, evaluation.trace.length)
      * 100,
    ),
  };
});
const temporalRobustness = {
  methodId: 'mpc',
  testCaseId: 'peak-congestion-stress',
  blocks: mpcTemporalStressSamples.map((sample) => ({
    id: sample.id,
    range: sample.range,
    baselineMeanDelayHours: sample.metrics.baseline.meanDelayHours,
    modeledMeanDelayHours: sample.metrics.modeled.meanDelayHours,
    absoluteDelayReductionHours:
      sample.metrics.baseline.meanDelayHours - sample.metrics.modeled.meanDelayHours,
    baselineMeanCongestionPercent: sample.metrics.baseline.meanCongestionPercent,
    modeledMeanCongestionPercent: sample.metrics.modeled.meanCongestionPercent,
    absoluteCongestionReductionPoints:
      sample.metrics.baseline.meanCongestionPercent - sample.metrics.modeled.meanCongestionPercent,
    throughputRetentionPercent: sample.metrics.modeled.throughputRetentionPercent,
    safetyViolationRatePercent: sample.metrics.modeled.safetyViolationRatePercent,
    interventionRatePercent: sample.interventionRatePercent,
  })),
  absoluteDelayReductionHours: summarize(mpcTemporalStressSamples.map((sample) =>
    sample.metrics.baseline.meanDelayHours - sample.metrics.modeled.meanDelayHours)),
  absoluteCongestionReductionPoints: summarize(mpcTemporalStressSamples.map((sample) =>
    sample.metrics.baseline.meanCongestionPercent - sample.metrics.modeled.meanCongestionPercent)),
  interventionRatePercent: summarize(mpcTemporalStressSamples.map((sample) =>
    sample.interventionRatePercent)),
};
const meanTestArrivals = dataset.testRecords.reduce(
  (sum, record) => sum + record.arrivals,
  0,
) / Math.max(1, dataset.testRecords.length);
const finalDeferredBacklogToMeanArrivalPercent =
  mpcStress.finalDeferredBacklogVessels.mean
  / Math.max(1, meanTestArrivals)
  * 100;
const claimThresholds = {
  minimumThroughputRetentionPercent: 99,
  maximumExpectedSafetyViolationRatePercent: 5,
  minimumAbsoluteDelayReductionHours: 0.02,
  minimumAbsoluteCongestionReductionPoints: 0.1,
  maximumInterventionRatePercent: 30,
  maximumTemporalBlockInterventionRatePercent: 70,
  minimumNormalHoldRatePercent: 90,
  maximumFinalDeferredBacklogToMeanArrivalPercent: 1,
  minimumBaselineDelayForRelativeClaimHours: 1,
  minimumBaselineCongestionForRelativeClaimPercent: 5,
  maximumRelativeReductionForPublicAggregateClaimPercent: 30,
};
const claimChecks = {
  throughputRetention:
    mpcStress.throughputRetentionPercent.mean >= claimThresholds.minimumThroughputRetentionPercent,
  expectedSafetyRisk:
    mpcStress.safetyViolationRatePercent.mean <=
      claimThresholds.maximumExpectedSafetyViolationRatePercent,
  absoluteDelayReduction:
    mpcStress.absoluteDelayReductionHours.mean >=
      claimThresholds.minimumAbsoluteDelayReductionHours,
  absoluteCongestionReduction:
    mpcStress.absoluteCongestionReductionPoints.mean >=
      claimThresholds.minimumAbsoluteCongestionReductionPoints,
  boundedIntervention:
    mpcStress.interventionRatePercent.mean <= claimThresholds.maximumInterventionRatePercent,
  boundedTemporalBlockIntervention:
    temporalRobustness.interventionRatePercent.max <=
      claimThresholds.maximumTemporalBlockInterventionRatePercent,
  normalNoOp:
    100 - mpcClosedLoop.interventionRatePercent.mean >= claimThresholds.minimumNormalHoldRatePercent,
  deferredBacklog:
    finalDeferredBacklogToMeanArrivalPercent <=
      claimThresholds.maximumFinalDeferredBacklogToMeanArrivalPercent,
};
const relativePercentClaimAllowed =
  mpcStress.baselineMeanDelayHours.mean >=
    claimThresholds.minimumBaselineDelayForRelativeClaimHours &&
  mpcStress.baselineMeanCongestionPercent.mean >=
    claimThresholds.minimumBaselineCongestionForRelativeClaimPercent &&
  mpcStress.delayReductionPercent.mean <=
    claimThresholds.maximumRelativeReductionForPublicAggregateClaimPercent &&
  mpcStress.congestionReductionPercent.mean <=
    claimThresholds.maximumRelativeReductionForPublicAggregateClaimPercent;
const report = {
  schemaVersion: 'resume-rl-benchmark.v2',
  generatedAt: process.env.SOURCE_DATE_EPOCH
    ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1_000).toISOString()
    : new Date().toISOString(),
  evidenceLabel: 'OFFLINE_MODEL_REPLAY_NOT_FIELD_KPI',
  claimBoundary: [
    'This report is a real execution of the repository training code, not a fabricated result.',
    'The input is monthly aggregate public data; capacity is a train-only P90 service-envelope proxy.',
    'ERA5 monthly P95 daily-maximum wind coverage is reported separately from complete wind/wave/visibility coverage.',
    'Wave, visibility and safety fields are absent in the default dataset; weather-stress tests add documented synthetic disturbances.',
    'Action effects are conservative declared bounds, not coefficients calibrated from measured intervention outcomes.',
    'Relative reductions are not resume-eligible when baseline burden is too small or the small denominator amplifies the percentage.',
    'Deterministic test safety is the expected modeled violation rate, not a claim of observed zero incidents.',
    'Metrics are model-replay comparisons and are not field accuracy, production savings, or certified resilience.',
  ],
  modelContract: {
    calibrationId: RL_OPERATIONAL_CALIBRATION.id,
    capacityProxy: RL_OPERATIONAL_CALIBRATION.capacityProxy,
    stressTest: RL_OPERATIONAL_CALIBRATION.stressTest,
    observations: RL_OBSERVATION_CONTRACT,
    actions: RL_ACTIONS.map((action) => ({
      id: action.id,
      deferredDemandFraction: action.deferredDemand,
      divertedDemandFraction: action.divertedDemand,
      capacityMultiplier: action.capacityMultiplier,
      carbonMultiplier: action.carbonMultiplier,
      safetyProbabilityModifier: action.safetyModifier,
      evidenceLevel: RL_OPERATIONAL_CALIBRATION.evidenceLevel,
    })),
    evaluationSafetyMetric: 'mean expected violation probability per time step',
  },
  dataset: runs[0].artifacts.benchmark.dataset,
  datasetScale: {
    monthlyRecords: dataset.records.length,
    cumulativeVesselArrivals: round(cumulativeArrivals, 0),
    range: [dataset.records[0].timestamp, dataset.records.at(-1)!.timestamp],
  },
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
  temporalRobustness,
  provisionalResumeMetric: {
    allowedOnlyWithOfflineReplayQualifier: true,
    relativePercentClaimAllowed,
    selectedRlAlgorithmId,
    recommendedMethodId: 'mpc',
    scenarioId: 'peak-congestion-stress',
    rationale: 'Normal replay has insufficient baseline burden for a percentage claim; the calibrated stress diagnostic is reported with absolute before/after values.',
    baselineMeanDelayHours: mpcStress.baselineMeanDelayHours,
    modeledMeanDelayHours: mpcStress.modeledMeanDelayHours,
    absoluteDelayReductionHours: mpcStress.absoluteDelayReductionHours,
    baselineMeanCongestionPercent: mpcStress.baselineMeanCongestionPercent,
    modeledMeanCongestionPercent: mpcStress.modeledMeanCongestionPercent,
    absoluteCongestionReductionPoints: mpcStress.absoluteCongestionReductionPoints,
    throughputRetentionPercent: mpcStress.throughputRetentionPercent,
    safetyViolationRatePercent: mpcStress.safetyViolationRatePercent,
    interventionRatePercent: mpcStress.interventionRatePercent,
    finalDeferredBacklogVessels: mpcStress.finalDeferredBacklogVessels,
    finalDeferredBacklogToMeanArrivalPercent: round(
      finalDeferredBacklogToMeanArrivalPercent,
      3,
    ),
  },
  claimEligibility: {
    methodId: 'mpc',
    claimType: 'absolute_stress_diagnostic',
    relativePercentClaimAllowed,
    thresholds: claimThresholds,
    checks: claimChecks,
    passed: Object.values(claimChecks).every(Boolean),
    scope: 'offline_aggregate_stress_diagnostic_only',
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
  return `| ${algorithm.label} | ${formatSummary(metrics.baselineMeanDelayHours, 'h')} | ${formatSummary(metrics.modeledMeanDelayHours, 'h')} | ${formatSummary(metrics.baselineMeanCongestionPercent, '%')} | ${formatSummary(metrics.modeledMeanCongestionPercent, '%')} | ${formatSummary(metrics.interventionRatePercent, '%')} |`;
}).join('\n');
const stressRows = RL_ALGORITHMS.map((algorithm) => {
  const metrics = evaluations[algorithm.id]!['peak-congestion-stress'];
  return `| ${algorithm.label} | ${formatSummary(metrics.absoluteDelayReductionHours, 'h')} | ${formatSummary(metrics.absoluteCongestionReductionPoints, 'pp')} | ${formatSummary(metrics.throughputRetentionPercent, '%')} | ${formatSummary(metrics.safetyViolationRatePercent, '%')} | ${formatSummary(metrics.interventionRatePercent, '%')} |`;
}).join('\n');
const temporalRows = temporalRobustness.blocks.map((block) =>
  `| ${block.range.join(' → ')} | ${block.baselineMeanDelayHours.toFixed(3)}h → ${block.modeledMeanDelayHours.toFixed(3)}h | ${block.baselineMeanCongestionPercent.toFixed(3)}% → ${block.modeledMeanCongestionPercent.toFixed(3)}% | ${block.throughputRetentionPercent.toFixed(3)}% | ${block.interventionRatePercent.toFixed(2)}% |`,
).join('\n');
const markdown = `# RL 保守校准证据报告 v2

> 证据等级：**离线模型回放，不是现场业务 KPI，也不是“韧性模型准确率”**。

## 实验协议

- 数据：${dataset.records.length} 个 MPA 月度记录，汇总 ${cumulativeArrivals.toLocaleString('en-US')} 艘次到港量，并按月对齐 Open-Meteo ERA5 10 m 风速特征；${dataset.split.trainRange.join(' → ')} 训练、${dataset.split.validationRange.join(' → ')} 验证、${dataset.split.testRange.join(' → ')} 最终测试。
- 数据指纹：\`${dataset.fingerprint}\`；港口范围：\`${dataset.portId}\`；容量缺失，使用训练段 P90 服务包络 \`${dataset.quality.capacityProxyValue}\`，不读取验证/测试未来值。
- 方法：Q-Learning、SARSA、Expected SARSA、Dyna-Q 与 MPC；每个 RL 超参数候选 ${episodes} episodes，${tuningTrials} 组候选，${seeds.length} 个随机种子。
- 目标：\`${objectiveId}\`；验证前段调参，验证后段选算法，最终测试不参与调参或选择。
- 跨种子验证集最优 RL：**${selectedRlLabel}**。
- 核心代码指纹：\`${sourceDigest}\`。
- 状态：${RL_OBSERVATION_CONTRACT.length} 维离散观测（队列/能力、延误、碳指数、递延积压/能力、需求趋势、天气风险）；递延积压进入状态以避免非马尔可夫状态混叠。
- 安全：确定性测试报告逐步期望违规概率的均值，不用有利随机种子制造“零事故”。
- 拥堵：按现场队列 + 100% 递延积压计算有效压力，避免把错峰需求移出可见队列后误报为拥堵消失。
- 干预上限：单步错峰 ≤2%、分流 ≤1%、短时能力增益 ≤2%；常态负荷不足时 MPC 自动保持计划。
- 压力诊断：到港需求 +5%、临时能力 −2%，仅用于敏感性分析，不代表已发生的现场事故。

## 验证段透明对比

| 方法 | 分类 | 平均奖励 | 约束选择分 |
|---|---|---:|---:|
${validationRows}

## 全算法留出闭环回放

| 方法 | 基线延误 | 策略延误 | 基线拥堵 | 策略拥堵 | 非保持动作率 |
|---|---:|---:|---:|---:|---:|
${closedLoopRows}

常态封存期的保持计划基线没有形成可测延误或拥堵负担，因此不允许使用“下降百分比”。
MPC 在 ${formatSummary(mpcClosedLoop.interventionRatePercent, '%')} 的时段触发非保持动作，其常态结果只用于验证
“无负荷不干预”门禁，不包装成收益。

## 保守压力诊断

| 方法 | 延误绝对变化 | 拥堵绝对变化 | 吞吐保持 | 期望安全风险 | 非保持动作率 |
|---|---:|---:|---:|---:|---:|
${stressRows}

MPC 的主诊断值为：代理延误 \`${mpcStress.baselineMeanDelayHours.mean.toFixed(3)}h → ${mpcStress.modeledMeanDelayHours.mean.toFixed(3)}h\`
（绝对变化 \`${mpcStress.absoluteDelayReductionHours.mean.toFixed(3)}h\`），有效拥堵压力
\`${mpcStress.baselineMeanCongestionPercent.mean.toFixed(3)}% → ${mpcStress.modeledMeanCongestionPercent.mean.toFixed(3)}%\`
（绝对变化 \`${mpcStress.absoluteCongestionReductionPoints.mean.toFixed(3)}pp\`），吞吐保持
\`${mpcStress.throughputRetentionPercent.mean.toFixed(3)}%\`，期望安全风险
\`${mpcStress.safetyViolationRatePercent.mean.toFixed(3)}%\`，非保持动作率
\`${mpcStress.interventionRatePercent.mean.toFixed(2)}%\`。

相对延误/拥堵百分比为 \`${mpcStress.delayReductionPercent.mean.toFixed(2)}% / ${mpcStress.congestionReductionPercent.mean.toFixed(2)}%\`，
但基线负担仅 \`${mpcStress.baselineMeanDelayHours.mean.toFixed(3)}h / ${mpcStress.baselineMeanCongestionPercent.mean.toFixed(3)}%\`，
触发小分母门禁，\`relativePercentClaimAllowed=${relativePercentClaimAllowed}\`；这些百分比不得出现在简历标题。

## 封存期分块稳健性

确定性 MPC 重复不同随机种子会天然得到零方差，因此本报告不用“跨种子 0 波动”证明 MPC 稳定，
而是把 57 个月封存期切成三个连续时间块并分别冷启动回放。

| 时间块 | 代理延误 | 有效拥堵压力 | 吞吐保持 | 非保持动作率 |
|---|---:|---:|---:|---:|
${temporalRows}

## 简历使用边界

- 不可写“网络韧性评估模型准确率 89%”：仓库没有带真实韧性标签的监督学习任务，无法定义或验证 accuracy。
- 可以写“在 MPA+ERA5 公开数据的封存离线压力诊断中，三步 MPC 将代理延误从 A 降到 B、
  有效拥堵压力从 C 降到 D，同时报告吞吐、安全、动作率和时间分块结果”；不能只摘相对百分比。
- 五个动作的错峰、分流、能力与碳系数是公开的情景假设，并非来自真实干预 A/B 或因果估计；
  收益必须与这些参数及本报告的 \`claimEligibility\` 门禁一起解释。
- 默认数据容量、风速、完整风浪能见度、安全覆盖率分别为 ${dataset.quality.capacityCoveragePercent}% / ${dataset.quality.windCoveragePercent}% / ${dataset.quality.weatherCoveragePercent}% / ${dataset.quality.safetyCoveragePercent}%，因此不能外推为泊位级实时业务收益。
- 旧版 66% 报告保留在 \`reports/rl-benchmark-balanced-resilience.md\`，只作为校准前历史对照，不再作为当前简历证据。
`;

const reportDirectory = path.resolve('reports');
await mkdir(reportDirectory, { recursive: true });
const reportBaseName = `rl-benchmark-${objectiveId}-calibrated-v2`;
await writeFile(path.join(reportDirectory, `${reportBaseName}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(path.join(reportDirectory, `${reportBaseName}.md`), markdown, 'utf8');
process.stdout.write(`${path.join(reportDirectory, `${reportBaseName}.json`)}\n${path.join(reportDirectory, `${reportBaseName}.md`)}\n`);
