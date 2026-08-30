import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  PORT_BUSINESS_ACTIONS,
  PORT_BUSINESS_AUTHORITY_BOUNDARY,
  PORT_BUSINESS_HARD_CONSTRAINTS,
  PORT_BUSINESS_OBSERVATIONS,
  PORT_BUSINESS_RESPONSIBILITY_MATRIX,
  PORT_BUSINESS_REWARD_COMPONENTS,
  PORT_BUSINESS_RL_CONTRACT_VERSION,
} from '../../shared/portBusinessRlContract.ts';
import { loadPortBusinessDataset } from '../../server/portBusinessDataset.ts';

interface Summary {
  mean: number;
  lower95: number;
  upper95: number;
  min: number;
  max: number;
  samples: number;
}

interface EvidenceReport {
  schemaVersion: string;
  evidenceLabel: string;
  sourceFingerprint: {
    algorithm: string;
    digest: string;
    files: Record<string, string>;
  };
  publicEvidence: Array<{ role: string; url: string }>;
  coverageAudit: Array<{ domain: string; owner: string }>;
  contract: {
    version: string;
    observations: Array<{ id: string }>;
    actions: Array<{ id: string }>;
    rewardComponents: Array<{ id: string; weight: number }>;
    hardConstraints: string[];
    responsibilityMatrix: Array<{ owner: string; learned: boolean }>;
    authorityBoundary: Record<string, boolean>;
  };
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: string;
    operationalClaimAllowed: boolean;
    recordCount: number;
    split: { trainRange: [string, string]; validationRange: [string, string]; testRange: [string, string] };
    lineage: Array<{ field: string; mode: string }>;
    quality: {
      engineeringDerivedFieldCount: number;
      operatorMeasuredFieldCount: number;
      operatorMeasurementCoveragePercent: number;
      leakageChecks: Record<string, boolean>;
    };
    retainedArtifact: { path: string; integrityDigest: string };
  };
  nonReinforcementLearning: {
    demandForecast: {
      validation: { model: { wapePercent: number }; seasonalNaive: { wapePercent: number } };
      sealedTest: { model: { wapePercent: number }; seasonalNaive: { wapePercent: number } };
      gate: Record<string, boolean>;
    };
    deterministicOptimizer: { dispatchAllowed: boolean; results: unknown[] };
    safetyAndAuthority: { dispatchAllowed: boolean; humanApprovalRequired: boolean; externalDecisions: string[] };
  };
  training: {
    protocolVersion: string;
    dataset: { fingerprint: string; sealedTestRange: [string, string] };
    attempts: Array<{
      attemptId: string;
      status: string;
      seeds: number[];
      candidates: Array<{ algorithmId: string; configurationId: string; selectedForAlgorithm: boolean }>;
      validationGate: { passed: boolean; checks: Record<string, boolean> };
    }>;
    champion: {
      admitted: boolean;
      algorithmId: string;
      attemptId: string;
      seedPolicies: Array<{
        observationIds: string[];
        actionIds: string[];
        weights: number[][];
        hyperparameters: { seed: number; episodes: number };
        training: { environmentSteps: number; parameterUpdates: number };
      }>;
      validationGate: { passed: boolean; checks: Record<string, boolean> };
      finalTestGate: {
        passed: boolean;
        checks: Record<string, boolean>;
        evidence: {
          rewardImprovement: Summary;
          waitReductionHours: Summary;
          queueReductionVessels: Summary;
          carbonReductionPercent: Summary;
          fairnessGapReductionPoints: Summary;
          minimumThroughputRetentionPercent: number;
          maximumSafetyProjectionRatePercent: number;
          hardConstraintViolations: number;
          materialDelaySampleCount: number;
        };
      };
      finalTest: {
        reinforcementLearning: unknown[];
        standardOperatingProcedure: unknown[];
        deterministicOptimizer: unknown[];
      };
    };
    boundary: Record<string, boolean>;
  };
  retainedArtifacts: {
    allAttempts: string;
    championPolicies: Array<{ seed: number; path: string; digest: string }>;
  };
  releaseDecision: {
    offlineChampionAdmitted: boolean;
    validationGatePassed: boolean;
    finalTestGatePassed: boolean;
    operationalDeploymentAdmitted: boolean;
  };
}

const reportPath = path.resolve(
  process.env.PORT_BUSINESS_CHAMPION_REPORT || 'reports/port-business-rl-champion-v3.json',
);
const report = JSON.parse(await readFile(reportPath, 'utf8')) as EvidenceReport;
const errors: string[] = [];
const warnings: string[] = [];
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

if (report.schemaVersion !== 'port-business-rl-evidence.v3') errors.push('unsupported evidence schema');
if (report.evidenceLabel !== 'OFFLINE_PUBLIC_ANCHORED_ENGINEERING_AUGMENTED_NOT_FIELD_KPI') {
  errors.push('offline evidence boundary is missing');
}
if (report.sourceFingerprint.algorithm !== 'sha256') errors.push('unsupported source fingerprint algorithm');
const fileEntries = Object.entries(report.sourceFingerprint.files)
  .sort(([left], [right]) => left.localeCompare(right));
