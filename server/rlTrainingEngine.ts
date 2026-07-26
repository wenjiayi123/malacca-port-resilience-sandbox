import type { PortTrainingDataset, PortTrainingRecord } from './portTrainingDataset.ts';
import {
  getRlObjectivePreset,
  type RlObjectiveWeights,
} from '../shared/rlObjectivePresets.ts';
import { RL_OPERATIONAL_CALIBRATION } from '../shared/rlOperationalCalibration.ts';

export type RlAlgorithmId = 'q-learning' | 'sarsa' | 'expected-sarsa' | 'dyna-q' | 'mpc';

export interface RlTrainingRequest {
  protocolVersion?: string;
  algorithmId?: RlAlgorithmId;
  objectiveId?: string;
  trainingParameters?: {
    maxEpisodes?: number;
    seed?: number;
    learningRate?: number;
    discountGamma?: number;
    tuningTrials?: number;
    wallClockHours?: number;
  };
  rewardWeights?: {
    delay?: number;
    congestion?: number;
    carbon?: number;
    safety?: number;
    resilience?: number;
    throughput?: number;
  };
  scenarioSnapshot?: {
    scenarioId?: string;
    carbonTons?: number;
    networkResilienceIndex?: number;
  };
}

export interface RlBenchmarkPoint {
  episode: number;
  reward: number;
}

export interface RlEvaluationTracePoint {
  step: number;
  timestamp: string;
  actionId: string;
  actionLabel: string;
  arrivals: number;
  processedVessels: number;
  divertedVessels: number;
  deferredBacklogVessels: number;
  serviceLevelPercent: number;
  throughputRetentionPercent: number;
  queueVessels: number;
  delayHours: number;
  congestionPercent: number;
  carbonIndex: number;
  resilienceIndex: number;
  reward: number;
  safetyViolation: number;
}

export interface RlBenchmarkResult {
  id: RlAlgorithmId;
  label: string;
  color: string;
  family: 'reinforcement-learning' | 'control-theory';
  curve: RlBenchmarkPoint[];
  training: {
    episodes: number;
    environmentSteps: number;
    parameterUpdates: number;
    visitedStates: number;
    elapsedMs: number;
    tuningTrials: number;
    executedEpisodes: number;
  };
  hyperparameters: {
    learningRate: number | null;
    discountGamma: number | null;
    epsilonStart: number | null;
    epsilonEnd: number | null;
    planningSteps: number;
  };
  tuning: {
    candidateCount: number;
    selectionSplit: 'validation-tuning';
    selectedScore: number;
    selectedMeanReward: number;
    selectedSafetyViolations: number;
  };
  selectionScore: number;
  evaluation: {
    meanReward: number;
    delayReductionPercent: number;
    congestionReductionPercent: number;
    carbonReductionPercent: number;
    resilienceGain: number;
    safetyViolations: number;
    modeled: RlOperationalMetrics;
    baseline: RlOperationalMetrics;
  };
}

export interface RlOperationalMetrics {
  meanDelayHours: number;
  p95DelayHours: number;
  meanCongestionPercent: number;
  carbonIndexTotal: number;
  meanResilienceIndex: number;
  meanServiceLevelPercent: number;
  throughputRetentionPercent: number;
  finalDeferredBacklogVessels: number;
  safetyViolationRatePercent: number;
}

export interface RlBenchmarkResponse {
  protocolVersion: 'rl-benchmark.v2';
  engine: 'dataset-calibrated-port-control';
  generatedAt: string;
  scenarioId: string;
  episodes: number;
  horizon: number;
  bestAlgorithmId: RlAlgorithmId;
  dataset: {
    id: string;
    label: string;
    portId: string;
    samplingInterval: PortTrainingDataset['samplingInterval'];
    evidenceLevel: PortTrainingDataset['evidenceLevel'];
    source: string;
    sourceUrl: string;
    license: string;
    fingerprint: string;
    quality: PortTrainingDataset['quality'];
    recordCount: number;
    trainRecordCount: number;
    validationRecordCount: number;
    testRecordCount: number;
    trainRange: [string, string];
    validationRange: [string, string];
    validationTuningRange: [string, string];
    validationSelectionRange: [string, string];
    testRange: [string, string];
  };
  selectionSplit: 'validation';
  results: RlBenchmarkResult[];
  notes: string[];
}

export interface RlPolicyEvaluationResponse {
  protocolVersion: 'rl-policy-evaluation.v1';
  jobId: string;
  algorithmId: RlAlgorithmId;
  algorithmLabel: string;
  testCaseId: 'closed-loop-replay' | 'peak-congestion-stress' | 'weather-disturbance-generalization';
  generatedAt: string;
  datasetFingerprint: string;
  split: 'test';
  metrics: RlBenchmarkResult['evaluation'];
  trace: RlEvaluationTracePoint[];
  notes: string[];
}

export interface TrainingProgress {
  phase: 'training' | 'evaluating' | 'checkpointing';
  progressPercent: number;
  currentAlgorithmId: RlAlgorithmId | null;
  completedEpisodes: number;
  totalEpisodes: number;
  environmentSteps: number;
  parameterUpdates: number;
  rewardEma: number | null;
  samplesPerSecond: number;
  message: string;
}

type RewardWeights = RlObjectiveWeights;

interface EnvironmentState {
  queue: number;
  delayHours: number;
  carbonIndex: number;
  resilience: number;
  deferredBacklog: number;
  demandTrend: number;
  weatherRisk: number;
}

interface EnvironmentStep {
  state: EnvironmentState;
  reward: number;
  safetyViolation: number;
  arrivals: number;
  processed: number;
  diverted: number;
  deferredBacklog: number;
  serviceLevel: number;
  throughputRetention: number;
}

