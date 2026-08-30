import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  applyAlgorithmSafetyShield,
  evaluateAlgorithmAssurance,
  type AlgorithmAssuranceEvidence,
  type ScenarioEvaluationEvidence,
} from '../server/algorithmAssuranceGate.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const categories: ScenarioEvaluationEvidence['category'][] = [
  'NORMAL', 'PEAK', 'EXTREME_WEATHER', 'EQUIPMENT_FAILURE', 'DATA_LOSS', 'REGULATORY_DELAY',
];
const evidence = (): AlgorithmAssuranceEvidence => ({
  protocolVersion: 'algorithm-assurance-evidence.v1',
  candidate: {
    algorithmID: 'dyna-q-balanced-resilience',
    checkpointSha256: hash('checkpoint'),
    trainingDataSha256: hash('training-data'),
    codeSha256: hash('code'),
    rollbackCheckpointSha256: hash('rollback-checkpoint'),
  },
  evaluationProtocol: {
    preregistrationSha256: hash('preregistered-plan'),
    finalTestLockSha256: hash('locked-final-test'),
    finalTestEvaluationCount: 1,
    chronologicalSplit: true,
    leakageChecksPassed: true,
    minimumSeedCount: 5,
    totalHeldOutEpisodes: 600,
    confidenceLevel: 0.95,
  },
  scenarios: categories.map((category, index) => ({
    scenarioID: `scenario.${index + 1}`,
    category,
    episodes: 100,
    seeds: 5,
    objectiveMean: 10 - index * 0.1,
    objectiveImprovementLower95: 0.5,
    delayImprovementLower95: 0.2,
    carbonImprovementLower95: 0.1,
    safetyViolationCount: 0,
    safetyViolationRateUpper95: 0.005,
  })),
  offPolicyEvaluation: {
    methods: ['DOUBLY_ROBUST', 'WEIGHTED_IMPORTANCE_SAMPLING'],
    effectiveSampleSize: 480,
    maximumImportanceWeight: 4.2,
    estimatedImprovementLower95: 0.3,
  },
  robustness: {
    populationStabilityIndexMaximum: 0.12,
    outOfDistributionDetectionAuroc: 0.91,
    missingDataScenariosPassed: true,
    sensorDriftScenariosPassed: true,
    adversarialScenarioCount: 30,
  },
  rewardIntegrity: {
    probeCount: 24,
    probesPassed: 24,
    forbiddenActionCount: 0,
    actionCoveragePercent: 100,
  },
  runtimeSafety: {
    safetyShieldTested: true,
    killSwitchTested: true,
    rollbackTested: true,
    auditReceiptTested: true,
  },
  shadow: {
    siteAuthorized: false,
    completedHours: 0,
    minimumRequiredHours: 720,
    operatorAcceptanceReference: null,
    interventionCount: 0,
    unresolvedSevereIncidentCount: 0,
  },
});

test('complete offline evidence admits only an offline champion and keeps field deployment closed', () => {
  const result = evaluateAlgorithmAssurance(evidence());
  assert.equal(result.status, 'ADMITTED_OFFLINE_CHAMPION');
  assert.equal(result.offlinePromotionReady, true);
  assert.equal(result.shadowPromotionReady, false);
  assert.equal(result.productionDeploymentReady, false);
  assert.ok(result.shadowBlockers.includes('shadow_site_not_authorized'));
  assert.equal(result.authority.dispatchAllowed, false);
});

test('safety violations, distribution shift and final-test reuse reject the candidate', () => {
  const value = evidence();
  value.evaluationProtocol.finalTestEvaluationCount = 2;
  value.scenarios[2].safetyViolationCount = 1;
  value.robustness.populationStabilityIndexMaximum = 0.4;
  const result = evaluateAlgorithmAssurance(value);
  assert.equal(result.status, 'REJECTED_OFFLINE_CANDIDATE');
  assert.ok(result.offlineBlockers.includes('final_test_reuse_detected'));
  assert.ok(result.offlineBlockers.some((item) => item.startsWith('safety_violation_gate_failed:')));
  assert.ok(result.offlineBlockers.includes('distribution_shift_too_large'));
});

test('runtime safety shield substitutes hold-plan when data, traffic or physical envelopes are unsafe', () => {
  const result = applyAlgorithmSafetyShield('capacity-control', {
    dataCompletenessPercent: 92,
    communicationAvailable: true,
    vesselTrafficCriticalEncounterCount: 1,
    safetyRiskPercent: 18,
    yardOccupancyPercent: 94,
    transformerLoadingPercent: 97,
    channelAvailable: true,
    liveAuthorityVerified: false,
  });
  assert.equal(result.admitted, false);
  assert.equal(result.shieldedAction, 'hold-plan');
  assert.ok(result.blockers.includes('critical_vessel_encounter_active'));
  assert.ok(result.blockers.includes('capacity_control_physical_envelope_blocked'));
  assert.equal(result.dispatchAllowed, false);
});
