import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { COMPATIBLE_RUNTIME_SOURCES, RUNTIME_COMPATIBILITY_REPORT, readRuntimeCompatibilityEvidence, type RuntimeCompatibilityEvidence } from '../../server/runtimeCompatibilityEvidence.ts';

// Fixed reviewed release baseline. This does not rewrite any model, report or active pointer.
const baselineCommit = 'bacb580bda5295f0c3e3d87cd0549643c84969ad';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const core = JSON.parse(await readFile('reports/core-operations-rl-champion-v2.json', 'utf8'));
const historicalFiles = new Set<string>([
  ...Object.keys(core.historicalPreservation),
  'reports/core-operations-rl-champion-v2.json', 'reports/core-operations-rl-champion-v2.md',
  'reports/core-operations-active.json', 'reports/operational-closure-acceptance-v2.md',
  'reports/dependency-security-upgrade-v1.json', 'data/rl/mpa_vessel_arrivals_monthly.csv',
]);
const reasons: Record<string, string> = {
  'src/components/OperationalEvidenceCenter.tsx': 'Reject stale reads and reports; retain independently visible endpoint errors; preserve approval/execution transitions.',
  'src/integrations/coreOperationsRlAdapter.ts': 'Reject malformed transport responses; policy request fields and endpoint semantics remain unchanged.',
  'server/coreOperationsModelRegistry.ts': 'Admit only this verified source extension; preserve pinned model/dataset and automatic rollback checks.',
  'scripts/rl/verifyCoreUpgradeLineage.ts': 'Compose the prior immutable model lineage with the explicitly bounded UI compatibility extension.',
  'src/App.tsx': 'Correlate Godot results and advisor/training responses; repair UI controls and local-time labels without changing learned policies.',
  'src/integrations/operationsControlAdapter.ts': 'Reject malformed JSON transport responses while preserving backend gate messages.',
  'server/publicEvidencePlugin.ts': 'Only complete advisor prompt setting identifiers and existing tuning/reward fields; exact string substitutions are enforced.',
  'server/operationalSimulator.ts': 'Only render eventLog.time through existing Malaysia-time formatting; the validator enforces exact single-expression equivalence.',
};
const report: RuntimeCompatibilityEvidence = {
  schemaVersion: 'ui-runtime-compatibility.v1', generatedAt: new Date().toISOString(), baselineCommit,
  preservedArtifacts: {}, changes: {}, verificationSources: {},
  authority: { simulationMode: true, liveDataVerified: false, productionAuthority: false, dispatchAllowed: false },
};
for (const file of historicalFiles) {
  const original = execFileSync('git', ['show', `${baselineCommit}:${file}`]);
  const current = await readFile(file);
  if (hash(original) !== hash(current)) throw new Error(`HISTORICAL_ARTIFACT_CHANGED:${file}`);
  report.preservedArtifacts[file] = hash(current);
}
for (const file of COMPATIBLE_RUNTIME_SOURCES) {
  const baseline = execFileSync('git', ['show', `${baselineCommit}:${file}`]);
  const baselineArtifact = `reports/artifacts/ui-runtime-compatibility-v1/sources/${file}.snapshot`;
  await mkdir(path.dirname(baselineArtifact), { recursive: true });
  await writeFile(baselineArtifact, baseline);
  report.changes[file] = { baselineArtifact, baselineSha256: hash(baseline), currentSha256: hash(await readFile(file)), reason: reasons[file] };
}
for (const file of ['server/runtimeCompatibilityEvidence.ts', 'scripts/operations/buildUiRuntimeCompatibility.ts', 'tests/runtimeCompatibilityEvidence.test.ts']) {
  report.verificationSources[file] = hash(await readFile(file));
}
await writeFile(RUNTIME_COMPATIBILITY_REPORT, `${JSON.stringify(report, null, 2)}\n`);
await readRuntimeCompatibilityEvidence();
console.log('UI_RUNTIME_COMPATIBILITY:PASS:IMMUTABLE_MODELS:UNCHANGED_LEARNING_SOURCES:CLOCK_ONLY_SIMULATOR');
