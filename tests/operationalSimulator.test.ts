import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OperationalControlService,
  PortOperationsSimulator,
} from '../server/operationalSimulator.ts';
import {
  PORT_TELEMETRY_CONTRACT,
  PORT_TELEMETRY_CONTRACT_VERSION,
  isTelemetryField,
} from '../shared/portTelemetryContract.ts';

const collectFields = (value: unknown, output: unknown[] = []) => {
  if (!value || typeof value !== 'object') return output;
  if ('schema_version' in value && 'quality_status' in value) {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) value.forEach((item) => collectFields(item, output));
  else Object.values(value).forEach((item) => collectFields(item, output));
  return output;
};

test('deterministic simulator emits complete field lineage and obeys physical envelopes', () => {
  const first = new PortOperationsSimulator({ seed: 240520, startedAtMs: 0, wallTickMs: 5_000 });
  const second = new PortOperationsSimulator({ seed: 240520, startedAtMs: 0, wallTickMs: 5_000 });
  const firstSnapshot = first.snapshot(15_000);
  const secondSnapshot = second.snapshot(15_000);

  assert.equal(firstSnapshot.protocolVersion, PORT_TELEMETRY_CONTRACT_VERSION);
  assert.deepEqual(firstSnapshot.kpis, secondSnapshot.kpis);
  assert.equal(firstSnapshot.snapshot_hash, secondSnapshot.snapshot_hash);
  assert.equal(firstSnapshot.seed, 240520);
  assert.deepEqual(firstSnapshot.authority, {
    simulation_mode: true,
    live_data_verified: false,
    dispatch_allowed: false,
    production_authority: false,
  });
  const fields = collectFields(firstSnapshot.operationalTelemetry);
  assert.ok(fields.length >= 50);
  assert.ok(fields.every(isTelemetryField));
  assert.ok(PORT_TELEMETRY_CONTRACT.required_metadata.every((key) => key in (fields[0] as object)));
  assert.ok(firstSnapshot.quality.consistency_checks.every((check) => check.passed));
  assert.ok((firstSnapshot.operationalTelemetry.energy.battery_soc_percent.value ?? 0) >= 15);
  assert.ok((firstSnapshot.operationalTelemetry.energy.battery_soc_percent.value ?? 100) <= 95);
  assert.ok((firstSnapshot.operationalTelemetry.terminal.yard_occupancy_percent.value ?? 0) <= 100);
  assert.ok(firstSnapshot.forecast.points.some((point) => point.queue_vessels !== firstSnapshot.kpis.queue_vessels));
  assert.equal(firstSnapshot.forecast.model.training_split.includes('70%'), true);
  assert.match(firstSnapshot.forecast.model.hash, /^[a-f0-9]{64}$/);
  assert.equal(firstSnapshot.scenario.carbon.todayUnit, 'tCO₂e/模拟日');
  assert.ok(firstSnapshot.scenario.carbon.todayEmission > 0);
  assert.ok(firstSnapshot.scenario.carbon.hourlyTrend.length > 0);
  assert.ok(firstSnapshot.scenario.congestionHeatmap.hotspots.every((item) => item.intensity >= 0 && item.intensity <= 1));
  assert.equal(firstSnapshot.telemetry.ports.length, 8);
  assert.equal(
    firstSnapshot.scenario.vesselTypeStats.reduce((sum, item) => sum + item.count, 0),
    firstSnapshot.telemetry.overview.monitoredVesselCount,
  );
  assert.equal(
    firstSnapshot.telemetry.ports.reduce((sum, item) => sum + item.vesselCount, 0),
    firstSnapshot.telemetry.overview.monitoredVesselCount,
  );
});

test('simulator changes continuously without unconstrained randomness', () => {
  const simulator = new PortOperationsSimulator({ seed: 11, startedAtMs: 0, wallTickMs: 5_000 });
  const initial = simulator.snapshot(0);
  const next = simulator.snapshot(10_000);
  assert.equal(next.sequence, initial.sequence + 2);
  assert.notEqual(next.event_time, initial.event_time);
  assert.notDeepEqual(next.kpis, initial.kpis);

  const replay = new PortOperationsSimulator({ seed: 11, startedAtMs: 0, wallTickMs: 5_000 }).snapshot(10_000);
  assert.deepEqual(replay.kpis, next.kpis);
});

