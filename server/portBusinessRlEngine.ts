import {
  PORT_BUSINESS_ACTIONS,
  PORT_BUSINESS_AUTHORITY_BOUNDARY,
  PORT_BUSINESS_OBSERVATIONS,
  PORT_BUSINESS_REWARD_COMPONENTS,
  type BusinessActionId,
  type BusinessObservationId,
} from '../shared/portBusinessRlContract.ts';
import {
  businessActionEffect,
  applicableBusinessActionIds,
  optimizeBusinessActionDeterministically,
  projectBusinessAction,
  type PortBusinessDynamicState,
} from './portBusinessControlPlane.ts';
import type { PortBusinessDataset, PortBusinessRecord } from './portBusinessDataset.ts';

export type PortBusinessRlAlgorithmId =
  | 'linear-q-learning'
  | 'linear-sarsa'
  | 'linear-expected-sarsa'
  | 'linear-dyna-q';

export type BusinessEvaluationScenarioId =
  | 'chronological-replay'
  | 'demand-surge'
  | 'capacity-disruption'
  | 'weather-generalization';

export interface LinearBusinessPolicy {
  protocolVersion: 'linear-port-business-policy.v1';
  algorithmId: PortBusinessRlAlgorithmId;
  observationIds: BusinessObservationId[];
  actionIds: BusinessActionId[];
  weights: number[][];
  hyperparameters: {
    learningRate: number;
    discountGamma: number;
    planningSteps: number;
    episodes: number;
    seed: number;
  };
  training: {
    environmentSteps: number;
    parameterUpdates: number;
    finalRewardEma: number;
  };
}

export interface BusinessOperationalMetrics {
  meanReward: number;
  meanWaitingHours: number;
  p95WaitingHours: number;
  meanQueueVessels: number;
  serviceLevelPercent: number;
  throughputRetentionPercent: number;
  carbonIntensity: number;
  energyCostIndex: number;
  yardOverflowRatePercent: number;
  gateSlaBreachRatePercent: number;
  fairnessGapPercent: number;
  recoveryBacklogVessels: number;
  interventionRatePercent: number;
  actionSwitchRatePercent: number;
  safetyProjectionRatePercent: number;
  hardConstraintViolations: number;
}

export interface BusinessEvaluationResult {
  scenarioId: BusinessEvaluationScenarioId;
  policyKind: 'reinforcement-learning' | 'standard-operating-procedure' | 'deterministic-optimizer';
  algorithmId: PortBusinessRlAlgorithmId | 'sop' | 'deterministic-optimizer';
  metrics: BusinessOperationalMetrics;
  actionCounts: Record<string, number>;
}

export interface BusinessTrainingAttempt {
  attemptId: string;
  episodes: number;
  seeds: number[];
  candidates: Array<{
    algorithmId: PortBusinessRlAlgorithmId;
    configurationId: string;
    learningRate: number;
    discountGamma: number;
    validationScoreMean: number;
    validationRewardMean: number;
    validationSafetyViolations: number;
    selectedForAlgorithm: boolean;
  }>;
  selectedAlgorithmId: PortBusinessRlAlgorithmId;
  validationGate: BusinessValueGate;
  status: 'qualified' | 'rejected';
  rejectionReasons: string[];
}

export interface ConfidenceSummary {
  mean: number;
  lower95: number;
  upper95: number;
  min: number;
  max: number;
  samples: number;
}

export interface BusinessValueGate {
  thresholds: {
    minimumRewardImprovementLower95: number;
    minimumWaitReductionHoursLower95: number;
    minimumQueueReductionVesselsLower95: number;
    minimumThroughputRetentionPercent: number;
    minimumCarbonReductionPercentLower95: number;
    minimumFairnessGapReductionPointsLower95: number;
    maximumMeanInterventionRatePercent: number;
    maximumMeanActionSwitchRatePercent: number;
    maximumSafetyProjectionRatePercent: number;
    maximumHardConstraintViolations: number;
  };
  evidence: {
    rewardImprovement: ConfidenceSummary;
    waitReductionHours: ConfidenceSummary;
    queueReductionVessels: ConfidenceSummary;
    carbonReductionPercent: ConfidenceSummary;
    fairnessGapReductionPoints: ConfidenceSummary;
    minimumThroughputRetentionPercent: number;
    meanInterventionRatePercent: number;
    meanActionSwitchRatePercent: number;
    materialDelaySampleCount: number;
    maximumSafetyProjectionRatePercent: number;
    hardConstraintViolations: number;
    yardOverflowNonRegression: boolean;
    gateSlaNonRegression: boolean;
  };
  checks: Record<string, boolean>;
  passed: boolean;
}

export interface PortBusinessChampionResult {
  protocolVersion: 'port-business-champion.v3';
  generatedAt: string;
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: PortBusinessDataset['evidenceLevel'];
    operationalClaimAllowed: boolean;
    recordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    sealedTestRange: [string, string];
  };
  attempts: BusinessTrainingAttempt[];
  champion: {
    admitted: boolean;
    algorithmId: PortBusinessRlAlgorithmId;
    attemptId: string;
    seedPolicies: LinearBusinessPolicy[];
    validationGate: BusinessValueGate;
    finalTestGate: BusinessValueGate;
    finalTest: {
      reinforcementLearning: BusinessEvaluationResult[];
      standardOperatingProcedure: BusinessEvaluationResult[];
      deterministicOptimizer: BusinessEvaluationResult[];
    };
  };
  boundary: typeof PORT_BUSINESS_AUTHORITY_BOUNDARY;
  notes: string[];
}

