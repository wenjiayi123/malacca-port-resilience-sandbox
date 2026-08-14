import type { RlAlgorithmId, RlBenchmarkResponse } from './rlTrainingEngine.ts';
import { RL_OPERATIONAL_CALIBRATION } from '../shared/rlOperationalCalibration.ts';

export type RlDisturbanceType = 'none' | 'arrival-surge' | 'weather-shock' | 'capacity-loss';
export type RlPolicyEventEffectMode = 'queue' | 'hold' | 'slow' | 'divert' | 'eco';

export interface RlPolicyInferenceEventContext {
  templateId?: string;
  label?: string;
  category?: string;
  scopeLabel?: string;
  effectMode?: RlPolicyEventEffectMode;
  effectLabel?: string;
  affectedVesselCount?: number;
  impact?: {
    incidentPressure?: number;
    congestionPoints?: number;
    delayMinutes?: number;
    speedKnotsDelta?: number;
    carbonPercentDelta?: number;
    weatherSeverity?: number;
  };
}

export interface RlPolicyInferenceRequest {
  protocolVersion?: string;
  requestId?: string;
  jobId?: string;
  algorithmId?: RlAlgorithmId;
  disturbance?: { type?: RlDisturbanceType; intensity?: number };
  eventContext?: RlPolicyInferenceEventContext | null;
  state?: {
    congestionPercent?: number;
    delayMinutes?: number;
    carbonTons?: number;
    resilienceIndex?: number;
    windSpeedMs?: number;
    waveHeightM?: number;
    visibilityKm?: number;
    queueVessels?: number;
    eventCount?: number;
  };
}

export interface TrainedPolicyDecision {
  algorithmId: RlAlgorithmId;
  benchmark: RlBenchmarkResponse;
  decision: {
    actionIndex: number;
    values: number[];
    action: {
      id: string;
      label: string;
      detail: string;
      deferredDemand: number;
      divertedDemand: number;
      capacityMultiplier: number;
      carbonMultiplier: number;
      safetyModifier: number;
    };
  };
}

export interface RlPolicyInferenceResponse {
  protocolVersion: 'rl-policy-inference.v2';
  requestId: string;
  generatedAt: string;
  model: {
    policyId: string;
    algorithm: string;
    checkpoint: string;
    architecture: string;
    trainingEpisodes: number;
    trainingSource: string;
    evaluationStatus: string;
  };
  inputTensor: Array<{ id: string; label: string; raw: number; normalized: number; unit: string }>;
  disturbance: { type: RlDisturbanceType; label: string; intensity: number };
  eventContext: RlPolicyInferenceEventContext | null;
  inference: {
    ensembleRuns: number;
    latencyMs: number;
    valueEstimate: number;
    policyEntropy: number;
    confidencePercent: number;
    safetyShield: string;
  };
  actionDistribution: Array<{
    id: string;
    label: string;
    probability: number;
    uncertainty: number;
    detail: string;
  }>;
  scenarioForecasts: Array<{
    id: string;
    label: string;
    probability: number;
    congestionPercent: number;
    delayMinutes: number;
    carbonDeltaTons: number;
    recoveryMinutes: number;
  }>;
  selectedAction: {
    id: string;
    label: string;
    probability: number;
    targetSpeedKnots: number;
    diversionPercent: number;
    arrivalShiftMinutes: number;
    affectedScope: string;
    rationale: string;
    commandSummary: string;
    executionSteps: string[];
  };
  comparison: {
    baseline: { congestionPercent: number; delayMinutes: number; carbonTons: number; resilienceIndex: number };
    policy: { congestionPercent: number; delayMinutes: number; carbonTons: number; resilienceIndex: number };
    improvement: { congestionPoints: number; delayMinutes: number; carbonTons: number; resiliencePoints: number };
  };
}

const ACTIONS = RL_OPERATIONAL_CALIBRATION.actions;

const disturbanceLabels: Record<RlDisturbanceType, string> = {
  none: '无附加扰动',
  'arrival-surge': '到港流量突增',
  'weather-shock': '风浪能见度冲击',
  'capacity-loss': '港口能力损失',
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const softmax = (values: number[]) => {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(clamp(value - maximum, -30, 30)));
  const total = exponentials.reduce((sum, value) => sum + value, 0) || 1;
  return exponentials.map((value) => value / total);
};

