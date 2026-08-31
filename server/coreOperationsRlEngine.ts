import {
  CORE_OPERATIONS_ACTION_HEADS,
  CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  CORE_OPERATIONS_OBSERVATIONS,
  type CoreActionChoiceId,
  type CoreObservationId,
  type CoreOperationsDomain,
} from '../shared/coreOperationsRlContract.ts';
import type { PortBusinessDataset, PortBusinessRecord } from './portBusinessDataset.ts';

export type CoreOperationsRlAlgorithmId = 'factorized-linear-q' | 'factorized-linear-dyna-q';
export type CoreEvaluationScenarioId =
  | 'chronological-replay'
  | 'demand-surge'
  | 'equipment-energy-stress'
  | 'disruption-recovery';

export interface CoreSafetyContext {
  channelAvailable: boolean;
  tideWindowOpen: boolean;
  pilotAvailabilityRatio: number;
  tugAvailabilityRatio: number;
  hazmatRestrictionActive: boolean;
  yardOccupancy: number;
  craneAvailabilityRatio: number;
  agvAvailabilityRatio: number;
  truckAvailabilityRatio: number;
  transformerLoading: number;
  batterySoc: number;
  batterySoh: number;
  shorePowerLoadRatio: number;
  transferCapacityRatio: number;
  activeFaultRatio: number;
  maintenanceDueRatio: number;
  communicationAvailable: boolean;
  dataQualityScore: number;
}

export interface CoreObservationTensorItem {
  id: CoreObservationId;
  raw: number;
  normalized: number;
  inRange: boolean;
}

export interface CoreEnvironmentState {
  queueVessels: number;
  delayHours: number;
  yardOccupancy: number;
  gatePressure: number;
  horizontalAvailability: number;
  energyCostIndex: number;
  peakGridRatio: number;
  carbonIntensity: number;
  reeferService: number;
  maintenanceBacklog: number;
  fairnessGap: number;
  recoveryBacklog: number;
  batterySoc: number;
  previousPlan: Record<CoreOperationsDomain, CoreActionChoiceId>;
}

export interface CoreActionPlan {
  choices: Record<CoreOperationsDomain, CoreActionChoiceId>;
}

export interface ProjectedCoreActionPlan {
  requested: CoreActionPlan;
  executed: CoreActionPlan;
  modifiedDomains: CoreOperationsDomain[];
  reasons: Partial<Record<CoreOperationsDomain, string[]>>;
  hardConstraintViolations: 0;
  requiresHumanApproval: boolean;
  dispatchAllowed: false;
}

export interface CoreHeadPolicy {
  domain: CoreOperationsDomain;
  choiceIds: CoreActionChoiceId[];
  weights: number[][];
}

export interface FactorizedCorePolicy {
  protocolVersion: 'factorized-core-operations-policy.v1';
  algorithmId: CoreOperationsRlAlgorithmId;
  observationIds: CoreObservationId[];
  heads: CoreHeadPolicy[];
  hyperparameters: {
    learningRate: number;
    discountGamma: number;
    planningSteps: number;
    episodes: number;
    horizon: number;
    seed: number;
  };
  training: {
    environmentSteps: number;
    parameterUpdates: number;
    finalRewardEma: number;
  };
}

export interface CoreEvaluationMetrics {
  meanReward: number;
  meanWaitingHours: number;
  meanQueueVessels: number;
  throughputRetentionPercent: number;
  yardOverflowRatePercent: number;
  gateSlaBreachRatePercent: number;
  horizontalAvailabilityPercent: number;
  energyCostIndex: number;
  peakGridRatioPercent: number;
  carbonIntensity: number;
  reeferServicePercent: number;
  maintenanceBacklog: number;
  fairnessGapPercent: number;
  recoveryBacklogVessels: number;
  interventionRatePercent: number;
  safetyProjectionRatePercent: number;
  hardConstraintViolations: number;
}

export interface CoreEvaluationResult {
  scenarioId: CoreEvaluationScenarioId;
  policyKind: 'reinforcement-learning' | 'standard-operating-procedure';
  algorithmId: string;
  metrics: CoreEvaluationMetrics;
  domainActionCounts: Record<CoreOperationsDomain, Record<string, number>>;
}

export interface ConfidenceSummary {
  mean: number;
  lower95: number;
  upper95: number;
  min: number;
  max: number;
  samples: number;
}

export interface CoreBusinessValueGate {
  thresholds: Record<string, number>;
  evidence: {
    rewardImprovement: ConfidenceSummary;
    waitReductionHours: ConfidenceSummary;
    queueReductionVessels: ConfidenceSummary;
    energyCostReductionPercent: ConfidenceSummary;
    peakGridReductionPoints: ConfidenceSummary;
    carbonReductionPercent: ConfidenceSummary;
    maintenanceBacklogReduction: ConfidenceSummary;
    recoveryBacklogReductionVessels: ConfidenceSummary;
    minimumThroughputRetentionPercent: number;
    minimumReeferServicePercent: number;
    maximumSafetyProjectionRatePercent: number;
    hardConstraintViolations: number;
    activeDomainCount: number;
    activeDomains: CoreOperationsDomain[];
  };
  checks: Record<string, boolean>;
  passed: boolean;
}

export interface CoreTrainingAttempt {
  attemptId: string;
  episodes: number;
  seeds: number[];
  candidates: Array<{
    algorithmId: CoreOperationsRlAlgorithmId;
    configurationId: string;
    validationScoreMean: number;
    validationRewardMean: number;
    selected: boolean;
  }>;
  selectedAlgorithmId: CoreOperationsRlAlgorithmId;
  validationGate: CoreBusinessValueGate;
  status: 'qualified' | 'rejected';
  rejectionReasons: string[];
}

export interface CoreOperationsChampionResult {
  protocolVersion: 'core-operations-champion.v1';
  generatedAt: string;
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: string;
    operationalClaimAllowed: boolean;
    recordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    sealedTestRange: [string, string];
  };
  attempts: CoreTrainingAttempt[];
  champion: {
    admitted: boolean;
    algorithmId: CoreOperationsRlAlgorithmId;
    attemptId: string;
    seedPolicies: FactorizedCorePolicy[];
    validationGate: CoreBusinessValueGate;
    finalTestGate: CoreBusinessValueGate;
    finalTest: {
      reinforcementLearning: CoreEvaluationResult[];
      standardOperatingProcedure: CoreEvaluationResult[];
    };
  };
  boundary: typeof CORE_OPERATIONS_AUTHORITY_BOUNDARY;
  notes: string[];
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
};

const headDefinitions = CORE_OPERATIONS_ACTION_HEADS.map((head) => ({
  domain: head.id,
  choiceIds: head.choices.map((choice) => choice.id) as CoreActionChoiceId[],
}));

const holdChoice = Object.fromEntries(CORE_OPERATIONS_ACTION_HEADS.map((head) => [
  head.id,
  head.choices[0].id,
])) as Record<CoreOperationsDomain, CoreActionChoiceId>;