export interface PortBusinessRuntimeInference {
  protocolVersion: 'port-business-runtime-inference.v1';
  observationTensor: Array<{
    id: BusinessObservationId;
    raw: number;
    normalized: number;
    inRange: boolean;
  }>;
  applicableActionIds: BusinessActionId[];
  actionDistribution: Array<{
    actionId: BusinessActionId;
    label: string;
    meanValue: number;
    ensembleStd: number;
    probability: number;
    voteShare: number;
    applicable: boolean;
  }>;
  selectedAction: {
    actionId: BusinessActionId;
    label: string;
    probability: number;
    voteShare: number;
    requiresHumanApproval: boolean;
  };
  uncertainty: {
    normalizedEntropy: number;
    outOfRangeObservationCount: number;
    ensemblePolicyCount: number;
  };
}

interface SimulatorState extends PortBusinessDynamicState {
  meanWaitingHours: number;
  p95WaitingHours: number;
  carbonIntensity: number;
  energyCostIndex: number;
}

interface TransitionSample {
  state: SimulatorState;
  requestedActionId: BusinessActionId;
  executedActionId: BusinessActionId;
  reward: number;
  arrivals: number;
  processed: number;
  diverted: number;
  serviceLevel: number;
  throughputRetention: number;
  safetyProjected: number;
  hardConstraintViolations: number;
}

const RL_ALGORITHMS: PortBusinessRlAlgorithmId[] = [
  'linear-q-learning',
  'linear-sarsa',
  'linear-expected-sarsa',
  'linear-dyna-q',
];
const ACTION_IDS = PORT_BUSINESS_ACTIONS.map((action) => action.id);
const ACTION_INDEX = new Map(ACTION_IDS.map((id, index) => [id, index]));
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 6) => Number(value.toFixed(digits));

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const metoceanRisk = (record: PortBusinessRecord) => clamp(
  record.windSpeedMs / 24 * 0.3 +
  record.waveHeightM / 4 * 0.28 +
  record.currentSpeedKnots / 2 * 0.14 +
  Math.max(0, 8 - record.visibilityKm) / 8 * 0.18 +
  record.safetyRisk * 0.1,
  0,
  1,
);

const initialSimulatorState = (record: PortBusinessRecord): SimulatorState => {
  const queue = Math.max(0, record.arrivals - record.effectiveCapacity) * 0.28;
  return {
    queueVessels: queue,
    deferredBacklogVessels: 0,
    recoveryBacklogVessels: record.arrivals * record.capacityLossRatio * 0.08,
    yardOccupancy: record.yardOccupancy,
    gateQueuePressure: record.gateQueuePressure,
    fairnessGap: record.fairnessDemandSkew,
    previousActionId: 'hold-plan',
    meanWaitingHours: queue / Math.max(1, record.effectiveCapacity) * 24,
    p95WaitingHours: queue / Math.max(1, record.effectiveCapacity) * 36,
    carbonIntensity: record.carbonIntensity,
    energyCostIndex: record.carbonIntensity * record.energyPriceIndex,
  };
};

export const buildPortBusinessObservation = (
  state: SimulatorState,
  record: PortBusinessRecord,
  previous?: PortBusinessRecord,
): Record<BusinessObservationId, number> => {
  const capacity = Math.max(1, record.effectiveCapacity);
  const previousArrivals = previous?.arrivals ?? record.arrivals;
  const railPressure = record.railTransferDemand / Math.max(1, record.transferCapacity * 0.45);
  const waterPressure = record.waterTransferDemand / Math.max(1, record.transferCapacity * 0.55);
  return {
    arrivals_to_capacity: record.arrivals / capacity,
    arrival_trend: (record.arrivals - previousArrivals) / Math.max(1, previousArrivals),
    eta_deviation: record.etaDeviationHours / 12,
    vessel_size_index: record.vesselSizeIndex,
    queue_to_capacity: state.queueVessels / capacity,
    mean_waiting_hours_norm: state.meanWaitingHours / 24,
    p95_waiting_hours_norm: state.p95WaitingHours / 24,
    deferred_backlog_to_capacity: state.deferredBacklogVessels / capacity,
    berth_utilization: record.berthUtilization,
    berth_capacity_slack: (capacity - state.queueVessels - record.arrivals) / capacity,
    crane_productivity_index: record.craneProductivityIndex,
    crane_availability_ratio: record.craneAvailabilityRatio,
    yard_occupancy: state.yardOccupancy,
    yard_capacity_slack: 1 - state.yardOccupancy,
    truck_turn_time_norm: record.truckTurnTimeMinutes / 60,
    gate_queue_pressure: state.gateQueuePressure,
    rail_transfer_pressure: railPressure,
    water_transfer_pressure: waterPressure,
    network_transfer_slack: (record.transferCapacity - record.railTransferDemand - record.waterTransferDemand) /
      Math.max(1, record.transferCapacity),
    channel_available: record.channelAvailable ? 1 : 0,
    tide_window_open: record.tideWindowOpen ? 1 : 0,
    pilot_availability_ratio: record.pilotAvailabilityRatio,
    tug_availability_ratio: record.tugAvailabilityRatio,
    metocean_risk: metoceanRisk(record),
    hazmat_restriction_active: record.hazmatRestrictionActive ? 1 : 0,
    shore_power_availability: record.shorePowerAvailability,
    energy_carbon_intensity: state.carbonIntensity,
    energy_price_index: record.energyPriceIndex,
    capacity_loss_ratio: record.capacityLossRatio,
    recovery_backlog_to_capacity: state.recoveryBacklogVessels / capacity,
    service_fairness_gap: state.fairnessGap,
    forecast_uncertainty: record.forecastUncertainty,
    data_quality_score: record.dataQualityScore,
  };
};

const observationFeatures = (
  state: SimulatorState,
  record: PortBusinessRecord,
  previous?: PortBusinessRecord,
) => {
  const observation = buildPortBusinessObservation(state, record, previous);
  return [
    1,
    ...PORT_BUSINESS_OBSERVATIONS.map((definition) => {
      const value = clamp(observation[definition.id], definition.range[0], definition.range[1]);
      return ((value - definition.range[0]) / Math.max(1e-9, definition.range[1] - definition.range[0])) * 2 - 1;
    }),
  ];
};

