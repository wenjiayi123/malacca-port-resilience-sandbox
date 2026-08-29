export interface XiaoyiRlAdvisorRequest {
  objectiveId?: string;
  objectiveLabel?: string;
  requestedCard?: string;
  scenario?: {
    peakCongestionPercent?: number;
    peakDelayMinutes?: number;
    carbonTons?: number;
    resilienceIndex?: number;
    injectedEvents?: number;
    windSpeedMs?: number;
    waveHeightM?: number;
  };
}

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

type Profile = XiaoyiRlAdvisorResponse['recommendation'] & {
  confidencePercent: number;
  operatorSummary: string;
  reasons: string[];
};

export type XiaoyiRlExternalDecision = Partial<
  Pick<
    XiaoyiRlAdvisorResponse['recommendation'],
    'algorithmId' | 'baselineId' | 'settingId' | 'backendMode' | 'backendEndpoint' | 'policyTestCaseId'
  >
> & {
  confidencePercent?: number;
  operatorSummary?: string;
  reasons?: string[];
  parameters?: Record<string, number>;
};

const baseParameters = {
  learningRate: 0.12,
  discountGamma: 0.97,
  maxEpisodes: 600,
  wallClockHours: 1,
  seed: 240520,
  rewardDelay: 0.28,
  rewardCongestion: 0.24,
  rewardCarbon: 0.18,
  rewardSafety: 0.2,
  rewardResilience: 0.1,
};

const algorithmLabels: Record<XiaoyiRlAdvisorResponse['recommendation']['algorithmId'], string> = {
  'q-learning': 'Q-Learning 离策略控制',
  sarsa: 'SARSA 在策略控制',
  'expected-sarsa': 'Expected SARSA 期望更新',
  'dyna-q': 'Dyna-Q 规划增强控制',
  mpc: '模型预测控制（MPC）',
};

const baselineLabels: Record<XiaoyiRlAdvisorResponse['recommendation']['baselineId'], string> = {
  'q-learning': 'Q-Learning',
  sarsa: 'SARSA',
  'expected-sarsa': 'Expected SARSA',
  'dyna-q': 'Dyna-Q',
  mpc: '模型预测控制（MPC）',
};

const algorithmIds = Object.keys(algorithmLabels) as Array<keyof typeof algorithmLabels>;
const baselineIds = Object.keys(baselineLabels) as Array<keyof typeof baselineLabels>;

const settingIds = [
  'network-snapshot',
  'vessel-state',
  'event-disturbance',
  'weather-sea-state',
  'congestion-delay',
  'carbon-reward',
  'dispatch-action',
  'validation-feedback',
] as const;

const policyTestCaseIds = [
  'closed-loop-replay',
  'peak-congestion-stress',
  'weather-disturbance-generalization',
] as const;

const backendModes = ['http', 'websocket', 'ray-service'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isAllowedValue = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === 'string' && allowed.includes(value as T);

export const parseXiaoyiRlExternalDecision = (answer?: string): XiaoyiRlExternalDecision | undefined => {
  if (!answer) return undefined;
  const jsonBlock = answer.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonBlock) return undefined;
  try {
    const parsed = JSON.parse(jsonBlock) as unknown;
    if (!isRecord(parsed)) return undefined;
    const candidate = isRecord(parsed.recommendation) ? parsed.recommendation : parsed;
    const decision: XiaoyiRlExternalDecision = {};
    if (isAllowedValue(candidate.algorithmId, algorithmIds)) {
      decision.algorithmId = candidate.algorithmId;
    }
    if (isAllowedValue(candidate.baselineId, baselineIds)) {
      decision.baselineId = candidate.baselineId;
    }
    if (isAllowedValue(candidate.settingId, settingIds)) decision.settingId = candidate.settingId;
    if (isAllowedValue(candidate.backendMode, backendModes)) decision.backendMode = candidate.backendMode;
    if (typeof candidate.backendEndpoint === 'string' && candidate.backendEndpoint.trim()) {
      decision.backendEndpoint = candidate.backendEndpoint.trim().slice(0, 240);
    }
    if (isAllowedValue(candidate.policyTestCaseId, policyTestCaseIds)) {
      decision.policyTestCaseId = candidate.policyTestCaseId;
    }
    if (typeof candidate.confidencePercent === 'number' && Number.isFinite(candidate.confidencePercent)) {
      decision.confidencePercent = Math.min(99, Math.max(50, candidate.confidencePercent));
    }
    if (typeof candidate.operatorSummary === 'string' && candidate.operatorSummary.trim()) {
      decision.operatorSummary = candidate.operatorSummary.trim().slice(0, 260);
    }
    if (Array.isArray(candidate.reasons)) {
      decision.reasons = candidate.reasons
        .filter((reason): reason is string => typeof reason === 'string' && Boolean(reason.trim()))
        .slice(0, 4)
        .map((reason) => reason.trim().slice(0, 120));
    }
    if (isRecord(candidate.parameters)) {
      decision.parameters = Object.entries(candidate.parameters).reduce<Record<string, number>>(
        (parameters, [key, value]) => {
          if (key in baseParameters && typeof value === 'number' && Number.isFinite(value)) {
            parameters[key] = value;
          }
          return parameters;
        },
        {},
      );
    }
    if (!decision.algorithmId && !decision.baselineId && !Object.keys(decision.parameters ?? {}).length) {
      return undefined;
    }
    return decision;
  } catch {
    return undefined;
  }
};

