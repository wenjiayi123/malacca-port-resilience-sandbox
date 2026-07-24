export type RlObjectiveId =
  | 'balanced-resilience'
  | 'min-delay'
  | 'min-carbon'
  | 'max-throughput'
  | 'port-congestion-relief'
  | 'fair-queueing'
  | 'safety-first'
  | 'rapid-recovery'
  | 'energy-cost-control'
  | 'weather-robustness'
  | 'multi-port-coordination';

export interface RlObjectiveWeights {
  delay: number;
  congestion: number;
  carbon: number;
  safety: number;
  resilience: number;
  throughput: number;
}

export interface RlObjectivePreset {
  id: RlObjectiveId;
  weights: RlObjectiveWeights;
  supportedByAggregateEnvironment: boolean;
  requiredEvidence: string[];
}

export const RL_OBJECTIVE_PRESETS: Record<RlObjectiveId, RlObjectivePreset> = {
  'balanced-resilience': {
    id: 'balanced-resilience',
    weights: {
      delay: 0.2,
      congestion: 0.18,
      carbon: 0.14,
      safety: 0.16,
      resilience: 0.14,
      throughput: 0.18,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'gross_tonnage', 'capacity'],
  },
  'min-delay': {
    id: 'min-delay',
    weights: {
      delay: 0.34,
      congestion: 0.22,
      carbon: 0.08,
      safety: 0.12,
      resilience: 0.1,
      throughput: 0.14,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'capacity'],
  },
  'min-carbon': {
    id: 'min-carbon',
    weights: {
      delay: 0.12,
      congestion: 0.1,
      carbon: 0.34,
      safety: 0.14,
      resilience: 0.1,
      throughput: 0.2,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'gross_tonnage', 'capacity'],
  },
  'max-throughput': {
    id: 'max-throughput',
    weights: {
      delay: 0.12,
      congestion: 0.14,
      carbon: 0.08,
      safety: 0.12,
      resilience: 0.12,
      throughput: 0.42,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'capacity'],
  },
  'port-congestion-relief': {
    id: 'port-congestion-relief',
    weights: {
      delay: 0.25,
      congestion: 0.31,
      carbon: 0.08,
      safety: 0.12,
      resilience: 0.12,
      throughput: 0.12,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'capacity'],
  },
  'fair-queueing': {
    id: 'fair-queueing',
    weights: {
      delay: 0.24,
      congestion: 0.16,
      carbon: 0.06,
      safety: 0.12,
      resilience: 0.14,
      throughput: 0.28,
    },
    supportedByAggregateEnvironment: false,
    requiredEvidence: ['vessel_class', 'queue_entry_time', 'service_start_time'],
  },
  'safety-first': {
    id: 'safety-first',
    weights: {
      delay: 0.1,
      congestion: 0.1,
      carbon: 0.06,
      safety: 0.42,
      resilience: 0.2,
      throughput: 0.12,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['wind_speed_ms', 'wave_height_m', 'visibility_km', 'safety_incidents'],
  },
  'rapid-recovery': {
    id: 'rapid-recovery',
    weights: {
      delay: 0.22,
      congestion: 0.24,
      carbon: 0.06,
      safety: 0.12,
      resilience: 0.24,
      throughput: 0.12,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['arrivals', 'capacity'],
  },
  'energy-cost-control': {
    id: 'energy-cost-control',
    weights: {
      delay: 0.12,
      congestion: 0.1,
      carbon: 0.34,
      safety: 0.12,
      resilience: 0.1,
      throughput: 0.22,
    },
    supportedByAggregateEnvironment: false,
    requiredEvidence: ['fuel_consumption', 'fuel_price', 'carbon_price'],
  },
  'weather-robustness': {
    id: 'weather-robustness',
    weights: {
      delay: 0.14,
      congestion: 0.12,
      carbon: 0.08,
      safety: 0.34,
      resilience: 0.22,
      throughput: 0.1,
    },
    supportedByAggregateEnvironment: true,
    requiredEvidence: ['wind_speed_ms', 'wave_height_m', 'visibility_km'],
  },
  'multi-port-coordination': {
    id: 'multi-port-coordination',
    weights: {
      delay: 0.18,
      congestion: 0.22,
      carbon: 0.08,
      safety: 0.12,
      resilience: 0.18,
      throughput: 0.22,
    },
    supportedByAggregateEnvironment: false,
    requiredEvidence: ['port_id', 'transfer_capacity', 'transfer_cost', 'synchronized_timestamp'],
  },
};

export const getRlObjectivePreset = (objectiveId?: string) =>
  RL_OBJECTIVE_PRESETS[objectiveId as RlObjectiveId] ?? RL_OBJECTIVE_PRESETS['balanced-resilience'];
