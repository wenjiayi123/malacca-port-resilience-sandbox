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

export const submitRlPolicyInference = async (
  request: RlPolicyInferenceRequest,
  signal?: AbortSignal,
  authToken = '',
): Promise<RlPolicyInferenceResponse> => {
  const response = await fetch('/api/rl/inference', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) throw new Error(`RL inference HTTP ${response.status}`);
  const result = (await response.json()) as Partial<RlPolicyInferenceResponse>;
  if (
    result.protocolVersion !== 'rl-policy-inference.v2'
    || !Array.isArray(result.actionDistribution)
    || (result.admission?.status !== 'admitted' && result.admission?.status !== 'abstain')
    || !Array.isArray(result.admission?.blockers)
  ) {
    throw new Error('RL inference 返回协议无效');
  }
  return result as RlPolicyInferenceResponse;
};
