export const CORE_OPERATIONS_RL_CONTRACT_VERSION = 'core-operations-rl.v1' as const;

export type CoreOperationsDomain =
  | 'arrival-flow'
  | 'berth-crane'
  | 'yard-gate'
  | 'horizontal-transport'
  | 'navigation-resources'
  | 'energy-storage'
  | 'reefer-building-load'
  | 'equipment-maintenance'
  | 'intermodal-network'
  | 'disruption-recovery';

export interface CoreObservationDefinition {
  id: string;
  domain: CoreOperationsDomain | 'data-assurance';
  range: readonly [number, number];
  description: string;
}

/**
 * Runtime values are normalized against these explicit envelopes before they
 * reach the factorized value functions.  The fields cover the state that the
 * operational simulator actually advances; none is a display-only feature.
 */
export const CORE_OPERATIONS_OBSERVATIONS = [
  { id: 'arrivals_to_capacity', domain: 'arrival-flow', range: [0, 3], description: '到港需求与有效服务能力之比' },
  { id: 'arrival_trend', domain: 'arrival-flow', range: [-1, 1], description: '当前到港相对上一时段的变化率' },
  { id: 'queue_to_capacity', domain: 'arrival-flow', range: [0, 6], description: '锚地及码头队列相对有效能力' },
  { id: 'delay_hours', domain: 'arrival-flow', range: [0, 8], description: '当前平均等待小时' },
  { id: 'forecast_arrivals_to_capacity', domain: 'arrival-flow', range: [0, 3], description: '最近预测到港量相对能力' },
  { id: 'berth_utilization', domain: 'berth-crane', range: [0, 1.2], description: '泊位利用率' },
  { id: 'crane_productivity_index', domain: 'berth-crane', range: [0, 1.6], description: '岸桥效率相对每小时二十八自然箱基线' },
  { id: 'crane_availability_ratio', domain: 'berth-crane', range: [0, 1], description: '可用岸桥比例' },
  { id: 'service_level', domain: 'berth-crane', range: [0, 1], description: '当前服务履约率' },
  { id: 'yard_occupancy', domain: 'yard-gate', range: [0, 1.2], description: '堆场占用率' },
  { id: 'yard_reshuffle_pressure', domain: 'yard-gate', range: [0, 2], description: '翻箱作业相对工程上限' },
  { id: 'truck_turn_time_hours', domain: 'yard-gate', range: [0, 3], description: '集卡周转小时' },
  { id: 'gate_queue_pressure', domain: 'yard-gate', range: [0, 2], description: '闸口排队压力' },
  { id: 'agv_availability_ratio', domain: 'horizontal-transport', range: [0, 1], description: '自动导引运输车可用比例' },
  { id: 'terminal_truck_availability_ratio', domain: 'horizontal-transport', range: [0, 1], description: '场内集卡可用比例' },
  { id: 'rtg_availability_ratio', domain: 'horizontal-transport', range: [0, 1], description: '轮胎式龙门起重机可用比例' },
  { id: 'channel_available', domain: 'navigation-resources', range: [0, 1], description: '航道可用状态' },
  { id: 'tide_window_open', domain: 'navigation-resources', range: [0, 1], description: '潮窗开放状态' },
  { id: 'pilot_availability_ratio', domain: 'navigation-resources', range: [0, 1], description: '引航资源可用比例' },
  { id: 'tug_availability_ratio', domain: 'navigation-resources', range: [0, 1], description: '拖轮资源可用比例' },
  { id: 'wind_risk', domain: 'navigation-resources', range: [0, 1], description: '风速相对安全包络' },
  { id: 'wave_risk', domain: 'navigation-resources', range: [0, 1], description: '浪高相对安全包络' },
  { id: 'visibility_risk', domain: 'navigation-resources', range: [0, 1], description: '低能见度风险' },
  { id: 'current_risk', domain: 'navigation-resources', range: [0, 1], description: '流速相对安全包络' },
  { id: 'hazmat_restriction_active', domain: 'navigation-resources', range: [0, 1], description: '危险品限制状态' },
  { id: 'grid_load_ratio', domain: 'energy-storage', range: [0, 1.2], description: '电网负荷相对变压器容量' },
  { id: 'transformer_loading', domain: 'energy-storage', range: [0, 1.2], description: '变压器负载率' },
  { id: 'shore_power_load_ratio', domain: 'energy-storage', range: [0, 1], description: '岸电负荷相对六兆瓦工程包络' },
  { id: 'solar_supply_ratio', domain: 'energy-storage', range: [0, 1], description: '光伏出力相对当前电网负荷' },
  { id: 'battery_soc', domain: 'energy-storage', range: [0, 1], description: '储能荷电状态' },
  { id: 'battery_soh', domain: 'energy-storage', range: [0, 1], description: '储能健康状态' },
  { id: 'energy_price_index', domain: 'energy-storage', range: [0, 2], description: '电价相对常规时段' },
  { id: 'grid_carbon_index', domain: 'energy-storage', range: [0, 2], description: '电网碳因子相对工程基线' },
  { id: 'reefer_inventory_pressure', domain: 'reefer-building-load', range: [0, 2], description: '冷藏箱数量相对插座工程基线' },
  { id: 'reefer_power_ratio', domain: 'reefer-building-load', range: [0, 1], description: '冷藏箱负荷相对三兆瓦工程包络' },
  { id: 'building_flexible_load_ratio', domain: 'reefer-building-load', range: [0, 1], description: '暖通与照明可调负荷比例' },
  { id: 'active_fault_ratio', domain: 'equipment-maintenance', range: [0, 1], description: '活动设备故障相对关键设备池' },
  { id: 'maintenance_due_ratio', domain: 'equipment-maintenance', range: [0, 1], description: '待维护任务相对工程上限' },
  { id: 'rail_transfer_pressure', domain: 'intermodal-network', range: [0, 2], description: '海铁转运需求压力' },
  { id: 'water_transfer_pressure', domain: 'intermodal-network', range: [0, 2], description: '水水转运需求压力' },
  { id: 'recovery_backlog_pressure', domain: 'disruption-recovery', range: [0, 3], description: '扰动恢复积压相对有效能力' },
  { id: 'safety_risk', domain: 'disruption-recovery', range: [0, 1], description: '安全风险评分' },
  { id: 'resilience_index', domain: 'disruption-recovery', range: [0, 1], description: '运行韧性指数' },
  { id: 'communication_available', domain: 'data-assurance', range: [0, 1], description: '控制通信链可用状态' },
  { id: 'communication_latency', domain: 'data-assurance', range: [0, 1], description: '通信延迟相对两秒门槛' },
  { id: 'data_quality_score', domain: 'data-assurance', range: [0, 1], description: '输入字段完整性与一致性' },
  { id: 'forecast_uncertainty', domain: 'data-assurance', range: [0, 1], description: '需求预测相对不确定度' },
] as const satisfies readonly CoreObservationDefinition[];

