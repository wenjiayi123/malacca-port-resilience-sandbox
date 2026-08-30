import {
  PORT_BUSINESS_ACTIONS,
  type BusinessActionId,
} from '../shared/portBusinessRlContract.ts';
import type { PortBusinessRecord } from './portBusinessDataset.ts';

const percentile = (values: number[], ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))] ?? 1;
};

export interface PortBusinessDynamicState {
  queueVessels: number;
  deferredBacklogVessels: number;
  recoveryBacklogVessels: number;
  yardOccupancy: number;
  gateQueuePressure: number;
  fairnessGap: number;
  previousActionId: BusinessActionId;
}

export interface BusinessActionEffect {
  id: BusinessActionId;
  capacityMultiplier: number;
  deferredDemandFraction: number;
  divertedDemandFraction: number;
  carbonMultiplier: number;
  yardRelief: number;
  gateRelief: number;
  intermodalRelief: number;
  fairnessRelief: number;
  recoveryMultiplier: number;
  interventionCost: number;
}

export const PORT_BUSINESS_ACTION_EFFECTS: readonly BusinessActionEffect[] = [
  { id: 'hold-plan', capacityMultiplier: 1, deferredDemandFraction: 0, divertedDemandFraction: 0, carbonMultiplier: 1, yardRelief: 0, gateRelief: 0, intermodalRelief: 0, fairnessRelief: 0, recoveryMultiplier: 1, interventionCost: 0 },
  { id: 'eco-speed-advisory', capacityMultiplier: 0.998, deferredDemandFraction: 0.006, divertedDemandFraction: 0, carbonMultiplier: 0.972, yardRelief: 0, gateRelief: 0.01, intermodalRelief: 0, fairnessRelief: 0, recoveryMultiplier: 1, interventionCost: 0.025 },
  { id: 'arrival-window-smooth', capacityMultiplier: 1, deferredDemandFraction: 0.018, divertedDemandFraction: 0, carbonMultiplier: 0.994, yardRelief: 0.008, gateRelief: 0.035, intermodalRelief: 0, fairnessRelief: 0.01, recoveryMultiplier: 1, interventionCost: 0.04 },
  { id: 'berth-reassign', capacityMultiplier: 1.035, deferredDemandFraction: 0.002, divertedDemandFraction: 0, carbonMultiplier: 1.002, yardRelief: 0, gateRelief: 0, intermodalRelief: 0, fairnessRelief: 0.018, recoveryMultiplier: 1.03, interventionCost: 0.055 },
  { id: 'crane-rebalance', capacityMultiplier: 1.05, deferredDemandFraction: 0.003, divertedDemandFraction: 0, carbonMultiplier: 1.006, yardRelief: -0.006, gateRelief: 0, intermodalRelief: 0, fairnessRelief: 0.01, recoveryMultiplier: 1.05, interventionCost: 0.065 },
  { id: 'yard-gate-smooth', capacityMultiplier: 1.006, deferredDemandFraction: 0.004, divertedDemandFraction: 0, carbonMultiplier: 0.997, yardRelief: 0.035, gateRelief: 0.09, intermodalRelief: 0, fairnessRelief: 0.008, recoveryMultiplier: 1.01, interventionCost: 0.052 },
  { id: 'pilot-tug-priority', capacityMultiplier: 1.012, deferredDemandFraction: 0.002, divertedDemandFraction: 0, carbonMultiplier: 1.001, yardRelief: 0, gateRelief: 0, intermodalRelief: 0, fairnessRelief: 0.045, recoveryMultiplier: 1.01, interventionCost: 0.058 },
  { id: 'shore-power-priority', capacityMultiplier: 0.998, deferredDemandFraction: 0, divertedDemandFraction: 0, carbonMultiplier: 0.948, yardRelief: 0, gateRelief: 0, intermodalRelief: 0, fairnessRelief: 0, recoveryMultiplier: 1, interventionCost: 0.038 },
  { id: 'intermodal-rebalance', capacityMultiplier: 1.008, deferredDemandFraction: 0.003, divertedDemandFraction: 0, carbonMultiplier: 0.995, yardRelief: 0.045, gateRelief: 0.04, intermodalRelief: 0.11, fairnessRelief: 0.012, recoveryMultiplier: 1.015, interventionCost: 0.06 },
  { id: 'recovery-capacity', capacityMultiplier: 1.06, deferredDemandFraction: 0.006, divertedDemandFraction: 0, carbonMultiplier: 1.012, yardRelief: 0.02, gateRelief: 0.025, intermodalRelief: 0.02, fairnessRelief: 0.02, recoveryMultiplier: 1.16, interventionCost: 0.09 },
  { id: 'neighbor-port-advisory', capacityMultiplier: 0.997, deferredDemandFraction: 0, divertedDemandFraction: 0.012, carbonMultiplier: 1.008, yardRelief: 0.015, gateRelief: 0.015, intermodalRelief: 0.08, fairnessRelief: 0.006, recoveryMultiplier: 1.03, interventionCost: 0.08 },
] as const;

