import { currentUiRuntimeAuditSources } from './uiRuntimeAuditSources.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadActiveCoreModel } from '../../server/coreOperationsModelRegistry.ts';
import { RUNTIME_COMPATIBILITY_REPORT, readRuntimeCompatibilityEvidence } from '../../server/runtimeCompatibilityEvidence.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const artifactRoot = 'reports/artifacts/ui-runtime-compatibility-v1';
const checkLogPath = `${artifactRoot}/pnpm-check.txt`;
const operationalPath = `${artifactRoot}/operational-current.json`;
const reportPath = 'reports/ui-runtime-acceptance-v1.json';
const { report: compatibility } = await readRuntimeCompatibilityEvidence();
const model = await loadActiveCoreModel();
assert.equal(model.selection, 'active');
assert.equal(model.report.training.champion.seedPolicies[0].algorithmId, 'factorized-fitted-policy-iteration');
const checkLog = await readFile(process.env.UI_RUNTIME_CHECK_LOG || checkLogPath, 'utf8');
const count = Number(checkLog.match(/ℹ tests (\d+)/)?.[1]);
assert.ok(count > 0 && /ℹ fail 0(?:\s|$)/.test(checkLog) && /built in/.test(checkLog), 'a completed pnpm check log is required');
await writeFile(checkLogPath, checkLog);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-current-acceptance-'));
let operationalBytes: Buffer;
try {
  for (const root of ['server', 'shared', 'scripts', 'src', 'reports', 'data', 'tests', 'package.json', 'pnpm-lock.yaml']) {
    await cp(root, path.join(temporary, root), { recursive: true });
  }
  // Its fixed v2 output path is isolated here; the historical report in the
  // checkout remains byte-for-byte unchanged. No training command is run.
  execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/operations/runOperationalAcceptance.ts'], {
    cwd: temporary, stdio: 'pipe', env: { ...process.env, CORE_OPERATIONS_CHAMPION_REPORT: '' },
  });
  operationalBytes = await readFile(path.join(temporary, 'reports/operational-closure-acceptance-v2.json'));
} finally { await rm(temporary, { recursive: true, force: true }); }
await writeFile(operationalPath, operationalBytes);
const operational = JSON.parse(operationalBytes.toString());
assert.equal(operational.coreOperationsControl.champion.algorithmId, 'factorized-fitted-policy-iteration');
assert.equal(operational.coreOperationsControl.idempotentReplay, true);
assert.equal(operational.coreOperationsControl.rollbackStatus, 'rolled_back');
assert.equal(operational.audit.verified, true);
const sourceFiles = await currentUiRuntimeAuditSources();
const currentSources: Record<string, string> = {};
for (const file of [...sourceFiles].sort()) currentSources[file] = hash(await readFile(file));
const report = {
  schemaVersion: 'ui-runtime-acceptance.v1', generatedAt: new Date().toISOString(),
  evidenceLabel: 'CURRENT_SOURCE_RUNTIME_REGRESSION_AND_PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI',
  compatibility: { path: RUNTIME_COMPATIBILITY_REPORT, sha256: hash(await readFile(RUNTIME_COMPATIBILITY_REPORT)) },
  preservedArtifacts: compatibility.preservedArtifacts,
  activeModel: { ...model.reference, selection: model.selection, algorithmId: model.report.training.champion.seedPolicies[0].algorithmId, retrained: false },
  validation: { command: 'pnpm check', passed: true, testCount: count, log: checkLogPath, logSha256: hash(checkLog) },
  operationalAcceptance: { path: operationalPath, sha256: hash(operationalBytes), generatedFrom: 'scripts/operations/runOperationalAcceptance.ts', isolatedOutput: true },
  currentSources,
  authority: compatibility.authority,
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UI_RUNTIME_ACCEPTANCE:GENERATED:${count}_TESTS:ACTIVE_V2:CURRENT_OPERATIONAL_RECEIPT`);
