import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from '../../server/portTrainingDataset.ts';
import {
  buildRegulatoryScenarioRecords,
  evaluateRegulatoryPolicy,
  regulatoryMetricReductionPercent,
  trainRegulatoryPolicy,
  type RegulatoryEvaluation,
  type RegulatoryEvaluationMetrics,
  type RegulatoryPolicyArtifact,
  type RegulatoryShieldMode,
} from '../../server/regulatoryResilienceTraining.ts';
import {
  PRESERVED_OPERATIONAL_ACTION_IDS,
  REGULATORY_AUTHORITY_BOUNDARY,
  REGULATORY_OBSERVATION_CONTRACT,
  REGULATORY_OFFICIAL_SOURCES,
  REGULATORY_SUPPLEMENT_ACTIONS,
} from '../../shared/regulatoryResilienceContract.ts';

const EVIDENCE_LABEL = 'PREDECLARED_MALACCA_REGULATORY_SCENARIO_NOT_FIELD_KPI';
const REPORTS_DIRECTORY = path.resolve('reports');
const ARTIFACT_DIRECTORY = path.join(REPORTS_DIRECTORY, 'regulatory-resilience-artifacts');
const SEEDS = [17, 37, 59];
const EPISODES = Number(process.env.REGULATORY_TRAINING_EPISODES || 2_500);
const SOURCE_FILES = [
  'server/regulatoryResilienceTraining.ts',
  'shared/regulatoryResilienceContract.ts',
  'scripts/rl/runRegulatoryResilienceBenchmark.ts',
];
const PROTECTED_FILES = [
  'reports/rl-benchmark-balanced-resilience.json',
  'reports/rl-benchmark-balanced-resilience.md',
  'reports/rl-benchmark-balanced-resilience-calibrated-v2.json',
  'reports/rl-benchmark-balanced-resilience-calibrated-v2.md',
  'reports/public-dataset-credibility-comparison.json',
  'reports/public-dataset-credibility-comparison.md',
  'reports/operational-closure-acceptance-v1.json',
  'reports/operational-closure-acceptance-v1.md',
  'server/rlTrainingEngine.ts',
  'shared/rlOperationalCalibration.ts',
  'shared/rlObjectivePresets.ts',
];

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const sha256 = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');
const fileHash = async (file: string) => sha256(await readFile(path.resolve(file)));
const hashes = async (files: string[]) => Object.fromEntries(
  await Promise.all([...files].sort().map(async (file) => [file, await fileHash(file)])),
);

const stableHash = (value: unknown) => sha256(JSON.stringify(value, null, 0));

const metricsDelta = (baseline: RegulatoryEvaluationMetrics, candidate: RegulatoryEvaluationMetrics) => ({
  costReductionPercent: regulatoryMetricReductionPercent(baseline.incrementalCostMyr, candidate.incrementalCostMyr),
  carbonReductionPercent: regulatoryMetricReductionPercent(baseline.incrementalCarbonKg, candidate.incrementalCarbonKg),
  energyReductionPercent: regulatoryMetricReductionPercent(baseline.incrementalEnergyKwh, candidate.incrementalEnergyKwh),
  regulatoryDelayReductionPercent: regulatoryMetricReductionPercent(baseline.regulatoryDelayHours, candidate.regulatoryDelayHours),
  recoveryServiceChangePercent: round(
    regulatoryMetricReductionPercent(baseline.processedRecoveryVessels, candidate.processedRecoveryVessels) * -1,
  ),
  endingRecoveryBacklogChange: round(
    candidate.finalReleasedRecoveryVessels - baseline.finalReleasedRecoveryVessels,
  ),
  expectedSafetyViolationChange: round(
    candidate.expectedSafetyViolations - baseline.expectedSafetyViolations,
    6,
  ),
  authorityViolationChange: candidate.authorityViolations - baseline.authorityViolations,
});

const validationScore = (evaluation: RegulatoryEvaluation) =>
  evaluation.metrics.meanReward
  - evaluation.metrics.expectedSafetyViolations * 8
  - evaluation.metrics.finalReleasedRecoveryVessels / 5_000;

const pairedBootstrap = (
  baseline: RegulatoryEvaluation,
  candidate: RegulatoryEvaluation,
  seed = 2_026_082_1,
) => {
  const ratios = baseline.trace.map((point, index) => {
    const candidatePoint = candidate.trace[index];
    return (point.incrementalCostMyr - candidatePoint.incrementalCostMyr)
      / Math.max(1e-9, point.incrementalCostMyr) * 100;
  });
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const estimates = Array.from({ length: 2_000 }, () => {
    let sum = 0;
    for (let index = 0; index < ratios.length; index += 1) {
      sum += ratios[Math.floor(random() * ratios.length)];
    }
    return sum / Math.max(1, ratios.length);
  }).sort((left, right) => left - right);
  return {
    method: 'paired percentile bootstrap over frozen monthly test rows',
    samples: 2_000,
    pairedRows: ratios.length,
    estimatePercent: round(ratios.reduce((sum, value) => sum + value, 0) / Math.max(1, ratios.length), 4),
    lower95Percent: round(estimates[Math.floor(estimates.length * 0.025)], 4),
    upper95Percent: round(estimates[Math.floor(estimates.length * 0.975)], 4),
  };
};