interface ActionDefinition {
  id: string;
  label: string;
  detail: string;
  deferredDemand: number;
  divertedDemand: number;
  capacityMultiplier: number;
  carbonMultiplier: number;
  safetyModifier: number;
}

interface QPolicy {
  kind: 'q-table';
  algorithmId: Exclude<RlAlgorithmId, 'mpc'>;
  qA: Map<number, number[]>;
  qB?: Map<number, number[]>;
}

interface MpcPolicy {
  kind: 'mpc';
  algorithmId: 'mpc';
  forecastBias: number;
  forecastRmse: number;
  horizon: number;
}

export type TrainedPolicy = QPolicy | MpcPolicy;

export interface RlTrainingArtifacts {
  benchmark: RlBenchmarkResponse;
  policies: Map<RlAlgorithmId, TrainedPolicy>;
}

export const RL_ALGORITHMS: Array<{
  id: RlAlgorithmId;
  label: string;
  color: string;
  family: RlBenchmarkResult['family'];
}> = [
  { id: 'q-learning', label: 'Q-Learning', color: '#35e6c2', family: 'reinforcement-learning' },
  { id: 'sarsa', label: 'SARSA', color: '#45b8ff', family: 'reinforcement-learning' },
  { id: 'expected-sarsa', label: 'Expected SARSA', color: '#b985ff', family: 'reinforcement-learning' },
  { id: 'dyna-q', label: 'Dyna-Q', color: '#ffbd45', family: 'reinforcement-learning' },
  { id: 'mpc', label: '模型预测控制（MPC）', color: '#ff6d72', family: 'control-theory' },
];

export const RL_ACTIONS: ActionDefinition[] = RL_OPERATIONAL_CALIBRATION.actions.map((action) => ({
  id: action.id,
  label: action.label,
  detail: action.detail,
  deferredDemand: action.deferredDemand,
  divertedDemand: action.divertedDemand,
  capacityMultiplier: action.capacityMultiplier,
  carbonMultiplier: action.carbonMultiplier,
  safetyModifier: action.safetyModifier,
}));

const RL_IDS: Array<Exclude<RlAlgorithmId, 'mpc'>> = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q'];
/**
 * Tabular policies observe six causally relevant aggregates.  In particular,
 * deferred backlog must be part of the state because it is released into
 * future demand. Omitting it aliases states with different future dynamics and
 * violates the Markov assumption made by the Q updates.
 */
export const RL_OBSERVATION_CONTRACT = [
  'queue_to_capacity',
  'delay_hours',
  'carbon_index',
  'deferred_backlog_to_capacity',
  'demand_trend',
  'weather_risk',
] as const;
const STATE_SHAPE = [6, 5, 5, 4, 4, 4] as const;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const sleepImmediate = () => new Promise<void>((resolve) => setImmediate(resolve));

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

const weatherRisk = (record: PortTrainingRecord) => clamp(
  record.windSpeedMs / 24 * 0.35 +
  record.waveHeightM / 4 * 0.35 +
  Math.max(0, 8 - record.visibilityKm) / 8 * 0.2 +
  Math.min(1, record.safetyIncidents) * 0.1,
  0,
  1,
);

const initialState = (record: PortTrainingRecord, previous?: PortTrainingRecord): EnvironmentState => ({
  queue: Math.max(0, record.arrivals - record.capacity) * 0.35,
  delayHours: 0,
  carbonIndex: 1,
  resilience: 1,
  deferredBacklog: 0,
  demandTrend: previous ? (record.arrivals - previous.arrivals) / Math.max(1, previous.arrivals) : 0,
  weatherRisk: weatherRisk(record),
});

const bin = (value: number, minimum: number, maximum: number, count: number) =>
  clamp(Math.floor((clamp(value, minimum, maximum) - minimum) / Math.max(1e-9, maximum - minimum) * count), 0, count - 1);

const encodeState = (state: EnvironmentState, capacity: number) => {
  const values = [
    bin(state.queue / Math.max(1, capacity), 0, 2.1, STATE_SHAPE[0]),
    bin(state.delayHours, 0, 72, STATE_SHAPE[1]),
    bin(state.carbonIndex, 0.65, 1.45, STATE_SHAPE[2]),
    bin(state.deferredBacklog / Math.max(1, capacity), 0, 1.6, STATE_SHAPE[3]),
    bin(state.demandTrend, -0.25, 0.25, STATE_SHAPE[4]),
    bin(state.weatherRisk, 0, 1, STATE_SHAPE[5]),
  ];
  return values.reduce((index, value, dimension) => index * STATE_SHAPE[dimension] + value, 0);
};

const tableRow = (table: Map<number, number[]>, state: number) => {
  const existing = table.get(state);
  if (existing) return existing;
  const created = Array(RL_ACTIONS.length).fill(0) as number[];
  table.set(state, created);
  return created;
};

const argmax = (values: number[], random?: () => number) => {
  const best = Math.max(...values);
  const indexes = values.flatMap((value, index) => Math.abs(value - best) < 1e-9 ? [index] : []);
  if (!random) return indexes[0] ?? 0;
  return indexes[Math.floor(random() * indexes.length)] ?? 0;
};

const epsilonAction = (values: number[], epsilon: number, random: () => number) =>
  random() < epsilon ? Math.floor(random() * RL_ACTIONS.length) : argmax(values, random);

export const resolveRewardWeights = (request: RlTrainingRequest): RewardWeights => {
  const preset = getRlObjectivePreset(request.objectiveId).weights;
  const raw = {
    delay: request.rewardWeights?.delay ?? preset.delay,
    congestion: request.rewardWeights?.congestion ?? preset.congestion,
    carbon: request.rewardWeights?.carbon ?? preset.carbon,
    safety: request.rewardWeights?.safety ?? preset.safety,
    resilience: request.rewardWeights?.resilience ?? preset.resilience,
    throughput: request.rewardWeights?.throughput ?? preset.throughput,
  };
  const total = Object.values(raw).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.max(0, value) / total])) as unknown as RewardWeights;
};