const effectById = new Map(PORT_BUSINESS_ACTION_EFFECTS.map((effect) => [effect.id, effect]));

export const businessActionEffect = (actionId: BusinessActionId) =>
  effectById.get(actionId) ?? PORT_BUSINESS_ACTION_EFFECTS[0];

const infeasibilityReasons = (
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
  actionId: BusinessActionId,
) => {
  if (actionId === 'hold-plan') return [];
  const reasons: string[] = [];
  if (['eco-speed-advisory', 'arrival-window-smooth', 'pilot-tug-priority'].includes(actionId) && !record.channelAvailable) {
    reasons.push('channel_closed');
  }
  if (actionId === 'arrival-window-smooth' && !record.tideWindowOpen) reasons.push('tide_window_closed');
  if (['arrival-window-smooth', 'pilot-tug-priority'].includes(actionId) &&
      (record.pilotAvailabilityRatio < 0.64 || record.tugAvailabilityRatio < 0.64)) {
    reasons.push('pilot_or_tug_resource_below_envelope');
  }
  if (['berth-reassign', 'yard-gate-smooth', 'intermodal-rebalance'].includes(actionId) &&
      record.hazmatRestrictionActive) {
    reasons.push('hazmat_restriction_active');
  }
  if (actionId === 'crane-rebalance' && record.craneAvailabilityRatio < 0.74) reasons.push('crane_resource_unavailable');
  if (actionId === 'shore-power-priority' && record.shorePowerAvailability < 0.2) reasons.push('shore_power_unavailable');
  if (actionId === 'intermodal-rebalance' && record.transferCapacity < record.arrivals * 0.08) reasons.push('transfer_capacity_insufficient');
  if (actionId === 'neighbor-port-advisory' && record.transferCapacity < record.arrivals * 0.04) reasons.push('neighbor_transfer_capacity_undeclared');
  if (actionId === 'recovery-capacity' &&
      (record.capacityLossRatio < 0.025 || record.craneAvailabilityRatio < 0.74 || state.yardOccupancy >= 0.98)) {
    reasons.push('recovery_preconditions_not_met');
  }
  if (['crane-rebalance', 'recovery-capacity'].includes(actionId) && state.yardOccupancy >= 0.995) {
    reasons.push('yard_capacity_interlock');
  }
  if (record.safetyRisk >= 0.78 && ['eco-speed-advisory', 'arrival-window-smooth', 'pilot-tug-priority'].includes(actionId)) {
    reasons.push('metocean_safety_interlock');
  }
  return reasons;
};

export interface ProjectedBusinessAction {
  requestedActionId: BusinessActionId;
  executedActionId: BusinessActionId;
  modified: boolean;
  feasible: boolean;
  reasons: string[];
  hardConstraintViolations: 0;
  requiresHumanApproval: boolean;
  dispatchAllowed: false;
}

export const projectBusinessAction = (
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
  requestedActionId: BusinessActionId,
): ProjectedBusinessAction => {
  const actionKnown = PORT_BUSINESS_ACTIONS.some((action) => action.id === requestedActionId);
  const reasons = actionKnown ? infeasibilityReasons(record, state, requestedActionId) : ['action_not_allowlisted'];
  const executedActionId = reasons.length ? 'hold-plan' : requestedActionId;
  return {
    requestedActionId,
    executedActionId,
    modified: executedActionId !== requestedActionId,
    feasible: reasons.length === 0,
    reasons,
    hardConstraintViolations: 0,
    requiresHumanApproval: executedActionId !== 'hold-plan',
    dispatchAllowed: false,
  };
};

