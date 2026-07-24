import type { RlAlgorithmId, RlBenchmarkResponse } from './rlTrainingEngine.ts';

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

const ACTIONS = [
  { id: 'hold-plan', label: '保持计划', detail: '按当前到港计划与可用能力执行' },
  { id: 'eco-speed', label: '低碳航速平滑', detail: '平滑到港波峰并降低单位运输碳强度' },
  { id: 'arrival-window', label: '错峰到港窗口', detail: '把部分到港需求后移至下一服务窗口' },
  { id: 'port-diversion', label: '邻港协同分流', detail: '把超出承载能力的船流分配至邻近港口' },
  { id: 'capacity-control', label: '泊位能力重配置', detail: '重排泊位与服务资源，短时提升可用能力' },
] as const;

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
  const profiles: Record<string, { congestion: number; delay: number; carbon: number; resilience: number; speed: number; diversion: number; shift: number }> = {
    'hold-plan': { congestion: 0, delay: 0, carbon: 0, resilience: 0, speed: 12, diversion: 0, shift: 0 },
    'eco-speed': { congestion: 3, delay: 6, carbon: 0.12, resilience: 2.2, speed: 10.5, diversion: 0, shift: 10 },
    'arrival-window': { congestion: 12, delay: 14, carbon: 0.08, resilience: 7, speed: 11.4, diversion: 0, shift: 35 },
    'port-diversion': { congestion: 16, delay: 18, carbon: -0.04, resilience: 8.5, speed: 11.8, diversion: 20, shift: 12 },
    'capacity-control': { congestion: 13, delay: 16, carbon: -0.02, resilience: 7.5, speed: 12, diversion: 0, shift: 5 },
  };
  const profile = profiles[actionId] ?? profiles['hold-plan'];
  const stress = 1 + disturbanceIntensity * 0.2;
  const congestion = clamp(state.congestionPercent - profile.congestion / stress, 0, 100);
  const delay = clamp(state.delayMinutes - profile.delay / stress, 0, 999);
  const carbon = Math.max(0, state.carbonTons * (1 - profile.carbon));
  const resilience = clamp(state.resilienceIndex + profile.resilience / stress, 0, 100);
  return { ...profile, congestion, delay, carbon, resilience };
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
  const selectedIndex = trained.decision.actionIndex;
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
  const scenarioForecasts = [
    { id: 'observed', label: '观测需求延续', probability: 0.55, factor: 1 },
    { id: 'demand-high', label: '到港需求上浮 15%', probability: 0.2, factor: 1.15 },
    { id: 'capacity-low', label: '服务能力下降 15%', probability: 0.15, factor: 1.18 },
    { id: 'weather-stress', label: '气象风险加剧', probability: 0.1, factor: 1.1 },
  ].map((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    probability: scenario.probability,
    congestionPercent: round(clamp(projection.congestion * scenario.factor, 0, 100), 1),
    delayMinutes: round(projection.delay * scenario.factor, 1),
    carbonDeltaTons: round(projection.carbon * scenario.factor - state.carbonTons, 2),
    recoveryMinutes: Math.round(clamp(45 + projection.congestion * 0.8 * scenario.factor, 30, 180)),
  }));
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
      executionSteps: ['校验当前数据时间戳与容量边界', `生成候选动作 ${selectedAction.label}`, '通过安全约束后等待人工确认下发'],
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
