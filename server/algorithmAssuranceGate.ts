const SHA256 = /^[a-f0-9]{64}$/;
const STABLE_ID = /^[A-Za-z0-9._:-]{2,160}$/;

export interface ScenarioEvaluationEvidence {
  scenarioID: string;
  category: 'NORMAL' | 'PEAK' | 'EXTREME_WEATHER' | 'EQUIPMENT_FAILURE' | 'DATA_LOSS' | 'REGULATORY_DELAY';
  episodes: number;
  seeds: number;
  objectiveMean: number;
  objectiveImprovementLower95: number;
  delayImprovementLower95: number;
  carbonImprovementLower95: number;
  safetyViolationCount: number;
  safetyViolationRateUpper95: number;
}

export interface AlgorithmAssuranceEvidence {
  protocolVersion: 'algorithm-assurance-evidence.v1';
  candidate: {
    algorithmID: string;
    checkpointSha256: string;
    trainingDataSha256: string;
    codeSha256: string;
    rollbackCheckpointSha256: string;
  };
  evaluationProtocol: {
    preregistrationSha256: string;
    finalTestLockSha256: string;
    finalTestEvaluationCount: number;
    chronologicalSplit: boolean;
    leakageChecksPassed: boolean;
    minimumSeedCount: number;
    totalHeldOutEpisodes: number;
    confidenceLevel: number;
  };
  scenarios: ScenarioEvaluationEvidence[];
  offPolicyEvaluation: {
    methods: string[];
    effectiveSampleSize: number;
    maximumImportanceWeight: number;
    estimatedImprovementLower95: number;
  };
  robustness: {
    populationStabilityIndexMaximum: number;
    outOfDistributionDetectionAuroc: number;
    missingDataScenariosPassed: boolean;
    sensorDriftScenariosPassed: boolean;
    adversarialScenarioCount: number;
  };
  rewardIntegrity: {
    probeCount: number;
    probesPassed: number;
    forbiddenActionCount: number;
    actionCoveragePercent: number;
  };
  runtimeSafety: {
    safetyShieldTested: boolean;
    killSwitchTested: boolean;
    rollbackTested: boolean;
    auditReceiptTested: boolean;
  };
  shadow: {
    siteAuthorized: boolean;
    completedHours: number;
    minimumRequiredHours: number;
    operatorAcceptanceReference: string | null;
    interventionCount: number;
    unresolvedSevereIncidentCount: number;
  };
}

const allFinite = (values: number[]) => values.every(Number.isFinite);