const dot = (left: number[], right: number[]) =>
  left.reduce((sum, value, index) => sum + value * right[index], 0);

const qValues = (weights: number[][], features: number[]) => weights.map((row) => dot(row, features));

const softmax = (values: number[]) => {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(clamp(value - maximum, -30, 30)));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
};

const feasibleIndexes = (record: PortBusinessRecord, state: SimulatorState) =>
  applicableBusinessActionIds(record, state).map((id) => ACTION_INDEX.get(id)!).filter(Number.isInteger);

const bestIndex = (values: number[], available: number[], random?: () => number) => {
  const candidates = available.length ? available : [0];
  const best = Math.max(...candidates.map((index) => values[index]));
  const tied = candidates.filter((index) => Math.abs(values[index] - best) < 1e-9);
  return tied[Math.floor((random?.() ?? 0) * tied.length)] ?? tied[0] ?? 0;
};

export const inferPortBusinessPolicyEnsemble = (
  policies: LinearBusinessPolicy[],
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
  previous?: PortBusinessRecord,
): PortBusinessRuntimeInference => {
  if (policies.length === 0) throw new Error('港口全业务冠军不含可用的种子策略');
  const expectedObservations = PORT_BUSINESS_OBSERVATIONS.map((item) => item.id);
  const expectedActions = [...ACTION_IDS];
  for (const policy of policies) {
    if (
      policy.protocolVersion !== 'linear-port-business-policy.v1'
      || policy.observationIds.join('|') !== expectedObservations.join('|')
      || policy.actionIds.join('|') !== expectedActions.join('|')
      || policy.weights.length !== expectedActions.length
      || policy.weights.some((row) => row.length !== expectedObservations.length + 1)
    ) throw new Error('港口全业务冠军策略与当前观测动作合同不兼容');
  }
  const enrichedState: SimulatorState = {
    ...state,
    meanWaitingHours: state.queueVessels / Math.max(1, record.effectiveCapacity) * 24,
    p95WaitingHours: state.queueVessels / Math.max(1, record.effectiveCapacity) * 36,
    carbonIntensity: record.carbonIntensity,
    energyCostIndex: record.carbonIntensity * record.energyPriceIndex,
  };
  const rawObservation = buildPortBusinessObservation(enrichedState, record, previous);
  const observationTensor = PORT_BUSINESS_OBSERVATIONS.map((definition) => {
    const raw = rawObservation[definition.id];
    const bounded = clamp(raw, definition.range[0], definition.range[1]);
    return {
      id: definition.id,
      raw: round(raw),
      normalized: round(((bounded - definition.range[0]) /
        Math.max(1e-9, definition.range[1] - definition.range[0])) * 2 - 1),
      inRange: raw >= definition.range[0] && raw <= definition.range[1],
    };
  });
  const features = [1, ...observationTensor.map((item) => item.normalized)];
  const applicableActionIds = applicableBusinessActionIds(record, state);
  const applicableIndexes = applicableActionIds
    .map((id) => ACTION_INDEX.get(id)!)
    .filter(Number.isInteger);
  const valuesByPolicy = policies.map((policy) => qValues(policy.weights, features));
  const winningIndexes = valuesByPolicy.map((values) => bestIndex(values, applicableIndexes));
  const meanValues = ACTION_IDS.map((_, actionIndex) =>
    valuesByPolicy.reduce((sum, values) => sum + values[actionIndex], 0) / policies.length);
  const applicableMeanValues = applicableIndexes.map((index) => meanValues[index]);
  const meanCenter = applicableMeanValues.reduce((sum, value) => sum + value, 0) /
    Math.max(1, applicableMeanValues.length);
  const valueScale = Math.max(0.25, Math.sqrt(
    applicableMeanValues.reduce((sum, value) => sum + (value - meanCenter) ** 2, 0) /
    Math.max(1, applicableMeanValues.length),
  ));
  const applicableProbabilities = softmax(applicableMeanValues.map((value) => value / valueScale));
  const probabilityByIndex = new Map(applicableIndexes.map((index, position) => [index, applicableProbabilities[position]]));
  const selectedIndex = bestIndex(meanValues, applicableIndexes);
  const actionDistribution = ACTION_IDS.map((actionId, actionIndex) => {
    const values = valuesByPolicy.map((row) => row[actionIndex]);
    const meanValue = meanValues[actionIndex];
    const ensembleStd = Math.sqrt(values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) /
      Math.max(1, values.length));
    const action = PORT_BUSINESS_ACTIONS[actionIndex];
    return {
      actionId,
      label: action.label,
      meanValue: round(meanValue),
      ensembleStd: round(ensembleStd),
      probability: round(probabilityByIndex.get(actionIndex) ?? 0),
      voteShare: round(winningIndexes.filter((winner) => winner === actionIndex).length / policies.length),
      applicable: applicableIndexes.includes(actionIndex),
    };
  });
  const selected = actionDistribution[selectedIndex];
  const entropy = -applicableProbabilities.reduce((sum, probability) =>
    sum + (probability > 0 ? probability * Math.log(probability) : 0), 0);
  return {
    protocolVersion: 'port-business-runtime-inference.v1',
    observationTensor,
    applicableActionIds,
    actionDistribution,
    selectedAction: {
      actionId: selected.actionId,
      label: selected.label,
      probability: selected.probability,
      voteShare: selected.voteShare,
      requiresHumanApproval: PORT_BUSINESS_ACTIONS[selectedIndex].requiresHumanApproval,
    },
    uncertainty: {
      normalizedEntropy: round(entropy / Math.log(Math.max(2, applicableProbabilities.length))),
      outOfRangeObservationCount: observationTensor.filter((item) => !item.inRange).length,
      ensemblePolicyCount: policies.length,
    },
  };
};

