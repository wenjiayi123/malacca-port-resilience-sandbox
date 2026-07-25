import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from '../../server/portTrainingDataset.ts';
import {
  evaluateTrainedPolicy,
  RL_ALGORITHMS,
  trainRlBenchmark,
  type RlAlgorithmId,
  type RlTrainingArtifacts,
  type RlTrainingRequest,
} from '../../server/rlTrainingEngine.ts';

interface AisPackage {
  protocolVersion: string;
  manifest: {
    datasetId: string;
    title: string;
    source: string;
    sourceUrl: string;
    doi: string;
    license: string;
    archiveMd5: string;
    rawMessageCount: number;
    rawPeriod: [string, string];
    derivedRecordCount: number;
    aggregation: string;
    demandMode: string;
    grossTonnageMode: string;
    limitations: string[];
  };
  records: unknown[];
}

interface Summary {
  mean: number;
  standardDeviation: number;
  samples: number;
}

const summarize = (values: number[]): Summary => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length);
  return {
    mean: Number(mean.toFixed(3)),
    standardDeviation: Number(Math.sqrt(variance).toFixed(3)),
    samples: values.length,
  };
};

const inputPath = path.resolve(
  process.env.INFORE_AIS_OUTPUT_PATH ||
  '.runtime/public-datasets/infore-piraeus-ais-minute.json',
);
const reportPath = path.resolve(
  process.env.PUBLIC_DATASET_COMPARISON_REPORT ||
  'reports/public-dataset-credibility-comparison.json',
);
const markdownPath = reportPath.replace(/\.json$/i, '.md');
const aisPackage = JSON.parse(await readFile(inputPath, 'utf8')) as AisPackage;
if (aisPackage.protocolVersion !== 'public-ais-training-package.v1') {
  throw new Error('unsupported INFORE AIS package protocol');
}
if (aisPackage.manifest.grossTonnageMode !== 'neutral-control-scaling-not-observed-tonnage') {
  throw new Error('AIS package must keep non-observed tonnage outside metric claims');
}

const dataset = await loadPortTrainingDataset(inputPath, 'GRPIR-AIS-RECEIVER');
const episodes = Number(process.env.PUBLIC_DATASET_BENCHMARK_EPISODES || 120);
const seeds = (process.env.PUBLIC_DATASET_BENCHMARK_SEEDS || '240520,240521,240522')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter(Number.isInteger);
if (seeds.length < 2) throw new Error('at least two public-dataset benchmark seeds are required');

const runs: Array<{ request: RlTrainingRequest; artifacts: RlTrainingArtifacts }> = [];
for (const seed of seeds) {
  const request: RlTrainingRequest = {
    protocolVersion: 'rl-training-job.v1',
    objectiveId: 'port-congestion-relief',
    trainingParameters: {
      maxEpisodes: episodes,
      seed,
      learningRate: 0.12,
      discountGamma: 0.97,
      tuningTrials: 3,
    },
    rewardWeights: {
      delay: 0.35,
      congestion: 0.35,
      throughput: 0.3,
      carbon: 0,
      safety: 0,
      resilience: 0,
    },
    scenarioSnapshot: { scenarioId: 'piraeus-ais-density-external-validation' },
  };
  runs.push({
    request,
    artifacts: await trainRlBenchmark(request, dataset, () => undefined),
  });
}

const methods = Object.fromEntries(RL_ALGORITHMS.map((algorithm) => {
  const validation = runs.map((run) =>
    run.artifacts.benchmark.results.find((result) => result.id === algorithm.id)!);
  const heldOut = runs.map((run) => evaluateTrainedPolicy(
    `public-data-${run.request.trainingParameters?.seed}`,
    algorithm.id,
    'closed-loop-replay',
    run.artifacts,
    dataset,
    run.request,
  ));
  return [algorithm.id, {
    label: algorithm.label,
    family: algorithm.family,
    validationSelectionScore: summarize(validation.map((result) => result.selectionScore)),
    environmentSteps: validation.map((result) => result.training.environmentSteps),
    heldOutDelayReductionPercent: summarize(heldOut.map((result) => result.metrics.delayReductionPercent)),
    heldOutCongestionReductionPercent: summarize(heldOut.map((result) => result.metrics.congestionReductionPercent)),
    heldOutThroughputRetentionPercent: summarize(
      heldOut.map((result) => result.metrics.modeled.throughputRetentionPercent),
    ),
  }];
})) as Record<RlAlgorithmId, {
  label: string;
  family: string;
  validationSelectionScore: Summary;
  environmentSteps: number[];
  heldOutDelayReductionPercent: Summary;
  heldOutCongestionReductionPercent: Summary;
  heldOutThroughputRetentionPercent: Summary;
}>;