for (const [file, expected] of fileEntries) {
  const actual = sha256(await readFile(path.resolve(file)));
  if (actual !== expected) errors.push(`stale source fingerprint: ${file}`);
}
const combined = sha256(fileEntries.map(([file, digest]) => `${file}:${digest}`).join('\n'));
if (combined !== report.sourceFingerprint.digest) errors.push('combined source fingerprint mismatch');

if (report.publicEvidence.filter((item) => item.role === 'training-anchor').length < 2 ||
    !report.publicEvidence.some((item) => item.url.includes('data.gov.sg')) ||
    !report.publicEvidence.some((item) => item.url.includes('worldbank.org'))) {
  errors.push('public data and business metric provenance are incomplete');
}
if (report.coverageAudit.length < 9 || !report.coverageAudit.some((item) => item.owner.includes('external-authority'))) {
  errors.push('business coverage audit is incomplete');
}
if (report.contract.version !== PORT_BUSINESS_RL_CONTRACT_VERSION) errors.push('contract version mismatch');
const compareIds = (actual: string[], expected: string[], label: string) => {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    errors.push(`${label} contract mismatch`);
  }
};
compareIds(report.contract.observations.map((item) => item.id), PORT_BUSINESS_OBSERVATIONS.map((item) => item.id), 'observation');
compareIds(report.contract.actions.map((item) => item.id), PORT_BUSINESS_ACTIONS.map((item) => item.id), 'action');
compareIds(report.contract.rewardComponents.map((item) => item.id), PORT_BUSINESS_REWARD_COMPONENTS.map((item) => item.id), 'reward');
if (Math.abs(report.contract.rewardComponents.reduce((sum, item) => sum + item.weight, 0) - 1) > 1e-9) {
  errors.push('reward weights do not sum to one');
}
if (JSON.stringify(report.contract.hardConstraints) !== JSON.stringify(PORT_BUSINESS_HARD_CONSTRAINTS)) {
  errors.push('hard constraint contract mismatch');
}
if (report.contract.responsibilityMatrix.length !== PORT_BUSINESS_RESPONSIBILITY_MATRIX.length ||
    !report.contract.responsibilityMatrix.some((item) => item.owner === 'external-authority' && !item.learned)) {
  errors.push('RL versus non-RL responsibility matrix mismatch');
}
for (const flag of ['dispatch_allowed', 'production_authority', 'live_data_verified']) {
  if (report.contract.authorityBoundary[flag] !== PORT_BUSINESS_AUTHORITY_BOUNDARY[flag as keyof typeof PORT_BUSINESS_AUTHORITY_BOUNDARY]) {
    errors.push(`authority boundary mismatch: ${flag}`);
  }
}

const dataset = await loadPortBusinessDataset();
if (report.dataset.id !== dataset.id || report.dataset.fingerprint !== dataset.fingerprint ||
    report.training.dataset.fingerprint !== dataset.fingerprint || report.dataset.recordCount !== dataset.records.length) {
  errors.push('dataset identity or fingerprint mismatch');
}
if (report.dataset.operationalClaimAllowed || report.dataset.evidenceLevel !== 'public-aggregate-with-engineering-augmentation') {
  errors.push('public augmented dataset must not allow operational claims');
}
if (report.dataset.quality.operatorMeasuredFieldCount !== 0 ||
    report.dataset.quality.operatorMeasurementCoveragePercent !== 0 ||
    report.dataset.quality.engineeringDerivedFieldCount < 20 ||
    !Object.values(report.dataset.quality.leakageChecks).every(Boolean)) {
  errors.push('data quality, lineage or leakage boundary is invalid');
}
if (!report.dataset.lineage.some((item) => item.mode === 'public-anchor') ||
    !report.dataset.lineage.some((item) => item.mode === 'engineering-derived')) {
  errors.push('field-level provenance classes are incomplete');
}
if (JSON.stringify(report.dataset.split.testRange) !== JSON.stringify(dataset.split.testRange) ||
    JSON.stringify(report.training.dataset.sealedTestRange) !== JSON.stringify(dataset.split.testRange)) {
  errors.push('sealed chronological test range mismatch');
}

const nonRlGate = report.nonReinforcementLearning.demandForecast.gate;
if (!Object.values(nonRlGate).every(Boolean) ||
    report.nonReinforcementLearning.demandForecast.validation.model.wapePercent >=
      report.nonReinforcementLearning.demandForecast.validation.seasonalNaive.wapePercent ||
    report.nonReinforcementLearning.demandForecast.sealedTest.model.wapePercent >=
      report.nonReinforcementLearning.demandForecast.sealedTest.seasonalNaive.wapePercent) {
  errors.push('non-RL public-data demand forecast gate failed');
}
if (report.nonReinforcementLearning.deterministicOptimizer.dispatchAllowed ||
    report.nonReinforcementLearning.deterministicOptimizer.results.length !== 4 ||
    report.nonReinforcementLearning.safetyAndAuthority.dispatchAllowed ||
    !report.nonReinforcementLearning.safetyAndAuthority.humanApprovalRequired ||
    report.nonReinforcementLearning.safetyAndAuthority.externalDecisions.length < 6) {
  errors.push('non-RL optimizer, safety or authority boundary is incomplete');
}

