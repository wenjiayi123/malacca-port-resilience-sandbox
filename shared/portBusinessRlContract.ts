export const PORT_BUSINESS_RL_CONTRACT_VERSION = 'port-business-rl.v3' as const;

export type BusinessRlDomain =
  | 'arrival-flow'
  | 'berth-crane'
  | 'yard-gate'
  | 'navigation-resources'
  | 'energy-carbon'
  | 'intermodal-network'
  | 'disruption-recovery'
  | 'service-fairness';

export type ControlOwner =
  | 'reinforcement-learning-advisory'
  | 'deterministic-optimizer'
  | 'rules-and-safety-interlock'
  | 'external-authority'
  | 'human-approved-executor';

export interface BusinessObservationDefinition {
  id: string;
  group: BusinessRlDomain | 'data-assurance';
  range: readonly [number, number];
  description: string;
}

/**
 * Every value is normalized to the declared range before it reaches a policy.
 * The contract deliberately retains capacity slack, uncertainty and data
 * quality: a controller must know when the operating envelope is narrow or
 * when its evidence is weak, not only what the current queue looks like.
 */
export const PORT_BUSINESS_OBSERVATIONS = [
  { id: 'arrivals_to_capacity', group: 'arrival-flow', range: [0, 2.5], description: '当前到港需求与有效能力之比' },
  { id: 'arrival_trend', group: 'arrival-flow', range: [-1, 1], description: '近期到港需求变化率' },
  { id: 'eta_deviation', group: 'arrival-flow', range: [-1, 1], description: '计划与实际到港偏差' },
  { id: 'vessel_size_index', group: 'arrival-flow', range: [0, 2], description: '单船总吨位相对训练段中位数' },
  { id: 'queue_to_capacity', group: 'arrival-flow', range: [0, 3], description: '待服务船舶与有效能力之比' },
  { id: 'mean_waiting_hours_norm', group: 'arrival-flow', range: [0, 3], description: '平均等待时间相对二十四小时' },
  { id: 'p95_waiting_hours_norm', group: 'arrival-flow', range: [0, 4], description: '第九十五百分位等待时间相对二十四小时' },
  { id: 'deferred_backlog_to_capacity', group: 'arrival-flow', range: [0, 2], description: '错峰递延积压与能力之比' },
  { id: 'berth_utilization', group: 'berth-crane', range: [0, 1.2], description: '泊位利用率' },
  { id: 'berth_capacity_slack', group: 'berth-crane', range: [-1, 1], description: '泊位剩余能力比例' },
  { id: 'crane_productivity_index', group: 'berth-crane', range: [0, 1.5], description: '岸桥效率相对工程基线' },
  { id: 'crane_availability_ratio', group: 'berth-crane', range: [0, 1], description: '可用岸桥资源比例' },
  { id: 'yard_occupancy', group: 'yard-gate', range: [0, 1.2], description: '堆场占用率' },
  { id: 'yard_capacity_slack', group: 'yard-gate', range: [-1, 1], description: '堆场剩余容量比例' },
  { id: 'truck_turn_time_norm', group: 'yard-gate', range: [0, 3], description: '集卡周转时间相对六十分钟' },
  { id: 'gate_queue_pressure', group: 'yard-gate', range: [0, 2], description: '闸口排队压力' },
  { id: 'rail_transfer_pressure', group: 'intermodal-network', range: [0, 2], description: '海铁转运需求与能力之比' },
  { id: 'water_transfer_pressure', group: 'intermodal-network', range: [0, 2], description: '水水中转需求与能力之比' },
  { id: 'network_transfer_slack', group: 'intermodal-network', range: [-1, 1], description: '跨码头或邻港可转移能力余量' },
  { id: 'channel_available', group: 'navigation-resources', range: [0, 1], description: '航道可用状态' },
  { id: 'tide_window_open', group: 'navigation-resources', range: [0, 1], description: '潮窗开放状态' },
  { id: 'pilot_availability_ratio', group: 'navigation-resources', range: [0, 1], description: '引航资源可用比例' },
  { id: 'tug_availability_ratio', group: 'navigation-resources', range: [0, 1], description: '拖轮资源可用比例' },
  { id: 'metocean_risk', group: 'navigation-resources', range: [0, 1], description: '风浪流与能见度综合风险' },
  { id: 'hazmat_restriction_active', group: 'navigation-resources', range: [0, 1], description: '危险品或防污染限制状态' },
  { id: 'shore_power_availability', group: 'energy-carbon', range: [0, 1], description: '岸电资源可用比例' },
  { id: 'energy_carbon_intensity', group: 'energy-carbon', range: [0, 2], description: '单位服务量能源与碳强度' },
  { id: 'energy_price_index', group: 'energy-carbon', range: [0, 2], description: '能源与碳成本相对基线' },
  { id: 'capacity_loss_ratio', group: 'disruption-recovery', range: [0, 1], description: '扰动导致的能力损失比例' },
  { id: 'recovery_backlog_to_capacity', group: 'disruption-recovery', range: [0, 2], description: '待恢复积压与能力之比' },
  { id: 'service_fairness_gap', group: 'service-fairness', range: [0, 1], description: '不同船型服务水平最大差距' },
  { id: 'forecast_uncertainty', group: 'data-assurance', range: [0, 1], description: '需求预测不确定度' },
  { id: 'data_quality_score', group: 'data-assurance', range: [0, 1], description: '输入数据质量与完整度' },
] as const satisfies readonly BusinessObservationDefinition[];

export type BusinessObservationId = (typeof PORT_BUSINESS_OBSERVATIONS)[number]['id'];

export interface BusinessActionDefinition {
  id: string;
  label: string;
  domains: readonly BusinessRlDomain[];
  requiresHumanApproval: boolean;
  explanation: string;
}