const selectedMethodId = (Object.entries(methods) as Array<[RlAlgorithmId, typeof methods[RlAlgorithmId]]>)
  .sort((left, right) =>
    right[1].validationSelectionScore.mean - left[1].validationSelectionScore.mean)[0][0];
const existingReport = JSON.parse(await readFile(
  path.resolve('reports/rl-benchmark-balanced-resilience.json'),
  'utf8',
)) as {
  dataset: { recordCount: number; trainRange: [string, string]; testRange: [string, string]; fingerprint: string };
  provisionalResumeMetric: { recommendedMethodId: string };
};
const comparisonSourcePaths = [
  'server/rlTrainingEngine.ts',
  'server/portTrainingDataset.ts',
  'scripts/data/sync_infore_ais.mjs',
  'scripts/rl/runPublicDatasetComparison.ts',
  'package.json',
  'pnpm-lock.yaml',
];
const comparisonSourceHashes: Record<string, string> = {};
const comparisonSourceDigest = createHash('sha256');
for (const sourcePath of comparisonSourcePaths) {
  const content = await readFile(path.resolve(sourcePath));
  const digest = createHash('sha256').update(content).digest('hex');
  comparisonSourceHashes[sourcePath] = digest;
  comparisonSourceDigest.update(`${sourcePath}\0${digest}\n`);
}