const actionProjection = (
  actionId: string,
  state: Required<NonNullable<RlPolicyInferenceRequest['state']>>,
  disturbanceIntensity: number,
) => {
  const action = ACTIONS.find((candidate) => candidate.id === actionId) ?? ACTIONS[0];
  const reliefFraction = action.deferredDemand
    + action.divertedDemand
    + Math.max(0, action.capacityMultiplier - 1);
  const stress = 1 + disturbanceIntensity * 0.2;
  const congestionRelief = Math.min(state.congestionPercent * 0.08, reliefFraction * 100) / stress;
  const delayRelief = Math.min(state.delayMinutes * 0.08, state.delayMinutes * reliefFraction * 2) / stress;
  const congestion = clamp(state.congestionPercent - congestionRelief, 0, 100);
  const delay = clamp(state.delayMinutes - delayRelief, 0, 999);
  const carbon = Math.max(0, state.carbonTons * action.carbonMultiplier);
  const resilience = clamp(state.resilienceIndex + reliefFraction * 20 / stress, 0, 100);
  return {
    congestion,
    delay,
    carbon,
    resilience,
    speed: action.targetSpeedKnots,
    diversion: action.divertedDemand * 100,
    shift: action.arrivalShiftMinutes,
  };
};

export const runRlPolicyInference = (
  request: RlPolicyInferenceRequest,
  trained: TrainedPolicyDecision,
): RlPolicyInferenceResponse => {
  const startedAt = performance.now();
  const rawState = request.state ?? {};
  const state = {
    congestionPercent: rawState.congestionPercent ?? 0,
    delayMinutes: rawState.delayMinutes ?? 0,
    carbonTons: rawState.carbonTons ?? 0,
    resilienceIndex: rawState.resilienceIndex ?? 0,
    windSpeedMs: rawState.windSpeedMs ?? 0,
    waveHeightM: rawState.waveHeightM ?? 0,
    visibilityKm: rawState.visibilityKm ?? 20,
    queueVessels: rawState.queueVessels ?? 0,
    eventCount: rawState.eventCount ?? 0,
  };
  const disturbanceType = request.disturbance?.type ?? 'none';
  const intensity = clamp(request.disturbance?.intensity ?? 0, 0, 1);
  const probabilities = softmax(trained.decision.values);
  const selectedIndex = (
    state.congestionPercent < 1
    && state.delayMinutes < 5
    && disturbanceType === 'none'
  )
    ? 0
    : trained.decision.actionIndex;
  const selectedAction = ACTIONS[selectedIndex] ?? ACTIONS[0];
  const projection = actionProjection(selectedAction.id, state, intensity);
  const entropy = -probabilities.reduce((sum, probability) =>
    sum + (probability > 0 ? probability * Math.log(probability) : 0), 0);
  const result = trained.benchmark.results.find((item) => item.id === trained.algorithmId)!;
  const inputTensor = [
    ['congestion', '拥堵率', state.congestionPercent, clamp(state.congestionPercent / 100, 0, 1), '%'],
    ['delay', '延误', state.delayMinutes, clamp(state.delayMinutes / 180, 0, 1), 'min'],
    ['carbon', '碳排', state.carbonTons, clamp(state.carbonTons / 1_000, 0, 1), 't'],
    ['resilience', '韧性', state.resilienceIndex, clamp(state.resilienceIndex / 100, 0, 1), ''],
    ['wind', '风速', state.windSpeedMs, clamp(state.windSpeedMs / 25, 0, 1), 'm/s'],
    ['wave', '浪高', state.waveHeightM, clamp(state.waveHeightM / 5, 0, 1), 'm'],
    ['visibility', '能见度', state.visibilityKm, clamp(state.visibilityKm / 20, 0, 1), 'km'],
    ['queue', '排队船舶', state.queueVessels, clamp(state.queueVessels / 80, 0, 1), '艘'],
  ].map(([id, label, raw, normalized, unit]) => ({
    id: String(id), label: String(label), raw: Number(raw), normalized: Number(normalized), unit: String(unit),
  }));
  const actionDistribution = ACTIONS.map((action, index) => ({
    ...action,
    probability: round(probabilities[index] ?? 0, 4),
    uncertainty: round(1 - (probabilities[index] ?? 0), 4),
  }));
  const weatherStress = clamp(
    state.windSpeedMs / 25 * 0.42 + state.waveHeightM / 5 * 0.38 + (1 - state.visibilityKm / 20) * 0.2,
    0,
    1,
  );
  const demandStress = clamp(state.queueVessels / 80 * 0.55 + state.congestionPercent / 100 * 0.45, 0, 1);
  const capacityStress = clamp(state.delayMinutes / 180 * 0.62 + state.eventCount / 8 * 0.38, 0, 1);
  const scenarioWeights = [
    { id: 'observed', label: '观测需求延续', weight: Math.max(0.2, 1.2 - (demandStress + capacityStress + weatherStress) / 3), factor: 1 },
    { id: 'demand-high', label: '到港需求上浮 5%', weight: 0.1 + demandStress, factor: 1.05 },
    { id: 'capacity-low', label: '服务能力下降 2%', weight: 0.1 + capacityStress, factor: 1.02 },
    { id: 'weather-stress', label: '气象风险加剧', weight: 0.1 + weatherStress, factor: 1.05 },
  ];
  const totalScenarioWeight = scenarioWeights.reduce((sum, scenario) => sum + scenario.weight, 0);
  const scenarioForecasts = scenarioWeights.map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    probability: round(scenario.weight / totalScenarioWeight, 4),
    congestionPercent: round(clamp(projection.congestion * scenario.factor, 0, 100), 1),
    delayMinutes: round(projection.delay * scenario.factor, 1),
    carbonDeltaTons: round(projection.carbon * scenario.factor - state.carbonTons, 2),
    recoveryMinutes: Math.round(clamp(45 + projection.congestion * 0.8 * scenario.factor, 30, 180)),
  })).sort((left, right) => right.probability - left.probability);
  return {
    protocolVersion: 'rl-policy-inference.v2',
    requestId: request.requestId ?? `policy-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    model: {
      policyId: `${trained.algorithmId}-${request.jobId}`,
      algorithm: trained.algorithmId,
      checkpoint: `job://${request.jobId}`,
      architecture: trained.algorithmId === 'mpc' ? '3-step receding-horizon controller' : 'discrete Q table',
      trainingEpisodes: result.training.episodes,
      trainingSource: `${trained.benchmark.dataset.label} / ${trained.benchmark.dataset.fingerprint}`,
      evaluationStatus: `chronological holdout ${trained.benchmark.dataset.testRange.join(' to ')}`,
    },
    inputTensor,
    disturbance: { type: disturbanceType, label: disturbanceLabels[disturbanceType], intensity },
    eventContext: request.eventContext ?? null,
    inference: {
      ensembleRuns: 1,
      latencyMs: round(performance.now() - startedAt, 3),
      valueEstimate: round(Math.max(...trained.decision.values), 4),
      policyEntropy: round(entropy, 4),
      confidencePercent: round((probabilities[selectedIndex] ?? 0) * 100, 1),
      safetyShield: '动作仍需通过港口容量、航行安全与人工确认约束',
    },
    actionDistribution,
    scenarioForecasts,
    selectedAction: {
      id: selectedAction.id,
      label: selectedAction.label,
      probability: round(probabilities[selectedIndex] ?? 0, 4),
      targetSpeedKnots: projection.speed,
      diversionPercent: projection.diversion,
      arrivalShiftMinutes: projection.shift,
      affectedScope: request.eventContext?.scopeLabel ?? '当前港航网络快照',
      rationale: `${selectedAction.detail}；动作来自 ${trained.algorithmId} 检查点的当前状态决策。`,
      commandSummary: `${selectedAction.label} / 目标航速 ${projection.speed.toFixed(1)}kn / 分流 ${projection.diversion}% / 到港偏移 ${projection.shift}min`,
      executionSteps: ['校验当前数据时间戳与容量边界', `生成候选动作 ${selectedAction.label}`, '通过安全约束后等待人工确认进入沙盘回放'],
    },
    comparison: {
      baseline: {
        congestionPercent: round(state.congestionPercent, 1),
        delayMinutes: round(state.delayMinutes, 1),
        carbonTons: round(state.carbonTons, 2),
        resilienceIndex: round(state.resilienceIndex, 1),
      },
      policy: {
        congestionPercent: round(projection.congestion, 1),
        delayMinutes: round(projection.delay, 1),
        carbonTons: round(projection.carbon, 2),
        resilienceIndex: round(projection.resilience, 1),
      },
      improvement: {
        congestionPoints: round(state.congestionPercent - projection.congestion, 1),
        delayMinutes: round(state.delayMinutes - projection.delay, 1),
        carbonTons: round(state.carbonTons - projection.carbon, 2),
        resiliencePoints: round(projection.resilience - state.resilienceIndex, 1),
      },
    },
  };
};