/** These are bounded planning/advisory bundles, never direct helm or equipment commands. */
export const PORT_BUSINESS_ACTIONS = [
  { id: 'hold-plan', label: '保持计划', domains: ['arrival-flow'], requiresHumanApproval: false, explanation: '维持当前经批准的计划' },
  { id: 'eco-speed-advisory', label: '低碳航速建议', domains: ['arrival-flow', 'energy-carbon'], requiresHumanApproval: true, explanation: '在船方和船舶交通服务批准前只生成到港节奏建议' },
  { id: 'arrival-window-smooth', label: '错峰到港窗口', domains: ['arrival-flow', 'navigation-resources'], requiresHumanApproval: true, explanation: '在航道、潮窗和引拖资源允许时平滑到港' },
  { id: 'berth-reassign', label: '泊位重排建议', domains: ['berth-crane'], requiresHumanApproval: true, explanation: '在兼容性和安全规则内重排候选泊位' },
  { id: 'crane-rebalance', label: '岸桥资源再平衡', domains: ['berth-crane'], requiresHumanApproval: true, explanation: '在设备与工班包络内调整岸桥资源比例' },
  { id: 'yard-gate-smooth', label: '堆场闸口协同平滑', domains: ['yard-gate'], requiresHumanApproval: true, explanation: '缓解堆场高占用和集卡闸口峰值' },
  { id: 'pilot-tug-priority', label: '引航拖轮优先队列', domains: ['navigation-resources', 'service-fairness'], requiresHumanApproval: true, explanation: '仅调整准备顺序，不代替调度员发令' },
  { id: 'shore-power-priority', label: '岸电接入优先', domains: ['energy-carbon'], requiresHumanApproval: true, explanation: '在岸电容量可用时提高合格船舶优先级' },
  { id: 'intermodal-rebalance', label: '海铁水水联运再平衡', domains: ['yard-gate', 'intermodal-network'], requiresHumanApproval: true, explanation: '在转运能力内转移堆场压力' },
  { id: 'recovery-capacity', label: '扰动恢复能力调用', domains: ['berth-crane', 'yard-gate', 'disruption-recovery'], requiresHumanApproval: true, explanation: '按已批准应急预案调用有限恢复能力' },
  { id: 'neighbor-port-advisory', label: '邻港协同分流建议', domains: ['intermodal-network', 'disruption-recovery'], requiresHumanApproval: true, explanation: '只形成跨港协同建议，不代表对方港口接受' },
] as const satisfies readonly BusinessActionDefinition[];

export type BusinessActionId = (typeof PORT_BUSINESS_ACTIONS)[number]['id'];

export const PORT_BUSINESS_REWARD_COMPONENTS = [
  { id: 'service', direction: 'maximize', weight: 0.18, description: '服务水平与按期完成量' },
  { id: 'throughput', direction: 'maximize', weight: 0.14, description: '吞吐保持率' },
  { id: 'delay', direction: 'minimize', weight: 0.15, description: '平均与尾部等待' },
  { id: 'queue', direction: 'minimize', weight: 0.1, description: '排队与递延积压' },
  { id: 'carbon', direction: 'minimize', weight: 0.08, description: '单位服务量碳强度' },
  { id: 'energy_cost', direction: 'minimize', weight: 0.05, description: '能源和碳成本' },
  { id: 'yard_gate', direction: 'minimize', weight: 0.08, description: '堆场溢出与闸口超时' },
  { id: 'fairness', direction: 'minimize', weight: 0.07, description: '船型服务差距与饥饿' },
  { id: 'recovery', direction: 'maximize', weight: 0.09, description: '扰动恢复与能力韧性' },
  { id: 'intervention', direction: 'minimize', weight: 0.06, description: '动作成本、频繁切换和不必要干预' },
] as const;

export const PORT_BUSINESS_HARD_CONSTRAINTS = [
  'channel_closed_blocks_arrival_and_navigation_actions',
  'closed_tide_window_blocks_draft_sensitive_arrival_shift',
  'pilot_and_tug_shortage_blocks_navigation_priority',
  'hazmat_restriction_blocks_incompatible_berth_and_yard_actions',
  'yard_occupancy_cap_is_never_exceeded_by_admitted_transfer',
  'shore_power_action_requires_available_capacity',
  'neighbor_port_action_requires_declared_transfer_capacity',
  'emergency_stop_and_collision_avoidance_are_never_rl_actions',
  'official_inspection_release_and_customs_decisions_are_exogenous',
  'all_non_hold_actions_require_human_approval_before_execution',
] as const;

export const PORT_BUSINESS_RESPONSIBILITY_MATRIX = [
  { capability: '到港节奏、宏观资源组合与扰动恢复建议', owner: 'reinforcement-learning-advisory', learned: true },
  { capability: '泊位兼容、岸桥工班和资源守恒的可行排程', owner: 'deterministic-optimizer', learned: false },
  { capability: '航道潮窗、危险品、岸电容量、设备上限与紧急停止', owner: 'rules-and-safety-interlock', learned: false },
  { capability: '海事检查、海关查验、正式放行和船舶交通服务指令', owner: 'external-authority', learned: false },
  { capability: '身份鉴别、人工批准、生产下发、回执和回滚', owner: 'human-approved-executor', learned: false },
] as const satisfies readonly { capability: string; owner: ControlOwner; learned: boolean }[];

export const PORT_BUSINESS_AUTHORITY_BOUNDARY = {
  simulation_mode: true,
  public_data_anchored: true,
  terminal_measurements_available: false,
  live_data_verified: false,
  dispatch_allowed: false,
  production_authority: false,
  human_approval_required: true,
  official_release_exogenous: true,
  emergency_control_exogenous: true,
} as const;