const epsilonIndex = (
  values: number[],
  available: number[],
  epsilon: number,
  random: () => number,
) => random() < epsilon
  ? (available[Math.floor(random() * available.length)] ?? 0)
  : bestIndex(values, available, random);

const transition = (
  state: SimulatorState,
  requestedActionId: BusinessActionId,
  record: PortBusinessRecord,
  random: () => number,
  stochastic: boolean,
): TransitionSample => {
  const projection = projectBusinessAction(record, state, requestedActionId);
  const actionId = projection.executedActionId;
  const effect = businessActionEffect(actionId);
  const residual = stochastic ? (random() - 0.5) * 0.055 : 0;
  const arrivals = Math.max(0, record.arrivals * (1 + residual));
  const capacity = Math.max(
    1,
    record.effectiveCapacity * effect.capacityMultiplier *
      clamp(0.88 + record.craneProductivityIndex * 0.12, 0.88, 1.04),
  );
  const releasedDeferred = Math.min(
    state.deferredBacklogVessels,
    Math.max(state.deferredBacklogVessels * 0.3, capacity * 0.018),
  );
  const newlyDeferred = arrivals * effect.deferredDemandFraction;
  const diverted = Math.min(arrivals * effect.divertedDemandFraction, record.transferCapacity * 0.08);
  const admitted = Math.max(0, arrivals - newlyDeferred - diverted + releasedDeferred);
  const availableForService = state.queueVessels + admitted;
  const processed = Math.min(availableForService, capacity);
  const queueVessels = Math.max(0, availableForService - processed);
  const deferredBacklogVessels = Math.max(0, state.deferredBacklogVessels - releasedDeferred + newlyDeferred);
  const serviceDenominator = Math.max(1, state.queueVessels + arrivals + releasedDeferred);
  const serviceLevel = clamp((processed + diverted) / serviceDenominator, 0, 1);
  const throughputRetention = clamp(processed / Math.max(1, arrivals + releasedDeferred), 0, 1.05);
  const loadPressure = (queueVessels + deferredBacklogVessels) / capacity;
  const meanWaitingHours = loadPressure * 24 * (1 + state.fairnessGap * 0.15);
  const fairnessGap = clamp(
    record.fairnessDemandSkew + loadPressure * 0.09 - effect.fairnessRelief,
    0,
    1,
  );
  const p95WaitingHours = meanWaitingHours * (1.48 + fairnessGap * 0.42);
  const yardOccupancy = clamp(
    state.yardOccupancy * 0.64 + record.yardOccupancy * 0.36 +
      Math.max(0, processed / capacity - 0.84) * 0.05 - effect.yardRelief,
    0.25,
    1.08,
  );
  const gateQueuePressure = clamp(
    state.gateQueuePressure * 0.55 + record.gateQueuePressure * 0.45 +
      Math.max(0, yardOccupancy - 0.78) * 0.32 - effect.gateRelief,
    0,
    2,
  );
  const recoveryCreated = arrivals * record.capacityLossRatio * 0.07;
  const recoveryCleared = Math.min(
    state.recoveryBacklogVessels + recoveryCreated,
    capacity * 0.012 * effect.recoveryMultiplier + Math.max(0, capacity - processed) * 0.12,
  );
  const recoveryBacklogVessels = Math.max(0, state.recoveryBacklogVessels + recoveryCreated - recoveryCleared);
  const carbonIntensity = Math.max(
    0.55,
    record.carbonIntensity * effect.carbonMultiplier + loadPressure * 0.035 +
      diverted / Math.max(1, arrivals) * 0.035,
  );
  const energyCostIndex = carbonIntensity * record.energyPriceIndex + effect.interventionCost * 0.16;
  const switchCost = state.previousActionId !== actionId && state.previousActionId !== 'hold-plan' ? 0.02 : 0;
  const serviceTerm = serviceLevel;
  const throughputTerm = throughputRetention;
  const delayPenalty = clamp((meanWaitingHours * 0.55 + p95WaitingHours * 0.45) / 36, 0, 2);
  const queuePenalty = clamp(loadPressure, 0, 2);
  const carbonPenalty = clamp((carbonIntensity - 0.78) / 0.7, 0, 2);
  const energyPenalty = clamp((energyCostIndex - 0.75) / 0.9, 0, 2);
  const yardGatePenalty = clamp(Math.max(0, yardOccupancy - 0.72) * 2.6 + gateQueuePressure / 2, 0, 2);
  const fairnessPenalty = fairnessGap;
  const recoveryTerm = clamp(1 - recoveryBacklogVessels / Math.max(1, capacity), 0, 1);
  const interventionPenalty = effect.interventionCost + switchCost + (projection.modified ? 0.18 : 0);
  const rewardValues: Record<(typeof PORT_BUSINESS_REWARD_COMPONENTS)[number]['id'], number> = {
    service: serviceTerm,
    throughput: throughputTerm,
    delay: -delayPenalty,
    queue: -queuePenalty,
    carbon: -carbonPenalty,
    energy_cost: -energyPenalty,
    yard_gate: -yardGatePenalty,
    fairness: -fairnessPenalty,
    recovery: recoveryTerm,
    intervention: -interventionPenalty,
  };
  const reward = PORT_BUSINESS_REWARD_COMPONENTS.reduce(
    (sum, component) => sum + component.weight * rewardValues[component.id],
    0,
  ) * 10;
  return {
    state: {
      queueVessels,
      deferredBacklogVessels,
      recoveryBacklogVessels,
      yardOccupancy,
      gateQueuePressure,
      fairnessGap,
      previousActionId: actionId,
      meanWaitingHours,
      p95WaitingHours,
      carbonIntensity,
      energyCostIndex,
    },
    requestedActionId,
    executedActionId: actionId,
    reward,
    arrivals,
    processed,
    diverted,
    serviceLevel,
    throughputRetention,
    safetyProjected: projection.modified ? 1 : 0,
    hardConstraintViolations: projection.hardConstraintViolations,
  };
};

