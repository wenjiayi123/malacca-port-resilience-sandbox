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
    observations: string[];
    actions: Array<{
      id: string;
      evidenceLevel: string;
    }>;
    evaluationSafetyMetric: string;
  };
  provisionalResumeMetric: {
    recommendedMethodId: string;
    allowedOnlyWithOfflineReplayQualifier: boolean;
  };
  claimEligibility: {
    methodId: string;
    checks: Record<string, boolean>;
    passed: boolean;
    scope: string;
  };
}

const reportPath = path.resolve(
  process.env.RL_BENCHMARK_REPORT || 'reports/rl-benchmark-balanced-resilience.json',
);
const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport;
const errors: string[] = [];
if (report.schemaVersion !== 'resume-rl-benchmark.v1') errors.push('unsupported report schema');
if (report.evidenceLabel !== 'OFFLINE_MODEL_REPLAY_NOT_FIELD_KPI') errors.push('missing evidence boundary');
if (report.dataset.quality.operationalClaimAllowed !== false) {
  errors.push('default public aggregate report must not allow operational claims');
}
if (!report.modelContract?.observations.includes('deferred_backlog_to_capacity')) {
  errors.push('observation contract must include deferred backlog');
}
if (report.modelContract?.actions.length !== 5 ||
    report.modelContract.actions.some((action) => action.evidenceLevel !== 'declared_scenario_assumption')) {
  errors.push('action assumptions are incomplete or overclaimed');
}
if (report.modelContract?.evaluationSafetyMetric !== 'mean expected violation probability per time step') {
  errors.push('deterministic safety metric is not the expected modeled risk');
}
if (report.provisionalResumeMetric?.recommendedMethodId !== 'mpc' ||
    report.provisionalResumeMetric?.allowedOnlyWithOfflineReplayQualifier !== true) {
  errors.push('resume metric must remain an offline-qualified MPC result');
}
if (report.claimEligibility?.methodId !== 'mpc' ||
    report.claimEligibility?.scope !== 'offline_model_replay_only' ||
    report.claimEligibility?.passed !== Object.values(report.claimEligibility?.checks || {}).every(Boolean)) {
  errors.push('claim eligibility gate is inconsistent');
}
const dataset = await loadPortTrainingDataset();
if (report.dataset.fingerprint !== dataset.fingerprint) errors.push('dataset fingerprint mismatch');
if (report.sourceFingerprint.algorithm !== 'sha256') errors.push('unsupported source fingerprint');

const sourceEntries = Object.entries(report.sourceFingerprint.files).sort(([left], [right]) =>
  left.localeCompare(right));
const recomputedFiles: Record<string, string> = {};
for (const [file, expectedDigest] of sourceEntries) {
  const digest = createHash('sha256').update(await readFile(path.resolve(file))).digest('hex');
  recomputedFiles[file] = digest;
  if (digest !== expectedDigest) errors.push(`stale source fingerprint: ${file}`);
}
const recomputedDigest = createHash('sha256')
  .update(sourceEntries.map(([file]) => `${file}:${recomputedFiles[file]}`).join('\n'))
  .digest('hex');
if (recomputedDigest !== report.sourceFingerprint.digest) errors.push('combined source fingerprint mismatch');

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
if (errors.length) process.exit(1);
process.stdout.write(`Benchmark evidence verified: ${path.relative(process.cwd(), reportPath)}\n`);