const transition = (
  state: EnvironmentState,
  actionIndex: number,
  record: PortTrainingRecord,
  previous: PortTrainingRecord | undefined,
  random: () => number,
  weights: RewardWeights,
  stochastic = true,
): EnvironmentStep => {
  const action = RL_ACTIONS[actionIndex] ?? RL_ACTIONS[0];
  const residual = stochastic ? (random() - 0.5) * 0.05 : 0;
  const arrivals = Math.max(0, record.arrivals * (1 + residual));
  const serviceCapacity = record.capacity * action.capacityMultiplier;
  const releasedDeferred = Math.min(
    state.deferredBacklog,
    Math.max(state.deferredBacklog * 0.35, serviceCapacity * 0.015),
  );
  const newlyDeferred = arrivals * action.deferredDemand;
  const diverted = arrivals * action.divertedDemand;
  const admittedDemand = Math.max(0, arrivals - newlyDeferred - diverted + releasedDeferred);
  const demandAvailableForService = state.queue + admittedDemand;
  const processed = Math.min(demandAvailableForService, serviceCapacity);
  const queue = Math.max(0, demandAvailableForService - processed);
  const deferredBacklog = Math.max(0, state.deferredBacklog - releasedDeferred + newlyDeferred);
  const delayHours = (queue + deferredBacklog) / Math.max(1, serviceCapacity) * 24;
  const baselineTonnage = Math.max(1, record.grossTonnage);
  const demandToManage = Math.max(1, state.queue + arrivals + releasedDeferred);
  const serviceLevel = clamp((processed + diverted) / demandToManage, 0, 1);
  const throughputRetention = clamp(processed / Math.max(1, arrivals + releasedDeferred), 0, 1);
  const processedRatio = clamp(processed / Math.max(1, arrivals + releasedDeferred), 0, 1.25);
  const carbonIndex = Math.max(
    0.4,
    (0.72 + processedRatio * 0.28) * action.carbonMultiplier +
      queue / Math.max(1, record.capacity) * 0.055 +
      deferredBacklog / Math.max(1, record.capacity) * 0.025 +
      diverted / Math.max(1, arrivals) * 0.08,
  );
  const risk = weatherRisk(record);
  const violationProbability = clamp(risk * 0.12 + action.safetyModifier + record.safetyIncidents / Math.max(1, record.arrivals), 0, 0.45);
  // Training samples Bernoulli events; deterministic evaluation reports the
  // expected violation rate. This prevents a favourable random seed from
  // turning a non-zero modeled risk into a misleading "zero violations" claim.
  const safetyViolation = stochastic
    ? (random() < violationProbability ? 1 : 0)
    : violationProbability;
  const congestion = clamp(queue / Math.max(1, record.capacity), 0, 2.5);
  const deferredPressure = clamp(deferredBacklog / Math.max(1, record.capacity), 0, 2.5);
  const resilience = clamp(
    0.72 +
      serviceLevel * 0.28 -
      congestion * 0.22 -
      deferredPressure * 0.12 -
      safetyViolation * 0.18 -
      risk * 0.08,
    0,
    1,
  );
  const carbonPenalty = Math.max(0, carbonIndex - 0.72);
  const interventionCost =
    action.deferredDemand * 2.2 +
    action.divertedDemand * 2.8 +
    Math.max(0, action.capacityMultiplier - 1) * 1.8;
  const reward =
    weights.resilience * resilience * 12 -
    weights.delay * clamp(delayHours / 48, 0, 2) * 12 -
    weights.congestion * congestion * 12 -
    weights.carbon * carbonPenalty * 10 -
    weights.safety * safetyViolation * 18 +
    weights.throughput * serviceLevel * 12 -
    deferredPressure * 0.85 -
    interventionCost +
    Math.min(1.2, baselineTonnage / Math.max(1, arrivals) / 30) * 0.15;
  return {
    state: {
      queue,
      delayHours,
      carbonIndex,
      resilience,
      deferredBacklog,
      demandTrend: previous ? (record.arrivals - previous.arrivals) / Math.max(1, previous.arrivals) : 0,
      weatherRisk: risk,
    },
    reward,
    safetyViolation,
    arrivals,
    processed,
    diverted,
    deferredBacklog,
    serviceLevel,
    throughputRetention,
  };
};

const combinedValues = (policy: QPolicy, stateIndex: number) => {
  const first = tableRow(policy.qA, stateIndex);
  if (!policy.qB) return first;
  const second = tableRow(policy.qB, stateIndex);
  return first.map((value, index) => value + second[index]);
};

const scenarioRecords = (
  records: PortTrainingRecord[],
  testCaseId: RlPolicyEvaluationResponse['testCaseId'],
) => records.map((record) => {
  if (testCaseId === 'peak-congestion-stress') {
    return {
      ...record,
      arrivals: record.arrivals * RL_OPERATIONAL_CALIBRATION.stressTest.arrivalMultiplier,
      capacity: record.capacity * RL_OPERATIONAL_CALIBRATION.stressTest.capacityMultiplier,
    };
  }
  if (testCaseId === 'weather-disturbance-generalization') {
    return {
      ...record,
      windSpeedMs: Math.max(17, record.windSpeedMs * 1.5),
      waveHeightM: Math.max(2.1, record.waveHeightM * 1.6),
      visibilityKm: Math.min(5, record.visibilityKm),
    };
  }
  return { ...record };
});

