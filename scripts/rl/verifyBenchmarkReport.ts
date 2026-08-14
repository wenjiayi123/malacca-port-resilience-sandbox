import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from '../../server/portTrainingDataset.ts';

interface BenchmarkReport {
  schemaVersion: string;
  evidenceLabel: string;
  dataset: {
    fingerprint: string;
    quality: {
      operationalClaimAllowed: boolean;
    };
  };
  datasetScale: {
    monthlyRecords: number;
    cumulativeVesselArrivals: number;
    range: [string, string];
  };
  sourceFingerprint: {
    algorithm: string;
    digest: string;
    files: Record<string, string>;
  };
  heldOutTest: Record<string, Record<string, Record<string, {
    mean: number;
    std: number;
    min: number;
    max: number;
    samples: number;
  }>>>;
  modelContract: {
    calibrationId: string;
    observations: string[];
    actions: Array<{
      id: string;
      evidenceLevel: string;
      deferredDemandFraction: number;
      divertedDemandFraction: number;
      capacityMultiplier: number;
    }>;
    evaluationSafetyMetric: string;
  };
  provisionalResumeMetric: {
    recommendedMethodId: string;
    allowedOnlyWithOfflineReplayQualifier: boolean;
    relativePercentClaimAllowed: boolean;
  };
  claimEligibility: {
    methodId: string;
    relativePercentClaimAllowed: boolean;
    checks: Record<string, boolean>;
    passed: boolean;
    scope: string;
  };
  temporalRobustness: {
    methodId: string;
    testCaseId: string;
    blocks: Array<{
      range: [string, string];
      baselineMeanDelayHours: number;
      modeledMeanDelayHours: number;
      interventionRatePercent: number;
    }>;
  };
}

const reportPath = path.resolve(
  process.env.RL_BENCHMARK_REPORT || 'reports/rl-benchmark-balanced-resilience-calibrated-v2.json',
);
const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport;
const errors: string[] = [];
const warnings: string[] = [];
if (report.schemaVersion !== 'resume-rl-benchmark.v2') errors.push('unsupported report schema');
if (report.evidenceLabel !== 'OFFLINE_MODEL_REPLAY_NOT_FIELD_KPI') errors.push('missing evidence boundary');
if (report.dataset.quality.operationalClaimAllowed !== false) {
  errors.push('default public aggregate report must not allow operational claims');
}
if (!report.modelContract?.observations.includes('deferred_backlog_to_capacity')) {
  errors.push('observation contract must include deferred backlog');
}
if (report.modelContract?.calibrationId !== 'public-aggregate-conservative-v2') {
  errors.push('missing conservative calibration contract');
}
if (report.modelContract?.actions.length !== 5 ||
    report.modelContract.actions.some((action) => action.evidenceLevel !== 'bounded_scenario_assumption')) {
  errors.push('action assumptions are incomplete or overclaimed');
}
if (report.modelContract.actions.some((action) =>
  action.deferredDemandFraction > 0.02 ||
  action.divertedDemandFraction > 0.01 ||
  action.capacityMultiplier < 0.995 ||
  action.capacityMultiplier > 1.02)) {
  errors.push('action exceeds the public aggregate intervention envelope');
}
if (report.modelContract?.evaluationSafetyMetric !== 'mean expected violation probability per time step') {
  errors.push('deterministic safety metric is not the expected modeled risk');
}
if (report.provisionalResumeMetric?.recommendedMethodId !== 'mpc' ||
    report.provisionalResumeMetric?.allowedOnlyWithOfflineReplayQualifier !== true ||
    report.provisionalResumeMetric?.relativePercentClaimAllowed !== false) {
  errors.push('resume metric must remain an offline-qualified MPC result');
}
if (report.claimEligibility?.methodId !== 'mpc' ||
    report.claimEligibility?.scope !== 'offline_aggregate_stress_diagnostic_only' ||
    report.claimEligibility?.relativePercentClaimAllowed !== false ||
    report.claimEligibility?.passed !== Object.values(report.claimEligibility?.checks || {}).every(Boolean)) {
  errors.push('claim eligibility gate is inconsistent');
}
if (report.temporalRobustness?.methodId !== 'mpc' ||
    report.temporalRobustness?.testCaseId !== 'peak-congestion-stress' ||
    report.temporalRobustness?.blocks.length !== 3 ||
    report.temporalRobustness.blocks.some((block) =>
      block.range.length !== 2 ||
      ![
        block.baselineMeanDelayHours,
        block.modeledMeanDelayHours,
        block.interventionRatePercent,
      ].every(Number.isFinite))) {
  errors.push('three-block temporal robustness evidence is incomplete');
}
const dataset = await loadPortTrainingDataset();
if (report.dataset.fingerprint !== dataset.fingerprint) errors.push('dataset fingerprint mismatch');
const cumulativeVesselArrivals = dataset.records.reduce((sum, record) => sum + record.arrivals, 0);
if (report.datasetScale?.monthlyRecords !== dataset.records.length ||
    report.datasetScale?.cumulativeVesselArrivals !== cumulativeVesselArrivals ||
    report.datasetScale?.range[0] !== dataset.records[0].timestamp ||
    report.datasetScale?.range[1] !== dataset.records.at(-1)!.timestamp) {
  errors.push('dataset scale summary mismatch');
}
if (report.sourceFingerprint.algorithm !== 'sha256') errors.push('unsupported source fingerprint');

