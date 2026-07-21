import type { PortTrainingDataset, PortTrainingRecord } from './portTrainingDataset.ts';

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
    wallClockHours?: number;
  };
  rewardWeights?: {
    delay?: number;
    congestion?: number;
    carbon?: number;
    safety?: number;
    resilience?: number;
  };
  scenarioSnapshot?: {
    scenarioId?: string;
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
  };
  evaluation: {
    meanReward: number;
    delayReductionPercent: number;
    congestionReductionPercent: number;
    carbonReductionPercent: number;
    resilienceGain: number;
    safetyViolations: number;
  };
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

interface RewardWeights {
  delay: number;
  congestion: number;
  carbon: number;
  safety: number;
  resilience: number;
}

interface EnvironmentState {
  queue: number;
  delayHours: number;
  carbonIndex: number;
  resilience: number;
  demandTrend: number;
  weatherRisk: number;
}

interface EnvironmentStep {
  state: EnvironmentState;
  reward: number;
  safetyViolation: number;
  arrivals: number;
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

export const RL_ACTIONS: ActionDefinition[] = [
  {
    id: 'hold-plan', label: '保持计划', detail: '按当前到港计划与可用能力执行',
    deferredDemand: 0, divertedDemand: 0, capacityMultiplier: 1, carbonMultiplier: 1, safetyModifier: 0,
  },
  {
    id: 'eco-speed', label: '低碳航速平滑', detail: '平滑到港波峰并降低单位运输碳强度',
    deferredDemand: 0.07, divertedDemand: 0, capacityMultiplier: 0.99, carbonMultiplier: 0.88, safetyModifier: -0.02,
  },
  {
    id: 'arrival-window', label: '错峰到港窗口', detail: '把部分到港需求后移至下一服务窗口',
    deferredDemand: 0.16, divertedDemand: 0, capacityMultiplier: 1.02, carbonMultiplier: 0.94, safetyModifier: -0.03,
  },
  {
    id: 'port-diversion', label: '邻港协同分流', detail: '把超出承载能力的船流分配至邻近港口',
    deferredDemand: 0, divertedDemand: 0.2, capacityMultiplier: 0.98, carbonMultiplier: 1.08, safetyModifier: 0.01,
  },
  {
    id: 'capacity-control', label: '泊位能力重配置', detail: '重排泊位与服务资源，短时提升可用能力',
    deferredDemand: 0.02, divertedDemand: 0, capacityMultiplier: 1.14, carbonMultiplier: 1.04, safetyModifier: 0.025,
  },
];

const RL_IDS: Array<Exclude<RlAlgorithmId, 'mpc'>> = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q'];
const STATE_SHAPE = [7, 6, 6, 5, 4] as const;

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
    bin(state.demandTrend, -0.25, 0.25, STATE_SHAPE[3]),
    bin(state.weatherRisk, 0, 1, STATE_SHAPE[4]),
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

const normalizeWeights = (request: RlTrainingRequest): RewardWeights => {
  const raw = {
    delay: request.rewardWeights?.delay ?? 0.28,
    congestion: request.rewardWeights?.congestion ?? 0.24,
    carbon: request.rewardWeights?.carbon ?? 0.18,
    safety: request.rewardWeights?.safety ?? 0.2,
    resilience: request.rewardWeights?.resilience ?? 0.1,
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
  const effectiveArrivals = arrivals * (1 - action.deferredDemand - action.divertedDemand);
  const serviceCapacity = record.capacity * action.capacityMultiplier;
  const queue = Math.max(0, state.queue + effectiveArrivals - serviceCapacity);
  const delayHours = queue / Math.max(1, serviceCapacity) * 24;
  const baselineTonnage = Math.max(1, record.grossTonnage);
  const processedRatio = effectiveArrivals / Math.max(1, record.arrivals);
  const carbonIndex = Math.max(0.4, processedRatio * action.carbonMultiplier + queue / Math.max(1, record.capacity) * 0.06);
  const risk = weatherRisk(record);
  const violationProbability = clamp(risk * 0.12 + action.safetyModifier + record.safetyIncidents / Math.max(1, record.arrivals), 0, 0.45);
  const safetyViolation = random() < violationProbability ? 1 : 0;
  const congestion = clamp(queue / Math.max(1, record.capacity), 0, 2.5);
  const resilience = clamp(1 - congestion * 0.45 - safetyViolation * 0.2, 0, 1);
  const carbonPenalty = Math.max(0, carbonIndex - 0.72);
  const reward =
    weights.resilience * resilience * 12 -
    weights.delay * clamp(delayHours / 48, 0, 2) * 12 -
    weights.congestion * congestion * 12 -
    weights.carbon * carbonPenalty * 10 -
    weights.safety * safetyViolation * 18 +
    Math.min(1.2, baselineTonnage / Math.max(1, arrivals) / 30) * 0.25;
  return {
    state: {
      queue,
      delayHours,
      carbonIndex,
      resilience,
      demandTrend: previous ? (record.arrivals - previous.arrivals) / Math.max(1, previous.arrivals) : 0,
      weatherRisk: risk,
    },
    reward,
    safetyViolation,
    arrivals,
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
    return { ...record, arrivals: record.arrivals * 1.24, capacity: record.capacity * 0.94 };
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
  meanCongestionPercent: number;
  carbonTotal: number;
  meanResilienceIndex: number;
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
      queueVessels: round(state.queue, 1),
      delayHours: round(state.delayHours, 2),
      congestionPercent: round(state.queue / Math.max(1, record.capacity) * 100, 2),
      carbonIndex: round(state.carbonIndex, 4),
      resilienceIndex: round(state.resilience * 100, 2),
      reward: round(sample.reward, 4),
      safetyViolation: sample.safetyViolation,
    });
  });
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    meanReward: mean(trace.map((point) => point.reward)),
    meanDelayHours: mean(trace.map((point) => point.delayHours)),
    meanCongestionPercent: mean(trace.map((point) => point.congestionPercent)),
    carbonTotal: trace.reduce((sum, point) => sum + point.carbonIndex, 0),
    meanResilienceIndex: mean(trace.map((point) => point.resilienceIndex)),
    safetyViolations: trace.reduce((sum, point) => sum + point.safetyViolation, 0),
    trace,
  };
};

