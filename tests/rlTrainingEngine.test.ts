import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPortTrainingDataset } from '../server/portTrainingDataset.ts';
import {
  evaluateTrainedPolicy,
  inferTrainedPolicy,
  RL_ALGORITHMS,
  RL_ACTIONS,
  resolveRewardWeights,
  trainRlBenchmark,
  type RlTrainingRequest,
} from '../server/rlTrainingEngine.ts';

const request: RlTrainingRequest = {
  protocolVersion: 'rl-training-job.v1',
  algorithmId: 'q-learning',
  trainingParameters: {
    maxEpisodes: 120,
    seed: 240_520,
    learningRate: 0.12,
    discountGamma: 0.97,
  },
  rewardWeights: {
    delay: 0.28,
    congestion: 0.24,
    carbon: 0.18,
    safety: 0.2,
    resilience: 0.1,
  },
  scenarioSnapshot: { scenarioId: 'test-malacca-public-data' },
};

test('public dataset is chronological and separates training, validation, and final test rows', async () => {
  const dataset = await loadPortTrainingDataset();
  assert.ok(dataset.records.length >= 300);
  assert.equal(dataset.trainRecords.length, Math.floor(dataset.records.length * 0.7));
  assert.equal(dataset.validationRecords.length, Math.floor(dataset.records.length * 0.85) - dataset.trainRecords.length);
  assert.equal(dataset.testRecords.length, dataset.records.length - dataset.trainRecords.length - dataset.validationRecords.length);
  assert.equal(dataset.records[0].timestamp, '1995-01');
  assert.equal(dataset.records.at(-1)!.timestamp, '2026-05');
  assert.ok(dataset.trainRecords.at(-1)!.timestamp < dataset.validationRecords[0].timestamp);
  assert.ok(dataset.validationRecords.at(-1)!.timestamp < dataset.testRecords[0].timestamp);
  assert.equal(dataset.split.method, 'chronological');
  assert.equal(dataset.quality.capacityMode, 'empirical-proxy');
  assert.equal(dataset.quality.capacityProxyCalibratedOn, 'train-only');
  assert.equal(dataset.quality.capacityProxyMethod, 'train-p90-service-envelope');
  assert.ok((dataset.quality.capacityProxyValue ?? 0) > 0);
  assert.equal(dataset.quality.operationalClaimAllowed, false);
  assert.equal(dataset.portId, 'SGSIN-AGGREGATE');
  assert.equal(dataset.evidenceLevel, 'public-aggregate-proxy');
  assert.equal(dataset.quality.duplicateTimestampCount, 0);
  assert.ok(Number.isFinite(dataset.quality.testArrivalDriftPercent));
  assert.match(dataset.fingerprint, /^[a-f0-9]{16}$/);
});

test('multi-port datasets require an explicit port and reject duplicate timestamps', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'malacca-port-dataset-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const records = ['SGSIN', 'MYPKG'].flatMap((portId) => Array.from({ length: 20 }, (_, index) => ({
    port_id: portId,
    timestamp: `2025-${String(index + 1).padStart(2, '0')}`,
    arrivals: 100 + index,
    gross_tonnage: 10_000 + index,
    capacity: 110,
  })));
  const datasetPath = path.join(directory, 'ports.json');
  await writeFile(datasetPath, JSON.stringify(records), 'utf8');
  await assert.rejects(loadPortTrainingDataset(datasetPath), /包含多个港口/);
  const selected = await loadPortTrainingDataset(datasetPath, 'MYPKG');
  assert.equal(selected.portId, 'MYPKG');
  assert.equal(selected.quality.capacityMode, 'measured');
  assert.equal(selected.quality.capacityProxyCalibratedOn, null);
  assert.ok(selected.records.every((record) => record.portId === 'MYPKG'));
  const duplicatePath = path.join(directory, 'duplicate.json');
  await writeFile(duplicatePath, JSON.stringify([...records, records[0]]), 'utf8');
  await assert.rejects(loadPortTrainingDataset(duplicatePath, 'SGSIN'), /重复时间戳/);
});

test('capacity proxy is calibrated on training records without future-demand leakage', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'malacca-port-capacity-leakage-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const records = Array.from({ length: 20 }, (_, index) => ({
    timestamp: `2025-${String(index + 1).padStart(2, '0')}`,
    arrivals: index < 14 ? 100 : 10_000,
    gross_tonnage: 1_000 + index,
  }));
  const datasetPath = path.join(directory, 'future-demand.json');
  await writeFile(datasetPath, JSON.stringify(records), 'utf8');
  const dataset = await loadPortTrainingDataset(datasetPath);
  assert.equal(dataset.trainRecords.length, 14);
  assert.ok(dataset.records.every((record) => record.capacity === 100));
  assert.equal(dataset.quality.capacityProxyCalibratedOn, 'train-only');
});

