import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PORT_BUSINESS_ACTIONS,
  PORT_BUSINESS_AUTHORITY_BOUNDARY,
  PORT_BUSINESS_OBSERVATIONS,
  PORT_BUSINESS_RESPONSIBILITY_MATRIX,
  PORT_BUSINESS_REWARD_COMPONENTS,
} from '../shared/portBusinessRlContract.ts';
import {
  applicableBusinessActionIds,
  evaluatePublicDemandForecaster,
  projectBusinessAction,
  trainPublicDemandForecaster,
  type PortBusinessDynamicState,
} from '../server/portBusinessControlPlane.ts';
import {
  loadPortBusinessDataset,
  PORT_BUSINESS_DATASET_REQUIRED_FIELDS,
} from '../server/portBusinessDataset.ts';
import {
  buildPortBusinessObservation,
  evaluateBusinessPolicy,
  trainLinearBusinessPolicy,
} from '../server/portBusinessRlEngine.ts';
import {
  assessPortBusinessProposal,
  inferPortBusinessChampion,
  loadPortBusinessChampionStatus,
} from '../server/portBusinessRlService.ts';

const baseState: PortBusinessDynamicState = {
  queueVessels: 30,
  deferredBacklogVessels: 5,
  recoveryBacklogVessels: 0,
  yardOccupancy: 0.82,
  gateQueuePressure: 0.8,
  fairnessGap: 0.25,
  previousActionId: 'hold-plan',
};

test('port business contract has unique full observations, bounded advisory actions and external authority boundaries', () => {
  assert.equal(PORT_BUSINESS_OBSERVATIONS.length, 33);
  assert.equal(new Set(PORT_BUSINESS_OBSERVATIONS.map((item) => item.id)).size, 33);
  assert.equal(PORT_BUSINESS_ACTIONS.length, 11);
  assert.equal(new Set(PORT_BUSINESS_ACTIONS.map((item) => item.id)).size, 11);
  assert.ok(PORT_BUSINESS_ACTIONS.filter((action) => action.id !== 'hold-plan')
    .every((action) => action.requiresHumanApproval));
  assert.ok(Math.abs(PORT_BUSINESS_REWARD_COMPONENTS.reduce((sum, item) => sum + item.weight, 0) - 1) < 1e-9);
  assert.equal(PORT_BUSINESS_AUTHORITY_BOUNDARY.dispatch_allowed, false);
  assert.equal(PORT_BUSINESS_AUTHORITY_BOUNDARY.production_authority, false);
  assert.ok(PORT_BUSINESS_RESPONSIBILITY_MATRIX.some((item) => item.owner === 'external-authority' && !item.learned));
});

test('public anchored dataset is deterministic, chronologically sealed and explicitly augmented', async () => {
  const first = await loadPortBusinessDataset();
  const second = await loadPortBusinessDataset();
  assert.equal(first.records.length, 1_508);
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.operationalClaimAllowed, false);
  assert.equal(first.evidenceLevel, 'public-aggregate-with-engineering-augmentation');
  assert.ok(first.quality.publicAnchorFieldCount > 0);
  assert.ok(first.quality.engineeringDerivedFieldCount > first.quality.publicAnchorFieldCount);
  assert.equal(first.quality.operatorMeasurementCoveragePercent, 0);
  assert.ok(first.trainRecords.at(-1)!.timestamp < first.validationRecords[0].timestamp);
  assert.ok(first.validationRecords.at(-1)!.timestamp < first.testRecords[0].timestamp);
  assert.deepEqual(Object.values(first.quality.leakageChecks), [true, true, true, true]);
  const firstMonth = first.records.filter((record) => record.sourceMonth === '1995-01');
  assert.ok(Math.abs(firstMonth.reduce((sum, record) => sum + record.arrivals, 0) -
    firstMonth[0].publicAnchorArrivals) < 0.01);
});

