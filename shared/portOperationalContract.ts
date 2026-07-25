export const PORT_OPERATIONAL_CONTRACT_VERSION = 'terminal-operations.v2' as const;

export type PortOperationalField =
  | 'port_id'
  | 'terminal_id'
  | 'timestamp'
  | 'arrivals'
  | 'gross_tonnage'
  | 'effective_service_capacity'
  | 'queue_vessels'
  | 'average_waiting_hours'
  | 'berth_utilization_percent'
  | 'yard_occupancy_percent'
  | 'quay_crane_moves_per_hour'
  | 'truck_turn_time_minutes'
  | 'rail_transfer_teu'
  | 'water_transfer_teu'
  | 'planned_eta'
  | 'actual_eta'
  | 'channel_available'
  | 'tide_window_open'
  | 'pilot_available_count'
  | 'tug_available_count'
  | 'wind_speed_ms'
  | 'wave_height_m'
  | 'visibility_km'
  | 'current_speed_knots'
  | 'safety_incidents'
  | 'hazmat_restriction_active'
  | 'shore_power_available'
  | 'shore_power_used'
  | 'fuel_consumption_tons'
  | 'carbon_emissions_tons'
  | 'fuel_price'
  | 'carbon_price'
  | 'transfer_capacity'
  | 'transfer_cost'
  | 'vessel_class'
  | 'queue_entry_time'
  | 'service_start_time';

export interface PortOperationalFieldDefinition {
  field: PortOperationalField;
  unit: string;
  description: string;
  requiredForTraining: boolean;
}

export const PORT_OPERATIONAL_FIELDS: PortOperationalFieldDefinition[] = [
  { field: 'port_id', unit: 'UN/LOCODE or stable operator ID', description: '港口稳定标识', requiredForTraining: true },
  { field: 'terminal_id', unit: 'stable operator ID', description: '港区或码头稳定标识', requiredForTraining: true },
  { field: 'timestamp', unit: 'ISO 8601 with offset', description: '统一采样时间', requiredForTraining: true },
  { field: 'arrivals', unit: 'vessels/interval', description: '采样周期内到港需求', requiredForTraining: true },
  { field: 'gross_tonnage', unit: 'GT/interval', description: '采样周期总吨位', requiredForTraining: true },
  { field: 'effective_service_capacity', unit: 'vessels/interval', description: '已考虑泊位、设备和通航约束的有效服务能力', requiredForTraining: true },
  { field: 'queue_vessels', unit: 'vessels', description: '锚地或港池排队船舶数', requiredForTraining: true },
  { field: 'average_waiting_hours', unit: 'hours', description: '平均等待时间', requiredForTraining: true },
  { field: 'berth_utilization_percent', unit: 'percent', description: '泊位利用率', requiredForTraining: true },
  { field: 'yard_occupancy_percent', unit: 'percent', description: '堆场占用率', requiredForTraining: true },
  { field: 'quay_crane_moves_per_hour', unit: 'moves/hour', description: '岸桥作业效率', requiredForTraining: true },
  { field: 'truck_turn_time_minutes', unit: 'minutes', description: '外集卡周转时间', requiredForTraining: true },
  { field: 'rail_transfer_teu', unit: 'TEU/interval', description: '海铁联运量', requiredForTraining: false },
  { field: 'water_transfer_teu', unit: 'TEU/interval', description: '水水中转量', requiredForTraining: false },
  { field: 'planned_eta', unit: 'ISO 8601 with offset', description: '计划到港时间', requiredForTraining: true },
  { field: 'actual_eta', unit: 'ISO 8601 with offset', description: '实际到港时间', requiredForTraining: true },
  { field: 'channel_available', unit: '0/1', description: '航道是否可用', requiredForTraining: true },
  { field: 'tide_window_open', unit: '0/1', description: '潮窗是否开放', requiredForTraining: true },
  { field: 'pilot_available_count', unit: 'people/interval', description: '可用引航资源', requiredForTraining: true },
  { field: 'tug_available_count', unit: 'vessels/interval', description: '可用拖轮资源', requiredForTraining: true },
  { field: 'wind_speed_ms', unit: 'm/s', description: '港区实测或有质量码的风速', requiredForTraining: true },
  { field: 'wave_height_m', unit: 'm', description: '港区实测或有质量码的浪高', requiredForTraining: true },
  { field: 'visibility_km', unit: 'km', description: '能见度', requiredForTraining: true },
  { field: 'current_speed_knots', unit: 'knots', description: '流速', requiredForTraining: true },
  { field: 'safety_incidents', unit: 'events/interval', description: '安全事件计数', requiredForTraining: true },
  { field: 'hazmat_restriction_active', unit: '0/1', description: '危险品或防污染作业限制', requiredForTraining: true },
  { field: 'shore_power_available', unit: '0/1', description: '岸电设施可用状态', requiredForTraining: false },
  { field: 'shore_power_used', unit: '0/1', description: '靠港船舶岸电使用状态', requiredForTraining: false },
  { field: 'fuel_consumption_tons', unit: 't/interval', description: '燃料消耗', requiredForTraining: false },
  { field: 'carbon_emissions_tons', unit: 'tCO2e/interval', description: '经审计口径的碳排放', requiredForTraining: false },
  { field: 'fuel_price', unit: 'currency/t', description: '燃料价格', requiredForTraining: false },
  { field: 'carbon_price', unit: 'currency/tCO2e', description: '碳价格', requiredForTraining: false },
  { field: 'transfer_capacity', unit: 'vessels or TEU/interval', description: '跨码头或跨港转移能力', requiredForTraining: false },
  { field: 'transfer_cost', unit: 'currency/unit', description: '跨码头或跨港转移成本', requiredForTraining: false },
  { field: 'vessel_class', unit: 'controlled vocabulary', description: '船舶类别', requiredForTraining: false },
  { field: 'queue_entry_time', unit: 'ISO 8601 with offset', description: '进入队列时间', requiredForTraining: false },
  { field: 'service_start_time', unit: 'ISO 8601 with offset', description: '开始服务时间', requiredForTraining: false },
];

