import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runRlPolicyInference,
  type TrainedPolicyDecision,
} from '../server/rlPolicyInference.ts';

const trainedDecision = (
  actionIndex: number,
  values: number[],
): TrainedPolicyDecision => ({
  algorithmId: 'q-learning',
  benchmark: {
    dataset: {
      label: 'admission-test-public-data',
      fingerprint: '0123456789abcdef',
      testRange: ['2025-01', '2025-06'],
    },
    results: [{
      id: 'q-learning',
      training: { episodes: 120 },
    }],
  } as TrainedPolicyDecision['benchmark'],
  decision: {
    actionIndex,
    values,
    action: {
      id: 'test-action',
      label: 'test-action',
      detail: 'test-action',
      deferredDemand: 0,
      divertedDemand: 0,
      capacityMultiplier: 1,
      carbonMultiplier: 1,
      safetyModifier: 0,
    },
  },
});

const request = {
  requestId: 'admission-test',
  jobId: 'job-test',
  state: {
    congestionPercent: 70,
    delayMinutes: 45,
    carbonTons: 200,
    resilienceIndex: 60,
    windSpeedMs: 8,
    waveHeightM: 1.2,
    visibilityKm: 12,
    queueVessels: 30,
    eventCount: 1,
  },
} as const;

test('policy admission accepts a decisive non-regressing action', () => {
  const result = runRlPolicyInference(request, trainedDecision(0, [8, 0, 0, 0, 0]));
  assert.equal(result.admission.status, 'admitted');
  assert.equal(result.admission.blockers.length, 0);
  assert.ok(result.inference.confidencePercent >= result.admission.thresholds.minimumConfidencePercent);
  assert.ok(result.admission.normalizedEntropy <= result.admission.thresholds.maximumNormalizedEntropy);
});

test('policy admission abstains on near-uniform low-confidence output', () => {
  const result = runRlPolicyInference(request, trainedDecision(0, [0, 0, 0, 0, 0]));
  assert.equal(result.admission.status, 'abstain');
  assert.equal(result.admission.checks.confidence, false);
  assert.equal(result.admission.checks.entropy, false);
  assert.ok(result.admission.blockers.some((blocker) => blocker.includes('动作置信度')));
  assert.ok(result.admission.blockers.some((blocker) => blocker.includes('策略熵')));
});

test('policy admission rejects a confident action that regresses carbon', () => {
  const result = runRlPolicyInference(request, trainedDecision(3, [0, 0, 0, 8, 0]));
  assert.equal(result.admission.status, 'abstain');
  assert.equal(result.admission.checks.carbonNonRegression, false);
  assert.ok(result.admission.blockers.includes('碳排业务指标预计退化'));
});