const mpcAction = (
  policy: MpcPolicy,
  state: EnvironmentState,
  records: PortTrainingRecord[],
  index: number,
  weights: RewardWeights,
) => {
  const forecast = Array.from({ length: policy.horizon }, (_, offset) =>
    records[Math.min(records.length - 1, index + offset)] ?? records.at(-1)!,
  );
  const currentCapacity = Math.max(1, records[index]?.capacity ?? forecast[0].capacity);
  const currentPressure = (state.queue + state.deferredBacklog) / currentCapacity;
  const forecastRequiresControl = forecast.some((record) =>
    record.arrivals * (1 + policy.forecastBias) > record.capacity);
  if (currentPressure < 0.005 && !forecastRequiresControl) return 0;
  let bestAction = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let first = 0; first < RL_ACTIONS.length; first += 1) {
    for (let second = 0; second < RL_ACTIONS.length; second += 1) {
      for (let third = 0; third < RL_ACTIONS.length; third += 1) {
        const sequence = [first, second, third];
        let projected = { ...state };
        let cost = 0;
        sequence.slice(0, policy.horizon).forEach((actionIndex, horizonIndex) => {
          const record = forecast[horizonIndex];
          const biased = { ...record, arrivals: record.arrivals * (1 + policy.forecastBias) };
          const sample = transition(projected, actionIndex, biased, forecast[horizonIndex - 1], () => 0.99, weights, false);
          projected = sample.state;
          cost += -sample.reward * Math.pow(0.96, horizonIndex) + (actionIndex === 4 ? 0.08 : 0);
        });
        if (cost < bestCost) {
          bestCost = cost;
          bestAction = first;
        }
      }
    }
  }
  return bestAction;
};

interface EvaluationRun {
  meanReward: number;
  meanDelayHours: number;
  p95DelayHours: number;
  meanCongestionPercent: number;
  carbonTotal: number;
  meanResilienceIndex: number;
  meanServiceLevelPercent: number;
  throughputRetentionPercent: number;
  finalDeferredBacklogVessels: number;
  safetyViolations: number;
  trace: RlEvaluationTracePoint[];
}

