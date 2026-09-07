import { CORE_OPERATIONS_ACTION_HEADS, CORE_OPERATIONS_OBSERVATIONS, type CoreOperationsDomain } from '../shared/coreOperationsRlContract.ts';
import {
  CORE_TRAINING_KERNEL as K, CORE_OPERATIONS_EVALUATION_SCENARIOS, CORE_OPERATIONS_HOLD_CHOICES,
  buildTrainingCoreObservation, corePlanEffect, createHoldCorePlan, evaluateCorePolicy,
  projectCoreActionPlan, resolveCoreRuntimePlan,
  type CoreActionPlan, type CoreEnvironmentState, type CoreEvaluationResult,
  type CoreEvaluationScenarioId, type FactorizedCorePolicy,
} from './coreOperationsRlEngine.ts';
import type { PortBusinessRecord } from './portBusinessDataset.ts';

// Model-based approximate policy iteration, not imitation of an expert or live-port learning.
// Each target is a paired discounted simulator return with just one action head changed.
// Neither rewards, action effects nor business gates are changed by this learner.
export interface FittedIteration {
  iteration: number;
  modelTransitions: number;
  fittedTargets: number;
  targetRmse: number;
  probeActionChangePercent: number;
  validationReward: number;
  validationScore: number;
  maximumAbsoluteWeight: number;
}
export interface FittedTrainingResult {
  policy: FactorizedCorePolicy;
  curve: FittedIteration[];
  convergence: {
    passed: boolean;
    criterion: string;
    stableIterations: number;
    selectedIteration: number;
    validationRewardRange: number;
    maximumProbeChangePercent: number;
  };
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const round = (x: number) => Number(x.toFixed(8));
const clone = <T>(value: T): T => structuredClone(value);

/** Positive-definite ridge regression, solved without matrix inversion. */
export const ridgeFit = (features: number[][], targets: number[], ridge: number) => {
  if (!features.length || features.length !== targets.length || !(ridge > 0)) throw new Error('invalid ridge training batch');
  const n = features[0].length;
  const a = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  const b = Array(n).fill(0) as number[];
  for (let row = 0; row < features.length; row++) {
    const x = features[row];
    if (x.length !== n || ![...x, targets[row]].every(Number.isFinite)) throw new Error('non-finite fitted target');
    for (let i = 0; i < n; i++) {
      b[i] += x[i] * targets[row];
      for (let j = 0; j <= i; j++) a[i][j] += x[i] * x[j];
    }
  }
  const l = Array.from({ length: n }, () => Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let v = a[i][j] + (i === j ? ridge * features.length : 0);
    for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
    l[i][j] = i === j ? Math.sqrt(Math.max(v, 1e-15)) : v / l[j][j];
  }
  const y = Array(n).fill(0) as number[];
  for (let i = 0; i < n; i++) {
    let v = b[i];
    for (let j = 0; j < i; j++) v -= l[i][j] * y[j];
    y[i] = v / l[i][i];
  }
  const w = Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let v = y[i];
    for (let j = i + 1; j < n; j++) v -= l[j][i] * w[j];
    w[i] = v / l[i][i];
  }
  return w;
};

const choosePlan = (policy: FactorizedCorePolicy, record: PortBusinessRecord, state: CoreEnvironmentState, previous?: PortBusinessRecord) => {
  const obs = buildTrainingCoreObservation(record, state, previous);
  const x = K.planFeatures(obs.tensor);
  const plan = createHoldCorePlan();
  for (const head of policy.heads) {
    const allowed = K.applicableChoiceIndexes(head.domain, head.choiceIds, obs.tensor, obs.context);
    plan.choices[head.domain] = head.choiceIds[K.bestIndex(K.qValues(head.weights, x), allowed)];
  }
  return { plan, obs, x };
};
const executePlan = (state: CoreEnvironmentState, plan: CoreActionPlan, record: PortBusinessRecord) => {
  const obs = buildTrainingCoreObservation(record, state);
  const projection = projectCoreActionPlan(plan, obs.context);
  const effect = corePlanEffect(projection.executed);
  // Same aggregate throughput veto as runtime. No reward for an unexecutable joint plan.
  const executable = 100 * (1 - effect.defer - effect.divert) >= 98.5 ? projection.executed : createHoldCorePlan();
  return K.transition(state, executable, record, obs.context);
};
interface Sample { records: PortBusinessRecord[]; index: number; state: CoreEnvironmentState }