export const createHoldCorePlan = (): CoreActionPlan => ({ choices: { ...holdChoice } });

const normalizeObservation = (id: CoreObservationId, raw: number): CoreObservationTensorItem => {
  const definition = CORE_OPERATIONS_OBSERVATIONS.find((item) => item.id === id)!;
  const [minimum, maximum] = definition.range;
  return {
    id,
    raw: round(raw),
    normalized: round(clamp((raw - minimum) / Math.max(1e-9, maximum - minimum), 0, 1)),
    inRange: raw >= minimum && raw <= maximum,
  };
};

export const normalizeCoreObservationRecord = (
  values: Record<CoreObservationId, number>,
) => CORE_OPERATIONS_OBSERVATIONS.map((definition) =>
  normalizeObservation(definition.id, values[definition.id]));

const planFeatures = (tensor: CoreObservationTensorItem[]) => [1, ...tensor.map((item) => item.normalized * 2 - 1)];
const dot = (left: number[], right: number[]) =>
  left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
const qValues = (weights: number[][], features: number[]) => weights.map((row) => dot(row, features));

const bestIndex = (values: number[], allowed: number[], random?: () => number) => {
  const maximum = Math.max(...allowed.map((index) => values[index]));
  const tied = allowed.filter((index) => Math.abs(values[index] - maximum) < 1e-10);
  return tied[Math.floor((random?.() ?? 0) * tied.length)] ?? allowed[0] ?? 0;
};

const contextFromTraining = (
  record: PortBusinessRecord,
  state: CoreEnvironmentState,
): CoreSafetyContext => {
  const hour = new Date(record.timestamp).getUTCHours();
  const pricePeak = hour >= 6 && hour < 14;
  const pressure = record.arrivals / Math.max(1, record.effectiveCapacity);
  return {
    channelAvailable: record.channelAvailable,
    tideWindowOpen: record.tideWindowOpen,
    pilotAvailabilityRatio: record.pilotAvailabilityRatio,
    tugAvailabilityRatio: record.tugAvailabilityRatio,
    hazmatRestrictionActive: record.hazmatRestrictionActive,
    yardOccupancy: state.yardOccupancy,
    craneAvailabilityRatio: record.craneAvailabilityRatio,
    agvAvailabilityRatio: clamp(0.97 - record.capacityLossRatio * 0.72, 0.48, 1),
    truckAvailabilityRatio: clamp(0.96 - record.capacityLossRatio * 0.58, 0.5, 1),
    transformerLoading: clamp(0.52 + pressure * 0.18 + (pricePeak ? 0.12 : 0), 0.35, 1.08),
    batterySoc: state.batterySoc,
    batterySoh: clamp(0.965 - record.capacityLossRatio * 0.08, 0.72, 0.99),
    shorePowerLoadRatio: clamp(0.32 + record.berthUtilization * 0.38, 0.1, 1),
    transferCapacityRatio: clamp(record.transferCapacity / Math.max(1, record.arrivals * 0.2), 0, 2),
    activeFaultRatio: clamp(record.capacityLossRatio * 0.75, 0, 1),
    maintenanceDueRatio: clamp(record.capacityLossRatio * 1.2 + (Number(record.sourceMonth.slice(-2)) % 5) * 0.03, 0, 1),
    communicationAvailable: record.dataQualityScore >= 0.45,
    dataQualityScore: record.dataQualityScore,
  };
};

export const buildTrainingCoreObservation = (
  record: PortBusinessRecord,
  state: CoreEnvironmentState,
  previousRecord?: PortBusinessRecord,
) => {
  const context = contextFromTraining(record, state);
  const capacity = Math.max(1, record.effectiveCapacity);
  const arrivalsTrend = previousRecord
    ? (record.arrivals - previousRecord.arrivals) / Math.max(1, previousRecord.arrivals)
    : 0;
  const pressure = record.arrivals / capacity;
  const transformer = context.transformerLoading;
  const values: Record<CoreObservationId, number> = {
    arrivals_to_capacity: pressure,
    arrival_trend: arrivalsTrend,
    queue_to_capacity: state.queueVessels / capacity,
    delay_hours: state.delayHours,
    forecast_arrivals_to_capacity: pressure * (1 + record.forecastUncertainty * 0.25),
    berth_utilization: record.berthUtilization,
    crane_productivity_index: record.craneProductivityIndex,
    crane_availability_ratio: record.craneAvailabilityRatio,
    service_level: clamp(1 - state.queueVessels / Math.max(1, record.arrivals + state.queueVessels), 0, 1),
    yard_occupancy: state.yardOccupancy,
    yard_reshuffle_pressure: clamp(Math.max(0, state.yardOccupancy - 0.68) * 4, 0, 2),
    truck_turn_time_hours: record.truckTurnTimeMinutes / 60,
    gate_queue_pressure: state.gatePressure,
    agv_availability_ratio: context.agvAvailabilityRatio,
    terminal_truck_availability_ratio: context.truckAvailabilityRatio,
    rtg_availability_ratio: clamp(0.98 - record.capacityLossRatio * 0.65, 0.5, 1),
    channel_available: Number(record.channelAvailable),
    tide_window_open: Number(record.tideWindowOpen),
    pilot_availability_ratio: record.pilotAvailabilityRatio,
    tug_availability_ratio: record.tugAvailabilityRatio,
    wind_risk: clamp(record.windSpeedMs / 24, 0, 1),
    wave_risk: clamp(record.waveHeightM / 4, 0, 1),
    visibility_risk: clamp((12 - record.visibilityKm) / 12, 0, 1),
    current_risk: clamp(record.currentSpeedKnots / 2.2, 0, 1),
    hazmat_restriction_active: Number(record.hazmatRestrictionActive),
    grid_load_ratio: transformer,
    transformer_loading: transformer,
    shore_power_load_ratio: context.shorePowerLoadRatio,
    solar_supply_ratio: clamp(0.08 + Math.max(0, 1 - record.energyPriceIndex) * 0.5, 0, 1),
    battery_soc: state.batterySoc,
    battery_soh: context.batterySoh,
    energy_price_index: record.energyPriceIndex,
    grid_carbon_index: record.carbonIntensity,
    reefer_inventory_pressure: clamp(state.yardOccupancy * 1.35, 0, 2),
    reefer_power_ratio: clamp(0.35 + state.yardOccupancy * 0.38, 0, 1),
    building_flexible_load_ratio: clamp(0.18 + record.energyPriceIndex * 0.22, 0, 1),
    active_fault_ratio: context.activeFaultRatio,
    maintenance_due_ratio: context.maintenanceDueRatio,
    rail_transfer_pressure: clamp(record.railTransferDemand / Math.max(1, record.transferCapacity * 0.45), 0, 2),
    water_transfer_pressure: clamp(record.waterTransferDemand / Math.max(1, record.transferCapacity * 0.55), 0, 2),
    recovery_backlog_pressure: state.recoveryBacklog / capacity,
    safety_risk: record.safetyRisk,
    resilience_index: clamp(1 - state.delayHours / 8 - state.maintenanceBacklog * 0.18, 0, 1),
    communication_available: Number(context.communicationAvailable),
    communication_latency: clamp(0.08 + (1 - record.dataQualityScore) * 0.55, 0, 1),
    data_quality_score: record.dataQualityScore,
    forecast_uncertainty: record.forecastUncertainty,
  };
  return { tensor: normalizeCoreObservationRecord(values), context };
};