test('operator replacement package fails closed when a required business field is missing', async () => {
  const dataset = await loadPortBusinessDataset();
  const directory = await mkdtemp(path.join(os.tmpdir(), 'port-business-dataset-'));
  const target = path.join(directory, 'operator.json');
  const records = Array.from({ length: 120 }, (_, index) => ({
    ...dataset.records[index],
    timestamp: new Date(Date.UTC(2024, 0, 1, index)).toISOString(),
  }));
  delete (records[0] as Partial<(typeof records)[number]>).effectiveCapacity;
  await writeFile(target, JSON.stringify({ records }), 'utf8');
  await assert.rejects(() => loadPortBusinessDataset(target), /缺少 effectiveCapacity/);
  assert.ok(PORT_BUSINESS_DATASET_REQUIRED_FIELDS.includes('effectiveCapacity'));
  records[0].effectiveCapacity = dataset.records[0].effectiveCapacity;
  await writeFile(target, JSON.stringify({
    metadata: { evidenceLevel: 'operator-authorized' },
    records,
  }), 'utf8');
  const replacement = await loadPortBusinessDataset(target);
  assert.equal(replacement.evidenceLevel, 'operator-supplied-unverified');
  assert.equal(replacement.operationalClaimAllowed, false);
});

test('safety projector masks authority-sensitive and resource-infeasible actions', async () => {
  const dataset = await loadPortBusinessDataset();
  const record = {
    ...dataset.records[10],
    channelAvailable: false,
    tideWindowOpen: false,
    pilotAvailabilityRatio: 0.2,
    tugAvailabilityRatio: 0.2,
  };
  const projected = projectBusinessAction(record, baseState, 'arrival-window-smooth');
  assert.equal(projected.executedActionId, 'hold-plan');
  assert.equal(projected.modified, true);
  assert.equal(projected.hardConstraintViolations, 0);
  assert.equal(projected.dispatchAllowed, false);
  assert.ok(projected.reasons.includes('channel_closed'));
});

test('business applicability imposes a post-intervention cooldown', async () => {
  const dataset = await loadPortBusinessDataset();
  const actions = applicableBusinessActionIds(dataset.records[20], {
    ...baseState,
    previousActionId: 'crane-rebalance',
  });
  assert.deepEqual(actions, ['hold-plan']);
});

test('non-RL demand model is trained only on training records and beats seasonal naive on validation replay', async () => {
  const dataset = await loadPortBusinessDataset();
  const model = trainPublicDemandForecaster(dataset.trainRecords);
  const evaluationRecords = [...dataset.trainRecords.slice(-8), ...dataset.validationRecords];
  const evaluation = evaluatePublicDemandForecaster(model, evaluationRecords);
  assert.equal(model.trainRange[1], dataset.trainRecords.at(-1)!.timestamp);
  assert.ok(evaluation.sampleCount > 100);
  assert.ok(evaluation.model.wapePercent < evaluation.seasonalNaive.wapePercent);
  assert.equal(evaluation.operationalClaimAllowed, false);
});

test('all declared observations reach the policy and real TD updates change stored weights', async () => {
  const dataset = await loadPortBusinessDataset();
  const policy = trainLinearBusinessPolicy('linear-dyna-q', dataset.trainRecords, {
    episodes: 24,
    seed: 37,
    learningRate: 0.034,
    discountGamma: 0.955,
    planningSteps: 3,
  });
  assert.deepEqual(policy.observationIds, PORT_BUSINESS_OBSERVATIONS.map((item) => item.id));
  assert.deepEqual(policy.actionIds, PORT_BUSINESS_ACTIONS.map((item) => item.id));
  assert.ok(policy.training.environmentSteps > 0);
  assert.ok(policy.training.parameterUpdates > policy.training.environmentSteps);
  assert.ok(policy.weights.flat().some((value) => Math.abs(value) > 1e-8));
  const initial = {
    ...baseState,
    meanWaitingHours: 1,
    p95WaitingHours: 2,
    carbonIntensity: 1,
    energyCostIndex: 1,
  };
  assert.equal(Object.keys(buildPortBusinessObservation(initial, dataset.records[10], dataset.records[9])).length, 33);
});