test('public aggregate actions stay inside the conservative intervention envelope', () => {
  for (const action of RL_ACTIONS) {
    assert.ok(action.deferredDemand <= 0.02);
    assert.ok(action.divertedDemand <= 0.01);
    assert.ok(action.capacityMultiplier >= 0.995 && action.capacityMultiplier <= 1.02);
    assert.ok(action.carbonMultiplier >= 0.98 && action.carbonMultiplier <= 1.01);
    assert.ok(Math.abs(action.safetyModifier) <= 0.003);
  }
});

test('objective presets resolve to distinct normalized reward functions', () => {
  const balanced = resolveRewardWeights({ objectiveId: 'balanced-resilience' });
  const carbon = resolveRewardWeights({ objectiveId: 'min-carbon' });
  const throughput = resolveRewardWeights({ objectiveId: 'max-throughput' });
  assert.equal(roundWeightTotal(balanced), 1);
  assert.equal(roundWeightTotal(carbon), 1);
  assert.equal(roundWeightTotal(throughput), 1);
  assert.ok(carbon.carbon > balanced.carbon);
  assert.ok(throughput.throughput > balanced.throughput);
});

test('four RL algorithms update parameters and MPC stays a control baseline', async () => {
  const dataset = await loadPortTrainingDataset();
  const progress: Array<{ percent: number; environmentSteps: number; parameterUpdates: number }> = [];
  const artifacts = await trainRlBenchmark(request, dataset, (update) => progress.push({
    percent: update.progressPercent,
    environmentSteps: update.environmentSteps,
    parameterUpdates: update.parameterUpdates,
  }));
  assert.deepEqual(artifacts.benchmark.results.map((result) => result.id), RL_ALGORITHMS.map((algorithm) => algorithm.id));
  assert.equal(artifacts.benchmark.protocolVersion, 'rl-benchmark.v2');
  assert.equal(artifacts.benchmark.selectionSplit, 'validation');
  assert.equal(artifacts.benchmark.dataset.fingerprint, dataset.fingerprint);
  assert.equal(artifacts.benchmark.dataset.validationRecordCount, dataset.validationRecords.length);
  for (const result of artifacts.benchmark.results.filter((item) => item.family === 'reinforcement-learning')) {
    assert.equal(result.training.episodes, 120);
    assert.equal(result.training.tuningTrials, 3);
    assert.equal(result.training.executedEpisodes, 360);
    assert.ok(result.training.environmentSteps > 0);
    assert.ok(result.training.parameterUpdates >= result.training.environmentSteps);
    assert.ok(result.training.visitedStates > 0);
    assert.ok(result.curve.length > 3);
    assert.ok(Number.isFinite(result.selectionScore));
    assert.ok(result.hyperparameters.learningRate);
    assert.equal(result.tuning.selectionSplit, 'validation-tuning');
    assert.ok(result.evaluation.modeled.meanServiceLevelPercent >= 0);
  }
  const mpc = artifacts.benchmark.results.find((result) => result.id === 'mpc')!;
  assert.equal(mpc.family, 'control-theory');
  assert.equal(mpc.training.episodes, 0);
  assert.equal(mpc.training.tuningTrials, 1);
  assert.ok(mpc.training.parameterUpdates > 0);
  assert.ok(progress.every((value, index) => index === 0 || value.percent >= progress[index - 1].percent));
  assert.ok(progress.every((value, index) => index === 0 || value.environmentSteps >= progress[index - 1].environmentSteps));
  assert.ok(progress.every((value, index) => index === 0 || value.parameterUpdates >= progress[index - 1].parameterUpdates));
  assert.ok(progress.at(-1)!.environmentSteps > 10_000);
  assert.ok(progress.at(-1)!.parameterUpdates > 10_000);
});

test('evaluation trace uses held-out timestamps and trained inference returns a real action', async () => {
  const dataset = await loadPortTrainingDataset();
  const artifacts = await trainRlBenchmark(request, dataset, () => undefined);
  const evaluation = evaluateTrainedPolicy(
    'test-job',
    artifacts.benchmark.bestAlgorithmId,
    'closed-loop-replay',
    artifacts,
    dataset,
    request,
  );
  assert.equal(evaluation.split, 'test');
  assert.equal(evaluation.trace.length, dataset.testRecords.length);
  assert.deepEqual(evaluation.trace.map((point) => point.timestamp), dataset.testRecords.map((record) => record.timestamp));
  assert.ok(evaluation.trace.every((point) => point.actionId && Number.isFinite(point.reward)));
  assert.ok(evaluation.trace.every((point) =>
    Number.isFinite(point.serviceLevelPercent) &&
    Number.isFinite(point.deferredBacklogVessels)));
  const policy = artifacts.policies.get(artifacts.benchmark.bestAlgorithmId)!;
  const inference = inferTrainedPolicy(policy, dataset, request, {
    congestionPercent: 78,
    delayMinutes: 42,
    carbonTons: 180,
    windSpeedMs: 12,
    waveHeightM: 1.4,
    visibilityKm: 8,
  });
  assert.equal(inference.values.length, 5);
  assert.ok(inference.action.id);
});

const roundWeightTotal = (weights: ReturnType<typeof resolveRewardWeights>) =>
  Number(Object.values(weights).reduce((sum, value) => sum + value, 0).toFixed(8));