export const PORT_OPERATIONAL_OBSERVATIONS = [
  'queue_to_effective_capacity',
  'average_waiting_hours',
  'berth_utilization_percent',
  'yard_occupancy_percent',
  'quay_crane_productivity_index',
  'truck_turn_time_index',
  'arrival_schedule_deviation',
  'navigation_window_state',
  'pilot_tug_availability_index',
  'metocean_risk',
  'safety_hazmat_risk',
  'intermodal_transfer_pressure',
  'energy_carbon_intensity',
  'deferred_backlog_to_capacity',
] as const;

export interface PortOperationalActionDefinition {
  id: string;
  label: string;
  requiredFields: PortOperationalField[];
  requiresHumanApproval: boolean;
}

export const PORT_OPERATIONAL_ACTIONS: PortOperationalActionDefinition[] = [
  { id: 'hold-plan', label: '保持计划', requiredFields: ['effective_service_capacity'], requiresHumanApproval: false },
  {
    id: 'eco-speed',
    label: '低碳航速与到港节奏',
    requiredFields: ['planned_eta', 'actual_eta', 'fuel_consumption_tons', 'carbon_emissions_tons'],
    requiresHumanApproval: true,
  },
  {
    id: 'arrival-window',
    label: '潮窗与引航约束下的错峰到港',
    requiredFields: ['planned_eta', 'actual_eta', 'tide_window_open', 'channel_available', 'pilot_available_count', 'tug_available_count'],
    requiresHumanApproval: true,
  },
  {
    id: 'port-diversion',
    label: '跨码头或邻港协同分流',
    requiredFields: ['terminal_id', 'transfer_capacity', 'transfer_cost'],
    requiresHumanApproval: true,
  },
  {
    id: 'capacity-control',
    label: '泊位、岸桥、堆场与闸口能力重配置',
    requiredFields: [
      'berth_utilization_percent',
      'yard_occupancy_percent',
      'quay_crane_moves_per_hour',
      'truck_turn_time_minutes',
      'effective_service_capacity',
    ],
    requiresHumanApproval: true,
  },
];

