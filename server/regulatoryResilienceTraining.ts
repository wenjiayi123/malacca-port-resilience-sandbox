import type { PortTrainingRecord } from './portTrainingDataset.ts';
import {
  REGULATORY_OBSERVATION_CONTRACT,
  REGULATORY_SUPPLEMENT_ACTIONS,
} from '../shared/regulatoryResilienceContract.ts';

export type RegulatoryShieldMode = 'unshielded' | 'dominance-projected';

export interface RegulatoryScenarioRecord extends PortTrainingRecord {
  maritimeInspectionRatio: number;
  customsInspectionRatio: number;
  maritimeReleaseRatio: number;
  customsReleaseRatio: number;
  documentReadinessRatio: number;
  inspectionResourceAvailableRatio: number;
  expectedHoldHours: number;
  electricityPriceMyrKwh: number;
  carbonFactorKgKwh: number;
}

interface RegulatoryState {
  maritimeHoldVessels: number;
  customsHoldVessels: number;
  releasedRecoveryVessels: number;
  terminalQueueVessels: number;
  cumulativeEnergyKwh: number;
  cumulativeCarbonKg: number;
}

interface RegulatoryStep {
  state: RegulatoryState;
  actionIndex: number;
  actionId: string;
  readinessRatio: number;
  recoveryPriorityRatio: number;
  maritimeInspectedVessels: number;
  customsInspectedVessels: number;
  maritimeReleasedVessels: number;
  customsReleasedVessels: number;
  processedRecoveryVessels: number;
  regulatoryDelayHours: number;
  incrementalEnergyKwh: number;
  incrementalCarbonKg: number;
  incrementalCostMyr: number;
  expectedSafetyViolation: number;
  reward: number;
}

export interface RegulatoryPolicyArtifact {
  schemaVersion: 'malacca-regulatory-q-table.v1';
  seed: number;
  episodes: number;
  environmentSteps: number;
  parameterUpdates: number;
  observationContract: readonly string[];
  actionContract: Array<{
    id: string;
    readinessRatio: number;
    recoveryPriorityRatio: number;
  }>;
  qTable: Record<string, number[]>;
}

export interface RegulatoryEvaluationMetrics {
  regulatoryDelayHours: number;
  incrementalEnergyKwh: number;
  incrementalCarbonKg: number;
  incrementalCostMyr: number;
  processedRecoveryVessels: number;
  finalMaritimeHoldVessels: number;
  finalCustomsHoldVessels: number;
  finalReleasedRecoveryVessels: number;
  expectedSafetyViolations: number;
  authorityViolations: number;
  meanReward: number;
}

export interface RegulatoryEvaluation {
  metrics: RegulatoryEvaluationMetrics;
  trace: Array<{
    step: number;
    timestamp: string;
    actionId: string;
    readinessRatio: number;
    recoveryPriorityRatio: number;
    maritimeHoldVessels: number;
    customsHoldVessels: number;
    releasedRecoveryVessels: number;
    processedRecoveryVessels: number;
    regulatoryDelayHours: number;
    incrementalEnergyKwh: number;
    incrementalCarbonKg: number;
    incrementalCostMyr: number;
    expectedSafetyViolation: number;
  }>;
}

const BASELINE_ACTION_INDEX = 7;
const STATE_SHAPE = [5, 5, 5, 4, 4] as const;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 4) => Number(value.toFixed(digits));

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

