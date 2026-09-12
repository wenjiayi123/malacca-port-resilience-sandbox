import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const RUNTIME_COMPATIBILITY_REPORT = 'reports/ui-runtime-compatibility-v1.json';
export const COMPATIBLE_RUNTIME_SOURCES = [
  'src/components/OperationalEvidenceCenter.tsx',
  'src/integrations/coreOperationsRlAdapter.ts',
  'server/coreOperationsModelRegistry.ts',
  'scripts/rl/verifyCoreUpgradeLineage.ts',
  'src/App.tsx',
  'src/integrations/operationsControlAdapter.ts',
  'server/operationalSimulator.ts',
  'server/publicEvidencePlugin.ts',
] as const;
const modelReportPath = 'reports/core-operations-rl-champion-v2.json';
const requiredPreservedReports = [modelReportPath, 'reports/core-operations-rl-champion-v1.json',
  'reports/operational-closure-acceptance-v2.json', 'reports/top-tier-hardening-evidence-v2.json',
  'reports/core-operations-active.json'];
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export interface RuntimeCompatibilityEvidence {
  schemaVersion: 'ui-runtime-compatibility.v1';
  generatedAt: string;
  baselineCommit: string;
  preservedArtifacts: Record<string, string>;
  changes: Record<string, { baselineArtifact: string; baselineSha256: string; currentSha256: string; reason: string }>;
  verificationSources: Record<string, string>;
  authority: { simulationMode: true; liveDataVerified: false; productionAuthority: false; dispatchAllowed: false };
}
interface BoundReport {
  sourceFingerprint?: { files?: Record<string, string> };
  verification?: { sourceSha256?: Record<string, string> };
  upgrade?: { sourceFiles: Record<string, string> };
  retainedArtifacts?: { files: Record<string, string> };
}

/** This extension admits named UI/verification changes; learning-source drift still fails closed. */
export async function readRuntimeCompatibilityEvidence(root = process.cwd()) {
  const read = (file: string) => readFile(path.resolve(root, file));
  const report = JSON.parse((await read(RUNTIME_COMPATIBILITY_REPORT)).toString()) as RuntimeCompatibilityEvidence;
  if (report.schemaVersion !== 'ui-runtime-compatibility.v1' ||
      report.authority?.simulationMode !== true || report.authority.liveDataVerified !== false ||
      report.authority.productionAuthority !== false || report.authority.dispatchAllowed !== false) throw new Error('RUNTIME_COMPATIBILITY_BOUNDARY_INVALID');
  if (JSON.stringify(Object.keys(report.changes).sort()) !== JSON.stringify([...COMPATIBLE_RUNTIME_SOURCES].sort())) {
    throw new Error('RUNTIME_COMPATIBILITY_SCOPE_INVALID');
  }
  if (requiredPreservedReports.some((file) => !report.preservedArtifacts[file]) ||
      !report.verificationSources['server/runtimeCompatibilityEvidence.ts']) throw new Error('RUNTIME_COMPATIBILITY_EVIDENCE_MISSING');
  const preserved = new Map<string, BoundReport>();
  for (const [file, expected] of Object.entries(report.preservedArtifacts)) {
    const bytes = await read(file);
    if (digest(bytes) !== expected) throw new Error(`RUNTIME_COMPATIBILITY_HISTORY_CHANGED:${file}`);
    if (file.endsWith('.json')) preserved.set(file, JSON.parse(bytes.toString()) as BoundReport);
  }
  for (const [file, expected] of Object.entries(report.verificationSources)) {
    if (digest(await read(file)) !== expected) throw new Error(`RUNTIME_COMPATIBILITY_VERIFIER_CHANGED:${file}`);
  }
  const model = preserved.get(modelReportPath)!;
  if (!model.upgrade?.sourceFiles || !model.retainedArtifacts?.files) throw new Error('RUNTIME_COMPATIBILITY_MODEL_EVIDENCE_MISSING');
  for (const [file, expected] of Object.entries(model.retainedArtifacts.files)) {
    if (digest(await read(file)) !== expected) throw new Error(`RUNTIME_COMPATIBILITY_LEARNING_ARTIFACT_CHANGED:${file}`);
  }
  for (const [file, change] of Object.entries(report.changes)) {
    if (change.baselineArtifact !== `reports/artifacts/ui-runtime-compatibility-v1/sources/${file}.snapshot` || !change.reason) {
      throw new Error(`RUNTIME_COMPATIBILITY_SOURCE_ARCHIVE_INVALID:${file}`);
    }
    const baseline = await read(change.baselineArtifact);
    const current = await read(file);
    if (digest(baseline) !== change.baselineSha256 || digest(current) !== change.currentSha256) {
      throw new Error(`RUNTIME_COMPATIBILITY_SOURCE_CHANGED:${file}`);
    }
    if (model.upgrade.sourceFiles[file] && model.upgrade.sourceFiles[file] !== change.baselineSha256) {
      throw new Error(`RUNTIME_COMPATIBILITY_BASELINE_MISMATCH:${file}`);
    }
    if (file === 'server/operationalSimulator.ts' && current.toString() !== baseline.toString().replace(
      'time: tick.eventTime.slice(11, 19)', 'time: malaysiaTime(tick.eventTime).slice(11, 19)',
    )) throw new Error('RUNTIME_COMPATIBILITY_SIMULATOR_CHANGE_NOT_CLOCK_ONLY');
    if (file === 'server/publicEvidencePlugin.ts' && current.toString() !== baseline.toString()
      .replace('）、settingId、policyTestCaseId', '）、settingId（network-snapshot/vessel-state/event-disturbance/weather-sea-state/congestion-delay/carbon-reward/dispatch-action/micro-validation）、policyTestCaseId')
      .replace('learningRate、discountGamma、maxEpisodes', 'learningRate、discountGamma、tuningTrials、maxEpisodes')
      .replace('rewardSafety、rewardResilience。四种RL', 'rewardSafety、rewardResilience、rewardThroughput。四种RL')) {
      throw new Error('RUNTIME_COMPATIBILITY_API_CHANGE_NOT_ADVISOR_PROMPT_ONLY');
    }
  }
  for (const [file, expected] of Object.entries(model.upgrade.sourceFiles)) {
    if (!report.changes[file] && digest(await read(file)) !== expected) throw new Error(`RUNTIME_COMPATIBILITY_LEARNING_SOURCE_CHANGED:${file}`);
  }
  return { report, preserved };
}

export async function isVerifiedRuntimeSourceExtension(archivedReport: string, file: string, expected: string, actual: string) {
  if (!(COMPATIBLE_RUNTIME_SOURCES as readonly string[]).includes(file)) return false;
  try {
    const { report, preserved } = await readRuntimeCompatibilityEvidence();
    const reportPath = path.relative(process.cwd(), path.resolve(archivedReport));
    const historical = preserved.get(reportPath);
    const reportedDigest = historical?.upgrade?.sourceFiles[file]
      ?? historical?.sourceFingerprint?.files?.[file] ?? historical?.verification?.sourceSha256?.[file];
    return Boolean(historical && reportedDigest === expected && report.changes[file].currentSha256 === actual);
  } catch { return false; }
}