export const trainFittedCorePolicy = (
  train: PortBusinessRecord[], validation: PortBusinessRecord[],
  options: { seed: number; iterations?: number; samples?: number; rolloutHorizon?: number; ridge?: number; damping?: number; onIteration?: (point: FittedIteration) => void },
): FittedTrainingResult => {
  if (train.length < 16 || validation.length < 8) throw new Error('insufficient chronological records');
  const random = K.seededRandom(options.seed);
  const horizon = options.rolloutHorizon ?? 4;
  const iterations = options.iterations ?? 32;
  const sampleCount = options.samples ?? 256;
  const gamma = 0.9;
  const policy: FactorizedCorePolicy = {
    protocolVersion: 'factorized-core-operations-policy.v1', algorithmId: 'factorized-fitted-policy-iteration',
    observationIds: CORE_OPERATIONS_OBSERVATIONS.map((x) => x.id),
    heads: CORE_OPERATIONS_ACTION_HEADS.map((head) => ({ domain: head.id, choiceIds: head.choices.map((c) => c.id), weights: head.choices.map(() => Array(CORE_OPERATIONS_OBSERVATIONS.length + 1).fill(0)) })),
    hyperparameters: { learningRate: options.damping ?? 0.15, discountGamma: gamma, planningSteps: horizon, episodes: iterations, horizon, seed: options.seed },
    training: { environmentSteps: 0, parameterUpdates: 0, finalRewardEma: 0 },
  };
  const scenarios = CORE_OPERATIONS_EVALUATION_SCENARIOS.map((s) => K.scenarioRecords(train, s));
  const pool: Sample[] = [];
  // Fixed, train-only exploration pool prevents stochastic state sampling from impersonating learning.
  for (let i = 0; i < sampleCount; i++) {
    const records = scenarios[i % scenarios.length];
    const index = Math.floor(random() * (records.length - horizon - 8)) + 8;
    let state = K.initialState(records[index - 8]);
    for (let j = index - 8; j < index; j++) {
      const obs = buildTrainingCoreObservation(records[j], state, records[j - 1]);
      const plan = i % 3 === 0 ? K.sopPlan(obs.tensor, obs.context) : createHoldCorePlan();
      if (i % 3 === 1) for (const head of policy.heads) {
        const allowed = K.applicableChoiceIndexes(head.domain, head.choiceIds, obs.tensor, obs.context);
        plan.choices[head.domain] = head.choiceIds[allowed[Math.floor(random() * allowed.length)]];
      }
      state = executePlan(state, plan, records[j]).state;
      policy.training.environmentSteps++;
    }
    pool.push({ records, index, state });
  }
  let best = clone(policy);
  let bestScore = -Infinity;
  let selectedIteration = 0;
  let previousActions: string[] = [];
  const curve: FittedIteration[] = [];
  const rollout = (sample: Sample, first: CoreActionPlan, frozen: FactorizedCorePolicy) => {
    let state = clone(sample.state);
    let total = 0;
    for (let t = 0; t < horizon && sample.index + t < sample.records.length; t++) {
      const index = sample.index + t;
      const record = sample.records[index];
      const plan = t === 0 ? first : choosePlan(frozen, record, state, sample.records[index - 1]).plan;
      const result = executePlan(state, plan, record);
      total += gamma ** t * result.reward;
      state = result.state;
      policy.training.environmentSteps++;
    }
    // Finite model rollout: no future record wrapping and no fabricated terminal bootstrap.
    return total;
  };
  for (let iteration = 1; iteration <= iterations; iteration++) {
    const frozen = clone(policy);
    const batches = policy.heads.map((head) => head.choiceIds.map(() => ({ x: [] as number[][], y: [] as number[] })));
    for (const sample of pool) {
      const { plan, obs, x } = choosePlan(frozen, sample.records[sample.index], sample.state, sample.records[sample.index - 1]);
      for (let h = 0; h < policy.heads.length; h++) {
        const head = policy.heads[h];
        const allowed = K.applicableChoiceIndexes(head.domain, head.choiceIds, obs.tensor, obs.context);
        const hold = clone(plan);
        hold.choices[head.domain] = head.choiceIds[0];
        const baseline = rollout(sample, hold, frozen);
        for (const a of allowed.filter((a) => a > 0)) {
          const alternative = clone(plan);
          alternative.choices[head.domain] = head.choiceIds[a];
          const advantage = rollout(sample, alternative, frozen) - baseline;
          batches[h][a].x.push(x);
          batches[h][a].y.push(advantage);
        }
      }
    }
    let squaredError = 0;
    let targetCount = 0;
    for (let h = 0; h < policy.heads.length; h++) for (let a = 1; a < policy.heads[h].choiceIds.length; a++) {
      const batch = batches[h][a];
      if (!batch.x.length) continue;
      const fitted = ridgeFit(batch.x, batch.y, options.ridge ?? 0.03);
      const row = policy.heads[h].weights[a];
      for (let j = 0; j < row.length; j++) row[j] = row[j] * (1 - policy.hyperparameters.learningRate) + fitted[j] * policy.hyperparameters.learningRate;
      for (let i = 0; i < batch.x.length; i++) squaredError += (K.dot(row, batch.x[i]) - batch.y[i]) ** 2;
      targetCount += batch.y.length;
    }
    policy.training.parameterUpdates += targetCount;
    const actions = pool.flatMap((s) => Object.values(choosePlan(policy, s.records[s.index], s.state, s.records[s.index - 1]).plan.choices));
    const change = previousActions.length ? actions.filter((a, i) => a !== previousActions[i]).length / actions.length * 100 : 100;
    previousActions = actions;
    const evaluations = CORE_OPERATIONS_EVALUATION_SCENARIOS.map((s) => evaluateCorePolicy({ kind: 'reinforcement-learning', policy, ensemble: [policy] }, validation, s));
    const reward = mean(evaluations.map((r) => r.metrics.meanReward));
    const score = mean(evaluations.map((r) => r.metrics.meanReward - r.metrics.meanWaitingHours * 0.01 - r.metrics.energyCostIndex * 0.01));
    const point: FittedIteration = { iteration, modelTransitions: policy.training.environmentSteps, fittedTargets: targetCount,
      targetRmse: round(Math.sqrt(squaredError / Math.max(1, targetCount))), probeActionChangePercent: round(change),
      validationReward: round(reward), validationScore: round(score), maximumAbsoluteWeight: Math.max(...policy.heads.flatMap((h) => h.weights.flat().map(Math.abs))) };
    curve.push(point);
    if (score > bestScore + 1e-9) { best = clone(policy); bestScore = score; selectedIteration = iteration; }
    options.onIteration?.(point);
  }
  const tail = curve.slice(-5);
  const rewardRange = Math.max(...tail.map((p) => p.validationReward)) - Math.min(...tail.map((p) => p.validationReward));
  const maxChange = Math.max(...tail.map((p) => p.probeActionChangePercent));
  const stable = tail.filter((p) => p.probeActionChangePercent <= 2).length;
  best.training = { ...policy.training, finalRewardEma: curve[selectedIteration - 1].validationReward };
  return { policy: best, curve, convergence: {
    passed: tail.length === 5 && stable === 5 && rewardRange <= 0.003 && curve.every((p) => Number.isFinite(p.targetRmse) && p.maximumAbsoluteWeight < 10),
    criterion: 'last_5_iterations: action_change<=2_percent, validation_reward_range<=0.003, finite_weights<10; checkpoint_selected_on_validation_only',
    stableIterations: stable, selectedIteration, validationRewardRange: round(rewardRange), maximumProbeChangePercent: round(maxChange),
  } };
};