const mergeExternalDecision = (fallback: Profile, external?: XiaoyiRlExternalDecision): Profile => {
  if (!external) return fallback;
  const algorithmId = external.algorithmId ?? fallback.algorithmId;
  const baselineId = external.baselineId ?? fallback.baselineId;
  return {
    ...fallback,
    ...external,
    algorithmId,
    algorithmLabel: algorithmLabels[algorithmId],
    baselineId,
    baselineLabel: baselineLabels[baselineId],
    parameters: { ...fallback.parameters, ...(external.parameters ?? {}) },
    reasons: external.reasons?.length ? external.reasons : fallback.reasons,
  };
};

const profile = (
  overrides: Partial<Profile> & Pick<Profile, 'algorithmId' | 'algorithmLabel' | 'baselineId' | 'baselineLabel'>,
): Profile => ({
  settingId: 'network-snapshot',
  backendMode: 'http',
  backendEndpoint: '/api/rl/jobs',
  policyTestCaseId: 'closed-loop-replay',
  confidencePercent: 89,
  operatorSummary: '已按当前优化目标生成稳健的训练配置，可直接一键采用。',
  reasons: ['统一状态空间与奖励尺度', '保留安全约束和离线评估', '采用可复现随机种子与检查点'],
  ...overrides,
  parameters: { ...baseParameters, ...(overrides.parameters ?? {}) },
});