const evaluationMetrics = (run: EvaluationRun, baseline: EvaluationRun): RlBenchmarkResult['evaluation'] => ({
  meanReward: round(run.meanReward, 3),
  delayReductionPercent: round((baseline.meanDelayHours - run.meanDelayHours) / Math.max(0.01, baseline.meanDelayHours) * 100, 2),
  congestionReductionPercent: round((baseline.meanCongestionPercent - run.meanCongestionPercent) / Math.max(0.01, baseline.meanCongestionPercent) * 100, 2),
  carbonReductionPercent: round((baseline.carbonTotal - run.carbonTotal) / Math.max(0.01, baseline.carbonTotal) * 100, 2),
  resilienceGain: round(run.meanResilienceIndex - baseline.meanResilienceIndex, 2),
  safetyViolations: run.safetyViolations,
});

const trainQPolicy = async (
  algorithmId: Exclude<RlAlgorithmId, 'mpc'>,
  records: PortTrainingRecord[],
  request: RlTrainingRequest,
  weights: RewardWeights,
  algorithmOffset: number,
  totalEpisodes: number,
  cumulativeEnvironmentSteps: number,
  cumulativeParameterUpdates: number,
  onProgress: (progress: TrainingProgress) => void,
  cancelled: () => boolean,
) => {
  const episodes = clamp(Math.round(request.trainingParameters?.maxEpisodes ?? 600), 120, 5_000);
  const alpha = clamp(request.trainingParameters?.learningRate ?? 0.12, 0.01, 0.5);
  const gamma = clamp(request.trainingParameters?.discountGamma ?? 0.97, 0.7, 0.999);
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
      const completedEpisodes = algorithmOffset * episodes + episode;
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
    },
  };
};