export const feasibleBusinessActionIds = (
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
) => PORT_BUSINESS_ACTIONS
  .map((action) => action.id)
  .filter((actionId) => infeasibilityReasons(record, state, actionId).length === 0);

/**
 * Business applicability is narrower than physical feasibility. It prevents a
 * policy from repeatedly invoking a legitimate but irrelevant intervention in
 * a low-pressure state. This mask is deterministic, audited and replaceable by
 * an operator-approved operating envelope.
 */
export const applicableBusinessActionIds = (
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
) => {
  const feasible = new Set(feasibleBusinessActionIds(record, state));
  // One decision interval of cool-down prevents repeated resource churn and
  // gives the operation time to observe the effect before another bundle.
  if (state.previousActionId !== 'hold-plan') return ['hold-plan'] as BusinessActionId[];
  const pressure = (record.arrivals + state.queueVessels + state.deferredBacklogVessels) /
    Math.max(1, record.effectiveCapacity);
  const applicable = new Set<BusinessActionId>(['hold-plan']);
  const add = (id: BusinessActionId, condition: boolean) => {
    if (condition && feasible.has(id)) applicable.add(id);
  };
  add('eco-speed-advisory', record.carbonIntensity > 1.02 && pressure < 1.06);
  add('arrival-window-smooth', pressure > 0.96 || state.queueVessels > record.effectiveCapacity * 0.025);
  add('berth-reassign', pressure > 0.94 || state.queueVessels > record.effectiveCapacity * 0.02);
  add('crane-rebalance', pressure > 1 || state.queueVessels > record.effectiveCapacity * 0.035);
  add('yard-gate-smooth', state.yardOccupancy > 0.78 || state.gateQueuePressure > 0.68);
  add('pilot-tug-priority', state.fairnessGap > 0.24 && pressure > 0.9);
  add('shore-power-priority', record.carbonIntensity > 1.04 && record.shorePowerAvailability >= 0.2);
  add('intermodal-rebalance', state.yardOccupancy > 0.8 || state.gateQueuePressure > 0.76);
  add('recovery-capacity', state.recoveryBacklogVessels > record.effectiveCapacity * 0.012);
  add('neighbor-port-advisory', pressure > 1.08 || state.recoveryBacklogVessels > record.effectiveCapacity * 0.04);
  return [...applicable];
};

/**
 * A non-learning resource scheduler. It enumerates the allowlisted macro plans
 * and ranks them with transparent conservation and safety terms. It is the
 * fallback/comparator when learning evidence is weak or out of distribution.
 */
export const optimizeBusinessActionDeterministically = (
  record: PortBusinessRecord,
  state: PortBusinessDynamicState,
) => {
  const pressure = (record.arrivals + state.queueVessels + state.deferredBacklogVessels) /
    Math.max(1, record.effectiveCapacity);
  const candidates = feasibleBusinessActionIds(record, state).map((actionId) => {
    const effect = businessActionEffect(actionId);
    const predictedCapacity = record.effectiveCapacity * effect.capacityMultiplier;
    const predictedQueue = Math.max(
      0,
      state.queueVessels + record.arrivals * (1 - effect.deferredDemandFraction - effect.divertedDemandFraction) - predictedCapacity,
    );
    const predictedYard = Math.max(0, state.yardOccupancy - effect.yardRelief + predictedQueue / Math.max(1, predictedCapacity) * 0.018);
    const delayCost = predictedQueue / Math.max(1, predictedCapacity);
    const carbonCost = record.carbonIntensity * effect.carbonMultiplier;
    const fairnessCost = Math.max(0, state.fairnessGap - effect.fairnessRelief);
    const recoveryCost = state.recoveryBacklogVessels /
      Math.max(1, predictedCapacity * effect.recoveryMultiplier);
    const score =
      delayCost * 0.31 +
      Math.max(0, predictedYard - 0.72) * 0.2 +
      carbonCost * 0.13 +
      fairnessCost * 0.12 +
      recoveryCost * 0.14 +
      effect.interventionCost * 0.1 +
      (pressure < 0.82 && actionId !== 'hold-plan' ? 0.08 : 0);
    return { actionId, score, predictedQueue, predictedYard };
  }).sort((left, right) => left.score - right.score || left.actionId.localeCompare(right.actionId));
  return {
    owner: 'deterministic-optimizer' as const,
    selectedActionId: candidates[0]?.actionId ?? 'hold-plan',
    candidates,
    constraintsApplied: true,
    humanApprovalRequired: (candidates[0]?.actionId ?? 'hold-plan') !== 'hold-plan',
    dispatchAllowed: false as const,
  };
};