test('trained policy evaluation executes through the safety mask with no hard violations', async () => {
  const dataset = await loadPortBusinessDataset();
  const policy = trainLinearBusinessPolicy('linear-q-learning', dataset.trainRecords, {
    episodes: 30,
    seed: 17,
    learningRate: 0.034,
    discountGamma: 0.955,
  });
  const result = evaluateBusinessPolicy(
    { kind: 'reinforcement-learning', policy },
    dataset.validationRecords,
    'weather-generalization',
  );
  assert.equal(result.metrics.hardConstraintViolations, 0);
  assert.equal(result.metrics.safetyProjectionRatePercent, 0);
  assert.ok(result.metrics.throughputRetentionPercent > 95);
  assert.equal(Object.values(result.actionCounts).reduce((sum, count) => sum + count, 0), dataset.validationRecords.length);
});

test('generated public dataset source remains the checked-in MPA snapshot', async () => {
  const readme = await readFile(path.resolve('data/rl/README.md'), 'utf8');
  assert.match(readme, /data\.gov\.sg\/collections\/394/);
});

test('runtime service exposes the admitted offline champion without production authority', async () => {
  const status = await loadPortBusinessChampionStatus();
  assert.equal(status.contract.observationCount, 33);
  assert.equal(status.contract.actionCount, 11);
  assert.equal(status.champion.admitted, true);
  assert.equal(status.operationalDeploymentAdmitted, false);
  assert.equal(status.boundary.dispatch_allowed, false);
});

test('runtime proposal assessment returns an auditable safety projection and non-dispatching fallback', async () => {
  const dataset = await loadPortBusinessDataset();
  const result = assessPortBusinessProposal({
    record: { ...dataset.records[1], channelAvailable: false },
    state: baseState,
    requestedActionId: 'arrival-window-smooth',
  });
  assert.equal(result.projected.executedActionId, 'hold-plan');
  assert.equal(result.projected.modified, true);
  assert.equal(result.execution.dispatchAllowed, false);
  assert.equal(result.execution.receiptIssued, false);
  assert.ok(result.deterministicFallback.candidates.length > 0);
});

test('champion runtime consumes all observations, exposes ensemble uncertainty and always fails closed to production', async () => {
  const dataset = await loadPortBusinessDataset();
  const record = { ...dataset.testRecords[12], dataQualityScore: 0.94, forecastUncertainty: 0.18 };
  const result = await inferPortBusinessChampion({
    record,
    state: baseState,
    previousRecord: dataset.testRecords[11],
    provenance: {
      sourceProtocolVersion: 'port-snapshot.v1',
      snapshotHash: 'verified-runtime-snapshot-hash',
      source: 'operational-simulator-public-calibrated',
      liveDataVerified: false,
      operatorMeasuredFieldCount: 0,
    },
  });
  assert.equal(result.protocolVersion, 'port-business-runtime-decision.v1');
  assert.equal(result.inference.observationTensor.length, PORT_BUSINESS_OBSERVATIONS.length);
  assert.equal(result.inference.actionDistribution.length, PORT_BUSINESS_ACTIONS.length);
  assert.equal(result.inference.uncertainty.ensemblePolicyCount, 5);
  assert.ok(result.inference.actionDistribution.every((action) => Number.isFinite(action.probability)));
  assert.ok(['reinforcement-learning-advisory', 'deterministic-optimizer']
    .includes(result.admission.recommendationSource));
  assert.equal(result.inputEvidence.snapshotHash, 'verified-runtime-snapshot-hash');
  assert.equal(result.inputEvidence.liveDataVerified, false);
  assert.equal(result.projected.dispatchAllowed, false);
  assert.equal(result.deterministicFallback.dispatchAllowed, false);
  assert.equal(result.execution.dispatchAllowed, false);
  assert.equal(result.execution.receiptIssued, false);
  assert.equal(result.authority.production_authority, false);
});