const reportFor = async (
  version: 'v1' | 'v2',
  shieldMode: RegulatoryShieldMode,
  policies: RegulatoryPolicyArtifact[],
  validationRecords: ReturnType<typeof buildRegulatoryScenarioRecords>,
  frozenTestRecords: ReturnType<typeof buildRegulatoryScenarioRecords>,
  dataset: Awaited<ReturnType<typeof loadPortTrainingDataset>>,
  protectedBefore: Record<string, string>,
) => {
  const candidates = policies.map((policy) => {
    const validation = evaluateRegulatoryPolicy(policy, validationRecords, shieldMode);
    return {
      seed: policy.seed,
      episodes: policy.episodes,
      environmentSteps: policy.environmentSteps,
      parameterUpdates: policy.parameterUpdates,
      validationScore: round(validationScore(validation), 6),
      validationMetrics: validation.metrics,
      artifact: `reports/regulatory-resilience-artifacts/q-seed-${policy.seed}.json`,
    };
  });
  const selected = [...candidates].sort((left, right) =>
    right.validationScore - left.validationScore || left.seed - right.seed)[0];
  const selectedPolicy = policies.find((policy) => policy.seed === selected.seed)!;
  const baseline = evaluateRegulatoryPolicy(null, frozenTestRecords, 'unshielded');
  const candidate = evaluateRegulatoryPolicy(selectedPolicy, frozenTestRecords, shieldMode);
  const delta = metricsDelta(baseline.metrics, candidate.metrics);
  const protectedAfter = await hashes(PROTECTED_FILES);
  const changedProtectedFiles = PROTECTED_FILES.filter((file) => protectedBefore[file] !== protectedAfter[file]);
  const sourceFingerprint = await hashes(SOURCE_FILES);
  const gates = {
    minimumTrainingEpisodes: selected.episodes >= 2_500,
    threeSeedValidationSelection: candidates.length === 3,
    validationOnlySelection: true,
    frozenFinalTest: true,
    costNonRegression: delta.costReductionPercent >= 0,
    carbonNonRegression: delta.carbonReductionPercent >= 0,
    energyNonRegression: delta.energyReductionPercent >= 0,
    regulatoryDelayNonRegression: delta.regulatoryDelayReductionPercent >= 0,
    recoveryServiceNonRegression: delta.recoveryServiceChangePercent >= 0,
    endingRecoveryBacklogNonRegression: delta.endingRecoveryBacklogChange <= 1e-6,
    expectedSafetyNonRegression: delta.expectedSafetyViolationChange <= 1e-9,
    zeroAuthorityViolations: candidate.metrics.authorityViolations === 0,
    historicalArtifactsPreserved: changedProtectedFiles.length === 0,
  };
  const passed = Object.values(gates).every(Boolean);
  const base = {
    schemaVersion: `malacca-regulatory-resilience.${version}`,
    generatedAt: new Date().toISOString(),
    evidenceLabel: EVIDENCE_LABEL,
    status: passed ? 'qualified_offline' : 'blocked_candidate_preserved',
    strategy: {
      id: shieldMode === 'dominance-projected'
        ? 'regulatory-incremental-q-with-dominance-projection-v2'
        : 'unshielded-regulatory-incremental-q-v1',
      shieldMode,
      learnedControls: ['inspection_readiness_ratio', 'post_release_recovery_priority_ratio'],
      preservedOperationalActions: [...PRESERVED_OPERATIONAL_ACTION_IDS],
      projectionGuarantees: shieldMode === 'dominance-projected' ? [
        'official inspection selection, outcome and release remain exogenous',
        'post-release recovery service is not below the preserved supplement baseline',
        'regulatory delay, expected safety and ending recovery backlog cannot regress in the one-step model',
        'among feasible actions, select minimum modeled cost plus carbon burden',
      ] : [],
    },
    authority: REGULATORY_AUTHORITY_BOUNDARY,
    officialSources: REGULATORY_OFFICIAL_SOURCES,
    dataset: {
      id: dataset.id,
      fingerprint: dataset.fingerprint,
      evidenceLevel: dataset.evidenceLevel,
      recordCount: dataset.records.length,
      trainRows: dataset.trainRecords.length,
      validationRows: dataset.validationRecords.length,
      frozenTestRows: dataset.testRecords.length,
      scenarioFields: 'deterministic predeclared regulatory stress covariates; not field telemetry',
      frozenTestStressMultiplier: 1.35,
    },
    protocol: {
      algorithm: 'tabular Q-learning regulatory supplement',
      seeds: SEEDS,
      episodesPerSeed: EPISODES,
      selectionSplit: 'chronological validation only',
      finalSplit: 'chronological frozen test with predeclared 1.35x inspection stress',
      finalTestAccessBeforeSelection: false,
      trainingRendering: false,
      observationCount: REGULATORY_OBSERVATION_CONTRACT.length,
      supplementalActionCount: REGULATORY_SUPPLEMENT_ACTIONS.length,
      oldActionCountPreserved: PRESERVED_OPERATIONAL_ACTION_IDS.length,
    },
    candidates,
    selectedSeed: selected.seed,
    finalTest: {
      baseline: baseline.metrics,
      candidate: candidate.metrics,
      delta,
      costReductionCi95: pairedBootstrap(baseline, candidate),
      trace: candidate.trace,
    },
    gates,
    historicalPreservation: {
      protectedFileCount: PROTECTED_FILES.length,
      changedFiles: changedProtectedFiles,
      before: protectedBefore,
      after: protectedAfter,
    },
    sourceFingerprint: {
      algorithm: 'sha256',
      files: sourceFingerprint,
      digest: stableHash(sourceFingerprint),
    },
    limitations: [
      'Regulatory scenario covariates are deterministic stress assumptions, not measured inspection events.',
      'MPA monthly aggregate data are not terminal-level Malacca observations.',
      'Qualified offline does not authorize production dispatch or predict authority decisions.',
    ],
  };
  const evidenceSha256 = stableHash(base);
  return { ...base, evidenceSha256 };
};