const initialState = (record: PortBusinessRecord): CoreEnvironmentState => ({
  queueVessels: Math.max(2, record.arrivals * 0.7),
  delayHours: Math.max(0, record.etaDeviationHours * 0.18),
  yardOccupancy: clamp(record.yardOccupancy, 0, 1.08),
  gatePressure: clamp(record.gateQueuePressure, 0, 2),
  horizontalAvailability: clamp(0.97 - record.capacityLossRatio * 0.5, 0.5, 1),
  energyCostIndex: record.energyPriceIndex,
  peakGridRatio: clamp(0.54 + record.berthUtilization * 0.2, 0.3, 1.1),
  carbonIntensity: record.carbonIntensity,
  reeferService: 0.995,
  maintenanceBacklog: clamp(record.capacityLossRatio * 1.4, 0, 1),
  fairnessGap: record.fairnessDemandSkew,
  recoveryBacklog: record.arrivals * record.capacityLossRatio,
  batterySoc: 0.58,
  previousPlan: { ...holdChoice },
});

const actionReasons = (
  domain: CoreOperationsDomain,
  choiceId: CoreActionChoiceId,
  context: CoreSafetyContext,
) => {
  if (choiceId === holdChoice[domain]) return [];
  const reasons: string[] = [];
  if (!context.communicationAvailable || context.dataQualityScore < 0.5) reasons.push('data_or_communication_gate_blocked');
  if (domain === 'arrival-flow' && (!context.channelAvailable || !context.tideWindowOpen)) reasons.push('channel_or_tide_window_closed');
  if (domain === 'navigation-resources' && (!context.channelAvailable || !context.tideWindowOpen ||
      context.pilotAvailabilityRatio < 0.6 || context.tugAvailabilityRatio < 0.6)) {
    reasons.push('navigation_resource_envelope_blocked');
  }
  if (['yard-gate', 'horizontal-transport'].includes(domain) && context.hazmatRestrictionActive) {
    reasons.push('hazmat_restriction_active');
  }
  if (domain === 'berth-crane' && choiceId === 'crane-rebalance' && context.craneAvailabilityRatio < 0.72) {
    reasons.push('crane_availability_below_envelope');
  }
  if (domain === 'horizontal-transport' && Math.min(context.agvAvailabilityRatio, context.truckAvailabilityRatio) < 0.48) {
    reasons.push('horizontal_transport_availability_below_envelope');
  }
  if (domain === 'energy-storage' && choiceId === 'shore-power-priority' &&
      (context.transformerLoading > 0.92 || context.shorePowerLoadRatio > 0.9)) {
    reasons.push('transformer_or_shore_power_capacity_blocked');
  }
  if (domain === 'energy-storage' && choiceId === 'battery-peak-shave' &&
      (context.batterySoc < 0.25 || context.batterySoh < 0.8)) {
    reasons.push('battery_soc_or_soh_below_envelope');
  }
  if (domain === 'intermodal-network' && context.transferCapacityRatio < 0.65) {
    reasons.push('intermodal_transfer_capacity_undeclared');
  }
  if (domain === 'disruption-recovery' && context.yardOccupancy > 0.985) reasons.push('yard_capacity_interlock');
  if (domain === 'equipment-maintenance' && choiceId === 'fault-recovery-priority' && context.activeFaultRatio <= 0) {
    reasons.push('no_confirmed_fault_for_recovery');
  }
  return reasons;
};

export const projectCoreActionPlan = (
  requested: CoreActionPlan,
  context: CoreSafetyContext,
): ProjectedCoreActionPlan => {
  const executed = { ...requested.choices };
  const reasons: Partial<Record<CoreOperationsDomain, string[]>> = {};
  const modifiedDomains: CoreOperationsDomain[] = [];
  for (const head of headDefinitions) {
    const known = head.choiceIds.includes(requested.choices[head.domain]);
    const domainReasons = known
      ? actionReasons(head.domain, requested.choices[head.domain], context)
      : ['action_not_allowlisted'];
    if (domainReasons.length) {
      executed[head.domain] = holdChoice[head.domain];
      reasons[head.domain] = domainReasons;
      modifiedDomains.push(head.domain);
    }
  }
  const requiresHumanApproval = headDefinitions.some((head) => executed[head.domain] !== holdChoice[head.domain]);
  return {
    requested,
    executed: { choices: executed },
    modifiedDomains,
    reasons,
    hardConstraintViolations: 0,
    requiresHumanApproval,
    dispatchAllowed: false,
  };
};

const applicableChoiceIndexes = (
  domain: CoreOperationsDomain,
  choiceIds: CoreActionChoiceId[],
  tensor: CoreObservationTensorItem[],
  context: CoreSafetyContext,
) => {
  const raw = Object.fromEntries(tensor.map((item) => [item.id, item.raw])) as Record<CoreObservationId, number>;
  const pressure = raw.arrivals_to_capacity > 0.82 || raw.queue_to_capacity > 0.55;
  const allowed = choiceIds.map((choiceId, index) => ({ choiceId, index }))
    .filter(({ choiceId }) => actionReasons(domain, choiceId, context).length === 0)
    .filter(({ choiceId }) => {
      if (choiceId === holdChoice[domain]) return true;
      if (domain === 'arrival-flow') return pressure;
      if (domain === 'berth-crane') return raw.berth_utilization > 0.72 || raw.crane_availability_ratio < 0.95 || pressure;
      if (domain === 'yard-gate') return raw.yard_occupancy > 0.62 || raw.gate_queue_pressure > 0.45;
      if (domain === 'horizontal-transport') return raw.agv_availability_ratio < 0.96 || raw.yard_occupancy > 0.7;
      if (domain === 'navigation-resources') return pressure || raw.pilot_availability_ratio < 0.85;
      if (domain === 'energy-storage') return raw.transformer_loading > 0.58 || raw.energy_price_index > 0.98 || raw.grid_carbon_index > 1;
      if (domain === 'reefer-building-load') return raw.reefer_inventory_pressure > 0.72 || raw.energy_price_index > 1;
      if (domain === 'equipment-maintenance') return raw.maintenance_due_ratio > 0.08 || raw.active_fault_ratio > 0;
      if (domain === 'intermodal-network') return raw.yard_occupancy > 0.68 || raw.rail_transfer_pressure > 0.5 || raw.water_transfer_pressure > 0.5;
      if (domain === 'disruption-recovery') return raw.recovery_backlog_pressure > 0.06 || raw.queue_to_capacity > 0.7;
      return true;
    })
    .map((item) => item.index);
  return allowed.length ? allowed : [0];
};

