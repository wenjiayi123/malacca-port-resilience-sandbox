export interface XiaoyiRlAdvisorResponse {
  protocolVersion: 'xiaoyi-rl-advisor.v1';
  generatedAt: string;
  source: 'xiaoyi-ai-live' | 'embedded-xiaoyi-advisor';
  externalConnected: boolean;
  externalAnswer?: string;
  requestedCard: string;
  confidencePercent: number;
  operatorSummary: string;
  reasons: string[];
  recommendation: {
    algorithmId: 'q-learning' | 'sarsa' | 'expected-sarsa' | 'dyna-q' | 'mpc';
    algorithmLabel: string;
    baselineId: 'q-learning' | 'sarsa' | 'expected-sarsa' | 'dyna-q' | 'mpc';
    baselineLabel: string;
    settingId: string;
    backendMode: 'http' | 'websocket' | 'ray-service';
    backendEndpoint: string;
    policyTestCaseId: 'closed-loop-replay' | 'peak-congestion-stress' | 'weather-disturbance-generalization';
    parameters: Record<string, number>;
  };
  cardAdvice: Record<string, string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isAdvisorResponse = (value: unknown): value is XiaoyiRlAdvisorResponse => {
  if (!isRecord(value) || !isRecord(value.recommendation)) return false;
  const recommendation = value.recommendation;
  const parameters = recommendation.parameters;
  const algorithmIds = ['q-learning', 'sarsa', 'expected-sarsa', 'dyna-q', 'mpc'];
  return value.protocolVersion === 'xiaoyi-rl-advisor.v1' &&
    typeof value.generatedAt === 'string' && Number.isFinite(Date.parse(value.generatedAt)) &&
    ['xiaoyi-ai-live', 'embedded-xiaoyi-advisor'].includes(String(value.source)) &&
    typeof value.externalConnected === 'boolean' &&
    (value.externalAnswer === undefined || typeof value.externalAnswer === 'string') &&
    typeof value.requestedCard === 'string' &&
    typeof value.confidencePercent === 'number' && Number.isFinite(value.confidencePercent) &&
    value.confidencePercent >= 0 && value.confidencePercent <= 100 &&
    typeof value.operatorSummary === 'string' && isStringArray(value.reasons) &&
    algorithmIds.includes(String(recommendation.algorithmId)) &&
    algorithmIds.includes(String(recommendation.baselineId)) &&
    typeof recommendation.algorithmLabel === 'string' && typeof recommendation.baselineLabel === 'string' &&
    ['network-snapshot', 'vessel-state', 'event-disturbance', 'weather-sea-state', 'congestion-delay', 'carbon-reward', 'dispatch-action', 'micro-validation'].includes(String(recommendation.settingId)) &&
    ['http', 'websocket', 'ray-service'].includes(String(recommendation.backendMode)) &&
    typeof recommendation.backendEndpoint === 'string' && Boolean(recommendation.backendEndpoint.trim()) &&
    ['closed-loop-replay', 'peak-congestion-stress', 'weather-disturbance-generalization'].includes(String(recommendation.policyTestCaseId)) &&
    isRecord(parameters) &&
    ['learningRate', 'discountGamma', 'maxEpisodes', 'wallClockHours', 'seed', 'rewardDelay', 'rewardCongestion', 'rewardCarbon', 'rewardSafety', 'rewardResilience', 'rewardThroughput'].every((key) => typeof parameters[key] === 'number' && Number.isFinite(parameters[key])) &&
    Object.values(parameters).every((item) => typeof item === 'number' && Number.isFinite(item)) &&
    isRecord(value.cardAdvice) && Object.values(value.cardAdvice).every((item) => typeof item === 'string');
};

export const requestXiaoyiRlAdvice = async (
  payload: {
    objectiveId: string;
    objectiveLabel: string;
    requestedCard: string;
    scenario: Record<string, number>;
  },
  signal?: AbortSignal,
  authToken = '',
): Promise<XiaoyiRlAdvisorResponse> => {
  const timeout = AbortSignal.timeout(12_000);
  const response = await fetch('/api/xiaoyi/rl-advisor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => null) as unknown;
    throw new Error(`小懿RL顾问 HTTP ${response.status}${isRecord(failure) && typeof failure.message === 'string' ? `：${failure.message}` : ''}`);
  }
  const result: unknown = await response.json();
  if (!isAdvisorResponse(result) || result.requestedCard !== payload.requestedCard) {
    throw new Error('小懿RL顾问返回协议无效');
  }
  return result;
};