const OPERATIONAL_OBJECTIVE_REQUIREMENTS: Record<string, PortOperationalField[]> = {
  'balanced-resilience': [
    'arrivals',
    'gross_tonnage',
    'effective_service_capacity',
    'queue_vessels',
    'average_waiting_hours',
    'wind_speed_ms',
    'wave_height_m',
    'visibility_km',
    'safety_incidents',
  ],
  'min-delay': ['arrivals', 'effective_service_capacity', 'queue_vessels', 'average_waiting_hours'],
  'min-carbon': ['gross_tonnage', 'fuel_consumption_tons', 'carbon_emissions_tons'],
  'max-throughput': ['arrivals', 'effective_service_capacity'],
  'port-congestion-relief': [
    'arrivals',
    'effective_service_capacity',
    'queue_vessels',
    'berth_utilization_percent',
    'yard_occupancy_percent',
  ],
  'fair-queueing': ['vessel_class', 'queue_entry_time', 'service_start_time'],
  'safety-first': [
    'wind_speed_ms',
    'wave_height_m',
    'visibility_km',
    'current_speed_knots',
    'safety_incidents',
    'hazmat_restriction_active',
  ],
  'rapid-recovery': ['arrivals', 'effective_service_capacity', 'channel_available', 'queue_vessels'],
  'energy-cost-control': ['fuel_consumption_tons', 'fuel_price', 'carbon_price', 'carbon_emissions_tons'],
  'weather-robustness': ['wind_speed_ms', 'wave_height_m', 'visibility_km', 'current_speed_knots'],
  'multi-port-coordination': ['port_id', 'terminal_id', 'transfer_capacity', 'transfer_cost'],
};

export interface PortOperationalReadiness {
  protocolVersion: typeof PORT_OPERATIONAL_CONTRACT_VERSION;
  availableFields: PortOperationalField[];
  missingTrainingFields: PortOperationalField[];
  fieldCoveragePercent: number;
  trainingReady: boolean;
  actions: Array<PortOperationalActionDefinition & { enabled: boolean; missingFields: PortOperationalField[] }>;
  objectives: Array<{ id: string; enabled: boolean; missingFields: PortOperationalField[] }>;
}

export const assessPortOperationalReadiness = (
  fields: Iterable<string>,
): PortOperationalReadiness => {
  const validFields = new Set(PORT_OPERATIONAL_FIELDS.map((definition) => definition.field));
  const availableFields = [...new Set(fields)]
    .filter((field): field is PortOperationalField => validFields.has(field as PortOperationalField))
    .sort();
  const available = new Set(availableFields);
  const trainingFields = PORT_OPERATIONAL_FIELDS
    .filter((definition) => definition.requiredForTraining)
    .map((definition) => definition.field);
  const missingTrainingFields = trainingFields.filter((field) => !available.has(field));
  return {
    protocolVersion: PORT_OPERATIONAL_CONTRACT_VERSION,
    availableFields,
    missingTrainingFields,
    fieldCoveragePercent: Number((availableFields.length / PORT_OPERATIONAL_FIELDS.length * 100).toFixed(1)),
    trainingReady: missingTrainingFields.length === 0,
    actions: PORT_OPERATIONAL_ACTIONS.map((action) => {
      const missingFields = action.requiredFields.filter((field) => !available.has(field));
      return { ...action, enabled: missingFields.length === 0, missingFields };
    }),
    objectives: Object.entries(OPERATIONAL_OBJECTIVE_REQUIREMENTS).map(([id, requirements]) => {
      const missingFields = requirements.filter((field) => !available.has(field));
      return { id, enabled: missingFields.length === 0, missingFields };
    }),
  };
};