const evaluatePolicy = (
  policy: TrainedPolicy | null,
  records: PortTrainingRecord[],
  weights: RewardWeights,
  seed: number,
): EvaluationRun => {
  const random = seededRandom(seed);
  let state = initialState(records[0]);
  const trace: RlEvaluationTracePoint[] = [];
  records.forEach((record, index) => {
    const stateIndex = encodeState(state, record.capacity);
    const actionIndex = policy?.kind === 'q-table'
      ? argmax(combinedValues(policy, stateIndex))
      : policy?.kind === 'mpc'
        ? mpcAction(policy, state, records, index, weights)
        : 0;
    const sample = transition(state, actionIndex, record, records[index - 1], random, weights, false);
    state = sample.state;
    const action = RL_ACTIONS[actionIndex];
    trace.push({
      step: index + 1,
      timestamp: record.timestamp,
      actionId: action.id,
      actionLabel: action.label,
      arrivals: round(sample.arrivals, 1),
      processedVessels: round(sample.processed, 1),
      divertedVessels: round(sample.diverted, 1),
      deferredBacklogVessels: round(sample.deferredBacklog, 1),
      serviceLevelPercent: round(sample.serviceLevel * 100, 2),
      throughputRetentionPercent: round(sample.throughputRetention * 100, 2),
      queueVessels: round(state.queue, 1),
      delayHours: round(state.delayHours, 2),
      congestionPercent: round(
        (state.queue + state.deferredBacklog)
          / Math.max(1, record.capacity)
          * 100,
        2,
      ),
      carbonIndex: round(state.carbonIndex, 4),
      resilienceIndex: round(state.resilience * 100, 2),
      reward: round(sample.reward, 4),
      safetyViolation: sample.safetyViolation,
    });
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const percentileValue = (values: number[], ratio: number) => {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
  };
  return {
    meanReward: mean(trace.map((point) => point.reward)),
    meanDelayHours: mean(trace.map((point) => point.delayHours)),
    p95DelayHours: percentileValue(trace.map((point) => point.delayHours), 0.95),
    meanCongestionPercent: mean(trace.map((point) => point.congestionPercent)),
    carbonTotal: trace.reduce((sum, point) => sum + point.carbonIndex, 0),
    meanResilienceIndex: mean(trace.map((point) => point.resilienceIndex)),
    meanServiceLevelPercent: mean(trace.map((point) => point.serviceLevelPercent)),
    throughputRetentionPercent: mean(trace.map((point) => point.throughputRetentionPercent)),
    finalDeferredBacklogVessels: trace.at(-1)?.deferredBacklogVessels ?? 0,
    safetyViolations: trace.reduce((sum, point) => sum + point.safetyViolation, 0),
    trace,
  };
};

const operationalMetrics = (run: EvaluationRun): RlOperationalMetrics => ({
  meanDelayHours: round(run.meanDelayHours, 3),
  p95DelayHours: round(run.p95DelayHours, 3),
  meanCongestionPercent: round(run.meanCongestionPercent, 3),
  carbonIndexTotal: round(run.carbonTotal, 4),
  meanResilienceIndex: round(run.meanResilienceIndex, 3),
  meanServiceLevelPercent: round(run.meanServiceLevelPercent, 3),
  throughputRetentionPercent: round(run.throughputRetentionPercent, 3),
  finalDeferredBacklogVessels: round(run.finalDeferredBacklogVessels, 2),
  safetyViolationRatePercent: round(run.safetyViolations / Math.max(1, run.trace.length) * 100, 3),
});

const relativeReduction = (baseline: number, candidate: number) =>
  Math.abs(baseline) < 1e-6 ? 0 : (baseline - candidate) / Math.abs(baseline) * 100;

const evaluationMetrics = (run: EvaluationRun, baseline: EvaluationRun): RlBenchmarkResult['evaluation'] => ({
  meanReward: round(run.meanReward, 3),
  delayReductionPercent: round(relativeReduction(baseline.meanDelayHours, run.meanDelayHours), 2),
  congestionReductionPercent: round(relativeReduction(baseline.meanCongestionPercent, run.meanCongestionPercent), 2),
  carbonReductionPercent: round(relativeReduction(baseline.carbonTotal, run.carbonTotal), 2),
  resilienceGain: round(run.meanResilienceIndex - baseline.meanResilienceIndex, 2),
  safetyViolations: run.safetyViolations,
  modeled: operationalMetrics(run),
  baseline: operationalMetrics(baseline),
});

const trainQPolicy = async (
  algorithmId: Exclude<RlAlgorithmId, 'mpc'>,
  records: PortTrainingRecord[],
  request: RlTrainingRequest,
  weights: RewardWeights,
  algorithmOffset: number,
  completedEpisodesBefore: number,
  totalEpisodes: number,
  cumulativeEnvironmentSteps: number,
  cumulativeParameterUpdates: number,
  onProgress: (progress: TrainingProgress) => void,
  cancelled: () => boolean,
  hyperparameters?: {
    learningRate: number;
    discountGamma: number;
  },
) => {
  const episodes = clamp(Math.round(request.trainingParameters?.maxEpisodes ?? 600), 120, 5_000);
  const alpha = clamp(hyperparameters?.learningRate ?? request.trainingParameters?.learningRate ?? 0.12, 0.01, 0.5);
  const gamma = clamp(hyperparameters?.discountGamma ?? request.trainingParameters?.discountGamma ?? 0.97, 0.7, 0.999);
  const seed = Math.round(request.trainingParameters?.seed ?? 240_520) + algorithmOffset * 997;
  const random = seededRandom(seed);
  const policy: QPolicy = {
    kind: 'q-table',
    algorithmId,
    qA: new Map(),
    ...(algorithmId === 'q-learning' ? {} : {}),
  };
  const model = new Map<string, { nextState: number; reward: number }>();
  const curve: RlBenchmarkPoint[] = [];
  const rewardWindow: number[] = [];
  let environmentSteps = 0;
  let parameterUpdates = 0;
  const startedAt = performance.now();
  const horizon = Math.min(24, Math.max(4, records.length));
  const curveEvery = Math.max(1, Math.floor(episodes / 60));

  for (let episode = 1; episode <= episodes; episode += 1) {
    if (cancelled()) throw new Error('training cancelled');
    const start = Math.floor(random() * Math.max(1, records.length - horizon));
    let state = initialState(records[start], records[start - 1]);
    let stateId = encodeState(state, records[start].capacity);
    const epsilon = Math.max(0.025, 0.42 * Math.exp(-episode / Math.max(30, episodes * 0.32)));
    let action = epsilonAction(tableRow(policy.qA, stateId), epsilon, random);
    let episodeReward = 0;
    for (let step = 0; step < horizon; step += 1) {
      const recordIndex = (start + step) % records.length;
      const record = records[recordIndex];
      const sample = transition(state, action, record, records[recordIndex - 1], random, weights);
      const nextStateId = encodeState(sample.state, record.capacity);
      const qState = tableRow(policy.qA, stateId);
      const qNext = tableRow(policy.qA, nextStateId);
      const nextAction = epsilonAction(qNext, epsilon, random);
      let target = sample.reward;
      if (algorithmId === 'sarsa') {
        target += gamma * qNext[nextAction];
      } else if (algorithmId === 'expected-sarsa') {
        const greedy = argmax(qNext, random);
        const expected = qNext.reduce((sum, value, index) =>
          sum + value * (epsilon / RL_ACTIONS.length + (index === greedy ? 1 - epsilon : 0)), 0);
        target += gamma * expected;
      } else {
        target += gamma * Math.max(...qNext);
      }
      qState[action] += alpha * (target - qState[action]);
      parameterUpdates += 1;
      if (algorithmId === 'dyna-q') {
        model.set(`${stateId}:${action}`, { nextState: nextStateId, reward: sample.reward });
        const entries = [...model.entries()];
        for (let planning = 0; planning < Math.min(5, entries.length); planning += 1) {
          const [key, remembered] = entries[Math.floor(random() * entries.length)];
          const [plannedState, plannedAction] = key.split(':').map(Number);
          const plannedRow = tableRow(policy.qA, plannedState);
          const plannedTarget = remembered.reward + gamma * Math.max(...tableRow(policy.qA, remembered.nextState));
          plannedRow[plannedAction] += alpha * 0.55 * (plannedTarget - plannedRow[plannedAction]);
          parameterUpdates += 1;
        }
      }
      episodeReward += sample.reward;
      environmentSteps += 1;
      state = sample.state;
      stateId = nextStateId;
      action = algorithmId === 'sarsa' ? nextAction : epsilonAction(qNext, epsilon, random);
    }
    rewardWindow.push(episodeReward);
    if (rewardWindow.length > 40) rewardWindow.shift();
    if (episode === 1 || episode % curveEvery === 0 || episode === episodes) {
      curve.push({
        episode,
        reward: round(rewardWindow.reduce((sum, value) => sum + value, 0) / rewardWindow.length, 3),
      });
    }
    if (episode % 8 === 0 || episode === episodes) {
      const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
      const completedEpisodes = completedEpisodesBefore + episode;
      onProgress({
        phase: 'training',
        progressPercent: 8 + completedEpisodes / totalEpisodes * 74,
        currentAlgorithmId: algorithmId,
        completedEpisodes,
        totalEpisodes,
        environmentSteps: cumulativeEnvironmentSteps + environmentSteps,
        parameterUpdates: cumulativeParameterUpdates + parameterUpdates,
        rewardEma: curve.at(-1)?.reward ?? null,
        samplesPerSecond: Math.round(environmentSteps / elapsedSeconds),
        message: `${RL_ALGORITHMS.find((algorithm) => algorithm.id === algorithmId)?.label} · episode ${episode}/${episodes}`,
      });
      await sleepImmediate();
    }
  }
  return {
    policy,
    curve,
    training: {
      episodes,
      environmentSteps,
      parameterUpdates,
      visitedStates: policy.qA.size,
      elapsedMs: Math.round(performance.now() - startedAt),
      tuningTrials: 1,
      executedEpisodes: episodes,
    },
    hyperparameters: {
      learningRate: alpha,
      discountGamma: gamma,
      epsilonStart: 0.42,
      epsilonEnd: 0.025,
      planningSteps: algorithmId === 'dyna-q' ? 5 : 0,
    },
  };
};

const calibrateMpc = async (
  records: PortTrainingRecord[],
  totalEpisodes: number,
  cumulativeEnvironmentSteps: number,
  cumulativeParameterUpdates: number,
  onProgress: (progress: TrainingProgress) => void,
) => {
  const startedAt = performance.now();
  const errors = records.slice(1).map((record, index) =>
    (record.arrivals - records[index].arrivals) / Math.max(1, records[index].arrivals));
  const forecastBias = errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length);
  const forecastRmse = Math.sqrt(errors.reduce((sum, value) => sum + Math.pow(value - forecastBias, 2), 0) / Math.max(1, errors.length));
  const policy: MpcPolicy = { kind: 'mpc', algorithmId: 'mpc', forecastBias, forecastRmse, horizon: 3 };
  const curve = records.slice(1).map((record, index) => ({
    episode: index + 1,
    reward: round(-Math.abs(record.arrivals - records[index].arrivals) / Math.max(1, record.arrivals) * 10, 3),
  }));
  onProgress({
    phase: 'training', progressPercent: 82, currentAlgorithmId: 'mpc',
    completedEpisodes: totalEpisodes, totalEpisodes,
    environmentSteps: cumulativeEnvironmentSteps + records.length,
    parameterUpdates: cumulativeParameterUpdates + errors.length,
    rewardEma: curve.at(-1)?.reward ?? null, samplesPerSecond: 0,
    message: `MPC 系统辨识完成 · 预测 RMSE ${round(forecastRmse * 100, 2)}%`,
  });
  await sleepImmediate();
  return {
    policy,
    curve,
    training: {
      episodes: 0,
      environmentSteps: records.length,
      parameterUpdates: errors.length,
      visitedStates: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      tuningTrials: 1,
      executedEpisodes: 0,
    },
    hyperparameters: {
      learningRate: null,
      discountGamma: null,
      epsilonStart: null,
      epsilonEnd: null,
      planningSteps: 0,
    },
  };
};

const buildTuningCandidates = (request: RlTrainingRequest) => {
  const trialCount = clamp(Math.round(request.trainingParameters?.tuningTrials ?? 3), 1, 5);
  const learningRate = clamp(request.trainingParameters?.learningRate ?? 0.12, 0.01, 0.5);
  const discountGamma = clamp(request.trainingParameters?.discountGamma ?? 0.97, 0.7, 0.999);
  const candidates = [
    { learningRate, discountGamma },
    {
      learningRate: clamp(learningRate * 0.72, 0.01, 0.5),
      discountGamma: clamp(discountGamma + 0.015, 0.7, 0.999),
    },
    {
      learningRate: clamp(learningRate * 1.28, 0.01, 0.5),
      discountGamma: clamp(discountGamma - 0.02, 0.7, 0.999),
    },
    {
      learningRate: clamp(learningRate * 0.5, 0.01, 0.5),
      discountGamma: clamp(discountGamma + 0.025, 0.7, 0.999),
    },
    {
      learningRate: clamp(learningRate * 1.55, 0.01, 0.5),
      discountGamma: clamp(discountGamma - 0.04, 0.7, 0.999),
    },
  ];
  return candidates.slice(0, trialCount).map((candidate) => ({
    learningRate: round(candidate.learningRate, 4),
    discountGamma: round(candidate.discountGamma, 4),
  }));
};

const splitValidationRecords = (records: PortTrainingRecord[]) => {
  const tuningEnd = Math.min(
    records.length - 2,
    Math.max(2, Math.floor(records.length * 0.6)),
  );
  return {
    tuningRecords: records.slice(0, tuningEnd),
    selectionRecords: records.slice(tuningEnd),
  };
};

const operationalSelectionScore = (
  meanReward: number,
  metrics: RlOperationalMetrics,
) =>
  meanReward -
  metrics.safetyViolationRatePercent / 100 * 0.5 -
  Math.max(0, 97 - metrics.meanServiceLevelPercent) / 100 * 4 -
  Math.max(0, 95 - metrics.throughputRetentionPercent) / 100 * 3 -
  metrics.finalDeferredBacklogVessels / 5_000;

const policySelectionScore = (run: EvaluationRun) =>
  operationalSelectionScore(run.meanReward, operationalMetrics(run));

export const trainRlBenchmark = async (
  request: RlTrainingRequest,
  dataset: PortTrainingDataset,
  onProgress: (progress: TrainingProgress) => void,
  cancelled: () => boolean = () => false,
): Promise<RlTrainingArtifacts> => {
  const episodes = clamp(Math.round(request.trainingParameters?.maxEpisodes ?? 600), 120, 5_000);
  const tuningCandidates = buildTuningCandidates(request);
  const totalEpisodes = episodes * RL_IDS.length * tuningCandidates.length;
  const weights = resolveRewardWeights(request);
  const { tuningRecords, selectionRecords } = splitValidationRecords(dataset.validationRecords);
  const policies = new Map<RlAlgorithmId, TrainedPolicy>();
  const trained = new Map<RlAlgorithmId, {
    curve: RlBenchmarkPoint[];
    training: RlBenchmarkResult['training'];
    hyperparameters: RlBenchmarkResult['hyperparameters'];
    tuning: RlBenchmarkResult['tuning'];
  }>();
  let cumulativeEnvironmentSteps = 0;
  let cumulativeParameterUpdates = 0;
  let completedEpisodes = 0;
  for (let index = 0; index < RL_IDS.length; index += 1) {
    const algorithmId = RL_IDS[index];
    let selected: Awaited<ReturnType<typeof trainQPolicy>> | null = null;
    let selectedRun: EvaluationRun | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    let aggregateEnvironmentSteps = 0;
    let aggregateParameterUpdates = 0;
    let aggregateElapsedMs = 0;
    for (const hyperparameters of tuningCandidates) {
      const result = await trainQPolicy(
        algorithmId,
        dataset.trainRecords,
        request,
        weights,
        index,
        completedEpisodes,
        totalEpisodes,
        cumulativeEnvironmentSteps,
        cumulativeParameterUpdates,
        onProgress,
        cancelled,
        hyperparameters,
      );
      const tuningRun = evaluatePolicy(result.policy, tuningRecords, weights, 77_001 + index * 101);
      const score = policySelectionScore(tuningRun);
      if (score > selectedScore) {
        selected = result;
        selectedRun = tuningRun;
        selectedScore = score;
      }
      completedEpisodes += episodes;
      cumulativeEnvironmentSteps += result.training.environmentSteps;
      cumulativeParameterUpdates += result.training.parameterUpdates;
      aggregateEnvironmentSteps += result.training.environmentSteps;
      aggregateParameterUpdates += result.training.parameterUpdates;
      aggregateElapsedMs += result.training.elapsedMs;
    }
    if (!selected || !selectedRun) throw new Error(`no tuning candidate completed for ${algorithmId}`);
    policies.set(algorithmId, selected.policy);
    trained.set(algorithmId, {
      curve: selected.curve,
      training: {
        ...selected.training,
        environmentSteps: aggregateEnvironmentSteps,
        parameterUpdates: aggregateParameterUpdates,
        elapsedMs: aggregateElapsedMs,
        tuningTrials: tuningCandidates.length,
        executedEpisodes: episodes * tuningCandidates.length,
      },
      hyperparameters: selected.hyperparameters,
      tuning: {
        candidateCount: tuningCandidates.length,
        selectionSplit: 'validation-tuning',
        selectedScore: round(selectedScore, 4),
        selectedMeanReward: round(selectedRun.meanReward, 4),
        selectedSafetyViolations: selectedRun.safetyViolations,
      },
    });
  }
  const mpc = await calibrateMpc(
    dataset.trainRecords,
    totalEpisodes,
    cumulativeEnvironmentSteps,
    cumulativeParameterUpdates,
    onProgress,
  );
  policies.set('mpc', mpc.policy);
  const mpcTuningRun = evaluatePolicy(mpc.policy, tuningRecords, weights, 77_505);
  trained.set('mpc', {
    curve: mpc.curve,
    training: mpc.training,
    hyperparameters: mpc.hyperparameters,
    tuning: {
      candidateCount: 1,
      selectionSplit: 'validation-tuning',
      selectedScore: round(policySelectionScore(mpcTuningRun), 4),
      selectedMeanReward: round(mpcTuningRun.meanReward, 4),
      selectedSafetyViolations: mpcTuningRun.safetyViolations,
    },
  });
  cumulativeEnvironmentSteps += mpc.training.environmentSteps;
  cumulativeParameterUpdates += mpc.training.parameterUpdates;

  onProgress({
    phase: 'evaluating', progressPercent: 86, currentAlgorithmId: null,
    completedEpisodes: totalEpisodes, totalEpisodes,
    environmentSteps: cumulativeEnvironmentSteps,
    parameterUpdates: cumulativeParameterUpdates,
    rewardEma: null, samplesPerSecond: 0,
    message: `超参数已在验证前段调节；开始在验证后段 ${selectionRecords[0].timestamp} → ${selectionRecords.at(-1)!.timestamp} 统一选择算法`,
  });
  await sleepImmediate();
  const baseline = evaluatePolicy(null, selectionRecords, weights, 88_001);
  const results: RlBenchmarkResult[] = [];
  for (let index = 0; index < RL_ALGORITHMS.length; index += 1) {
    if (cancelled()) throw new Error('training cancelled');
    const algorithm = RL_ALGORITHMS[index];
    const policy = policies.get(algorithm.id)!;
    const run = evaluatePolicy(policy, selectionRecords, weights, 88_001);
    const trainedResult = trained.get(algorithm.id)!;
    const metrics = evaluationMetrics(run, baseline);
    results.push({
      ...algorithm,
      curve: trainedResult.curve,
      training: trainedResult.training,
      hyperparameters: trainedResult.hyperparameters,
      tuning: trainedResult.tuning,
      selectionScore: round(operationalSelectionScore(metrics.meanReward, metrics.modeled), 4),
      evaluation: metrics,
    });
    onProgress({
      phase: 'evaluating', progressPercent: 86 + (index + 1) / RL_ALGORITHMS.length * 10,
      currentAlgorithmId: algorithm.id, completedEpisodes: totalEpisodes, totalEpisodes,
      environmentSteps: cumulativeEnvironmentSteps + (index + 1) * run.trace.length,
      parameterUpdates: cumulativeParameterUpdates,
      rewardEma: run.meanReward, samplesPerSecond: 0,
      message: `${algorithm.label} 验证集评估完成 · mean reward ${round(run.meanReward, 3)}`,
    });
    await sleepImmediate();
  }
  const best = [...results].sort((left, right) =>
    operationalSelectionScore(right.evaluation.meanReward, right.evaluation.modeled) -
    operationalSelectionScore(left.evaluation.meanReward, left.evaluation.modeled))[0];
  onProgress({
    phase: 'checkpointing', progressPercent: 98, currentAlgorithmId: best.id,
    completedEpisodes: totalEpisodes, totalEpisodes,
    environmentSteps: cumulativeEnvironmentSteps + RL_ALGORITHMS.length * dataset.validationRecords.length,
    parameterUpdates: cumulativeParameterUpdates,
    rewardEma: best.evaluation.meanReward, samplesPerSecond: 0,
    message: `正在封装 ${best.label} 检查点与评估摘要`,
  });
  const benchmark: RlBenchmarkResponse = {
    protocolVersion: 'rl-benchmark.v2',
    engine: 'dataset-calibrated-port-control',
    generatedAt: new Date().toISOString(),
    scenarioId: request.scenarioSnapshot?.scenarioId ?? 'malacca-public-evidence',
    episodes,
    horizon: Math.min(24, Math.max(4, dataset.trainRecords.length)),
    bestAlgorithmId: best.id,
    dataset: {
      id: dataset.id,
      label: dataset.label,
      portId: dataset.portId,
      source: dataset.source,
      sourceUrl: dataset.sourceUrl,
      license: dataset.license,
      fingerprint: dataset.fingerprint,
      samplingInterval: dataset.samplingInterval,
      evidenceLevel: dataset.evidenceLevel,
      quality: dataset.quality,
      recordCount: dataset.records.length,
      trainRecordCount: dataset.trainRecords.length,
      validationRecordCount: dataset.validationRecords.length,
      testRecordCount: dataset.testRecords.length,
      trainRange: dataset.split.trainRange,
      validationRange: dataset.split.validationRange,
      validationTuningRange: [tuningRecords[0].timestamp, tuningRecords.at(-1)!.timestamp],
      validationSelectionRange: [selectionRecords[0].timestamp, selectionRecords.at(-1)!.timestamp],
      testRange: dataset.split.testRange,
    },
    selectionSplit: 'validation',
    results,
    notes: [
      'Q-Learning、SARSA、Expected SARSA 与 Dyna-Q 均执行了真实价值函数更新。',
      'MPC 是控制理论基线，使用训练段进行需求模型辨识并在每个验证/测试时刻滚动优化，不伪装成 RL。',
      `目标函数 ${getRlObjectivePreset(request.objectiveId).id} 已解析为延误、拥堵、碳、安全、韧性与吞吐六项归一化权重。`,
      `每种 RL 在验证前段比较 ${tuningCandidates.length} 组超参数，验证后段再做算法选择，最终测试保持封存。`,
      '最终测试段不参与参数更新或算法选择，只在训练完成后的显式策略测试接口中读取并生成回放轨迹。',
      '错峰需求进入递延积压并在后续时段释放；分流、扩容和递延均计入干预成本，避免通过丢弃需求制造虚高改善。',
      '月度公开数据用于复现实证与接口验证；泊位级生产部署应替换为更高频的授权 TOS/VTS/AIS 数据。',
    ],
  };
  return { benchmark, policies };
};

export const evaluateTrainedPolicy = (
  jobId: string,
  algorithmId: RlAlgorithmId,
  testCaseId: RlPolicyEvaluationResponse['testCaseId'],
  artifacts: RlTrainingArtifacts,
  dataset: PortTrainingDataset,
  request: RlTrainingRequest,
): RlPolicyEvaluationResponse => {
  const records = scenarioRecords(dataset.testRecords, testCaseId);
  const weights = resolveRewardWeights(request);
  const baseline = evaluatePolicy(null, records, weights, 91_101);
  const run = evaluatePolicy(artifacts.policies.get(algorithmId)!, records, weights, 91_101);
  const algorithm = RL_ALGORITHMS.find((item) => item.id === algorithmId)!;
  return {
    protocolVersion: 'rl-policy-evaluation.v1',
    jobId,
    algorithmId,
    algorithmLabel: algorithm.label,
    testCaseId,
    split: 'test',
    generatedAt: new Date().toISOString(),
    datasetFingerprint: dataset.fingerprint,
    metrics: evaluationMetrics(run, baseline),
    trace: run.trace,
    notes: [
      '回放轨迹由留出测试记录逐步生成；前端只负责按 trace 顺序渲染。',
      '该最终测试段从未参与参数更新、超参数调节或最优算法选择。',
      testCaseId === 'closed-loop-replay'
        ? '闭环回放不修改留出测试记录。'
        : '压力测试只对留出记录施加文档化扰动，不回流训练。',
    ],
  };
};

export const inferTrainedPolicy = (
  policy: TrainedPolicy,
  dataset: PortTrainingDataset,
  request: RlTrainingRequest,
  input: { congestionPercent: number; delayMinutes: number; carbonTons: number; windSpeedMs: number; waveHeightM: number; visibilityKm: number },
) => {
  const record = {
    ...dataset.records.at(-1)!,
    windSpeedMs: input.windSpeedMs,
    waveHeightM: input.waveHeightM,
    visibilityKm: input.visibilityKm,
  };
  const state: EnvironmentState = {
    queue: input.congestionPercent / 100 * record.capacity,
    delayHours: input.delayMinutes / 60,
    carbonIndex: clamp(
      input.carbonTons / Math.max(1, request.scenarioSnapshot?.carbonTons ?? input.carbonTons),
      0.65,
      1.45,
    ),
    resilience: clamp(1 - input.congestionPercent / 150, 0, 1),
    deferredBacklog: 0,
    demandTrend: 0,
    weatherRisk: weatherRisk(record),
  };
  const weights = resolveRewardWeights(request);
  const values = policy.kind === 'q-table'
    ? combinedValues(policy, encodeState(state, record.capacity))
    : RL_ACTIONS.map((_, actionIndex) => {
      const sample = transition(state, actionIndex, record, undefined, () => 0.99, weights, false);
      return sample.reward;
    });
  const actionIndex = policy.kind === 'mpc'
    ? mpcAction(policy, state, [record, record, record], 0, weights)
    : argmax(values);
  return { actionIndex, values, action: RL_ACTIONS[actionIndex], state, record };
};