const report = {
  schemaVersion: 'public-dataset-credibility-comparison.v1',
  generatedAt: new Date().toISOString(),
  evidenceLabel: 'AIS_TRAFFIC_DENSITY_EXTERNAL_VALIDATION_NOT_PORT_KPI',
  sourceFingerprint: {
    algorithm: 'sha256',
    digest: comparisonSourceDigest.digest('hex'),
    files: comparisonSourceHashes,
  },
  comparison: {
    existingMacroBenchmark: {
      dataset: 'MPA vessel arrivals monthly + Open-Meteo ERA5',
      sourceType: 'official monthly aggregate',
      recordCount: existingReport.dataset.recordCount,
      period: [existingReport.dataset.trainRange[0], existingReport.dataset.testRange[1]],
      fingerprint: existingReport.dataset.fingerprint,
      strongestUse: 'long-horizon demand and offline control reproducibility',
      recommendedMethodId: existingReport.provisionalResumeMetric.recommendedMethodId,
    },
    highFrequencyBenchmark: {
      dataset: aisPackage.manifest.title,
      sourceType: 'raw anonymized AIS receiver messages',
      source: aisPackage.manifest.source,
      sourceUrl: aisPackage.manifest.sourceUrl,
      doi: aisPackage.manifest.doi,
      license: aisPackage.manifest.license,
      archiveMd5: aisPackage.manifest.archiveMd5,
      rawMessageCount: aisPackage.manifest.rawMessageCount,
      derivedRecordCount: dataset.records.length,
      period: aisPackage.manifest.rawPeriod,
      fingerprint: dataset.fingerprint,
      split: dataset.split,
      aggregation: aisPackage.manifest.aggregation,
      demandMode: aisPackage.manifest.demandMode,
      limitations: aisPackage.manifest.limitations,
      strongestUse: 'high-frequency ingestion, temporal split and algorithm-scale external validation',
      selectedMethodId,
      methods,
    },
  },
  verdict: {
    primaryResumeEvidence: 'MPA+ERA5 aggregate-v1 benchmark',
    secondaryScaleEvidence: 'INFORE Piraeus AIS one-minute traffic-density benchmark',
    rationale: [
      'MPA covers more than three decades and represents official vessel-arrival statistics, so it is stronger for long-horizon demand evidence.',
      'INFORE supplies 371k raw messages and 1,440 minute-level records, so it is stronger for high-frequency ingestion and execution-scale evidence.',
      'The AIS source covers only 24 hours, has no measured terminal capacity, GT, weather, safety or intervention outcomes, and cannot support carbon or Shanghai field-benefit claims.',
      'A Shanghai operational claim remains blocked until an authorized CNSHA/SIPG terminal-operations.v2 manifest passes every required field gate.',
    ],
    operationalClaimAllowed: false,
  },
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const methodRows = (Object.entries(methods) as Array<[RlAlgorithmId, typeof methods[RlAlgorithmId]]>)
  .map(([, value]) => `| ${value.label} | ${value.family === 'control-theory' ? '控制' : 'RL'} | ${value.validationSelectionScore.mean.toFixed(2)} ± ${value.validationSelectionScore.standardDeviation.toFixed(2)} | ${value.heldOutDelayReductionPercent.mean.toFixed(2)} ± ${value.heldOutDelayReductionPercent.standardDeviation.toFixed(2)}% | ${value.heldOutCongestionReductionPercent.mean.toFixed(2)} ± ${value.heldOutCongestionReductionPercent.standardDeviation.toFixed(2)}% | ${value.heldOutThroughputRetentionPercent.mean.toFixed(2)} ± ${value.heldOutThroughputRetentionPercent.standardDeviation.toFixed(2)}% |`)
  .join('\n');
const markdown = `# 公开数据集规模与可信度比较

> 证据边界：INFORE 数据用于 AIS 流量密度外部验证，不是上海港现场 KPI、港口调用事件或实测干预收益。

## 数据对照

| 数据集 | 原始量 | 训练记录 | 时间跨度 | 最可信用途 |
|---|---:|---:|---|---|
| MPA 到港月报 + ERA5 | 377 月度记录 | 377 | ${existingReport.dataset.trainRange[0]} → ${existingReport.dataset.testRange[1]} | 官方长期到港需求与离线控制复现 |
| INFORE Piraeus AIS | ${aisPackage.manifest.rawMessageCount.toLocaleString('en-US')} AIS 消息 | ${dataset.records.length.toLocaleString('en-US')} 分钟记录 | ${aisPackage.manifest.rawPeriod[0]} → ${aisPackage.manifest.rawPeriod[1]} | 高频数据接入、时间切分与执行规模 |

## INFORE 五基线留出比较

训练目标只包含延误、拥堵和吞吐；碳、安全与韧性权重为 0。容量仍为训练段代理，不能解释为码头实测能力。

| 方法 | 分类 | 验证选择分 | 延误变化 | 拥堵变化 | 吞吐保持 |
|---|---|---:|---:|---:|---:|
${methodRows}

验证选择方法：\`${selectedMethodId}\`。该结果只说明同一 AIS 密度代理环境内的相对表现。

## 使用结论

- 简历主指标继续使用 MPA+ERA5 的版本化离线基准，因为它的官方来源和长期覆盖更适合需求侧证据。
- INFORE 作为规模证据：公开说明处理 ${aisPackage.manifest.rawMessageCount.toLocaleString('en-US')} 条原始 AIS 消息并形成 ${dataset.records.length.toLocaleString('en-US')} 条分钟级记录，完成四种 RL + MPC 的统一时间留出比较。
- INFORE 只有 24 小时、且没有实测 GT、泊位能力、天气、安全或真实动作结果，不能替代上海港数据。
- 上海落地必须由授权的 \`terminal-operations.v2\` 数据清单通过门禁后再训练和测试。
`;
await writeFile(markdownPath, markdown, 'utf8');
process.stdout.write(`Public dataset comparison written: ${path.relative(process.cwd(), reportPath)}\n`);
