import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CORE_OPERATIONS_ACTION_HEADS,
  CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  CORE_OPERATIONS_HARD_CONSTRAINTS,
  CORE_OPERATIONS_OBSERVATIONS,
  CORE_OPERATIONS_REWARD_COMPONENTS,
  CORE_OPERATIONS_RL_CONTRACT_VERSION,
} from '../../shared/coreOperationsRlContract.ts';
import type { CoreOperationsChampionResult } from '../../server/coreOperationsRlEngine.ts';

interface CoreOperationsEvidenceReport {
  schemaVersion: string;
  evidenceLabel: string;
  contract: {
    version: string;
    observations: Array<{ id: string }>;
    actionHeads: Array<{ id: string }>;
    rewardComponents: Array<{ id: string; weight: number }>;
    hardConstraints: string[];
    authorityBoundary: Record<string, boolean>;
  };
  sourceFingerprint: {
    algorithm: string;
    digest: string;
    files: Record<string, string>;
  };
  training: CoreOperationsChampionResult;
  releaseDecision: { operationalDeploymentAdmitted: boolean };
  runtimeClosure: {
    simulatorExecutionImplemented: boolean;
    pairedRuntimeCounterfactualImplemented: boolean;
    physicalExecutionImplemented: boolean;
  };
}

const reportPath = path.resolve(process.env.CORE_OPERATIONS_CHAMPION_REPORT || 'reports/core-operations-rl-champion-v1.json');
const report = JSON.parse(await readFile(reportPath, 'utf8')) as CoreOperationsEvidenceReport;
const errors: string[] = [];
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

if (report.schemaVersion !== 'core-operations-rl-evidence.v1') errors.push('unsupported core operations evidence schema');
if (report.evidenceLabel !== 'OFFLINE_PUBLIC_ANCHORED_ENGINEERING_AUGMENTED_SIMULATION_VALUE_NOT_FIELD_KPI') {
  errors.push('offline evidence boundary is missing');
}
if (report.contract?.version !== CORE_OPERATIONS_RL_CONTRACT_VERSION) errors.push('contract version mismatch');
const sameIds = (actual: string[], expected: string[], label: string) => {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) errors.push(`${label} mismatch`);
};
sameIds(report.contract?.observations?.map((item) => item.id) ?? [], CORE_OPERATIONS_OBSERVATIONS.map((item) => item.id), 'observations');
sameIds(report.contract?.actionHeads?.map((item) => item.id) ?? [], CORE_OPERATIONS_ACTION_HEADS.map((item) => item.id), 'action heads');
sameIds(report.contract?.rewardComponents?.map((item) => item.id) ?? [], CORE_OPERATIONS_REWARD_COMPONENTS.map((item) => item.id), 'rewards');
sameIds(report.contract?.hardConstraints ?? [], [...CORE_OPERATIONS_HARD_CONSTRAINTS], 'hard constraints');
if (Math.abs((report.contract?.rewardComponents ?? []).reduce((sum, item) => sum + item.weight, 0) - 1) > 1e-9) {
  errors.push('reward weights do not sum to one');
}
for (const [key, value] of Object.entries(CORE_OPERATIONS_AUTHORITY_BOUNDARY)) {
  if (report.contract?.authorityBoundary?.[key] !== value) errors.push(`authority boundary mismatch: ${key}`);
}
if (report.sourceFingerprint?.algorithm !== 'sha256') errors.push('source fingerprint algorithm mismatch');
const entries = Object.entries(report.sourceFingerprint?.files ?? {}) as Array<[string, string]>;
for (const [file, expected] of entries) {
  const actual = sha256(await readFile(path.resolve(file)));
  if (actual !== expected) errors.push(`stale source fingerprint: ${file}`);
}
const combined = sha256(entries.sort(([left], [right]) => left.localeCompare(right))
  .map(([file, digest]) => `${file}:${digest}`).join('\n'));
if (combined !== report.sourceFingerprint?.digest) errors.push('combined source fingerprint mismatch');

const champion = report.training?.champion;
const gate = champion?.finalTestGate;
if (!champion?.admitted || !champion?.validationGate?.passed || !gate?.passed) errors.push('offline champion was not admitted');
if (!Array.isArray(champion?.seedPolicies) || champion.seedPolicies.length < 5) errors.push('five-seed ensemble missing');
for (const policy of champion?.seedPolicies ?? []) {
  sameIds(policy.observationIds ?? [], CORE_OPERATIONS_OBSERVATIONS.map((item) => item.id), 'policy observations');
  sameIds(policy.heads?.map((item) => item.domain) ?? [], CORE_OPERATIONS_ACTION_HEADS.map((item) => item.id), 'policy heads');
  if (!policy.training || policy.training.environmentSteps <= 0 || policy.training.parameterUpdates <= policy.training.environmentSteps) {
    errors.push(`policy ${policy.hyperparameters?.seed} has no real factorized parameter updates`);
  }
}
if (gate?.evidence?.activeDomainCount !== CORE_OPERATIONS_ACTION_HEADS.length) errors.push('not every core domain acted on sealed test');
if (gate?.evidence?.hardConstraintViolations !== 0) errors.push('hard constraint violations are non-zero');
if (gate?.evidence?.maximumSafetyProjectionRatePercent !== 0) errors.push('sealed evaluation required safety substitution');
if (gate?.evidence?.rewardImprovement?.lower95 < gate?.thresholds?.minimumRewardImprovementLower95) errors.push('reward value gate failed');
if (report.releaseDecision?.operationalDeploymentAdmitted !== false ||
    report.contract?.authorityBoundary?.production_authority !== false ||
    report.contract?.authorityBoundary?.dispatch_allowed !== false) {
  errors.push('production authority boundary was weakened');
}
if (report.runtimeClosure?.simulatorExecutionImplemented !== true ||
    report.runtimeClosure?.pairedRuntimeCounterfactualImplemented !== true ||
    report.runtimeClosure?.physicalExecutionImplemented !== false) {
  errors.push('runtime closure boundary is inconsistent');
}

if (errors.length) {
  process.stderr.write(`${errors.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`CORE_OPERATIONS_CHAMPION_EVIDENCE:PASS:${champion.algorithmId}:${champion.attemptId}:${gate.evidence.activeDomainCount}/${CORE_OPERATIONS_ACTION_HEADS.length}\n`);
}