export interface CorePlanEffect {
  capacity: number;
  queueRelief: number;
  defer: number;
  divert: number;
  yardRelief: number;
  gateRelief: number;
  horizontalGain: number;
  energy: number;
  peak: number;
  carbon: number;
  reeferGain: number;
  maintenanceRelief: number;
  fairnessRelief: number;
  recoveryGain: number;
  intervention: number;
}

const neutralEffect = (): CorePlanEffect => ({
  capacity: 1, queueRelief: 0, defer: 0, divert: 0, yardRelief: 0, gateRelief: 0,
  horizontalGain: 0, energy: 1, peak: 1, carbon: 1, reeferGain: 0,
  maintenanceRelief: 0, fairnessRelief: 0, recoveryGain: 1, intervention: 0,
});

const effects: Partial<Record<CoreActionChoiceId, Partial<CorePlanEffect>>> = {
  'eco-speed-window': { defer: 0.004, queueRelief: 0.015, energy: 0.985, carbon: 0.972, intervention: 0.018 },
  'arrival-smoothing': { defer: 0.012, queueRelief: 0.07, yardRelief: 0.008, gateRelief: 0.02, intervention: 0.03 },
  'berth-reassign': { capacity: 1.022, queueRelief: 0.03, fairnessRelief: 0.012, intervention: 0.038 },
  'crane-rebalance': { capacity: 1.035, queueRelief: 0.045, energy: 1.004, intervention: 0.045 },
  'yard-block-rebalance': { yardRelief: 0.028, gateRelief: 0.018, fairnessRelief: 0.008, intervention: 0.035 },
  'gate-slot-smoothing': { yardRelief: 0.012, gateRelief: 0.065, intervention: 0.028 },
  'agv-rebalance': { capacity: 1.012, horizontalGain: 0.035, yardRelief: 0.01, intervention: 0.032 },
  'truck-pool-rebalance': { horizontalGain: 0.028, gateRelief: 0.022, yardRelief: 0.014, intervention: 0.03 },
  'pilot-tug-priority': { queueRelief: 0.025, fairnessRelief: 0.028, intervention: 0.034 },
  'tide-window-sequence': { defer: 0.006, queueRelief: 0.04, fairnessRelief: 0.012, intervention: 0.03 },
  'shore-power-priority': { energy: 0.996, carbon: 0.958, intervention: 0.026 },
  'battery-peak-shave': { energy: 0.982, peak: 0.91, carbon: 0.982, intervention: 0.032 },
  'reefer-load-coordinate': { energy: 0.988, peak: 0.965, reeferGain: 0.006, intervention: 0.022 },
  'building-demand-response': { energy: 0.982, peak: 0.952, intervention: 0.024 },
  'preventive-maintenance-window': { capacity: 0.997, maintenanceRelief: 0.045, recoveryGain: 1.025, intervention: 0.028 },
  'fault-recovery-priority': { capacity: 1.018, maintenanceRelief: 0.075, recoveryGain: 1.07, intervention: 0.05 },
  'rail-barge-rebalance': { yardRelief: 0.035, gateRelief: 0.018, carbon: 0.995, intervention: 0.04 },
  'neighbor-port-advisory': { divert: 0.006, yardRelief: 0.018, recoveryGain: 1.025, intervention: 0.055 },
  'recovery-capacity': { capacity: 1.025, queueRelief: 0.055, yardRelief: 0.012, recoveryGain: 1.11, energy: 1.006, intervention: 0.055 },
  'controlled-backlog-release': { capacity: 1.012, queueRelief: 0.045, fairnessRelief: 0.025, recoveryGain: 1.07, intervention: 0.04 },
};

export const corePlanEffect = (plan: CoreActionPlan) => {
  const result = neutralEffect();
  for (const choiceId of Object.values(plan.choices)) {
    const effect = effects[choiceId];
    if (!effect) continue;
    result.capacity *= effect.capacity ?? 1;
    result.queueRelief += effect.queueRelief ?? 0;
    result.defer += effect.defer ?? 0;
    result.divert += effect.divert ?? 0;
    result.yardRelief += effect.yardRelief ?? 0;
    result.gateRelief += effect.gateRelief ?? 0;
    result.horizontalGain += effect.horizontalGain ?? 0;
    result.energy *= effect.energy ?? 1;
    result.peak *= effect.peak ?? 1;
    result.carbon *= effect.carbon ?? 1;
    result.reeferGain += effect.reeferGain ?? 0;
    result.maintenanceRelief += effect.maintenanceRelief ?? 0;
    result.fairnessRelief += effect.fairnessRelief ?? 0;
    result.recoveryGain *= effect.recoveryGain ?? 1;
    result.intervention += effect.intervention ?? 0;
  }
  result.capacity = clamp(result.capacity, 0.97, 1.09);
  result.defer = clamp(result.defer, 0, 0.02);
  result.divert = clamp(result.divert, 0, 0.01);
  result.energy = clamp(result.energy, 0.93, 1.05);
  result.peak = clamp(result.peak, 0.84, 1.04);
  result.carbon = clamp(result.carbon, 0.9, 1.05);
  return result;
};

interface TransitionResult {
  state: CoreEnvironmentState;
  reward: number;
  throughputRetention: number;
  projectionCount: number;
  hardConstraintViolations: 0;
  executed: CoreActionPlan;
}