const deterministicUnit = (index: number, salt: number) => {
  const value = Math.sin((index + 1) * (12.9898 + salt * 0.131) + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
};

export const buildRegulatoryScenarioRecords = (
  records: PortTrainingRecord[],
  stressMultiplier = 1,
): RegulatoryScenarioRecord[] => records.map((record, index) => {
  const maritimePulse = index % 19 === 0 ? 0.075 : index % 7 === 0 ? 0.026 : 0;
  const customsPulse = index % 13 === 0 ? 0.095 : index % 5 === 0 ? 0.032 : 0;
  const documentationShock = index % 17 === 0 ? 0.2 : 0;
  const resourceShock = index % 23 === 0 ? 0.24 : 0;
  return {
    ...record,
    maritimeInspectionRatio: clamp(
      (0.012 + maritimePulse + deterministicUnit(index, 3) * 0.012) * stressMultiplier,
      0,
      0.32,
    ),
    customsInspectionRatio: clamp(
      (0.018 + customsPulse + deterministicUnit(index, 7) * 0.016) * stressMultiplier,
      0,
      0.38,
    ),
    maritimeReleaseRatio: clamp(0.34 + deterministicUnit(index, 11) * 0.36, 0.2, 0.82),
    customsReleaseRatio: clamp(0.28 + deterministicUnit(index, 17) * 0.34, 0.16, 0.74),
    documentReadinessRatio: clamp(
      0.9 - documentationShock - deterministicUnit(index, 19) * 0.1,
      0.5,
      0.96,
    ),
    inspectionResourceAvailableRatio: clamp(
      0.88 - resourceShock - deterministicUnit(index, 23) * 0.12,
      0.45,
      0.94,
    ),
    expectedHoldHours: round(8 + deterministicUnit(index, 29) * 28 + maritimePulse * 90 + customsPulse * 100, 2),
    electricityPriceMyrKwh: round(0.36 + deterministicUnit(index, 31) * 0.24, 3),
    carbonFactorKgKwh: round(0.5 + deterministicUnit(index, 37) * 0.13, 3),
  };
});

const initialState = (): RegulatoryState => ({
  maritimeHoldVessels: 0,
  customsHoldVessels: 0,
  releasedRecoveryVessels: 0,
  terminalQueueVessels: 0,
  cumulativeEnergyKwh: 0,
  cumulativeCarbonKg: 0,
});

const bin = (value: number, maximum: number, count: number) =>
  clamp(Math.floor(clamp(value, 0, maximum) / maximum * count), 0, count - 1);

const encodeState = (state: RegulatoryState, record: RegulatoryScenarioRecord) => {
  const capacity = Math.max(1, record.capacity);
  const values = [
    bin(state.maritimeHoldVessels / capacity, 0.7, STATE_SHAPE[0]),
    bin(state.customsHoldVessels / capacity, 0.9, STATE_SHAPE[1]),
    bin(state.releasedRecoveryVessels / capacity, 0.8, STATE_SHAPE[2]),
    bin((state.maritimeHoldVessels + state.customsHoldVessels) / capacity, 1.2, STATE_SHAPE[3]),
    bin((record.maritimeInspectionRatio + record.customsInspectionRatio) / 0.5, 1, STATE_SHAPE[4]),
  ];
  return values.reduce((index, value, dimension) => index * STATE_SHAPE[dimension] + value, 0);
};

const qRow = (table: Map<number, number[]>, state: number) => {
  const existing = table.get(state);
  if (existing) return existing;
  const created = Array(REGULATORY_SUPPLEMENT_ACTIONS.length).fill(0) as number[];
  table.set(state, created);
  return created;
};

const argmax = (values: number[], random?: () => number) => {
  const best = Math.max(...values);
  const indexes = values.flatMap((value, index) => Math.abs(value - best) < 1e-9 ? [index] : []);
  if (!random) return indexes[0] ?? 0;
  return indexes[Math.floor(random() * indexes.length)] ?? 0;
};

const transition = (
  state: RegulatoryState,
  actionIndex: number,
  record: RegulatoryScenarioRecord,
  random: () => number,
  stochastic: boolean,
): RegulatoryStep => {
  const action = REGULATORY_SUPPLEMENT_ACTIONS[actionIndex] ?? REGULATORY_SUPPLEMENT_ACTIONS[BASELINE_ACTION_INDEX];
  const noise = stochastic ? 0.96 + random() * 0.08 : 1;
  const maritimeInspectedVessels = record.arrivals * record.maritimeInspectionRatio * noise;
  const customsInspectedVessels = record.arrivals * record.customsInspectionRatio * noise;
  const maritimeBeforeRelease = state.maritimeHoldVessels + maritimeInspectedVessels;
  const customsBeforeRelease = state.customsHoldVessels + customsInspectedVessels;

  // Inspection selection, outcome and official release are exogenous. Terminal
  // actions never change these equations; they only prepare and recover cargo
  // after the authority signal has arrived.
  const maritimeReleasedVessels = Math.min(
    maritimeBeforeRelease,
    maritimeBeforeRelease * record.maritimeReleaseRatio,
  );
  const customsReleasedVessels = Math.min(
    customsBeforeRelease,
    customsBeforeRelease * record.customsReleaseRatio,
  );
  const maritimeHoldVessels = Math.max(0, maritimeBeforeRelease - maritimeReleasedVessels);
  const customsHoldVessels = Math.max(0, customsBeforeRelease - customsReleasedVessels);
  const releasedBeforeRecovery = state.releasedRecoveryVessels
    + maritimeReleasedVessels
    + customsReleasedVessels;
  const recoveryCapacity = record.capacity * 0.12 * record.inspectionResourceAvailableRatio;
  const processedRecoveryVessels = Math.min(
    releasedBeforeRecovery,
    recoveryCapacity * action.recoveryPriorityRatio,
  );
  const releasedRecoveryVessels = Math.max(0, releasedBeforeRecovery - processedRecoveryVessels);
  const terminalQueueVessels = Math.max(
    0,
    state.terminalQueueVessels * 0.42
      + Math.max(0, record.arrivals - record.capacity) * 0.28
      + processedRecoveryVessels * 0.03,
  );
  const totalRegulatoryBacklog = maritimeHoldVessels + customsHoldVessels + releasedRecoveryVessels;
  const regulatoryDelayHours = totalRegulatoryBacklog / Math.max(1, record.capacity) * 24 * 30;
  const holdAuxiliaryEnergyKwh = (maritimeHoldVessels + customsHoldVessels) * 5.8;
  const readinessEnergyKwh = record.capacity * 0.025 * action.readinessRatio * 38;
  const recoveryEnergyKwh = processedRecoveryVessels * 9.5;
  const incrementalEnergyKwh = holdAuxiliaryEnergyKwh + readinessEnergyKwh + recoveryEnergyKwh;
  const incrementalCarbonKg = incrementalEnergyKwh * record.carbonFactorKgKwh;
  const delayCostMyr = regulatoryDelayHours * 38;
  const incrementalCostMyr = incrementalEnergyKwh * record.electricityPriceMyrKwh + delayCostMyr;
  const expectedSafetyViolation = clamp(
    Math.max(0, action.recoveryPriorityRatio - action.readinessRatio - 0.2) * 0.12
      + Math.max(0, 0.58 - record.inspectionResourceAvailableRatio) * action.recoveryPriorityRatio * 0.06,
    0,
    0.2,
  );
  const serviceReward = processedRecoveryVessels / Math.max(1, record.capacity) * 18;
  const reward = serviceReward
    - regulatoryDelayHours / 36
    - incrementalCostMyr / Math.max(1, record.capacity) / 12
    - incrementalCarbonKg / Math.max(1, record.capacity) / 30
    - expectedSafetyViolation * 35;
  return {
    state: {
      maritimeHoldVessels,
      customsHoldVessels,
      releasedRecoveryVessels,
      terminalQueueVessels,
      cumulativeEnergyKwh: state.cumulativeEnergyKwh + incrementalEnergyKwh,
      cumulativeCarbonKg: state.cumulativeCarbonKg + incrementalCarbonKg,
    },
    actionIndex,
    actionId: action.id,
    readinessRatio: action.readinessRatio,
    recoveryPriorityRatio: action.recoveryPriorityRatio,
    maritimeInspectedVessels,
    customsInspectedVessels,
    maritimeReleasedVessels,
    customsReleasedVessels,
    processedRecoveryVessels,
    regulatoryDelayHours,
    incrementalEnergyKwh,
    incrementalCarbonKg,
    incrementalCostMyr,
    expectedSafetyViolation,
    reward,
  };
};

export const trainRegulatoryPolicy = (
  records: RegulatoryScenarioRecord[],
  seed: number,
  episodes: number,
): RegulatoryPolicyArtifact => {
  const random = seededRandom(seed);
  const table = new Map<number, number[]>();
  const alpha = 0.11;
  const gamma = 0.985;
  let environmentSteps = 0;
  for (let episode = 0; episode < episodes; episode += 1) {
    let state = initialState();
    const epsilon = Math.max(0.025, 0.72 * Math.pow(0.9982, episode));
    records.forEach((record) => {
      const stateIndex = encodeState(state, record);
      const row = qRow(table, stateIndex);
      const actionIndex = random() < epsilon
        ? Math.floor(random() * REGULATORY_SUPPLEMENT_ACTIONS.length)
        : argmax(row, random);
      const sample = transition(state, actionIndex, record, random, true);
      const nextStateIndex = encodeState(sample.state, record);
      const target = sample.reward + gamma * Math.max(...qRow(table, nextStateIndex));
      row[actionIndex] += alpha * (target - row[actionIndex]);
      state = sample.state;
      environmentSteps += 1;
    });
  }
  return {
    schemaVersion: 'malacca-regulatory-q-table.v1',
    seed,
    episodes,
    environmentSteps,
    parameterUpdates: environmentSteps,
    observationContract: [...REGULATORY_OBSERVATION_CONTRACT],
    actionContract: REGULATORY_SUPPLEMENT_ACTIONS.map((action) => ({ ...action })),
    qTable: Object.fromEntries(
      [...table.entries()].sort(([left], [right]) => left - right)
        .map(([state, values]) => [String(state), values.map((value) => round(value, 8))]),
    ),
  };
};

const actionFromPolicy = (
  policy: RegulatoryPolicyArtifact,
  state: RegulatoryState,
  record: RegulatoryScenarioRecord,
) => argmax(policy.qTable[String(encodeState(state, record))] ?? Array(REGULATORY_SUPPLEMENT_ACTIONS.length).fill(0));

const projectedAction = (
  proposalIndex: number,
  state: RegulatoryState,
  record: RegulatoryScenarioRecord,
) => {
  const baseline = transition(state, BASELINE_ACTION_INDEX, record, () => 0.5, false);
  const order = [proposalIndex, ...REGULATORY_SUPPLEMENT_ACTIONS.map((_, index) => index)]
    .filter((value, index, values) => values.indexOf(value) === index);
  const feasible = order.map((actionIndex) => transition(state, actionIndex, record, () => 0.5, false))
    .filter((sample) =>
      sample.processedRecoveryVessels + 1e-8 >= baseline.processedRecoveryVessels
      && sample.regulatoryDelayHours <= baseline.regulatoryDelayHours + 1e-8
      && sample.expectedSafetyViolation <= baseline.expectedSafetyViolation + 1e-8);
  return feasible.sort((left, right) =>
    left.incrementalCostMyr + left.incrementalCarbonKg * 0.04
      - (right.incrementalCostMyr + right.incrementalCarbonKg * 0.04))[0] ?? baseline;
};

export const evaluateRegulatoryPolicy = (
  policy: RegulatoryPolicyArtifact | null,
  records: RegulatoryScenarioRecord[],
  shieldMode: RegulatoryShieldMode,
): RegulatoryEvaluation => {
  let state = initialState();
  const trace: RegulatoryEvaluation['trace'] = [];
  let totalReward = 0;
  let totalDelay = 0;
  let totalEnergy = 0;
  let totalCarbon = 0;
  let totalCost = 0;
  let totalRecovery = 0;
  let totalSafety = 0;
  records.forEach((record, index) => {
    const proposalIndex = policy ? actionFromPolicy(policy, state, record) : BASELINE_ACTION_INDEX;
    const sample = shieldMode === 'dominance-projected'
      ? projectedAction(proposalIndex, state, record)
      : transition(state, proposalIndex, record, () => 0.5, false);
    state = sample.state;
    totalReward += sample.reward;
    totalDelay += sample.regulatoryDelayHours;
    totalEnergy += sample.incrementalEnergyKwh;
    totalCarbon += sample.incrementalCarbonKg;
    totalCost += sample.incrementalCostMyr;
    totalRecovery += sample.processedRecoveryVessels;
    totalSafety += sample.expectedSafetyViolation;
    trace.push({
      step: index + 1,
      timestamp: record.timestamp,
      actionId: sample.actionId,
      readinessRatio: sample.readinessRatio,
      recoveryPriorityRatio: sample.recoveryPriorityRatio,
      maritimeHoldVessels: round(state.maritimeHoldVessels, 3),
      customsHoldVessels: round(state.customsHoldVessels, 3),
      releasedRecoveryVessels: round(state.releasedRecoveryVessels, 3),
      processedRecoveryVessels: round(sample.processedRecoveryVessels, 3),
      regulatoryDelayHours: round(sample.regulatoryDelayHours, 3),
      incrementalEnergyKwh: round(sample.incrementalEnergyKwh, 3),
      incrementalCarbonKg: round(sample.incrementalCarbonKg, 3),
      incrementalCostMyr: round(sample.incrementalCostMyr, 3),
      expectedSafetyViolation: round(sample.expectedSafetyViolation, 6),
    });
  });
  return {
    metrics: {
      regulatoryDelayHours: round(totalDelay, 3),
      incrementalEnergyKwh: round(totalEnergy, 3),
      incrementalCarbonKg: round(totalCarbon, 3),
      incrementalCostMyr: round(totalCost, 3),
      processedRecoveryVessels: round(totalRecovery, 3),
      finalMaritimeHoldVessels: round(state.maritimeHoldVessels, 3),
      finalCustomsHoldVessels: round(state.customsHoldVessels, 3),
      finalReleasedRecoveryVessels: round(state.releasedRecoveryVessels, 3),
      expectedSafetyViolations: round(totalSafety, 6),
      authorityViolations: 0,
      meanReward: round(totalReward / Math.max(1, records.length), 6),
    },
    trace,
  };
};

export const regulatoryMetricReductionPercent = (baseline: number, candidate: number) =>
  round(Math.abs(baseline) < 1e-9 ? 0 : (baseline - candidate) / Math.abs(baseline) * 100, 4);

export const REGULATORY_BASELINE_ACTION_INDEX = BASELINE_ACTION_INDEX;
