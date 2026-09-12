import { currentUiRuntimeAuditSources } from './uiRuntimeAuditSources.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadActiveCoreModel } from '../../server/coreOperationsModelRegistry.ts';
import { readRuntimeCompatibilityEvidence } from '../../server/runtimeCompatibilityEvidence.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(await readFile('reports/ui-runtime-acceptance-v1.json', 'utf8'));
assert.equal(report.schemaVersion, 'ui-runtime-acceptance.v1');
assert.equal(report.evidenceLabel, 'CURRENT_SOURCE_RUNTIME_REGRESSION_AND_PUBLIC_DATA_CALIBRATED_SIMULATION_NOT_FIELD_KPI');
const { report: compatibility } = await readRuntimeCompatibilityEvidence();
assert.deepEqual(report.authority, compatibility.authority);
assert.deepEqual(report.preservedArtifacts, compatibility.preservedArtifacts);
assert.equal(hash(await readFile(report.compatibility.path)), report.compatibility.sha256);
assert.deepEqual(Object.keys(report.currentSources).sort(), await currentUiRuntimeAuditSources(), 'current source coverage must be complete');
for (const [file, expected] of Object.entries(report.currentSources)) {
  assert.equal(hash(await readFile(file)), expected, `current runtime acceptance source changed: ${file}`);
}
const log = await readFile(report.validation.log, 'utf8');
assert.equal(hash(log), report.validation.logSha256);
assert.equal(report.validation.passed, true);
assert.equal(report.validation.command, 'pnpm check');
assert.equal(Number(log.match(/ℹ tests (\d+)/)?.[1]), report.validation.testCount);
assert.match(log, /ℹ fail 0(?:\s|$)/);
assert.match(log, /built in/);
const model = await loadActiveCoreModel();
assert.equal(model.selection, 'active');
assert.equal(model.reference.sha256, report.activeModel.sha256);
assert.equal(model.report.training.champion.seedPolicies[0].algorithmId, 'factorized-fitted-policy-iteration');
assert.equal(report.activeModel.retrained, false);
const bytes = await readFile(report.operationalAcceptance.path);
assert.equal(hash(bytes), report.operationalAcceptance.sha256);
const operations = JSON.parse(bytes.toString());
assert.equal(operations.schemaVersion, 'operational-closure-acceptance.v2');
assert.equal(operations.authority.simulation_mode, true);
assert.equal(operations.authority.production_authority, false);
assert.equal(operations.authority.dispatch_allowed, false);
assert.equal(operations.authority.live_data_verified, false);
assert.equal(operations.coreOperationsControl.champion.algorithmId, 'factorized-fitted-policy-iteration');
assert.equal(operations.coreOperationsControl.champion.admitted, true);
assert.equal(operations.control.idempotentReplay, true);
assert.equal(operations.control.rollbackStatus, 'rolled_back');
assert.equal(operations.coreOperationsControl.idempotentReplay, true);
assert.equal(operations.coreOperationsControl.rollbackStatus, 'rolled_back');
assert.equal(operations.audit.verified, true);
assert.equal(operations.failureClosure.dataLossFailure, 'DATA_QUALITY_GATE_BLOCKED');
assert.equal(operations.failureClosure.simulatorStoppedFailure, 'SIMULATOR_STOPPED');
assert.equal(operations.coreOperationsControl.receipt.counterfactual.design, 'same_state_same_seed_same_tick_new_rl_plan_vs_continue_current_plan');
for (const [file, expected] of Object.entries(operations.sourceFingerprint.files)) {
  assert.equal(hash(await readFile(file)), expected, `current operation source changed: ${file}`);
}
console.log(`UI_RUNTIME_ACCEPTANCE:PASS:${report.validation.testCount}_TESTS:ACTIVE_V2:IMMUTABLE_HISTORY`);