const transition = (
  state: CoreEnvironmentState,
  requested: CoreActionPlan,
  record: PortBusinessRecord,
  context: CoreSafetyContext,
): TransitionResult => {
  const projection = projectCoreActionPlan(requested, context);
  const effect = corePlanEffect(projection.executed);
  const capacity = Math.max(0.2, record.effectiveCapacity * effect.capacity);
  const admittedDemand = record.arrivals * (1 - effect.defer - effect.divert);
  const queueRelief = effect.queueRelief * Math.max(1, capacity);
  const queueVessels = Math.max(0, state.queueVessels + admittedDemand - capacity - queueRelief);
  const delayHours = clamp(queueVessels / Math.max(0.2, capacity) * 2.2, 0, 12);
  const throughputRetention = clamp(1 - effect.defer - effect.divert, 0, 1);
  const yardOccupancy = clamp(
    state.yardOccupancy + queueVessels / Math.max(1, capacity) * 0.006 - effect.yardRelief,
    0.18,
    1.12,
  );
  const gatePressure = clamp(
    record.gateQueuePressure * 0.55 + state.gatePressure * 0.35 + yardOccupancy * 0.18 - effect.gateRelief,
    0,
    2,
  );
  const horizontalAvailability = clamp(
    (context.agvAvailabilityRatio + context.truckAvailabilityRatio) / 2 + effect.horizontalGain,
    0,
    1,
  );
  const peakGridRatio = clamp(context.transformerLoading * effect.peak, 0, 1.2);
  const energyCostIndex = clamp(record.energyPriceIndex * effect.energy * (0.94 + peakGridRatio * 0.08), 0.4, 2);
  const carbonIntensity = clamp(record.carbonIntensity * effect.carbon * effect.energy, 0.35, 2);
  const reeferService = clamp(0.996 - Math.max(0, yardOccupancy - 0.92) * 0.08 + effect.reeferGain, 0.96, 1);
  const maintenanceBacklog = clamp(
    state.maintenanceBacklog * 0.7 + context.maintenanceDueRatio * 0.3 + context.activeFaultRatio * 0.25 - effect.maintenanceRelief,
    0,
    1.4,
  );
  const fairnessGap = clamp(
    state.fairnessGap * 0.65 + record.fairnessDemandSkew * 0.35 + queueVessels / Math.max(1, capacity) * 0.006 - effect.fairnessRelief,
    0,
    1,
  );
  const recoveryBacklog = Math.max(
    0,
    (state.recoveryBacklog * 0.72 + record.arrivals * record.capacityLossRatio * 0.28) / effect.recoveryGain - queueRelief * 0.4,
  );
  const serviceLevel = clamp(capacity / Math.max(1, state.queueVessels + record.arrivals), 0, 1);
  const safetyPenalty = record.safetyRisk * 0.28 + projection.modifiedDomains.length * 0.008;
  const overflowPenalty = Math.max(0, yardOccupancy - 1) * 4 + Math.max(0, gatePressure - 1) * 0.8;
  const reward =
    serviceLevel * 0.12 + throughputRetention * 0.10 - delayHours / 8 * 0.12 - queueVessels / Math.max(1, capacity * 5) * 0.08 -
    overflowPenalty * 0.08 + horizontalAvailability * 0.06 - energyCostIndex / 2 * 0.07 - peakGridRatio * 0.06 -
    carbonIntensity / 2 * 0.07 + reeferService * 0.05 - maintenanceBacklog * 0.07 - fairnessGap * 0.05 +
    1 / (1 + recoveryBacklog) * 0.05 - effect.intervention * 0.02 - safetyPenalty;
  const batteryDelta = Object.values(projection.executed.choices).includes('battery-peak-shave') ? -0.018 : 0.006;
  return {
    state: {
      queueVessels,
      delayHours,
      yardOccupancy,
      gatePressure,
      horizontalAvailability,
      energyCostIndex,
      peakGridRatio,
      carbonIntensity,
      reeferService,
      maintenanceBacklog,
      fairnessGap,
      recoveryBacklog,
      batterySoc: clamp(state.batterySoc + batteryDelta, 0.15, 0.95),
      previousPlan: { ...projection.executed.choices },
    },
    reward,
    throughputRetention,
    projectionCount: projection.modifiedDomains.length,
    hardConstraintViolations: 0,
    executed: projection.executed,
  };
};

const updateWeights = (weights: number[][], actionIndex: number, features: number[], error: number, rate: number) => {
  const row = weights[actionIndex];
  for (let index = 0; index < row.length; index += 1) row[index] += rate * error * features[index];
};

interface ReplayTransition {
  features: number[];
  actions: Record<CoreOperationsDomain, number>;
  reward: number;
  nextFeatures: number[];
  nextAllowed: Record<CoreOperationsDomain, number[]>;
}

export const trainFactorizedCorePolicy = (
  algorithmId: CoreOperationsRlAlgorithmId,
  records: PortBusinessRecord[],
  options: {
    episodes: number;
    seed: number;
    learningRate: number;
    discountGamma: number;
    planningSteps?: number;
    horizon?: number;
  },
): FactorizedCorePolicy => {
  const random = seededRandom(options.seed);
  const featureCount = CORE_OPERATIONS_OBSERVATIONS.length + 1;
  const horizon = Math.min(options.horizon ?? 64, records.length);
  const planningSteps = algorithmId === 'factorized-linear-dyna-q' ? options.planningSteps ?? 2 : 0;
  const heads = headDefinitions.map((head) => ({
    domain: head.domain,
    choiceIds: [...head.choiceIds],
    weights: head.choiceIds.map(() => Array.from({ length: featureCount }, () => (random() - 0.5) * 0.002)),
  }));
  const replay: ReplayTransition[] = [];
  let environmentSteps = 0;
  let parameterUpdates = 0;
  let rewardEma = 0;
  for (let episode = 1; episode <= options.episodes; episode += 1) {
    const start = Math.floor(random() * Math.max(1, records.length - horizon));
    let state = initialState(records[start]);
    let episodeReward = 0;
    const epsilon = Math.max(0.025, 0.28 * (1 - episode / options.episodes));
    for (let step = 0; step < horizon; step += 1) {
      const recordIndex = (start + step) % records.length;
      const record = records[recordIndex];
      const previous = records[(recordIndex - 1 + records.length) % records.length];
      const observation = buildTrainingCoreObservation(record, state, previous);
      const features = planFeatures(observation.tensor);
      const actionIndexes = {} as Record<CoreOperationsDomain, number>;
      const requestedChoices = {} as Record<CoreOperationsDomain, CoreActionChoiceId>;
      for (const head of heads) {
        const allowed = applicableChoiceIndexes(head.domain, head.choiceIds, observation.tensor, observation.context);
        const index = random() < epsilon
          ? allowed[Math.floor(random() * allowed.length)]
          : bestIndex(qValues(head.weights, features), allowed, random);
        actionIndexes[head.domain] = index;
        requestedChoices[head.domain] = head.choiceIds[index];
      }
      const sample = transition(state, { choices: requestedChoices }, record, observation.context);
      const nextRecord = records[(recordIndex + 1) % records.length];
      const nextObservation = buildTrainingCoreObservation(nextRecord, sample.state, record);
      const nextFeatures = planFeatures(nextObservation.tensor);
      const nextAllowed = {} as Record<CoreOperationsDomain, number[]>;
      for (const head of heads) {
        const allowed = applicableChoiceIndexes(head.domain, head.choiceIds, nextObservation.tensor, nextObservation.context);
        nextAllowed[head.domain] = allowed;
        const current = dot(head.weights[actionIndexes[head.domain]], features);
        const target = sample.reward + options.discountGamma * Math.max(
          ...allowed.map((index) => dot(head.weights[index], nextFeatures)),
        );
        updateWeights(head.weights, actionIndexes[head.domain], features, target - current, options.learningRate);
        parameterUpdates += 1;
      }
      if (planningSteps > 0) {
        replay.push({ features, actions: actionIndexes, reward: sample.reward, nextFeatures, nextAllowed });
        if (replay.length > 8_000) replay.shift();
        for (let planning = 0; planning < planningSteps; planning += 1) {
          const remembered = replay[Math.floor(random() * replay.length)];
          for (const head of heads) {
            const actionIndex = remembered.actions[head.domain];
            const target = remembered.reward + options.discountGamma * Math.max(
              ...remembered.nextAllowed[head.domain].map((index) => dot(head.weights[index], remembered.nextFeatures)),
            );
            updateWeights(
              head.weights,
              actionIndex,
              remembered.features,
              target - dot(head.weights[actionIndex], remembered.features),
              options.learningRate * 0.45,
            );
            parameterUpdates += 1;
          }
        }
      }
      state = sample.state;
      episodeReward += sample.reward;
      environmentSteps += 1;
    }
    const normalizedReward = episodeReward / horizon;
    rewardEma = episode === 1 ? normalizedReward : rewardEma * 0.94 + normalizedReward * 0.06;
  }
  return {
    protocolVersion: 'factorized-core-operations-policy.v1',
    algorithmId,
    observationIds: CORE_OPERATIONS_OBSERVATIONS.map((item) => item.id),
    heads: heads.map((head) => ({
      domain: head.domain,
      choiceIds: [...head.choiceIds],
      weights: head.weights.map((row) => row.map((value) => round(value, 9))),
    })),
    hyperparameters: {
      learningRate: options.learningRate,
      discountGamma: options.discountGamma,
      planningSteps,
      episodes: options.episodes,
      horizon,
      seed: options.seed,
    },
    training: { environmentSteps, parameterUpdates, finalRewardEma: round(rewardEma) },
  };
};

