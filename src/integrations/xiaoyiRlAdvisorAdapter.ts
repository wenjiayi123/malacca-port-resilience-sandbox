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
  const response = await fetch('/api/xiaoyi/rl-advisor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response.ok) throw new Error(`小懿RL顾问 HTTP ${response.status}`);
  const result = (await response.json()) as Partial<XiaoyiRlAdvisorResponse>;
  if (result.protocolVersion !== 'xiaoyi-rl-advisor.v1' || !result.recommendation) {
    throw new Error('小懿RL顾问返回协议无效');
  }
  return result as XiaoyiRlAdvisorResponse;
};