export interface DemandForecastModel {
  protocolVersion: 'public-demand-forecast.v1';
  featureContract: readonly ['bias', 'lag_1', 'lag_4', 'trend', 'season_sin', 'season_cos'];
  scale: number;
  ridgeLambda: number;
  weights: number[];
  trainedRecordCount: number;
  trainRange: [string, string];
}

const solveLinearSystem = (matrix: number[][], vector: number[]) => {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = Math.abs(augmented[pivot][pivot]) < 1e-12 ? 1e-12 : augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[size]);
};

const forecastFeatures = (records: PortBusinessRecord[], index: number, scale: number) => {
  const lag1 = records[Math.max(0, index - 1)]?.arrivals ?? scale;
  const lag4 = records[Math.max(0, index - 4)]?.arrivals ?? lag1;
  const lag2 = records[Math.max(0, index - 2)]?.arrivals ?? lag1;
  const month = Number(records[index]?.sourceMonth.slice(5, 7) ?? 1);
  return [
    1,
    lag1 / scale,
    lag4 / scale,
    (lag1 - lag2) / scale,
    Math.sin(month / 12 * Math.PI * 2),
    Math.cos(month / 12 * Math.PI * 2),
  ];
};

export const trainPublicDemandForecaster = (
  records: PortBusinessRecord[],
  ridgeLambda = 0.08,
): DemandForecastModel => {
  if (records.length < 40) throw new Error('需求预测训练至少需要 40 条记录');
  const scale = percentile(records.map((record) => record.arrivals), 0.5);
  const featureCount = 6;
  const matrix = Array.from({ length: featureCount }, () => Array(featureCount).fill(0) as number[]);
  const vector = Array(featureCount).fill(0) as number[];
  for (let index = 4; index < records.length; index += 1) {
    const features = forecastFeatures(records, index, scale);
    const target = records[index].arrivals / scale;
    for (let row = 0; row < featureCount; row += 1) {
      vector[row] += features[row] * target;
      for (let column = 0; column < featureCount; column += 1) {
        matrix[row][column] += features[row] * features[column];
      }
    }
  }
  for (let index = 1; index < featureCount; index += 1) matrix[index][index] += ridgeLambda;
  return {
    protocolVersion: 'public-demand-forecast.v1',
    featureContract: ['bias', 'lag_1', 'lag_4', 'trend', 'season_sin', 'season_cos'],
    scale,
    ridgeLambda,
    weights: solveLinearSystem(matrix, vector),
    trainedRecordCount: records.length,
    trainRange: [records[0].timestamp, records.at(-1)!.timestamp],
  };
};

export const predictPublicDemand = (
  model: DemandForecastModel,
  historyAndTarget: PortBusinessRecord[],
  targetIndex: number,
) => Math.max(0, forecastFeatures(historyAndTarget, targetIndex, model.scale)
  .reduce((sum, feature, index) => sum + feature * model.weights[index], 0) * model.scale);

export const evaluatePublicDemandForecaster = (
  model: DemandForecastModel,
  records: PortBusinessRecord[],
) => {
  const samples = records.slice(4).map((record, relativeIndex) => {
    const index = relativeIndex + 4;
    const prediction = predictPublicDemand(model, records, index);
    const seasonalNaive = records[index - 4].arrivals;
    return { actual: record.arrivals, prediction, seasonalNaive };
  });
  const metrics = (key: 'prediction' | 'seasonalNaive') => {
    const absoluteErrors = samples.map((sample) => Math.abs(sample.actual - sample[key]));
    const squaredErrors = samples.map((sample) => (sample.actual - sample[key]) ** 2);
    const actualTotal = samples.reduce((sum, sample) => sum + sample.actual, 0);
    return {
      mae: absoluteErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length),
      rmse: Math.sqrt(squaredErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length)),
      wapePercent: absoluteErrors.reduce((sum, value) => sum + value, 0) / Math.max(1, actualTotal) * 100,
    };
  };
  return {
    sampleCount: samples.length,
    model: metrics('prediction'),
    seasonalNaive: metrics('seasonalNaive'),
    operationalClaimAllowed: false,
  };
};