const updateLinearWeights = (
  weights: number[][],
  actionIndex: number,
  features: number[],
  tdError: number,
  learningRate: number,
) => {
  const row = weights[actionIndex];
  const boundedError = clamp(tdError, -8, 8);
  const normalizedRate = learningRate / Math.sqrt(features.length);
  for (let index = 0; index < features.length; index += 1) {
    row[index] = clamp(row[index] + normalizedRate * boundedError * features[index], -15, 15);
  }
};

interface ReplayTransition {
  features: number[];
  actionIndex: number;
  reward: number;
  nextFeatures: number[];
  nextFeasible: number[];
}

export const trainLinearBusinessPolicy = (
  algorithmId: PortBusinessRlAlgorithmId,
  records: PortBusinessRecord[],
  options: {
    episodes: number;
    seed: number;
    learningRate: number;
    discountGamma: number;
    planningSteps?: number;
  },
): LinearBusinessPolicy => {
  const random = seededRandom(options.seed);
  const featureCount = PORT_BUSINESS_OBSERVATIONS.length + 1;
  const weights = ACTION_IDS.map(() => Array(featureCount).fill(0) as number[]);
  const replay: ReplayTransition[] = [];
  const planningSteps = algorithmId === 'linear-dyna-q' ? Math.max(1, options.planningSteps ?? 4) : 0;
  const horizon = Math.min(52, Math.max(12, records.length));
  let environmentSteps = 0;
  let parameterUpdates = 0;
  let rewardEma = 0;
  for (let episode = 1; episode <= options.episodes; episode += 1) {
    const start = Math.floor(random() * Math.max(1, records.length - horizon - 1));
    let state = initialSimulatorState(records[start]);
    let features = observationFeatures(state, records[start], records[start - 1]);
    const available = feasibleIndexes(records[start], state);
    const epsilon = Math.max(0.025, 0.34 * Math.exp(-episode / Math.max(40, options.episodes * 0.36)));
    let actionIndex = epsilonIndex(qValues(weights, features), available, epsilon, random);
    let episodeReward = 0;
    for (let step = 0; step < horizon; step += 1) {
      const recordIndex = Math.min(records.length - 1, start + step);
      const record = records[recordIndex];
      const nextRecord = records[Math.min(records.length - 1, recordIndex + 1)];
      const sample = transition(state, ACTION_IDS[actionIndex], record, random, true);
      const nextFeatures = observationFeatures(sample.state, nextRecord, record);
      const nextAvailable = feasibleIndexes(nextRecord, sample.state);
      const nextValues = qValues(weights, nextFeatures);
      const nextAction = epsilonIndex(nextValues, nextAvailable, epsilon, random);
      const nextValue = algorithmId === 'linear-sarsa'
        ? nextValues[nextAction]
        : algorithmId === 'linear-expected-sarsa'
          ? (() => {
              const greedy = bestIndex(nextValues, nextAvailable);
              return nextAvailable.reduce((sum, index) =>
                sum + nextValues[index] *
                  (epsilon / nextAvailable.length + (index === greedy ? 1 - epsilon : 0)), 0);
            })()
          : Math.max(...nextAvailable.map((index) => nextValues[index]));
      const currentValue = dot(weights[actionIndex], features);
      updateLinearWeights(
        weights,
        actionIndex,
        features,
        sample.reward + options.discountGamma * nextValue - currentValue,
        options.learningRate,
      );
      parameterUpdates += 1;
      if (algorithmId === 'linear-dyna-q') {
        replay.push({ features, actionIndex, reward: sample.reward, nextFeatures, nextFeasible: nextAvailable });
        if (replay.length > 12_000) replay.shift();
        for (let planning = 0; planning < planningSteps; planning += 1) {
          const remembered = replay[Math.floor(random() * replay.length)];
          const plannedNext = qValues(weights, remembered.nextFeatures);
          const plannedTarget = remembered.reward + options.discountGamma *
            Math.max(...remembered.nextFeasible.map((index) => plannedNext[index]));
          updateLinearWeights(
            weights,
            remembered.actionIndex,
            remembered.features,
            plannedTarget - dot(weights[remembered.actionIndex], remembered.features),
            options.learningRate * 0.55,
          );
          parameterUpdates += 1;
        }
      }
      state = sample.state;
      features = nextFeatures;
      actionIndex = nextAction;
      episodeReward += sample.reward;
      environmentSteps += 1;
    }
    const normalizedReward = episodeReward / horizon;
    rewardEma = episode === 1 ? normalizedReward : rewardEma * 0.94 + normalizedReward * 0.06;
  }
  return {
    protocolVersion: 'linear-port-business-policy.v1',
    algorithmId,
    observationIds: PORT_BUSINESS_OBSERVATIONS.map((item) => item.id),
    actionIds: [...ACTION_IDS],
    weights: weights.map((row) => row.map((value) => round(value, 9))),
    hyperparameters: {
      learningRate: options.learningRate,
      discountGamma: options.discountGamma,
      planningSteps,
      episodes: options.episodes,
      seed: options.seed,
    },
    training: {
      environmentSteps,
      parameterUpdates,
      finalRewardEma: round(rewardEma),
    },
  };
};

