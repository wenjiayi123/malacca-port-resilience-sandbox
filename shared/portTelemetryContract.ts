export const PORT_TELEMETRY_CONTRACT_VERSION = 'port-operations.telemetry.v1' as const;
export const PORT_DECISION_CONTRACT_VERSION = 'port-operations.decision.v1' as const;

export type TelemetryValue = string | number | boolean | null;

export type TelemetrySourceType =
  | 'public_observation'
  | 'public_reanalysis'
  | 'official_aggregate'
  | 'historical_replay'
  | 'physics_simulation'
  | 'engineering_derived'
  | 'field_measured';

export type TelemetryQualityStatus =
  | 'normal'
  | 'interpolated'
  | 'delayed'
  | 'drift'
  | 'offline'
  | 'anomaly';

export interface TelemetryField<T extends TelemetryValue = TelemetryValue> {
  value: T;
  unit: string;
  event_time: string;
  ingest_time: string;
  source_type: TelemetrySourceType;
  source_id: string;
  quality_status: TelemetryQualityStatus;
  confidence: number;
  is_measured: boolean;
  is_simulated: boolean;
  is_derived: boolean;
  site_id: string;
  asset_id: string;
  schema_version: typeof PORT_TELEMETRY_CONTRACT_VERSION;
  trace_id: string;
}

export interface SimulatorAuthorityBoundary {
  simulation_mode: true;
  live_data_verified: false;
  dispatch_allowed: false;
  production_authority: false;
}

export interface TelemetryQualitySummary {
  total_fields: number;
  normal_fields: number;
  degraded_fields: number;
  measured_fields: number;
  simulated_fields: number;
  derived_fields: number;
  completeness_percent: number;
  consistency_checks: Array<{
    id: string;
    passed: boolean;
    detail: string;
  }>;
}

export interface PortTelemetryContractDescriptor {
  protocol_version: typeof PORT_TELEMETRY_CONTRACT_VERSION;
  timezone: 'Asia/Singapore';
  required_metadata: Array<keyof TelemetryField>;
  source_types: TelemetrySourceType[];
  quality_statuses: TelemetryQualityStatus[];
  adapter_slots: Array<{
    id: 'ais' | 'tos' | 'vts' | 'plc_scada' | 'ems_bms_ba';
    current: string;
    production_replacement: string;
  }>;
}

export const PORT_TELEMETRY_CONTRACT: PortTelemetryContractDescriptor = {
  protocol_version: PORT_TELEMETRY_CONTRACT_VERSION,
  timezone: 'Asia/Singapore',
  required_metadata: [
    'value',
    'unit',
    'event_time',
    'ingest_time',
    'source_type',
    'source_id',
    'quality_status',
    'confidence',
    'is_measured',
    'is_simulated',
    'is_derived',
    'site_id',
    'asset_id',
    'schema_version',
    'trace_id',
  ],
  source_types: [
    'public_observation',
    'public_reanalysis',
    'official_aggregate',
    'historical_replay',
    'physics_simulation',
    'engineering_derived',
    'field_measured',
  ],
  quality_statuses: ['normal', 'interpolated', 'delayed', 'drift', 'offline', 'anomaly'],
  adapter_slots: [
    { id: 'ais', current: '公开 AIS 研究分布校准的船流状态机', production_replacement: '授权 AIS/NMEA/IALA 数据适配器' },
    { id: 'tos', current: 'MPA 月度到港量校准的作业守恒模拟器', production_replacement: 'TOS 船期、泊位、箱流和作业任务适配器' },
    { id: 'vts', current: '潮窗、航道和引拖工程状态机', production_replacement: 'VTS、引航、拖轮与通航计划适配器' },
    { id: 'plc_scada', current: '岸桥、场桥、AGV、闸口和设备故障物理模拟', production_replacement: 'PLC/SCADA/设备 IoT 适配器' },
    { id: 'ems_bms_ba', current: '负荷、岸电、储能、光伏和楼宇工程模型', production_replacement: 'EMS/BMS/BA/电表适配器' },
  ],
};

export const isTelemetryField = (value: unknown): value is TelemetryField => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<TelemetryField>;
  return PORT_TELEMETRY_CONTRACT.required_metadata.every((key) => key in candidate)
    && candidate.schema_version === PORT_TELEMETRY_CONTRACT_VERSION
    && typeof candidate.confidence === 'number'
    && candidate.confidence >= 0
    && candidate.confidence <= 1;
};