const markdown = (report: Awaited<ReturnType<typeof reportFor>>) => {
  const delta = report.finalTest.delta;
  return `# 马六甲海事/海关检查韧性策略 ${report.schemaVersion.endsWith('v2') ? 'v2' : 'v1'}

> ${report.evidenceLabel}。监管情景字段不是现场遥测；检查选择、结果和官方放行均为外生信号。

- 状态：**${report.status}**
- 训练：${report.protocol.seeds.length} seeds × ${report.protocol.episodesPerSeed.toLocaleString()} episodes
- 选优：${report.protocol.selectionSplit}
- 最终测试：${report.dataset.frozenTestRows} 个冻结月度记录，检查压力 ×${report.dataset.frozenTestStressMultiplier}
- 原五类动作：保持不变
- 新增策略：仅检查准备与放行后恢复优先级

| 指标 | 相对保留策略 |
|---|---:|
| 场景成本降低 | ${delta.costReductionPercent.toFixed(4)}% |
| 碳排降低 | ${delta.carbonReductionPercent.toFixed(4)}% |
| 能耗降低 | ${delta.energyReductionPercent.toFixed(4)}% |
| 监管链延误降低 | ${delta.regulatoryDelayReductionPercent.toFixed(4)}% |
| 恢复服务变化 | ${delta.recoveryServiceChangePercent.toFixed(4)}% |
| 期末恢复积压变化 | ${delta.endingRecoveryBacklogChange.toFixed(4)} |
| 期望安全违规变化 | ${delta.expectedSafetyViolationChange.toFixed(6)} |

95% 成本降低区间：${report.finalTest.costReductionCi95.lower95Percent.toFixed(4)}%–${report.finalTest.costReductionCi95.upper95Percent.toFixed(4)}%。

业务结论：系统不预测或缩短主管机关检查时间，只在相同官方放行、恢复服务和安全约束下优化准备与恢复资源。

生产权限：\`false\`。
`;
};

await mkdir(ARTIFACT_DIRECTORY, { recursive: true });
const protectedBefore = await hashes(PROTECTED_FILES);
const dataset = await loadPortTrainingDataset();
const trainRecords = buildRegulatoryScenarioRecords(dataset.trainRecords);
const validationRecords = buildRegulatoryScenarioRecords(dataset.validationRecords);
const frozenTestRecords = buildRegulatoryScenarioRecords(dataset.testRecords, 1.35);
const policies = SEEDS.map((seed) => trainRegulatoryPolicy(trainRecords, seed, EPISODES));
for (const policy of policies) {
  await writeFile(
    path.join(ARTIFACT_DIRECTORY, `q-seed-${policy.seed}.json`),
    `${JSON.stringify(policy, null, 2)}\n`,
  );
}
const v1 = await reportFor('v1', 'unshielded', policies, validationRecords, frozenTestRecords, dataset, protectedBefore);
const v2 = await reportFor('v2', 'dominance-projected', policies, validationRecords, frozenTestRecords, dataset, protectedBefore);
for (const [name, report] of [['v1', v1], ['v2', v2]] as const) {
  await writeFile(path.join(REPORTS_DIRECTORY, `regulatory-resilience-${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(REPORTS_DIRECTORY, `regulatory-resilience-${name}.md`), markdown(report));
}
process.stdout.write(`${JSON.stringify({
  v1: { status: v1.status, selectedSeed: v1.selectedSeed, delta: v1.finalTest.delta },
  v2: { status: v2.status, selectedSeed: v2.selectedSeed, delta: v2.finalTest.delta, ci95: v2.finalTest.costReductionCi95 },
  protectedFilesChanged: v2.historicalPreservation.changedFiles,
}, null, 2)}\n`);