const sourceEntries = Object.entries(report.sourceFingerprint.files).sort(([left], [right]) =>
  left.localeCompare(right));
const recomputedFiles: Record<string, string> = {};
const sourceDriftFiles: string[] = [];
const archivedEnvironmentFiles = new Set(['package.json', 'pnpm-lock.yaml']);
for (const [file, expectedDigest] of sourceEntries) {
  const digest = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
  recomputedFiles[file] = digest;
  if (digest !== expectedDigest) {
    sourceDriftFiles.push(file);
    if (archivedEnvironmentFiles.has(file)) warnings.push(`archived environment fingerprint differs from current candidate: ${file}`);
    else errors.push(`stale core source fingerprint: ${file}`);
  }
}
const recomputedDigest = createHash('sha256')
  .update(sourceEntries.map(([file]) => `${file}:${recomputedFiles[file]}`).join('\n'))
  .digest('hex');
if (recomputedDigest !== report.sourceFingerprint.digest) {
  if (sourceDriftFiles.every((file) => archivedEnvironmentFiles.has(file))) {
    warnings.push('archived combined fingerprint intentionally differs after dependency/version update; report was not rewritten');
  } else {
    errors.push('combined source fingerprint mismatch');
  }
}

const algorithms = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'];
for (const algorithm of algorithms) {
  const cases = report.heldOutTest[algorithm];
  if (!cases) {
    errors.push(`missing held-out results for ${algorithm}`);
    continue;
  }
  for (const testCase of ['closed-loop-replay', 'peak-congestion-stress', 'weather-disturbance-generalization']) {
    const metrics = cases[testCase];
    if (!metrics) {
      errors.push(`missing ${testCase} results for ${algorithm}`);
      continue;
    }
    for (const [metric, summary] of Object.entries(metrics)) {
      if (![summary.mean, summary.std, summary.min, summary.max, summary.samples].every(Number.isFinite)) {
        errors.push(`non-finite ${algorithm}/${testCase}/${metric}`);
      }
      if (summary.samples < 2) errors.push(`insufficient seeds for ${algorithm}/${testCase}/${metric}`);
    }
  }
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
for (const warning of warnings) process.stderr.write(`WARN ${warning}\n`);
if (errors.length) process.exit(1);
process.stdout.write(`Archived benchmark evidence verified without rewriting: ${path.relative(process.cwd(), reportPath)}\n`);