const scenarioRecords = (records: PortBusinessRecord[], scenarioId: CoreEvaluationScenarioId) =>
  records.map((record, index) => {
    if (scenarioId === 'demand-surge') return { ...record, arrivals: record.arrivals * 1.12 };
    if (scenarioId === 'equipment-energy-stress') return {
      ...record,
      craneAvailabilityRatio: clamp(record.craneAvailabilityRatio - (index % 9 < 3 ? 0.16 : 0.05), 0.55, 1),
      capacityLossRatio: clamp(record.capacityLossRatio + (index % 9 < 3 ? 0.14 : 0.04), 0, 0.65),
      energyPriceIndex: clamp(record.energyPriceIndex * 1.24, 0, 2),
      shorePowerAvailability: clamp(record.shorePowerAvailability - 0.12, 0, 1),
    };
    if (scenarioId === 'disruption-recovery') return {
      ...record,
      arrivals: record.arrivals * 1.06,
      effectiveCapacity: record.effectiveCapacity * (index % 13 < 4 ? 0.78 : 0.94),
      capacityLossRatio: clamp(record.capacityLossRatio + (index % 13 < 4 ? 0.22 : 0.06), 0, 0.7),
    };
    return { ...record };
  });

const sopPlan = (
  tensor: CoreObservationTensorItem[],
  context: CoreSafetyContext,
): CoreActionPlan => {
  const raw = Object.fromEntries(tensor.map((item) => [item.id, item.raw])) as Record<CoreObservationId, number>;
  const plan = createHoldCorePlan();
  if (raw.queue_to_capacity > 1.5 && context.channelAvailable && context.tideWindowOpen) plan.choices['arrival-flow'] = 'arrival-smoothing';
  if (raw.berth_utilization > 0.94 && context.craneAvailabilityRatio >= 0.72) plan.choices['berth-crane'] = 'crane-rebalance';
  if (raw.yard_occupancy > 0.9 && !context.hazmatRestrictionActive) plan.choices['yard-gate'] = 'yard-block-rebalance';
  if (raw.active_fault_ratio > 0.18) plan.choices['equipment-maintenance'] = 'fault-recovery-priority';
  if (raw.transformer_loading > 0.84 && context.batterySoc >= 0.25 && context.batterySoh >= 0.8) plan.choices['energy-storage'] = 'battery-peak-shave';
  if (raw.recovery_backlog_pressure > 0.65 && context.yardOccupancy < 0.985) plan.choices['disruption-recovery'] = 'recovery-capacity';
  return plan;
};

export const evaluateCorePolicy = (
  mode: { kind: 'reinforcement-learning'; policy: FactorizedCorePolicy } | { kind: 'standard-operating-procedure' },
  records: PortBusinessRecord[],
  scenarioId: CoreEvaluationScenarioId,
): CoreEvaluationResult => {
  const scenario = scenarioRecords(records, scenarioId);
  let state = initialState(scenario[0]);
  const samples: TransitionResult[] = [];
  const states: CoreEnvironmentState[] = [];
  const domainActionCounts = Object.fromEntries(headDefinitions.map((head) => [
    head.domain,
    Object.fromEntries(head.choiceIds.map((choiceId) => [choiceId, 0])),
  ])) as Record<CoreOperationsDomain, Record<string, number>>;
  scenario.forEach((record, index) => {
    const observation = buildTrainingCoreObservation(record, state, scenario[index - 1]);
    let plan: CoreActionPlan;
    if (mode.kind === 'reinforcement-learning') {
      const features = planFeatures(observation.tensor);
      const choices = {} as Record<CoreOperationsDomain, CoreActionChoiceId>;
      for (const head of mode.policy.heads) {
        const allowed = applicableChoiceIndexes(head.domain, head.choiceIds, observation.tensor, observation.context);
        choices[head.domain] = head.choiceIds[bestIndex(qValues(head.weights, features), allowed)];
      }
      plan = { choices };
    } else {
      plan = sopPlan(observation.tensor, observation.context);
    }
    const sample = transition(state, plan, record, observation.context);
    state = sample.state;
    samples.push(sample);
    states.push(state);
    for (const [domain, choiceId] of Object.entries(sample.executed.choices) as Array<[CoreOperationsDomain, CoreActionChoiceId]>) {
      domainActionCounts[domain][choiceId] += 1;
    }
  });
  const interventions = samples.reduce((sum, sample) => sum + Object.entries(sample.executed.choices)
    .filter(([domain, choiceId]) => choiceId !== holdChoice[domain as CoreOperationsDomain]).length, 0);
  return {
    scenarioId,
    policyKind: mode.kind,
    algorithmId: mode.kind === 'reinforcement-learning' ? mode.policy.algorithmId : 'standard-operating-procedure',
    metrics: {
      meanReward: round(mean(samples.map((sample) => sample.reward))),
      meanWaitingHours: round(mean(states.map((item) => item.delayHours))),
      meanQueueVessels: round(mean(states.map((item) => item.queueVessels))),
      throughputRetentionPercent: round(mean(samples.map((sample) => sample.throughputRetention)) * 100),
      yardOverflowRatePercent: round(states.filter((item) => item.yardOccupancy > 1).length / states.length * 100),
      gateSlaBreachRatePercent: round(states.filter((item) => item.gatePressure > 1).length / states.length * 100),
      horizontalAvailabilityPercent: round(mean(states.map((item) => item.horizontalAvailability)) * 100),
      energyCostIndex: round(mean(states.map((item) => item.energyCostIndex))),
      peakGridRatioPercent: round(mean(states.map((item) => item.peakGridRatio)) * 100),
      carbonIntensity: round(mean(states.map((item) => item.carbonIntensity))),
      reeferServicePercent: round(mean(states.map((item) => item.reeferService)) * 100),
      maintenanceBacklog: round(mean(states.map((item) => item.maintenanceBacklog))),
      fairnessGapPercent: round(mean(states.map((item) => item.fairnessGap)) * 100),
      recoveryBacklogVessels: round(states.at(-1)?.recoveryBacklog ?? 0),
      interventionRatePercent: round(interventions / Math.max(1, samples.length * headDefinitions.length) * 100),
      safetyProjectionRatePercent: round(samples.reduce((sum, sample) => sum + sample.projectionCount, 0) /
        Math.max(1, samples.length * headDefinitions.length) * 100),
      hardConstraintViolations: 0,
    },
    domainActionCounts,
  };
};

