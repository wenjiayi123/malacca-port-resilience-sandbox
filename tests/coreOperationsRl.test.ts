import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CORE_OPERATIONS_ACTION_HEADS,
  CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  CORE_OPERATIONS_HARD_CONSTRAINTS,
  CORE_OPERATIONS_OBSERVATIONS,
  CORE_OPERATIONS_REWARD_COMPONENTS,
} from '../shared/coreOperationsRlContract.ts';
import {
  buildTrainingCoreObservation,
  createHoldCorePlan,
  projectCoreActionPlan,
  trainFactorizedCorePolicy,
} from '../server/coreOperationsRlEngine.ts';
import { loadPortBusinessDataset } from '../server/portBusinessDataset.ts';
import { OperationalControlService, PortOperationsSimulator } from '../server/operationalSimulator.ts';
import {
  buildRuntimeCoreObservation,
  inferCoreOperationsChampion,
  loadCoreOperationsChampionStatus,
} from '../server/coreOperationsRlService.ts';

test('core operations contract covers ten unique heads and keeps production authority closed', () => {
  assert.equal(CORE_OPERATIONS_ACTION_HEADS.length, 10);
  assert.equal(new Set(CORE_OPERATIONS_ACTION_HEADS.map((head) => head.id)).size, 10);
  assert.ok(CORE_OPERATIONS_OBSERVATIONS.length >= 45);
  assert.equal(new Set(CORE_OPERATIONS_OBSERVATIONS.map((item) => item.id)).size, CORE_OPERATIONS_OBSERVATIONS.length);
  assert.equal(CORE_OPERATIONS_ACTION_HEADS.every((head) => head.choices.length === 3), true);
  assert.equal(new Set(CORE_OPERATIONS_ACTION_HEADS.flatMap((head) => head.choices.map((choice) => choice.id))).size, 30);
  assert.ok(Math.abs(CORE_OPERATIONS_REWARD_COMPONENTS.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);
  assert.ok(CORE_OPERATIONS_HARD_CONSTRAINTS.length >= 12);
  assert.equal(CORE_OPERATIONS_AUTHORITY_BOUNDARY.dispatch_allowed, false);
  assert.equal(CORE_OPERATIONS_AUTHORITY_BOUNDARY.production_authority, false);
  assert.equal(CORE_OPERATIONS_AUTHORITY_BOUNDARY.direct_equipment_control, false);
});

test('factorized learner consumes every observation and performs real multi-head updates', async () => {
  const dataset = await loadPortBusinessDataset();
  const policy = trainFactorizedCorePolicy('factorized-linear-dyna-q', dataset.trainRecords, {
    episodes: 12,
    seed: 701,
    learningRate: 0.02,
    discountGamma: 0.96,
    planningSteps: 2,
    horizon: 24,
  });
  assert.deepEqual(policy.observationIds, CORE_OPERATIONS_OBSERVATIONS.map((item) => item.id));
  assert.deepEqual(policy.heads.map((head) => head.domain), CORE_OPERATIONS_ACTION_HEADS.map((head) => head.id));
  assert.ok(policy.training.environmentSteps > 0);
  assert.ok(policy.training.parameterUpdates >= policy.training.environmentSteps * CORE_OPERATIONS_ACTION_HEADS.length * 2);
  assert.equal(policy.heads.every((head) => head.weights.some((row) => row.some((value) => Math.abs(value) > 0.002))), true);
});

test('each unsafe domain choice is projected independently without weakening other heads', async () => {
  const dataset = await loadPortBusinessDataset();
  const record = dataset.trainRecords[0];
  const state = {
    queueVessels: 12,
    delayHours: 1,
    yardOccupancy: 0.8,
    gatePressure: 0.7,
    horizontalAvailability: 0.9,
    energyCostIndex: 1,
    peakGridRatio: 0.8,
    carbonIntensity: 1,
    reeferService: 1,
    maintenanceBacklog: 0.2,
    fairnessGap: 0.2,
    recoveryBacklog: 3,
    batterySoc: 0.2,
    previousPlan: createHoldCorePlan().choices,
  };
  const observation = buildTrainingCoreObservation(record, state);
  const requested = createHoldCorePlan();
  requested.choices['arrival-flow'] = 'arrival-smoothing';
  requested.choices['energy-storage'] = 'battery-peak-shave';
  requested.choices['yard-gate'] = 'yard-block-rebalance';
  const projected = projectCoreActionPlan(requested, {
    ...observation.context,
    channelAvailable: false,
    tideWindowOpen: false,
    batterySoc: 0.2,
    hazmatRestrictionActive: false,
  });
  assert.equal(projected.executed.choices['arrival-flow'], 'arrival-hold');
  assert.equal(projected.executed.choices['energy-storage'], 'energy-hold');
  assert.equal(projected.executed.choices['yard-gate'], 'yard-block-rebalance');
  assert.deepEqual(projected.modifiedDomains.sort(), ['arrival-flow', 'energy-storage']);
  assert.equal(projected.hardConstraintViolations, 0);
});

test('runtime tensor is backed by simulator fields and core control changes audited sandbox state', () => {
  const simulator = new PortOperationsSimulator({ seed: 240520, wallTickMs: 60_000, startedAtMs: Date.now() });
  const service = new OperationalControlService({ simulator, auditFile: null });
  const before = service.snapshot();
  const runtime = buildRuntimeCoreObservation(before);
  assert.equal(runtime.tensor.length, CORE_OPERATIONS_OBSERVATIONS.length);
  assert.equal(runtime.tensor.every((item) => Number.isFinite(item.raw) && Number.isFinite(item.normalized)), true);
  const result = service.executeCorePlan({
    proposalId: 'core-test-proposal',
    inputSnapshotHash: before.snapshot_hash,
    inputSequence: before.sequence,
    planHash: 'a'.repeat(64),
    activeDomains: ['arrival-flow', 'energy-storage', 'equipment-maintenance'],
    effect: {
      remainingTicks: 8,
      queueRelief: 0.2,
      capacityMultiplier: 1.03,
      carbonMultiplier: 0.96,
      diversionFraction: 0,
      yardOutflowMultiplier: 1.12,
      gateOutflowMultiplier: 1.08,
      intermodalOutflowMultiplier: 1.1,
      energyLoadMultiplier: 0.97,
      peakGridMultiplier: 0.92,
      reeferPowerMultiplier: 0.98,
      equipmentAvailabilityBonus: 1,
      batteryPowerAdjustmentKw: 900,
      maintenanceReliefCount: 2,
    },
  }, 'core-test-idempotency');
  assert.equal(result.receipt.status, 'acknowledged');
  assert.equal(result.receipt.executor, 'simulation-executor.v2-core-plan');
  assert.equal(result.receipt.dispatch_allowed, false);
  assert.equal(result.receipt.production_authority, false);
  assert.notEqual(result.receipt.input_snapshot_hash, result.receipt.output_snapshot_hash);
  assert.equal(result.receipt.counterfactual.design, 'same_state_same_seed_same_tick_new_rl_plan_vs_continue_current_plan');
  assert.notEqual(result.receipt.counterfactual.baseline_output_snapshot_hash, result.receipt.output_snapshot_hash);
  assert.equal(result.receipt.attribution, 'paired_deterministic_simulation_counterfactual_not_field_causal_estimate');
  assert.equal(
    Object.values(result.receipt.counterfactual.rl_vs_baseline_kpi_delta).some((value) => Math.abs(value) > 0),
    true,
  );
  assert.equal(service.auditTrail().verified, true);
  const replay = service.executeCorePlan({
    proposalId: 'core-test-proposal',
    inputSnapshotHash: before.snapshot_hash,
    inputSequence: before.sequence,
    planHash: 'a'.repeat(64),
    activeDomains: [],
    effect: result.receipt.applied_effect,
  }, 'core-test-idempotency');
  assert.equal(replay.idempotent_replay, true);
  assert.equal(replay.receipt.receipt_id, result.receipt.receipt_id);
});

test('stored five-seed champion serves a ten-head fail-closed runtime decision', async () => {
  const status = await loadCoreOperationsChampionStatus();
  assert.equal(status.champion.admitted, true);
  assert.equal(status.champion.seedPolicyCount, 5);
  assert.equal(status.contract.actionHeadCount, CORE_OPERATIONS_ACTION_HEADS.length);
  assert.equal(status.operationalDeploymentAdmitted, false);
  const simulator = new PortOperationsSimulator({ seed: 240520, wallTickMs: 60_000, startedAtMs: Date.now() });
  const decision = await inferCoreOperationsChampion(simulator.snapshot());
  assert.equal(decision.inference.heads.length, CORE_OPERATIONS_ACTION_HEADS.length);
  assert.equal(Object.keys(decision.executedPlan.choices).length, CORE_OPERATIONS_ACTION_HEADS.length);
  assert.equal(decision.execution.dispatchAllowed, false);
  assert.equal(decision.execution.productionAuthority, false);
  assert.equal(decision.authority.production_authority, false);
});