export type CoreObservationId = (typeof CORE_OPERATIONS_OBSERVATIONS)[number]['id'];

export interface CoreActionChoiceDefinition {
  id: string;
  label: string;
  explanation: string;
}

export interface CoreActionHeadDefinition {
  id: CoreOperationsDomain;
  label: string;
  choices: readonly CoreActionChoiceDefinition[];
}

/** Each head emits one bounded advisory choice, so all domains can act in the same interval. */
export const CORE_OPERATIONS_ACTION_HEADS = [
  { id: 'arrival-flow', label: '到港节奏', choices: [
    { id: 'arrival-hold', label: '保持到港计划', explanation: '不改变已经批准的到港计划' },
    { id: 'eco-speed-window', label: '低碳航速窗口', explanation: '建议船方在许可范围内调整航速' },
    { id: 'arrival-smoothing', label: '错峰到港', explanation: '在潮窗与航道许可下平滑到港峰值' },
  ] },
  { id: 'berth-crane', label: '泊位岸桥', choices: [
    { id: 'berth-crane-hold', label: '保持泊位岸桥计划', explanation: '维持当前可行排程' },
    { id: 'berth-reassign', label: '泊位重排建议', explanation: '由确定性兼容校验器投影后提交人工批准' },
    { id: 'crane-rebalance', label: '岸桥再平衡', explanation: '在工班和设备包络内调整岸桥资源' },
  ] },
  { id: 'yard-gate', label: '堆场闸口', choices: [
    { id: 'yard-gate-hold', label: '保持堆场闸口计划', explanation: '维持现有箱区与预约计划' },
    { id: 'yard-block-rebalance', label: '箱区再平衡', explanation: '缓解高占用箱区并限制额外翻箱' },
    { id: 'gate-slot-smoothing', label: '闸口预约平滑', explanation: '调整沙盘闸口预约负荷' },
  ] },
  { id: 'horizontal-transport', label: '水平运输', choices: [
    { id: 'horizontal-hold', label: '保持运输编组', explanation: '维持当前自动导引运输车与集卡编组' },
    { id: 'agv-rebalance', label: '自动导引运输车再平衡', explanation: '在可用率和安全包络内重分配车辆' },
    { id: 'truck-pool-rebalance', label: '场内集卡池再平衡', explanation: '缓解岸桥与堆场间运输瓶颈' },
  ] },
  { id: 'navigation-resources', label: '航道引拖', choices: [
    { id: 'navigation-hold', label: '保持引拖顺序', explanation: '维持当前引航拖轮准备顺序' },
    { id: 'pilot-tug-priority', label: '引航拖轮优先', explanation: '只调整准备优先级，不代替船舶交通服务发令' },
    { id: 'tide-window-sequence', label: '潮窗序列优化', explanation: '在水深、航道和主管机关许可下排序候选船舶' },
  ] },
  { id: 'energy-storage', label: '岸电储能', choices: [
    { id: 'energy-hold', label: '保持能源计划', explanation: '维持当前岸电与储能计划' },
    { id: 'shore-power-priority', label: '岸电优先', explanation: '在电网容量和船岸兼容条件内提高岸电优先级' },
    { id: 'battery-peak-shave', label: '储能削峰', explanation: '在荷电状态和健康状态包络内削减峰值' },
  ] },
  { id: 'reefer-building-load', label: '冷藏箱与楼宇负荷', choices: [
    { id: 'flex-load-hold', label: '保持柔性负荷', explanation: '维持冷藏箱和楼宇负荷计划' },
    { id: 'reefer-load-coordinate', label: '冷藏箱负荷协同', explanation: '保持温控服务前提下平滑除霜与辅助负荷' },
    { id: 'building-demand-response', label: '楼宇需求响应', explanation: '在舒适和照度边界内平移可调负荷' },
  ] },
  { id: 'equipment-maintenance', label: '设备维护', choices: [
    { id: 'maintenance-hold', label: '保持维护计划', explanation: '维持当前维护窗口' },
    { id: 'preventive-maintenance-window', label: '预防维护窗口', explanation: '在低负荷窗口安排到期维护' },
    { id: 'fault-recovery-priority', label: '故障恢复优先', explanation: '提高已确认故障设备的恢复资源优先级' },
  ] },
  { id: 'intermodal-network', label: '海铁水水联运', choices: [
    { id: 'intermodal-hold', label: '保持联运计划', explanation: '维持当前铁路与驳船计划' },
    { id: 'rail-barge-rebalance', label: '海铁水水再平衡', explanation: '在声明能力内转移堆场压力' },
    { id: 'neighbor-port-advisory', label: '邻港协同建议', explanation: '只形成跨港协同提议，不代表对方接受' },
  ] },
  { id: 'disruption-recovery', label: '扰动恢复', choices: [
    { id: 'recovery-hold', label: '保持恢复计划', explanation: '维持已批准应急恢复计划' },
    { id: 'recovery-capacity', label: '恢复能力调用', explanation: '按应急预案调用有限恢复能力' },
    { id: 'controlled-backlog-release', label: '受控积压释放', explanation: '按服务公平和容量约束释放积压' },
  ] },
] as const satisfies readonly CoreActionHeadDefinition[];

