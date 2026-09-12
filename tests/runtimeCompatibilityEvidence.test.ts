import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadActiveCoreModel } from '../server/coreOperationsModelRegistry.ts';
import { RUNTIME_COMPATIBILITY_REPORT, isVerifiedRuntimeSourceExtension, readRuntimeCompatibilityEvidence } from '../server/runtimeCompatibilityEvidence.ts';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('the UI compatibility extension preserves the active v2 model and only extends reported source bindings', async () => {
  const { report } = await readRuntimeCompatibilityEvidence();
  const active = await loadActiveCoreModel();
  assert.equal(active.selection, 'active');
  assert.equal(active.fallbackReason, null);
  assert.equal(active.report.training.champion.seedPolicies[0].algorithmId, 'factorized-fitted-policy-iteration');
  assert.equal(active.reference.sha256, report.preservedArtifacts['reports/core-operations-rl-champion-v2.json']);
  const file = 'src/components/OperationalEvidenceCenter.tsx';
  assert.equal(await isVerifiedRuntimeSourceExtension('reports/core-operations-rl-champion-v2.json', file, report.changes[file].baselineSha256, report.changes[file].currentSha256), true);
  assert.equal(await isVerifiedRuntimeSourceExtension('reports/core-operations-rl-champion-v2.json', file, 'unreported-digest', report.changes[file].currentSha256), false);
  assert.equal(await isVerifiedRuntimeSourceExtension('unregistered-model.json', file, report.changes[file].baselineSha256, report.changes[file].currentSha256), false);
  assert.equal(await isVerifiedRuntimeSourceExtension('reports/core-operations-rl-champion-v2.json', 'server/coreOperationsRlEngine.ts', 'before', 'after'), false);
});

test('compatibility verification rejects altered UI, model bytes, learning sources and broader simulator changes', async (context) => {
  const { report } = await readRuntimeCompatibilityEvidence();
  const model = JSON.parse(await readFile('reports/core-operations-rl-champion-v2.json', 'utf8'));
  const directory = await mkdtemp(path.join(tmpdir(), 'malacca-runtime-extension-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const files = new Set([
    RUNTIME_COMPATIBILITY_REPORT, ...Object.keys(report.preservedArtifacts), ...Object.keys(report.changes),
    ...Object.values(report.changes).map((entry) => entry.baselineArtifact), ...Object.keys(report.verificationSources),
    ...Object.keys(model.upgrade.sourceFiles), ...Object.keys(model.retainedArtifacts.files),
  ]);
  await Promise.all([...files].map(async (file) => {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await cp(file, path.join(directory, file));
  }));
  await readRuntimeCompatibilityEvidence(directory);
  for (const [file, expectedError] of [
    ['src/components/OperationalEvidenceCenter.tsx', /SOURCE_CHANGED/],
    ['reports/core-operations-rl-champion-v2.json', /HISTORY_CHANGED/],
    ['server/coreOperationsRlEngine.ts', /LEARNING_SOURCE_CHANGED/],
    ['reports/artifacts/core-operations-rl-v2/seed-17.json', /LEARNING_ARTIFACT_CHANGED/],
  ] as const) {
    const target = path.join(directory, file);
    const original = await readFile(target);
    await writeFile(target, Buffer.concat([original, Buffer.from('\n// altered') ]));
    await assert.rejects(readRuntimeCompatibilityEvidence(directory), expectedError);
    await writeFile(target, original);
  }
  const simulator = 'server/operationalSimulator.ts';
  const changedSimulator = `${await readFile(path.join(directory, simulator), 'utf8')}\n// broader runtime change`;
  await writeFile(path.join(directory, simulator), changedSimulator);
  const forged = structuredClone(report);
  forged.changes[simulator].currentSha256 = hash(changedSimulator);
  await writeFile(path.join(directory, RUNTIME_COMPATIBILITY_REPORT), JSON.stringify(forged));
  await assert.rejects(readRuntimeCompatibilityEvidence(directory), /SIMULATOR_CHANGE_NOT_CLOCK_ONLY/);
  const promptOnly = structuredClone(report);
  const api = 'server/publicEvidencePlugin.ts';
  const changedApi = `${await readFile(path.join(directory, api), 'utf8')}\n// broader API change`;
  await writeFile(path.join(directory, simulator), await readFile(simulator));
  await writeFile(path.join(directory, api), changedApi);
  promptOnly.changes[api].currentSha256 = hash(changedApi);
  await writeFile(path.join(directory, RUNTIME_COMPATIBILITY_REPORT), JSON.stringify(promptOnly));
  await assert.rejects(readRuntimeCompatibilityEvidence(directory), /API_CHANGE_NOT_ADVISOR_PROMPT_ONLY/);
  forged.changes['server/coreOperationsRlEngine.ts'] = forged.changes[simulator];
  await writeFile(path.join(directory, RUNTIME_COMPATIBILITY_REPORT), JSON.stringify(forged));
  await assert.rejects(readRuntimeCompatibilityEvidence(directory), /SCOPE_INVALID/);
});