export const evaluateAlgorithmAssurance = (evidence: AlgorithmAssuranceEvidence) => {
  const offlineBlockers: string[] = [];
  if (evidence.protocolVersion !== 'algorithm-assurance-evidence.v1') offlineBlockers.push('protocol_version_invalid');
  if (!STABLE_ID.test(evidence.candidate.algorithmID)) offlineBlockers.push('algorithm_id_invalid');
  for (const [field, digest] of Object.entries(evidence.candidate)) {
    if (field.endsWith('Sha256') && !SHA256.test(digest)) offlineBlockers.push(`${field}_invalid`);
  }
  const protocol = evidence.evaluationProtocol;
  if (!SHA256.test(protocol.preregistrationSha256) || !SHA256.test(protocol.finalTestLockSha256)) {
    offlineBlockers.push('evaluation_protocol_fingerprint_invalid');
  }
  if (protocol.finalTestEvaluationCount !== 1) offlineBlockers.push('final_test_reuse_detected');
  if (!protocol.chronologicalSplit || !protocol.leakageChecksPassed) offlineBlockers.push('temporal_leakage_gate_failed');
  if (protocol.minimumSeedCount < 5) offlineBlockers.push('insufficient_random_seeds');
  if (protocol.totalHeldOutEpisodes < 500) offlineBlockers.push('insufficient_held_out_episodes');
  if (protocol.confidenceLevel < 0.95) offlineBlockers.push('confidence_level_below_95_percent');
  const requiredCategories: ScenarioEvaluationEvidence['category'][] = [
    'NORMAL', 'PEAK', 'EXTREME_WEATHER', 'EQUIPMENT_FAILURE', 'DATA_LOSS', 'REGULATORY_DELAY',
  ];
  const categories = new Set(evidence.scenarios.map((scenario) => scenario.category));
  if (new Set(evidence.scenarios.map((scenario) => scenario.scenarioID)).size !== evidence.scenarios.length ||
      evidence.scenarios.some((scenario) => !STABLE_ID.test(scenario.scenarioID))) offlineBlockers.push('scenario_identity_invalid');
  const missingCategories = requiredCategories.filter((category) => !categories.has(category));
  if (missingCategories.length) offlineBlockers.push(`scenario_categories_missing:${missingCategories.join(',')}`);
  evidence.scenarios.forEach((scenario) => {
    if (scenario.episodes < 50 || scenario.seeds < 5) offlineBlockers.push(`scenario_sample_insufficient:${scenario.scenarioID}`);
    if (!allFinite([
      scenario.objectiveMean, scenario.objectiveImprovementLower95, scenario.delayImprovementLower95,
      scenario.carbonImprovementLower95, scenario.safetyViolationRateUpper95,
    ])) offlineBlockers.push(`scenario_non_finite_metric:${scenario.scenarioID}`);
    if (scenario.objectiveImprovementLower95 < 0) offlineBlockers.push(`objective_regression:${scenario.scenarioID}`);
    if (scenario.safetyViolationCount > 0 || scenario.safetyViolationRateUpper95 > 0.01) {
      offlineBlockers.push(`safety_violation_gate_failed:${scenario.scenarioID}`);
    }
  });
  const ope = evidence.offPolicyEvaluation;
  if (!ope.methods.includes('DOUBLY_ROBUST') || !ope.methods.includes('WEIGHTED_IMPORTANCE_SAMPLING')) {
    offlineBlockers.push('independent_ope_methods_missing');
  }
  if (!allFinite([ope.effectiveSampleSize, ope.maximumImportanceWeight, ope.estimatedImprovementLower95]) ||
      ope.effectiveSampleSize < 200 || ope.maximumImportanceWeight <= 0 || ope.maximumImportanceWeight > 20 ||
      ope.estimatedImprovementLower95 < 0) {
    offlineBlockers.push('off_policy_evaluation_unreliable');
  }
  const robustness = evidence.robustness;
  if (!allFinite([robustness.populationStabilityIndexMaximum, robustness.outOfDistributionDetectionAuroc]) ||
      robustness.populationStabilityIndexMaximum < 0 || robustness.populationStabilityIndexMaximum > 0.2) {
    offlineBlockers.push('distribution_shift_too_large');
  }
  if (!Number.isFinite(robustness.outOfDistributionDetectionAuroc) || robustness.outOfDistributionDetectionAuroc < 0.8 ||
      robustness.outOfDistributionDetectionAuroc > 1) offlineBlockers.push('out_of_distribution_detection_weak');
  if (!robustness.missingDataScenariosPassed || !robustness.sensorDriftScenariosPassed || robustness.adversarialScenarioCount < 20) {
    offlineBlockers.push('robustness_suite_incomplete');
  }
  const reward = evidence.rewardIntegrity;
  if (reward.probeCount < 20 || reward.probesPassed !== reward.probeCount || reward.forbiddenActionCount !== 0 ||
      reward.actionCoveragePercent < 95) offlineBlockers.push('reward_integrity_gate_failed');
  if (!Object.values(evidence.runtimeSafety).every(Boolean)) offlineBlockers.push('runtime_safety_controls_not_verified');
  const uniqueOfflineBlockers = [...new Set(offlineBlockers)];
  const offlinePromotionReady = uniqueOfflineBlockers.length === 0;
  const shadowBlockers = [
    ...(evidence.shadow.siteAuthorized ? [] : ['shadow_site_not_authorized']),
    ...(evidence.shadow.completedHours >= evidence.shadow.minimumRequiredHours ? [] : ['shadow_duration_incomplete']),
    ...(evidence.shadow.operatorAcceptanceReference ? [] : ['operator_acceptance_missing']),
    ...(evidence.shadow.unresolvedSevereIncidentCount === 0 ? [] : ['unresolved_severe_shadow_incident']),
    ...(evidence.shadow.minimumRequiredHours >= 720 ? [] : ['shadow_minimum_below_720_hours']),
  ];
  const shadowPromotionReady = offlinePromotionReady && shadowBlockers.length === 0;
  return {
    protocolVersion: 'algorithm-assurance-decision.v1',
    status: offlinePromotionReady ? 'ADMITTED_OFFLINE_CHAMPION' : 'REJECTED_OFFLINE_CANDIDATE',
    offlinePromotionReady,
    offlineBlockers: uniqueOfflineBlockers,
    shadowPromotionReady,
    shadowBlockers,
    productionDeploymentReady: false,
    remainingProductionBlockers: [
      'physical_dispatch_adapter_not_installed',
      'independent_ot_safety_case_not_accepted',
      'production_canary_and_rollback_authorization_not_completed',
    ],
    authority: { dispatchAllowed: false, productionAuthority: false },
  };
};

export type AssuredActionID = 'hold-plan' | 'eco-speed' | 'arrival-window' | 'port-diversion' | 'capacity-control';

export interface AlgorithmRuntimeState {
  dataCompletenessPercent: number;
  communicationAvailable: boolean;
  vesselTrafficCriticalEncounterCount: number;
  safetyRiskPercent: number;
  yardOccupancyPercent: number;
  transformerLoadingPercent: number;
  channelAvailable: boolean;
  liveAuthorityVerified: boolean;
}

export const applyAlgorithmSafetyShield = (requestedAction: string, state: AlgorithmRuntimeState) => {
  const allowed: AssuredActionID[] = ['hold-plan', 'eco-speed', 'arrival-window', 'port-diversion', 'capacity-control'];
  const blockers: string[] = [];
  if (!allowed.includes(requestedAction as AssuredActionID)) blockers.push('action_not_in_allowlist');
  if (state.dataCompletenessPercent < 95) blockers.push('data_completeness_below_95_percent');
  if (!state.communicationAvailable) blockers.push('communications_unavailable');
  if (state.vesselTrafficCriticalEncounterCount > 0) blockers.push('critical_vessel_encounter_active');
  if (state.safetyRiskPercent > 15) blockers.push('safety_risk_above_envelope');
  if (!state.channelAvailable && requestedAction !== 'hold-plan') blockers.push('channel_unavailable');
  if (requestedAction === 'capacity-control' && (state.yardOccupancyPercent > 90 || state.transformerLoadingPercent > 95)) {
    blockers.push('capacity_control_physical_envelope_blocked');
  }
  if (!state.liveAuthorityVerified) blockers.push('live_authority_not_verified');
  return {
    protocolVersion: 'algorithm-runtime-safety-shield.v1',
    requestedAction,
    admitted: blockers.length === 0,
    shieldedAction: blockers.length ? 'hold-plan' : requestedAction as AssuredActionID,
    blockers,
    requiresHumanReview: true,
    dispatchAllowed: false,
    productionAuthority: false,
  };
};