export type CoreActionChoiceId = (typeof CORE_OPERATIONS_ACTION_HEADS)[number]['choices'][number]['id'];

export const CORE_OPERATIONS_REWARD_COMPONENTS = [
  { id: 'service', weight: 0.12, direction: 'maximize', description: '服务履约率' },
  { id: 'throughput', weight: 0.10, direction: 'maximize', description: '吞吐保持率' },
  { id: 'delay', weight: 0.12, direction: 'minimize', description: '平均与尾部等待' },
  { id: 'queue', weight: 0.08, direction: 'minimize', description: '排队与积压' },
  { id: 'yard_gate', weight: 0.08, direction: 'minimize', description: '堆场溢出与闸口超时' },
  { id: 'horizontal_transport', weight: 0.06, direction: 'maximize', description: '水平运输可用与周转效率' },
  { id: 'energy_cost', weight: 0.07, direction: 'minimize', description: '能源成本' },
  { id: 'peak_grid', weight: 0.06, direction: 'minimize', description: '电网峰值负荷' },
  { id: 'carbon', weight: 0.07, direction: 'minimize', description: '碳排放强度' },
  { id: 'reefer_service', weight: 0.05, direction: 'maximize', description: '冷藏箱温控服务保持' },
  { id: 'maintenance', weight: 0.07, direction: 'minimize', description: '故障与到期维护积压' },
  { id: 'fairness', weight: 0.05, direction: 'minimize', description: '服务饥饿与资源偏置' },
  { id: 'recovery', weight: 0.05, direction: 'maximize', description: '扰动恢复速度' },
  { id: 'intervention', weight: 0.02, direction: 'minimize', description: '无效干预与频繁切换' },
] as const;

export const CORE_OPERATIONS_HARD_CONSTRAINTS = [
  'channel_or_tide_closure_blocks_arrival_and_navigation_changes',
  'pilot_and_tug_shortage_blocks_navigation_priority',
  'hazmat_restriction_blocks_incompatible_yard_and_horizontal_changes',
  'yard_occupancy_never_exceeds_physical_capacity',
  'equipment_rebalance_requires_available_assets',
  'shore_power_never_exceeds_transformer_capacity',
  'battery_soc_remains_between_15_and_95_percent',
  'battery_peak_shave_requires_minimum_state_of_health',
  'reefer_temperature_service_is_not_shed_by_rl',
  'neighbor_port_and_intermodal_actions_require_declared_capacity',
  'maintenance_action_cannot_bypass_lockout_tagout_or_emergency_interlock',
  'collision_avoidance_emergency_stop_and_official_release_are_not_rl_actions',
  'every_non_hold_domain_action_requires_human_approval_before_execution',
] as const;

export const CORE_OPERATIONS_AUTHORITY_BOUNDARY = {
  simulation_mode: true,
  live_data_verified: false,
  dispatch_allowed: false,
  production_authority: false,
  human_approval_required: true,
  direct_navigation_control: false,
  direct_equipment_control: false,
  regulatory_authority: false,
  independent_safety_interlock_authoritative: true,
} as const;