if (report.training.protocolVersion !== 'port-business-champion.v3' || report.training.attempts.length < 2) {
  errors.push('training ladder or protocol evidence is incomplete');
}
for (const attempt of report.training.attempts) {
  if (attempt.seeds.length !== 5 || new Set(attempt.seeds).size !== 5 || attempt.candidates.length !== 8 ||
      new Set(attempt.candidates.map((item) => item.algorithmId)).size !== 4 ||
      !Object.values(attempt.validationGate.checks).every(Boolean) || !attempt.validationGate.passed) {
    errors.push(`invalid training attempt evidence: ${attempt.attemptId}`);
  }
}
const champion = report.training.champion;
if (!champion.admitted || champion.attemptId !== 'curriculum-520' ||
    !champion.validationGate.passed || !champion.finalTestGate.passed ||
    !Object.values(champion.validationGate.checks).every(Boolean) ||
    !Object.values(champion.finalTestGate.checks).every(Boolean)) {
  errors.push('champion admission gate failed or selected the wrong curriculum');
}
if (champion.seedPolicies.length !== 5 || new Set(champion.seedPolicies.map((policy) => policy.hyperparameters.seed)).size !== 5) {
  errors.push('champion must retain five unique seed policies');
}
for (const policy of champion.seedPolicies) {
  compareIds(policy.observationIds, PORT_BUSINESS_OBSERVATIONS.map((item) => item.id), 'policy observation');
  compareIds(policy.actionIds, PORT_BUSINESS_ACTIONS.map((item) => item.id), 'policy action');
  if (policy.hyperparameters.episodes !== 520 || policy.weights.length !== PORT_BUSINESS_ACTIONS.length ||
      policy.weights.some((row) => row.length !== PORT_BUSINESS_OBSERVATIONS.length + 1 || row.some((value) => !Number.isFinite(value))) ||
      policy.training.environmentSteps <= 0 || policy.training.parameterUpdates <= policy.training.environmentSteps) {
    errors.push(`invalid champion policy for seed ${policy.hyperparameters.seed}`);
  }
}
const gate = champion.finalTestGate.evidence;
for (const summary of [
  gate.rewardImprovement,
  gate.waitReductionHours,
  gate.queueReductionVessels,
  gate.carbonReductionPercent,
  gate.fairnessGapReductionPoints,
]) {
  if (![summary.mean, summary.lower95, summary.upper95, summary.min, summary.max, summary.samples].every(Number.isFinite) ||
      summary.samples < 10) errors.push('invalid final test confidence summary');
}
if (gate.rewardImprovement.lower95 <= 0 || gate.queueReductionVessels.lower95 <= 0 ||
    gate.carbonReductionPercent.lower95 < 0 || gate.fairnessGapReductionPoints.lower95 < 0 ||
    gate.minimumThroughputRetentionPercent < 98.5 || gate.maximumSafetyProjectionRatePercent !== 0 ||
    gate.hardConstraintViolations !== 0 || gate.materialDelaySampleCount < 10 ||
    champion.finalTest.reinforcementLearning.length !== 20 ||
    champion.finalTest.standardOperatingProcedure.length !== 4 ||
    champion.finalTest.deterministicOptimizer.length !== 4) {
  errors.push('final test business value or safety evidence is incomplete');
}
if (report.training.boundary.dispatch_allowed || report.training.boundary.production_authority ||
    report.releaseDecision.operationalDeploymentAdmitted || !report.releaseDecision.offlineChampionAdmitted ||
    !report.releaseDecision.validationGatePassed || !report.releaseDecision.finalTestGatePassed) {
  errors.push('offline promotion and production fail-closed boundary are inconsistent');
}

try {
  const artifactContent = await readFile(path.resolve(report.dataset.retainedArtifact.path), 'utf8');
  const artifact = JSON.parse(artifactContent) as Record<string, unknown> & {
    integrity?: { algorithm?: string; digest?: string };
  };
  const { integrity, ...core } = artifact;
  if (integrity?.algorithm !== 'sha256' || integrity.digest !== sha256(JSON.stringify(core)) ||
      integrity.digest !== report.dataset.retainedArtifact.integrityDigest) {
    errors.push('retained training dataset integrity mismatch');
  }
} catch {
  warnings.push('runtime training dataset is absent; report and deterministic generator remain verifiable');
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
for (const warning of warnings) process.stderr.write(`WARN ${warning}\n`);
if (errors.length) process.exit(1);
process.stdout.write(`PORT_BUSINESS_CHAMPION_EVIDENCE:PASS:${champion.algorithmId}:${champion.attemptId}\n`);
