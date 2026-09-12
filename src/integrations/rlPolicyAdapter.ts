import { resolveRlServiceEndpoint } from './rlServiceEndpoint.ts';

export type RlDisturbanceType = 'none' | 'arrival-surge' | 'weather-shock' | 'capacity-loss';

export type RlPolicyEventEffectMode = 'queue' | 'hold' | 'slow' | 'divert' | 'eco';

export interface RlPolicyInferenceEventContext {
  templateId: string;
  label: string;
  category: string;
  scopeLabel: string;
  effectMode: RlPolicyEventEffectMode;
  effectLabel: string;
  affectedVesselCount: number;
  impact: {
    incidentPressure: number;
    congestionPoints: number;
    delayMinutes: number;
    speedKnotsDelta: number;
    carbonPercentDelta: number;
    weatherSeverity: number;
  };
}

export interface RlPolicyInferenceRequest {
  protocolVersion: 'rl-policy-inference.v2';
  requestId: string;
  jobId: string;
  algorithmId: 'q-learning' | 'sarsa' | 'expected-sarsa' | 'dyna-q' | 'mpc';
  disturbance: { type: RlDisturbanceType; intensity: number };
  eventContext: RlPolicyInferenceEventContext | null;
  state: {
    congestionPercent: number;
    delayMinutes: number;
    carbonTons: number;
    resilienceIndex: number;
    windSpeedMs: number;
    waveHeightM: number;
    visibilityKm: number;
    queueVessels: number;
    eventCount: number;
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
  admission: {
    status: 'admitted' | 'abstain';
    normalizedEntropy: number;
    thresholds: {
      minimumConfidencePercent: number;
      maximumNormalizedEntropy: number;
      requireBusinessNonRegression: true;
    };
    checks: {
      confidence: boolean;
      entropy: boolean;
      congestionNonRegression: boolean;
      delayNonRegression: boolean;
      carbonNonRegression: boolean;
      resilienceNonRegression: boolean;
    };
    blockers: string[];
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasStrings = (value: unknown, keys: string[]) =>
  isRecord(value) && keys.every((key) => typeof value[key] === 'string');
const hasNumbers = (value: unknown, keys: string[]) =>
  isRecord(value) && keys.every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]));
const isProbability = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const isStringArray = (value: unknown) => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isValidInferenceResponse = (value: unknown): value is RlPolicyInferenceResponse => {
  if (!isRecord(value) || !isRecord(value.inference) || !isRecord(value.admission) ||
    !isRecord(value.admission.thresholds) || !isRecord(value.admission.checks) ||
    !isRecord(value.selectedAction) || !isRecord(value.comparison)) return false;
  const { inference, admission, selectedAction, comparison } = value;
  const checks = admission.checks as Record<string, unknown>;
  const thresholds = admission.thresholds as Record<string, unknown>;
  return value.protocolVersion === 'rl-policy-inference.v2' && typeof value.requestId === 'string' &&
    typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt)) &&
    hasStrings(value.model, ['policyId', 'algorithm', 'checkpoint', 'architecture', 'trainingSource', 'evaluationStatus']) &&
    hasNumbers(value.model, ['trainingEpisodes']) &&
    Array.isArray(value.inputTensor) && value.inputTensor.every((entry) =>
      hasStrings(entry, ['id', 'label', 'unit']) && hasNumbers(entry, ['raw', 'normalized'])) &&
    hasNumbers(inference, ['ensembleRuns', 'latencyMs', 'valueEstimate', 'policyEntropy', 'confidencePercent']) &&
    Number(inference.latencyMs) >= 0 && Number(inference.ensembleRuns) >= 1 &&
    Number(inference.confidencePercent) >= 0 && Number(inference.confidencePercent) <= 100 &&
    typeof inference.safetyShield === 'string' &&
    (admission.status === 'admitted' || admission.status === 'abstain') &&
    isProbability(admission.normalizedEntropy) && isStringArray(admission.blockers) &&
    hasNumbers(thresholds, ['minimumConfidencePercent', 'maximumNormalizedEntropy']) &&
    thresholds.requireBusinessNonRegression === true &&
    ['confidence', 'entropy', 'congestionNonRegression', 'delayNonRegression', 'carbonNonRegression', 'resilienceNonRegression'].every((key) => typeof checks[key] === 'boolean') &&
    Array.isArray(value.actionDistribution) && value.actionDistribution.every((entry) =>
      isRecord(entry) && hasStrings(entry, ['id', 'label', 'detail']) && isProbability(entry.probability) && isProbability(entry.uncertainty)) &&
    Array.isArray(value.scenarioForecasts) && value.scenarioForecasts.every((entry) =>
      isRecord(entry) && hasStrings(entry, ['id', 'label']) && isProbability(entry.probability) &&
      hasNumbers(entry, ['congestionPercent', 'delayMinutes', 'carbonDeltaTons', 'recoveryMinutes'])) &&
    hasStrings(selectedAction, ['id', 'label', 'affectedScope', 'rationale', 'commandSummary']) &&
    hasNumbers(selectedAction, ['targetSpeedKnots', 'diversionPercent', 'arrivalShiftMinutes']) &&
    isProbability(selectedAction.probability) && isStringArray(selectedAction.executionSteps) &&
    hasNumbers(comparison.baseline, ['congestionPercent', 'delayMinutes', 'carbonTons', 'resilienceIndex']) &&
    hasNumbers(comparison.policy, ['congestionPercent', 'delayMinutes', 'carbonTons', 'resilienceIndex']) &&
    hasNumbers(comparison.improvement, ['congestionPoints', 'delayMinutes', 'carbonTons', 'resiliencePoints']) &&
    (value.eventContext === null || hasStrings(value.eventContext, ['label'])) &&
    hasStrings(value.disturbance, ['type', 'label']) && hasNumbers(value.disturbance, ['intensity']);
};

export const submitRlPolicyInference = async (
  request: RlPolicyInferenceRequest,
  signal?: AbortSignal,
  authToken = '',
  endpoint = '/api/rl/jobs',
): Promise<RlPolicyInferenceResponse> => {
  const response = await fetch(resolveRlServiceEndpoint(endpoint, 'inference'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(request),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(typeof payload?.error === 'string' ? payload.error : `RL inference HTTP ${response.status}`);
  }
  const result: unknown = await response.json();
  if (!isValidInferenceResponse(result) || result.requestId !== request.requestId) {
    throw new Error('RL inference 返回协议无效');
  }
  return result;
};