const selectProfile = (objectiveId = 'balanced-resilience', request: XiaoyiRlAdvisorRequest): Profile => {
  const stressed = (request.scenario?.peakCongestionPercent ?? 0) >= 78 || (request.scenario?.injectedEvents ?? 0) > 0;
  if (objectiveId === 'min-carbon' || objectiveId === 'energy-cost-control') {
    return profile({
      algorithmId: 'expected-sarsa', algorithmLabel: 'Expected SARSA 期望更新',
      baselineId: 'mpc', baselineLabel: '模型预测控制（MPC）', settingId: 'carbon-reward',
      parameters: { learningRate: 0.1, discountGamma: 0.97, maxEpisodes: 800, rewardDelay: 0.16, rewardCongestion: 0.14, rewardCarbon: 0.36, rewardSafety: 0.24, rewardResilience: 0.1 },
      confidencePercent: 93,
      operatorSummary: '优先推荐 Expected SARSA，以低方差价值更新学习低碳动作，并用 MPC 检查滚动优化收益。',
      reasons: ['碳排权重提高且仍保留安全惩罚', 'Expected SARSA降低下一动作抽样方差', 'MPC提供控制理论对照'],
    });
  }
  if (objectiveId === 'safety-first') {
    return profile({
      algorithmId: 'sarsa', algorithmLabel: 'SARSA 在策略控制',
      baselineId: 'mpc', baselineLabel: '模型预测控制（MPC）', settingId: 'event-disturbance',
      policyTestCaseId: 'weather-disturbance-generalization',
      parameters: { learningRate: 0.08, discountGamma: 0.99, maxEpisodes: 1000, rewardDelay: 0.12, rewardCongestion: 0.14, rewardCarbon: 0.08, rewardSafety: 0.48, rewardResilience: 0.18 },
      confidencePercent: 95,
      operatorSummary: '安全优先场景建议使用在策略 SARSA，并在从未参与训练或选优的天气扰动最终测试段检查违规项。',
      reasons: ['提高安全惩罚与韧性奖励', '在策略更新更贴近实际探索动作', '启用天气扰动泛化评估'],
    });
  }
  if (objectiveId === 'weather-robustness') {
    return profile({
      algorithmId: 'dyna-q', algorithmLabel: 'Dyna-Q 规划增强控制',
      baselineId: 'sarsa', baselineLabel: 'SARSA', settingId: 'weather-sea-state',
      policyTestCaseId: 'weather-disturbance-generalization',
      parameters: { learningRate: 0.1, discountGamma: 0.98, maxEpisodes: 1200, rewardDelay: 0.17, rewardCongestion: 0.16, rewardCarbon: 0.12, rewardSafety: 0.32, rewardResilience: 0.23 },
      confidencePercent: 91,
      operatorSummary: '气象样本有限时优先推荐 Dyna-Q，用已观测转移规划增强样本效率，并单独做天气扰动评估。',
      reasons: ['规划回放提高小数据集样本效率', '保留安全惩罚', '使用天气扰动泛化测试'],
    });
  }
  if (objectiveId === 'min-delay' || objectiveId === 'port-congestion-relief' || objectiveId === 'rapid-recovery') {
    return profile({
      algorithmId: 'dyna-q', algorithmLabel: 'Dyna-Q 规划增强控制',
      baselineId: 'mpc', baselineLabel: '模型预测控制（MPC）', settingId: 'event-disturbance',
      policyTestCaseId: 'peak-congestion-stress',
      parameters: { learningRate: 0.14, discountGamma: 0.98, maxEpisodes: 1000, rewardDelay: 0.32, rewardCongestion: 0.3, rewardCarbon: 0.08, rewardSafety: 0.16, rewardResilience: 0.14 },
      confidencePercent: stressed ? 96 : 92,
      operatorSummary: '拥堵恢复优先推荐 Dyna-Q 学习分流和到港窗口动作，并用 MPC 检查滚动控制边界。',
      reasons: ['模型回放提升拥堵扰动样本利用率', 'MPC提供控制理论对照', '峰值压力测试验证恢复速度'],
    });
  }
  if (objectiveId === 'fair-queueing') {
    return profile({
      algorithmId: 'expected-sarsa', algorithmLabel: 'Expected SARSA 期望更新',
      baselineId: 'sarsa', baselineLabel: 'SARSA', settingId: 'congestion-delay',
      policyTestCaseId: 'peak-congestion-stress',
      parameters: { learningRate: 0.1, discountGamma: 0.98, maxEpisodes: 900, rewardDelay: 0.3, rewardCongestion: 0.26, rewardCarbon: 0.06, rewardSafety: 0.18, rewardResilience: 0.2 },
      confidencePercent: 93,
      operatorSummary: '公平排队目标推荐 Expected SARSA，降低探索样本方差，并与在策略 SARSA 做一致数据对照。',
      reasons: ['期望更新降低单次动作抽样方差', 'SARSA提供在策略对照', '峰值压力测试检查长尾等待'],
    });
  }
  return profile({
    algorithmId: 'q-learning', algorithmLabel: 'Q-Learning 离策略控制',
    baselineId: 'mpc', baselineLabel: '模型预测控制（MPC）',
    confidencePercent: 94,
    operatorSummary: '均衡韧性目标先使用可解释的 Q-Learning，并以 MPC 作为独立控制理论基线。',
    reasons: ['价值表便于审计和直接导出', '奖励权重保持均衡', 'MPC提供非强化学习对照'],
  });
};

export const buildXiaoyiRlAdvisorResponse = (
  request: XiaoyiRlAdvisorRequest,
  external?: { connected: boolean; answer?: string; decision?: XiaoyiRlExternalDecision },
): XiaoyiRlAdvisorResponse => {
  const externalDecision = external?.decision;
  const recommendation = mergeExternalDecision(selectProfile(request.objectiveId, request), externalDecision);
  const source = externalDecision ? 'xiaoyi-ai-live' : 'embedded-xiaoyi-advisor';
  return {
    protocolVersion: 'xiaoyi-rl-advisor.v1', generatedAt: new Date().toISOString(), source,
    externalConnected: Boolean(external?.connected), externalAnswer: external?.answer,
    requestedCard: request.requestedCard ?? 'all', confidencePercent: recommendation.confidencePercent,
    operatorSummary: recommendation.operatorSummary, reasons: recommendation.reasons,
    recommendation,
    cardAdvice: {
      algorithm: `推荐 ${recommendation.algorithmLabel}：${recommendation.reasons[0]}`,
      baselines: `推荐 ${recommendation.baselineLabel}：用于形成可解释的A/B基线。`,
      settings: `训练信息聚焦 ${recommendation.settingId}，自动带入当前沙盘快照。`,
      parameters: `已生成价值更新步长、折扣因子、episode 数和六项奖励权重。`,
      backend: `内置服务使用 ${recommendation.backendEndpoint}；外部服务应实现相同 Job API 协议。`,
      progress: '进度只读取服务器实际完成的 episode、评估记录和检查点状态。',
      'policy-test': `训练完成后执行 ${recommendation.policyTestCaseId}。`,
      contract: '同步前检查算法、目标、状态空间、动作空间和奖励权重。',
    },
  };
};