test('normal simulator remains physically bounded during a two-week continuous run', () => {
  const wallTickMs = 5_000;
  const simulator = new PortOperationsSimulator({ seed: 240520, startedAtMs: 0, wallTickMs });
  const twoWeeksOfQuarterHours = 14 * 24 * 4;
  const snapshot = simulator.snapshot(twoWeeksOfQuarterHours * wallTickMs);

  assert.equal(snapshot.simulator.scenario, 'normal');
  assert.ok(snapshot.kpis.queue_vessels <= 60, `queue drifted to ${snapshot.kpis.queue_vessels}`);
  assert.ok(snapshot.kpis.delay_minutes <= 240, `delay drifted to ${snapshot.kpis.delay_minutes}`);
  assert.ok(snapshot.operationalTelemetry.terminal.yard_occupancy_percent.value !== null);
  assert.ok((snapshot.operationalTelemetry.terminal.yard_occupancy_percent.value ?? 100) <= 85);
  assert.ok(snapshot.quality.consistency_checks.every((check) => check.passed));
});

test('grounded handoff report cites the current snapshot and does not impersonate a model', () => {
  const service = new OperationalControlService({
    simulator: new PortOperationsSimulator({ seed: 45, wallTickMs: 60_000 }),
    auditFile: null,
  });
  const handoff = service.handoffReport();
  assert.equal(handoff.protocol_version, 'xiaoyi-operational-handoff.v1');
  assert.equal(handoff.generator.model_used, false);
  assert.match(handoff.input_snapshot_hash, /^[a-f0-9]{64}$/);
  assert.equal(handoff.evidence.trace_ids.length, 4);
  assert.equal(handoff.shift_handoff.authority.production_authority, false);
  assert.ok(handoff.state_summary.includes('队列'));
});

test('decision loop enforces dual approval, idempotency, receipts, rollback and audit hashes', () => {
  const simulator = new PortOperationsSimulator({ seed: 77, wallTickMs: 60_000 });
  const service = new OperationalControlService({ simulator, auditFile: null });
  const recommendations = service.recommendations();
  assert.equal(recommendations.candidates.length, 5);
  assert.equal(
    recommendations.candidates.find((candidate) => candidate.controller_id === 'rl-checkpoint')?.eligible,
    false,
  );

  const decision = service.createDecision('mpc');
  assert.equal(decision.status, 'pending_approval');
  assert.throws(
    () => service.approveDecision(decision.decision_id, [{ approver_id: 'operator-a', role: 'operator' }]),
    /DUAL_APPROVAL_REQUIRED/,
  );
  const approved = service.approveDecision(decision.decision_id, [
    { approver_id: 'operator-a', role: 'operator' },
    { approver_id: 'safety-b', role: 'safety_officer' },
  ]);
  assert.equal(approved.status, 'approved');

  const firstExecution = service.executeDecision(decision.decision_id, 'acceptance-loop-001');
  const replayExecution = service.executeDecision(decision.decision_id, 'acceptance-loop-001');
  assert.equal(firstExecution.idempotent_replay, false);
  assert.equal(replayExecution.idempotent_replay, true);
  assert.equal(firstExecution.decision.receipt?.status, 'acknowledged');
  assert.ok(firstExecution.decision.receipt?.kpi_delta);

  const rolledBack = service.rollbackDecision(decision.decision_id, 'acceptance-test');
  assert.equal(rolledBack.status, 'rolled_back');
  assert.equal(rolledBack.receipt?.rollback_reason, 'acceptance-test');
  const audit = service.auditTrail();
  assert.equal(audit.verified, true);
  assert.equal(audit.record_count, 4);
  assert.match(audit.head_hash, /^[a-f0-9]{64}$/);
});

test('data loss and simulator shutdown fail closed before recommendation or execution', () => {
  const service = new OperationalControlService({
    simulator: new PortOperationsSimulator({ seed: 91, wallTickMs: 60_000 }),
    auditFile: null,
  });
  service.injectScenario('data-loss');
  const offline = service.snapshot();
  assert.equal(offline.quality.completeness_percent, 0);
  assert.equal(offline.authority.dispatch_allowed, false);
  assert.throws(() => service.recommendations(), /DATA_QUALITY_GATE_BLOCKED/);

  service.injectScenario('normal');
  const decision = service.createDecision('port-sop');
  service.approveDecision(decision.decision_id, [
    { approver_id: 'operator-a', role: 'operator' },
    { approver_id: 'safety-b', role: 'safety_officer' },
  ]);
  service.controlSimulator('stop');
  assert.throws(() => service.executeDecision(decision.decision_id, 'fail-closed-001'), /SIMULATOR_STOPPED/);
});