export const evaluateDeployedCore = (policies: FactorizedCorePolicy[], records: PortBusinessRecord[], scenario: CoreEvaluationScenarioId): CoreEvaluationResult =>
  evaluateCorePolicy({ kind: 'reinforcement-learning', policy: policies[0], ensemble: policies }, records, scenario);

export const coreEnsembleAgreement = (policies: FactorizedCorePolicy[], records: PortBusinessRecord[]) => {
  let state = K.initialState(records[0]);
  const votes: number[] = [];
  let blocked = 0;
  const reasons: Record<string, number> = {};
  const domainActions = Object.fromEntries(CORE_OPERATIONS_ACTION_HEADS.map((h) => [h.id, 0])) as Record<CoreOperationsDomain, number>;
  for (let i = 0; i < records.length; i++) {
    const obs = buildTrainingCoreObservation(records[i], state, records[i - 1]);
    const result = resolveCoreRuntimePlan(policies, obs.tensor, obs.context);
    votes.push(...result.inference.heads.map((h) => h.voteShare));
    if (!Object.values(result.checks).every(Boolean)) blocked++;
    for (const [name, passed] of Object.entries(result.checks)) if (!passed) reasons[name] = (reasons[name] ?? 0) + 1;
    for (const [domain, choice] of Object.entries(result.executedPlan.choices) as Array<[CoreOperationsDomain, string]>) if (choice !== CORE_OPERATIONS_HOLD_CHOICES[domain]) domainActions[domain]++;
    state = K.transition(state, result.executedPlan, records[i], obs.context).state;
  }
  return { meanVoteShare: mean(votes), belowMinimumVotePercent: votes.filter((v) => v < 0.6).length / votes.length * 100,
    blockedRecordPercent: blocked / records.length * 100, reasons, domainActions };
};