const scenarioRecords = (
  records: PortBusinessRecord[],
  scenarioId: BusinessEvaluationScenarioId,
) => records.map((record, index) => {
  if (scenarioId === 'demand-surge') return { ...record, arrivals: record.arrivals * 1.08 };
  if (scenarioId === 'capacity-disruption') {
    const disruption = index % 17 < 4 ? 0.12 : 0.035;
    return {
      ...record,
      effectiveCapacity: record.effectiveCapacity * (1 - disruption),
      capacityLossRatio: clamp(record.capacityLossRatio + disruption, 0, 0.65),
    };
  }
  if (scenarioId === 'weather-generalization') {
    return {
      ...record,
      windSpeedMs: Math.max(15, record.windSpeedMs * 1.4),
      waveHeightM: Math.max(1.9, record.waveHeightM * 1.45),
      visibilityKm: Math.min(6, record.visibilityKm),
      safetyRisk: clamp(record.safetyRisk + 0.22, 0, 1),
    };
  }
  return { ...record };
});

type EvaluationMode =
  | { kind: 'reinforcement-learning'; policy: LinearBusinessPolicy }
  | { kind: 'standard-operating-procedure' }
  | { kind: 'deterministic-optimizer' };

const sopAction = (): BusinessActionId => 'hold-plan';

export const evaluateBusinessPolicy = (
  mode: EvaluationMode,
  records: PortBusinessRecord[],
  scenarioId: BusinessEvaluationScenarioId,
): BusinessEvaluationResult => {
  const scenario = scenarioRecords(records, scenarioId);
  const random = seededRandom(9_197);
  let state = initialSimulatorState(scenario[0]);
  const samples: TransitionSample[] = [];
  const states: SimulatorState[] = [];
  const actionCounts: Record<string, number> = Object.fromEntries(ACTION_IDS.map((id) => [id, 0]));
  scenario.forEach((record, index) => {
    let actionId: BusinessActionId;
    if (mode.kind === 'reinforcement-learning') {
      const features = observationFeatures(state, record, scenario[index - 1]);
      const values = qValues(mode.policy.weights, features);
      actionId = ACTION_IDS[bestIndex(values, feasibleIndexes(record, state))];
    } else if (mode.kind === 'deterministic-optimizer') {
      actionId = optimizeBusinessActionDeterministically(record, state).selectedActionId;
    } else {
      actionId = sopAction();
    }
    const sample = transition(state, actionId, record, random, false);
    state = sample.state;
    samples.push(sample);
    states.push(state);
    actionCounts[sample.executedActionId] = (actionCounts[sample.executedActionId] ?? 0) + 1;
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const p95 = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  };
  const interventions = samples.filter((sample) => sample.executedActionId !== 'hold-plan').length;
  const switches = samples.filter((sample, index) => index > 0 &&
    sample.executedActionId !== samples[index - 1].executedActionId).length;
  const carbon = mean(states.map((item) => item.carbonIntensity));
  return {
    scenarioId,
    policyKind: mode.kind,
    algorithmId: mode.kind === 'reinforcement-learning' ? mode.policy.algorithmId : mode.kind === 'deterministic-optimizer' ? 'deterministic-optimizer' : 'sop',
    metrics: {
      meanReward: round(mean(samples.map((sample) => sample.reward))),
      meanWaitingHours: round(mean(states.map((item) => item.meanWaitingHours))),
      p95WaitingHours: round(p95(states.map((item) => item.p95WaitingHours))),
      meanQueueVessels: round(mean(states.map((item) => item.queueVessels))),
      serviceLevelPercent: round(mean(samples.map((sample) => sample.serviceLevel)) * 100),
      throughputRetentionPercent: round(mean(samples.map((sample) => sample.throughputRetention)) * 100),
      carbonIntensity: round(carbon),
      energyCostIndex: round(mean(states.map((item) => item.energyCostIndex))),
      yardOverflowRatePercent: round(states.filter((item) => item.yardOccupancy > 1).length / states.length * 100),
      gateSlaBreachRatePercent: round(states.filter((item) => item.gateQueuePressure > 1).length / states.length * 100),
      fairnessGapPercent: round(mean(states.map((item) => item.fairnessGap)) * 100),
      recoveryBacklogVessels: round(states.at(-1)?.recoveryBacklogVessels ?? 0),
      interventionRatePercent: round(interventions / samples.length * 100),
      actionSwitchRatePercent: round(switches / samples.length * 100),
      safetyProjectionRatePercent: round(samples.reduce((sum, sample) => sum + sample.safetyProjected, 0) / samples.length * 100),
      hardConstraintViolations: samples.reduce((sum, sample) => sum + sample.hardConstraintViolations, 0),
    },
    actionCounts,
  };
};

const confidence = (values: number[]): ConfidenceSummary => {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / Math.max(1, values.length));
  return {
    mean: round(mean),
    lower95: round(mean - margin),
    upper95: round(mean + margin),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
    samples: values.length,
  };
};