const confidence = (values: number[]): ConfidenceSummary => {
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1);
  const margin = 1.96 * Math.sqrt(variance / Math.max(1, values.length));
  return {
    mean: round(average), lower95: round(average - margin), upper95: round(average + margin),
    min: round(Math.min(...values)), max: round(Math.max(...values)), samples: values.length,
  };
};

const activeDomains = (results: CoreEvaluationResult[]) => headDefinitions
  .filter((head) => results.some((result) => Object.entries(result.domainActionCounts[head.domain])
    .some(([choiceId, count]) => choiceId !== holdChoice[head.domain] && count > 0)))
  .map((head) => head.domain);

export const coreBusinessValueGate = (
  candidates: CoreEvaluationResult[],
  baselines: CoreEvaluationResult[],
): CoreBusinessValueGate => {
  const baselineByScenario = new Map(baselines.map((result) => [result.scenarioId, result.metrics]));
  const pairs = candidates.map((candidate) => ({ candidate: candidate.metrics, baseline: baselineByScenario.get(candidate.scenarioId)! }));
  const rewardImprovement = confidence(pairs.map((pair) => pair.candidate.meanReward - pair.baseline.meanReward));
  const waitReductionHours = confidence(pairs.map((pair) => pair.baseline.meanWaitingHours - pair.candidate.meanWaitingHours));
  const queueReductionVessels = confidence(pairs.map((pair) => pair.baseline.meanQueueVessels - pair.candidate.meanQueueVessels));
  const energyCostReductionPercent = confidence(pairs.map((pair) =>
    (pair.baseline.energyCostIndex - pair.candidate.energyCostIndex) / Math.max(1e-9, pair.baseline.energyCostIndex) * 100));
  const peakGridReductionPoints = confidence(pairs.map((pair) => pair.baseline.peakGridRatioPercent - pair.candidate.peakGridRatioPercent));
  const carbonReductionPercent = confidence(pairs.map((pair) =>
    (pair.baseline.carbonIntensity - pair.candidate.carbonIntensity) / Math.max(1e-9, pair.baseline.carbonIntensity) * 100));
  const maintenanceBacklogReduction = confidence(pairs.map((pair) => pair.baseline.maintenanceBacklog - pair.candidate.maintenanceBacklog));
  const recoveryBacklogReductionVessels = confidence(pairs.map((pair) => pair.baseline.recoveryBacklogVessels - pair.candidate.recoveryBacklogVessels));
  const minimumThroughputRetentionPercent = Math.min(...pairs.map((pair) => pair.candidate.throughputRetentionPercent));
  const minimumReeferServicePercent = Math.min(...pairs.map((pair) => pair.candidate.reeferServicePercent));
  const maximumSafetyProjectionRatePercent = Math.max(...pairs.map((pair) => pair.candidate.safetyProjectionRatePercent));
  const hardConstraintViolations = pairs.reduce((sum, pair) => sum + pair.candidate.hardConstraintViolations, 0);
  const domains = activeDomains(candidates);
  const thresholds = {
    minimumRewardImprovementLower95: 0.005,
    minimumWaitReductionHoursLower95: 0,
    minimumQueueReductionVesselsLower95: 0,
    minimumEnergyCostReductionPercentLower95: 0,
    minimumPeakGridReductionPointsLower95: 0,
    minimumCarbonReductionPercentLower95: 0,
    minimumMaintenanceBacklogReductionLower95: 0,
    minimumRecoveryBacklogReductionLower95: -0.05,
    minimumThroughputRetentionPercent: 98.5,
    minimumReeferServicePercent: 99,
    maximumSafetyProjectionRatePercent: 0,
    maximumHardConstraintViolations: 0,
    minimumActiveDomainCount: headDefinitions.length,
  };
  const checks = {
    rewardImprovement: rewardImprovement.lower95 >= thresholds.minimumRewardImprovementLower95,
    waitingTime: waitReductionHours.lower95 >= thresholds.minimumWaitReductionHoursLower95,
    queue: queueReductionVessels.lower95 >= thresholds.minimumQueueReductionVesselsLower95,
    energyCost: energyCostReductionPercent.lower95 >= thresholds.minimumEnergyCostReductionPercentLower95,
    peakGrid: peakGridReductionPoints.lower95 >= thresholds.minimumPeakGridReductionPointsLower95,
    carbon: carbonReductionPercent.lower95 >= thresholds.minimumCarbonReductionPercentLower95,
    maintenance: maintenanceBacklogReduction.lower95 >= thresholds.minimumMaintenanceBacklogReductionLower95,
    recovery: recoveryBacklogReductionVessels.lower95 >= thresholds.minimumRecoveryBacklogReductionLower95,
    throughput: minimumThroughputRetentionPercent >= thresholds.minimumThroughputRetentionPercent,
    reeferService: minimumReeferServicePercent >= thresholds.minimumReeferServicePercent,
    safetyProjection: maximumSafetyProjectionRatePercent <= thresholds.maximumSafetyProjectionRatePercent,
    hardConstraints: hardConstraintViolations <= thresholds.maximumHardConstraintViolations,
    domainCoverage: domains.length >= thresholds.minimumActiveDomainCount,
  };
  return {
    thresholds,
    evidence: {
      rewardImprovement, waitReductionHours, queueReductionVessels, energyCostReductionPercent,
      peakGridReductionPoints, carbonReductionPercent, maintenanceBacklogReduction,
      recoveryBacklogReductionVessels, minimumThroughputRetentionPercent, minimumReeferServicePercent,
      maximumSafetyProjectionRatePercent, hardConstraintViolations, activeDomainCount: domains.length, activeDomains: domains,
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
};

const scenarios: CoreEvaluationScenarioId[] = [
  'chronological-replay', 'demand-surge', 'equipment-energy-stress', 'disruption-recovery',
];
const evaluateScenarios = (policy: FactorizedCorePolicy, records: PortBusinessRecord[]) =>
  scenarios.map((scenario) => evaluateCorePolicy({ kind: 'reinforcement-learning', policy }, records, scenario));
const evaluateSopScenarios = (records: PortBusinessRecord[]) =>
  scenarios.map((scenario) => evaluateCorePolicy({ kind: 'standard-operating-procedure' }, records, scenario));
const selectionScore = (result: CoreEvaluationResult) =>
  result.metrics.meanReward - result.metrics.meanWaitingHours * 0.01 - result.metrics.meanQueueVessels * 0.001 -
  result.metrics.energyCostIndex * 0.01 - result.metrics.maintenanceBacklog * 0.02;

const configurations = [
  { id: 'stable', learningRate: 0.024, discountGamma: 0.96 },
  { id: 'long-horizon', learningRate: 0.016, discountGamma: 0.98 },
] as const;
const algorithms: CoreOperationsRlAlgorithmId[] = ['factorized-linear-q', 'factorized-linear-dyna-q'];

export const trainCoreOperationsChampion = (
  dataset: PortBusinessDataset,
  options: { seeds?: number[]; episodeLadder?: number[]; horizon?: number } = {},
): CoreOperationsChampionResult => {
  const seeds = options.seeds ?? [17, 37, 59, 83, 101];
  const episodeLadder = options.episodeLadder ?? [180, 360];
  const attempts: CoreTrainingAttempt[] = [];
  const validationBaselines = evaluateSopScenarios(dataset.validationRecords);
  let selectedPolicies: FactorizedCorePolicy[] = [];
  let selectedAlgorithmId: CoreOperationsRlAlgorithmId = 'factorized-linear-q';
  let selectedAttemptId = '';
  let selectedValidationGate: CoreBusinessValueGate | null = null;
  for (const episodes of episodeLadder) {
    const attemptId = `curriculum-${episodes}`;
    const policiesByCandidate = new Map<string, FactorizedCorePolicy[]>();
    const candidates: CoreTrainingAttempt['candidates'] = [];
    for (const algorithmId of algorithms) {
      for (const configuration of configurations) {
        const policies = seeds.map((seed) => trainFactorizedCorePolicy(algorithmId, dataset.trainRecords, {
          episodes,
          seed,
          learningRate: configuration.learningRate,
          discountGamma: configuration.discountGamma,
          planningSteps: 2,
          horizon: options.horizon ?? 64,
        }));
        policiesByCandidate.set(`${algorithmId}:${configuration.id}`, policies);
        const evaluations = policies.flatMap((policy) => evaluateScenarios(policy, dataset.validationRecords));
        candidates.push({
          algorithmId,
          configurationId: configuration.id,
          validationScoreMean: round(mean(evaluations.map(selectionScore))),
          validationRewardMean: round(mean(evaluations.map((result) => result.metrics.meanReward))),
          selected: false,
        });
      }
    }
    const winner = [...candidates].sort((left, right) => right.validationScoreMean - left.validationScoreMean)[0];
    winner.selected = true;
    const policies = policiesByCandidate.get(`${winner.algorithmId}:${winner.configurationId}`)!;
    const validationResults = policies.flatMap((policy) => evaluateScenarios(policy, dataset.validationRecords));
    const validationGate = coreBusinessValueGate(validationResults, validationBaselines);
    attempts.push({
      attemptId,
      episodes,
      seeds: [...seeds],
      candidates,
      selectedAlgorithmId: winner.algorithmId,
      validationGate,
      status: validationGate.passed ? 'qualified' : 'rejected',
      rejectionReasons: Object.entries(validationGate.checks).filter(([, passed]) => !passed).map(([name]) => name),
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
    const winner = last.candidates.find((candidate) => candidate.selected)!;
    selectedAlgorithmId = winner.algorithmId;
    selectedAttemptId = last.attemptId;
    selectedValidationGate = last.validationGate;
    const configuration = configurations.find((item) => item.id === winner.configurationId)!;
    selectedPolicies = seeds.map((seed) => trainFactorizedCorePolicy(selectedAlgorithmId, dataset.trainRecords, {
      episodes: last.episodes,
      seed,
      learningRate: configuration.learningRate,
      discountGamma: configuration.discountGamma,
      planningSteps: 2,
      horizon: options.horizon ?? 64,
    }));
  }
  const testRl = selectedPolicies.flatMap((policy) => evaluateScenarios(policy, dataset.testRecords));
  const testSop = evaluateSopScenarios(dataset.testRecords);
  const finalTestGate = coreBusinessValueGate(testRl, testSop);
  return {
    protocolVersion: 'core-operations-champion.v1',
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
      finalTest: { reinforcementLearning: testRl, standardOperatingProcedure: testSop },
    },
    boundary: CORE_OPERATIONS_AUTHORITY_BOUNDARY,
    notes: [
      'Ten factorized value-function heads choose a simultaneous bounded advisory plan from one shared observation tensor.',
      'Every declared observation is consumed by every head; deterministic masks remain authoritative before learning and execution.',
      'Validation selects the algorithm, configuration and episode budget before the chronological final test is opened.',
      'Paired business-value deltas use identical scenario records for RL and the conservative SOP comparator.',
      'The result is offline public-anchored and engineering-augmented evidence, not a measured Malacca terminal KPI.',
    ],
  };
};

export const inferFactorizedCoreEnsemble = (
  policies: FactorizedCorePolicy[],
  tensor: CoreObservationTensorItem[],
  context: CoreSafetyContext,
) => {
  const features = planFeatures(tensor);
  const requested = {} as Record<CoreOperationsDomain, CoreActionChoiceId>;
  const heads = headDefinitions.map((definition) => {
    const allowed = applicableChoiceIndexes(definition.domain, definition.choiceIds, tensor, context);
    const rows = policies.map((policy) => {
      const head = policy.heads.find((item) => item.domain === definition.domain)!;
      const values = qValues(head.weights, features);
      return { values, selectedIndex: bestIndex(values, allowed) };
    });
    const meanValues = definition.choiceIds.map((_, index) => mean(rows.map((row) => row.values[index])));
    const selectedIndex = bestIndex(meanValues, allowed);
    const votes = rows.filter((row) => row.selectedIndex === selectedIndex).length;
    const minimum = Math.min(...allowed.map((index) => meanValues[index]));
    const shifted = allowed.map((index) => Math.exp(clamp(meanValues[index] - minimum, -30, 30)));
    const total = shifted.reduce((sum, value) => sum + value, 0);
    const probabilityByIndex = new Map(allowed.map((index, position) => [index, shifted[position] / Math.max(1e-9, total)]));
    requested[definition.domain] = definition.choiceIds[selectedIndex];
    return {
      domain: definition.domain,
      selectedChoiceId: definition.choiceIds[selectedIndex],
      voteShare: round(votes / Math.max(1, policies.length)),
      probability: round(probabilityByIndex.get(selectedIndex) ?? 0),
      choices: definition.choiceIds.map((choiceId, index) => ({
        choiceId,
        meanValue: round(meanValues[index]),
        probability: round(probabilityByIndex.get(index) ?? 0),
        applicable: allowed.includes(index),
      })),
    };
  });
  return {
    protocolVersion: 'core-operations-runtime-inference.v1' as const,
    observationTensor: tensor,
    requestedPlan: { choices: requested } as CoreActionPlan,
    heads,
    ensemblePolicyCount: policies.length,
    outOfRangeObservationCount: tensor.filter((item) => !item.inRange).length,
  };
};

export const CORE_OPERATIONS_RL_ALGORITHMS = [...algorithms] as const;
export const CORE_OPERATIONS_EVALUATION_SCENARIOS = [...scenarios] as const;
export const CORE_OPERATIONS_HOLD_CHOICES = { ...holdChoice };