export const trainRlBenchmark = async (
  request: RlTrainingRequest,
  dataset: PortTrainingDataset,
  onProgress: (progress: TrainingProgress) => void,
  cancelled: () => boolean = () => false,
): Promise<RlTrainingArtifacts> => {
  const episodes = clamp(Math.round(request.trainingParameters?.maxEpisodes ?? 600), 120, 5_000);
  const totalEpisodes = episodes * RL_IDS.length;
  const weights = normalizeWeights(request);
  const policies = new Map<RlAlgorithmId, TrainedPolicy>();
  const trained = new Map<RlAlgorithmId, {
    curve: RlBenchmarkPoint[];
    training: RlBenchmarkResult['training'];
  }>();
  let cumulativeEnvironmentSteps = 0;
  let cumulativeParameterUpdates = 0;
  for (let index = 0; index < RL_IDS.length; index += 1) {
    const algorithmId = RL_IDS[index];
    const result = await trainQPolicy(
      algorithmId, dataset.trainRecords, request, weights, index, totalEpisodes,
      cumulativeEnvironmentSteps, cumulativeParameterUpdates, onProgress, cancelled,
    );
    policies.set(algorithmId, result.policy);
    trained.set(algorithmId, { curve: result.curve, training: result.training });
    cumulativeEnvironmentSteps += result.training.environmentSteps;
    cumulativeParameterUpdates += result.training.parameterUpdates;
  }
  const mpc = await calibrateMpc(
    dataset.trainRecords,
    totalEpisodes,
    cumulativeEnvironmentSteps,
    cumulativeParameterUpdates,
    onProgress,
  );
  policies.set('mpc', mpc.policy);
  trained.set('mpc', { curve: mpc.curve, training: mpc.training });
  cumulativeEnvironmentSteps += mpc.training.environmentSteps;
  cumulativeParameterUpdates += mpc.training.parameterUpdates;

  onProgress({
    phase: 'evaluating', progressPercent: 86, currentAlgorithmId: null,
    completedEpisodes: totalEpisodes, totalEpisodes,
    environmentSteps: cumulativeEnvironmentSteps,
    parameterUpdates: cumulativeParameterUpdates,
    rewardEma: null, samplesPerSecond: 0,
    message: `开始在验证集 ${dataset.split.validationRange.join(' → ')} 上统一选择算法`,
  });
  await sleepImmediate();
  const baseline = evaluatePolicy(null, dataset.validationRecords, weights, 88_001);
  const results: RlBenchmarkResult[] = [];
  for (let index = 0; index < RL_ALGORITHMS.length; index += 1) {
    if (cancelled()) throw new Error('training cancelled');
    const algorithm = RL_ALGORITHMS[index];
    const policy = policies.get(algorithm.id)!;
    const run = evaluatePolicy(policy, dataset.validationRecords, weights, 88_001);
    results.push({
      ...algorithm,
      curve: trained.get(algorithm.id)!.curve,
      training: trained.get(algorithm.id)!.training,
      evaluation: evaluationMetrics(run, baseline),
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
    (right.evaluation.meanReward - right.evaluation.safetyViolations * 2) -
    (left.evaluation.meanReward - left.evaluation.safetyViolations * 2))[0];
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
      quality: dataset.quality,
      recordCount: dataset.records.length,
      trainRecordCount: dataset.trainRecords.length,
      validationRecordCount: dataset.validationRecords.length,
      testRecordCount: dataset.testRecords.length,
      trainRange: dataset.split.trainRange,
      validationRange: dataset.split.validationRange,
      testRange: dataset.split.testRange,
    },
    selectionSplit: 'validation',
    results,
    notes: [
      'Q-Learning、SARSA、Expected SARSA 与 Dyna-Q 均执行了真实价值函数更新。',
      'MPC 是控制理论基线，使用训练段进行需求模型辨识并在每个验证/测试时刻滚动优化，不伪装成 RL。',
      '数据按时间顺序切为训练、验证、测试；训练只读取训练段，最优算法只由验证段选择。',
      '最终测试段不参与参数更新或算法选择，只在训练完成后的显式策略测试接口中读取并生成回放轨迹。',
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
  const weights = normalizeWeights(request);
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
    carbonIndex: clamp(input.carbonTons / Math.max(1, input.carbonTons), 0.65, 1.45),
    resilience: clamp(1 - input.congestionPercent / 150, 0, 1),
    demandTrend: 0,
    weatherRisk: weatherRisk(record),
  };
  const weights = normalizeWeights(request);
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