const businessValueGate = (
  candidates: BusinessEvaluationResult[],
  baselines: BusinessEvaluationResult[],
): BusinessValueGate => {
  const baselineByScenario = new Map(baselines.map((result) => [result.scenarioId, result.metrics]));
  const pairs = candidates.map((candidate) => ({
    candidate: candidate.metrics,
    baseline: baselineByScenario.get(candidate.scenarioId)!,
  }));
  const rewardImprovement = confidence(pairs.map((pair) => pair.candidate.meanReward - pair.baseline.meanReward));
  const carbonReductionPercent = confidence(pairs.map((pair) =>
    (pair.baseline.carbonIntensity - pair.candidate.carbonIntensity) / Math.max(1e-9, pair.baseline.carbonIntensity) * 100));
  const fairnessGapReductionPoints = confidence(pairs.map((pair) =>
    pair.baseline.fairnessGapPercent - pair.candidate.fairnessGapPercent));
  const materialDelayPairs = pairs.filter((pair) => pair.baseline.meanWaitingHours >= 0.1);
  const delayPairs = materialDelayPairs.length ? materialDelayPairs : pairs;
  const materialWaitReductionHours = confidence(delayPairs.map((pair) =>
    pair.baseline.meanWaitingHours - pair.candidate.meanWaitingHours));
  const materialQueueReductionVessels = confidence(delayPairs.map((pair) =>
    pair.baseline.meanQueueVessels - pair.candidate.meanQueueVessels));
  const minimumThroughputRetentionPercent = Math.min(...pairs.map((pair) => pair.candidate.throughputRetentionPercent));
  const meanInterventionRatePercent = pairs.reduce((sum, pair) => sum + pair.candidate.interventionRatePercent, 0) /
    Math.max(1, pairs.length);
  const meanActionSwitchRatePercent = pairs.reduce((sum, pair) => sum + pair.candidate.actionSwitchRatePercent, 0) /
    Math.max(1, pairs.length);
  const maximumSafetyProjectionRatePercent = Math.max(...pairs.map((pair) => pair.candidate.safetyProjectionRatePercent));
  const hardConstraintViolations = pairs.reduce((sum, pair) => sum + pair.candidate.hardConstraintViolations, 0);
  const yardOverflowNonRegression = pairs.every((pair) =>
    pair.candidate.yardOverflowRatePercent <= pair.baseline.yardOverflowRatePercent + 1e-9);
  const gateSlaNonRegression = pairs.every((pair) =>
    pair.candidate.gateSlaBreachRatePercent <= pair.baseline.gateSlaBreachRatePercent + 1e-9);
  const thresholds = {
    minimumRewardImprovementLower95: 0.04,
    minimumWaitReductionHoursLower95: -0.01,
    minimumQueueReductionVesselsLower95: 0.1,
    minimumThroughputRetentionPercent: 98.5,
    minimumCarbonReductionPercentLower95: -0.2,
    minimumFairnessGapReductionPointsLower95: -0.05,
    maximumMeanInterventionRatePercent: 85,
    maximumMeanActionSwitchRatePercent: 75,
    maximumSafetyProjectionRatePercent: 0,
    maximumHardConstraintViolations: 0,
  };
  const checks = {
    rewardImprovement: rewardImprovement.lower95 >= thresholds.minimumRewardImprovementLower95,
    waitingTime: materialWaitReductionHours.lower95 >= thresholds.minimumWaitReductionHoursLower95,
    queue: materialQueueReductionVessels.lower95 >= thresholds.minimumQueueReductionVesselsLower95,
    throughput: minimumThroughputRetentionPercent >= thresholds.minimumThroughputRetentionPercent,
    carbon: carbonReductionPercent.lower95 >= thresholds.minimumCarbonReductionPercentLower95,
    fairness: fairnessGapReductionPoints.lower95 >= thresholds.minimumFairnessGapReductionPointsLower95,
    interventionRate: meanInterventionRatePercent <= thresholds.maximumMeanInterventionRatePercent,
    actionSwitchRate: meanActionSwitchRatePercent <= thresholds.maximumMeanActionSwitchRatePercent,
    yardOverflowNonRegression,
    gateSlaNonRegression,
    safetyProjection: maximumSafetyProjectionRatePercent <= thresholds.maximumSafetyProjectionRatePercent,
    hardConstraints: hardConstraintViolations <= thresholds.maximumHardConstraintViolations,
  };
  return {
    thresholds,
    evidence: {
      rewardImprovement,
      waitReductionHours: materialWaitReductionHours,
      queueReductionVessels: materialQueueReductionVessels,
      carbonReductionPercent,
      fairnessGapReductionPoints,
      minimumThroughputRetentionPercent,
      meanInterventionRatePercent: round(meanInterventionRatePercent),
      meanActionSwitchRatePercent: round(meanActionSwitchRatePercent),
      materialDelaySampleCount: delayPairs.length,
      maximumSafetyProjectionRatePercent,
      hardConstraintViolations,
      yardOverflowNonRegression,
      gateSlaNonRegression,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
};

const selectionScore = (result: BusinessEvaluationResult) =>
  result.metrics.meanReward -
  result.metrics.meanWaitingHours * 0.025 -
  result.metrics.meanQueueVessels * 0.002 -
  result.metrics.fairnessGapPercent * 0.003 -
  result.metrics.safetyProjectionRatePercent * 0.5 -
  result.metrics.hardConstraintViolations * 10;

const evaluationScenarios: BusinessEvaluationScenarioId[] = [
  'chronological-replay',
  'demand-surge',
  'capacity-disruption',
  'weather-generalization',
];

const evaluatePolicyScenarios = (policy: LinearBusinessPolicy, records: PortBusinessRecord[]) =>
  evaluationScenarios.map((scenarioId) => evaluateBusinessPolicy(
    { kind: 'reinforcement-learning', policy }, records, scenarioId,
  ));

const evaluateBaselineScenarios = (
  kind: 'standard-operating-procedure' | 'deterministic-optimizer',
  records: PortBusinessRecord[],
) => evaluationScenarios.map((scenarioId) => evaluateBusinessPolicy({ kind }, records, scenarioId));

const configurations = [
  { id: 'stable', learningRate: 0.034, discountGamma: 0.955 },
  { id: 'long-horizon', learningRate: 0.024, discountGamma: 0.975 },
] as const;

export const trainPortBusinessChampion = (
  dataset: PortBusinessDataset,
  options: {
    seeds?: number[];
    episodeLadder?: number[];
  } = {},
): PortBusinessChampionResult => {
  const seeds = options.seeds ?? [17, 37, 59, 83, 101];
  const episodeLadder = options.episodeLadder ?? [260, 520];
  const attempts: BusinessTrainingAttempt[] = [];
  const validationBaselines = evaluateBaselineScenarios('standard-operating-procedure', dataset.validationRecords);
  let selectedPolicies: LinearBusinessPolicy[] = [];
  let selectedAlgorithmId: PortBusinessRlAlgorithmId = 'linear-q-learning';
  let selectedAttemptId = '';
  let selectedValidationGate: BusinessValueGate | null = null;

  for (const episodes of episodeLadder) {
    const attemptId = `curriculum-${episodes}`;
    const policiesByCandidate = new Map<string, LinearBusinessPolicy[]>();
    const candidateRows: BusinessTrainingAttempt['candidates'] = [];
    for (const algorithmId of RL_ALGORITHMS) {
      for (const configuration of configurations) {
        const policies = seeds.map((seed) => trainLinearBusinessPolicy(
          algorithmId,
          dataset.trainRecords,
          {
            episodes,
            seed,
            learningRate: configuration.learningRate,
            discountGamma: configuration.discountGamma,
            planningSteps: 4,
          },
        ));
        policiesByCandidate.set(`${algorithmId}:${configuration.id}`, policies);
        const evaluations = policies.flatMap((policy) =>
          evaluatePolicyScenarios(policy, dataset.validationRecords));
        candidateRows.push({
          algorithmId,
          configurationId: configuration.id,
          learningRate: configuration.learningRate,
          discountGamma: configuration.discountGamma,
          validationScoreMean: round(evaluations.reduce((sum, result) => sum + selectionScore(result), 0) / evaluations.length),
          validationRewardMean: round(evaluations.reduce((sum, result) => sum + result.metrics.meanReward, 0) / evaluations.length),
          validationSafetyViolations: evaluations.reduce((sum, result) => sum + result.metrics.hardConstraintViolations, 0),
          selectedForAlgorithm: false,
        });
      }
    }
    const algorithmWinners = RL_ALGORITHMS.map((algorithmId) => {
      const candidates = candidateRows.filter((candidate) => candidate.algorithmId === algorithmId)
        .sort((left, right) => right.validationScoreMean - left.validationScoreMean);
      const winner = candidates[0];
      winner.selectedForAlgorithm = true;
      return winner;
    }).sort((left, right) => right.validationScoreMean - left.validationScoreMean);
    const winner = algorithmWinners[0];
    const policies = policiesByCandidate.get(`${winner.algorithmId}:${winner.configurationId}`)!;
    const validationResults = policies.flatMap((policy) =>
      evaluatePolicyScenarios(policy, dataset.validationRecords));
    const validationGate = businessValueGate(validationResults, validationBaselines);
    const rejectionReasons = Object.entries(validationGate.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    attempts.push({
      attemptId,
      episodes,
      seeds: [...seeds],
      candidates: candidateRows,
      selectedAlgorithmId: winner.algorithmId,
      validationGate,
      status: validationGate.passed ? 'qualified' : 'rejected',
      rejectionReasons,
    });
    if (validationGate.passed) {
      selectedPolicies = policies;
      selectedAlgorithmId = winner.algorithmId;
      selectedAttemptId = attemptId;
      selectedValidationGate = validationGate;
    }
  }

  if (!selectedValidationGate) {
    const last = attempts.at(-1)!;
    selectedAlgorithmId = last.selectedAlgorithmId;
    selectedAttemptId = last.attemptId;
    selectedValidationGate = last.validationGate;
    const selectedRow = last.candidates
      .filter((candidate) => candidate.algorithmId === selectedAlgorithmId && candidate.selectedForAlgorithm)[0];
    selectedPolicies = seeds.map((seed) => trainLinearBusinessPolicy(
      selectedAlgorithmId,
      dataset.trainRecords,
      {
        episodes: last.episodes,
        seed,
        learningRate: selectedRow.learningRate,
        discountGamma: selectedRow.discountGamma,
        planningSteps: 4,
      },
    ));
  }

  // The final test is opened exactly once, after the algorithm, configuration,
  // episode budget and seeds have all been selected on validation evidence.
  const testRl = selectedPolicies.flatMap((policy) =>
    evaluatePolicyScenarios(policy, dataset.testRecords));
  const testSop = evaluateBaselineScenarios('standard-operating-procedure', dataset.testRecords);
  const testOptimizer = evaluateBaselineScenarios('deterministic-optimizer', dataset.testRecords);
  const finalTestGate = businessValueGate(testRl, testSop);
  return {
    protocolVersion: 'port-business-champion.v3',
    generatedAt: new Date().toISOString(),
    dataset: {
      id: dataset.id,
      fingerprint: dataset.fingerprint,
      evidenceLevel: dataset.evidenceLevel,
      operationalClaimAllowed: dataset.operationalClaimAllowed,
      recordCount: dataset.records.length,
      trainRange: dataset.split.trainRange,
      validationRange: dataset.split.validationRange,
      sealedTestRange: dataset.split.testRange,
    },
    attempts,
    champion: {
      admitted: selectedValidationGate.passed && finalTestGate.passed,
      algorithmId: selectedAlgorithmId,
      attemptId: selectedAttemptId,
      seedPolicies: selectedPolicies,
      validationGate: selectedValidationGate,
      finalTestGate,
      finalTest: {
        reinforcementLearning: testRl,
        standardOperatingProcedure: testSop,
        deterministicOptimizer: testOptimizer,
      },
    },
    boundary: PORT_BUSINESS_AUTHORITY_BOUNDARY,
    notes: [
      'All 33 observations feed the linear value function; no display-only observation is claimed as policy input.',
      'The safety projector masks infeasible actions before sampling and remains authoritative during evaluation.',
      'The deterministic optimizer is a transparent non-learning comparator and fail-safe fallback, not an RL algorithm.',
      'The final chronological test was not used to select an algorithm, hyperparameter or episode budget.',
      'An admitted champion demonstrates offline value only in the public-anchored, engineering-augmented simulator.',
    ],
  };
};

export const PORT_BUSINESS_RL_ALGORITHMS = [...RL_ALGORITHMS] as const;
export const PORT_BUSINESS_EVALUATION_SCENARIOS = [...evaluationScenarios] as const;
