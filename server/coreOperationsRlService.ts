import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CORE_OPERATIONS_ACTION_HEADS,
  CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  CORE_OPERATIONS_OBSERVATIONS,
  CORE_OPERATIONS_REWARD_COMPONENTS,
  CORE_OPERATIONS_RL_CONTRACT_VERSION,
  type CoreActionChoiceId,
} from '../shared/coreOperationsRlContract.ts';
import type { PortOperationsSimulator, OperationalActionId } from './operationalSimulator.ts';
import {
  CORE_OPERATIONS_HOLD_CHOICES,
  corePlanEffect,
  inferFactorizedCoreEnsemble,
  normalizeCoreObservationRecord,
  projectCoreActionPlan,
  type CoreActionPlan,
  type CoreObservationTensorItem,
  type CoreSafetyContext,
  type FactorizedCorePolicy,
} from './coreOperationsRlEngine.ts';

type OperationsSnapshot = ReturnType<PortOperationsSimulator['snapshot']>;

interface StoredCoreEvidence {
  schemaVersion: 'core-operations-rl-evidence.v1';
  evidenceLabel: string;
  generatedAt: string;
  contract: { version: string };
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: string;
    operationalClaimAllowed: boolean;
    recordCount: number;
    split: unknown;
    quality: unknown;
  };
  training: {
    champion: {
      admitted: boolean;
      algorithmId: string;
      attemptId: string;
      seedPolicies: FactorizedCorePolicy[];
      validationGate: unknown;
      finalTestGate: unknown;
    };
  };
  valueAttribution: unknown;
  releaseDecision: {
    simulationExecutionAdmitted: boolean;
    operationalDeploymentAdmitted: boolean;
  };
}

const readStoredEvidence = async (
  reportPath = process.env.CORE_OPERATIONS_CHAMPION_REPORT || 'reports/core-operations-rl-champion-v1.json',
) => {
  const report = JSON.parse(await readFile(path.resolve(reportPath), 'utf8')) as StoredCoreEvidence;
  if (report.schemaVersion !== 'core-operations-rl-evidence.v1' ||
      report.contract?.version !== CORE_OPERATIONS_RL_CONTRACT_VERSION ||
      !report.training?.champion?.seedPolicies?.length) {
    throw new Error('全核心业务强化学习冠军证据不存在或协议不兼容');
  }
  return report;
};

const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const numberField = (snapshot: OperationsSnapshot, domain: string, name: string, fallback = 0) => {
  const value = (snapshot.operationalTelemetry as Record<string, Record<string, { value: unknown }>>)[domain]?.[name]?.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const booleanField = (snapshot: OperationsSnapshot, domain: string, name: string, fallback = false) => {
  const value = (snapshot.operationalTelemetry as Record<string, Record<string, { value: unknown }>>)[domain]?.[name]?.value;
  return typeof value === 'boolean' ? value : fallback;
};

export const buildRuntimeCoreObservation = (snapshot: OperationsSnapshot): {
  tensor: CoreObservationTensorItem[];
  context: CoreSafetyContext;
} => {
  const arrivals = numberField(snapshot, 'terminal', 'arrivals');
  const capacity = Math.max(0.2, numberField(snapshot, 'terminal', 'effective_service_capacity', 1));
  const queue = numberField(snapshot, 'terminal', 'queue_vessels');
  const yard = numberField(snapshot, 'terminal', 'yard_occupancy_percent') / 100;
  const truckTurnMinutes = numberField(snapshot, 'terminal', 'truck_turn_time_minutes', 30);
  const cranesAvailable = numberField(snapshot, 'equipment', 'quay_cranes_available');
  const cranesTotal = Math.max(1, numberField(snapshot, 'equipment', 'quay_cranes_total', 10));
  const agvAvailable = numberField(snapshot, 'equipment', 'agv_available');
  const trucksAvailable = numberField(snapshot, 'equipment', 'terminal_trucks_available');
  const rtgAvailable = numberField(snapshot, 'equipment', 'rtg_available');
  const transformer = numberField(snapshot, 'energy', 'transformer_loading_percent') / 100;
  const batterySoc = numberField(snapshot, 'energy', 'battery_soc_percent', 58) / 100;
  const batterySoh = numberField(snapshot, 'energy', 'battery_soh_percent', 96) / 100;
  const shorePowerLoadRatio = numberField(snapshot, 'energy', 'shore_power_kw') / 6_000;
  const rail = numberField(snapshot, 'terminal', 'rail_transfer_teu');
  const water = numberField(snapshot, 'terminal', 'water_transfer_teu');
  const activeFaultRatio = numberField(snapshot, 'equipment', 'active_faults') / 6;
  const maintenanceDueRatio = numberField(snapshot, 'equipment', 'maintenance_due_count') / 12;
  const qualityScore = clamp(snapshot.quality.completeness_percent / 100, 0, 1);
  const forecastArrivals = Number(snapshot.forecast.points[0]?.arrivals ?? arrivals);
  const forecastUncertainty = clamp(
    snapshot.forecast.model.validationRmseVesselsPerMonth / Math.max(1, forecastArrivals) / 100,
    0,
    1,
  );
  const context: CoreSafetyContext = {
    channelAvailable: booleanField(snapshot, 'navigation', 'channel_available'),
    tideWindowOpen: booleanField(snapshot, 'navigation', 'tide_window_open'),
    pilotAvailabilityRatio: clamp(numberField(snapshot, 'navigation', 'pilot_available_count') / 8, 0, 1),
    tugAvailabilityRatio: clamp(numberField(snapshot, 'navigation', 'tug_available_count') / 6, 0, 1),
    hazmatRestrictionActive: booleanField(snapshot, 'safety', 'hazmat_restriction_active'),
    yardOccupancy: yard,
    craneAvailabilityRatio: clamp(cranesAvailable / cranesTotal, 0, 1),
    agvAvailabilityRatio: clamp(agvAvailable / 54, 0, 1),
    truckAvailabilityRatio: clamp(trucksAvailable / 76, 0, 1),
    transformerLoading: transformer,
    batterySoc,
    batterySoh,
    shorePowerLoadRatio,
    transferCapacityRatio: clamp((rail + water) / Math.max(1, arrivals * 100), 0, 2),
    activeFaultRatio,
    maintenanceDueRatio,
    communicationAvailable: booleanField(snapshot, 'safety', 'communication_available'),
    dataQualityScore: qualityScore,
  };
  const values = {
    arrivals_to_capacity: arrivals / capacity,
    arrival_trend: clamp((forecastArrivals - arrivals) / Math.max(1, arrivals), -1, 1),
    queue_to_capacity: queue / capacity,
    delay_hours: snapshot.kpis.delay_minutes / 60,
    forecast_arrivals_to_capacity: forecastArrivals / capacity,
    berth_utilization: numberField(snapshot, 'terminal', 'berth_utilization_percent') / 100,
    crane_productivity_index: numberField(snapshot, 'terminal', 'quay_crane_moves_per_hour', 28) / 28,
    crane_availability_ratio: context.craneAvailabilityRatio,
    service_level: snapshot.kpis.service_level_percent / 100,
    yard_occupancy: yard,
    yard_reshuffle_pressure: numberField(snapshot, 'terminal', 'yard_reshuffles') / 120,
    truck_turn_time_hours: truckTurnMinutes / 60,
    gate_queue_pressure: clamp(truckTurnMinutes / 60 + queue / capacity * 0.12, 0, 2),
    agv_availability_ratio: context.agvAvailabilityRatio,
    terminal_truck_availability_ratio: context.truckAvailabilityRatio,
    rtg_availability_ratio: clamp(rtgAvailable / 28, 0, 1),
    channel_available: Number(context.channelAvailable),
    tide_window_open: Number(context.tideWindowOpen),
    pilot_availability_ratio: context.pilotAvailabilityRatio,
    tug_availability_ratio: context.tugAvailabilityRatio,
    wind_risk: clamp(numberField(snapshot, 'navigation', 'wind_speed_ms') / 24, 0, 1),
    wave_risk: clamp(numberField(snapshot, 'navigation', 'wave_height_m') / 4, 0, 1),
    visibility_risk: clamp((12 - numberField(snapshot, 'navigation', 'visibility_km', 12)) / 12, 0, 1),
    current_risk: clamp(numberField(snapshot, 'navigation', 'current_speed_knots') / 2.2, 0, 1),
    hazmat_restriction_active: Number(context.hazmatRestrictionActive),
    grid_load_ratio: numberField(snapshot, 'energy', 'grid_load_kw') / 18_000,
    transformer_loading: transformer,
    shore_power_load_ratio: shorePowerLoadRatio,
    solar_supply_ratio: clamp(numberField(snapshot, 'energy', 'solar_kw') /
      Math.max(1, numberField(snapshot, 'energy', 'grid_load_kw')), 0, 1),
    battery_soc: batterySoc,
    battery_soh: batterySoh,
    energy_price_index: numberField(snapshot, 'energy', 'electricity_price_myr_kwh', 0.48) / 0.48,
    grid_carbon_index: numberField(snapshot, 'energy', 'carbon_factor_kg_kwh', 0.58) / 0.58,
    reefer_inventory_pressure: numberField(snapshot, 'terminal', 'reefer_container_count') / 1_800,
    reefer_power_ratio: numberField(snapshot, 'building', 'reefer_power_kw') / 3_000,
    building_flexible_load_ratio: (numberField(snapshot, 'building', 'hvac_power_kw') +
      numberField(snapshot, 'building', 'lighting_power_kw')) / 3_000,
    active_fault_ratio: activeFaultRatio,
    maintenance_due_ratio: maintenanceDueRatio,
    rail_transfer_pressure: rail / 420,
    water_transfer_pressure: water / 520,
    recovery_backlog_pressure: queue * clamp(activeFaultRatio + Math.max(0, 1 - capacity / 5.2), 0, 1) / capacity,
    safety_risk: snapshot.kpis.safety_risk_percent / 100,
    resilience_index: snapshot.kpis.resilience_index / 100,
    communication_available: Number(context.communicationAvailable),
    communication_latency: clamp(numberField(snapshot, 'safety', 'communication_latency_ms') / 2_000, 0, 1),
    data_quality_score: qualityScore,
    forecast_uncertainty: forecastUncertainty,
  } as const;
  return {
    tensor: normalizeCoreObservationRecord(values),
    context,
  };
};

const operationalActionFromPlan = (plan: CoreActionPlan): OperationalActionId => {
  const choices = new Set(Object.values(plan.choices));
  if (choices.has('arrival-smoothing') || choices.has('tide-window-sequence')) return 'arrival-window';
  if (choices.has('eco-speed-window') || choices.has('shore-power-priority') ||
      choices.has('battery-peak-shave') || choices.has('reefer-load-coordinate') ||
      choices.has('building-demand-response')) return 'eco-speed';
  if (choices.has('neighbor-port-advisory')) return 'port-diversion';
  if ([
    'berth-reassign', 'crane-rebalance', 'yard-block-rebalance', 'gate-slot-smoothing',
    'agv-rebalance', 'truck-pool-rebalance', 'fault-recovery-priority',
    'recovery-capacity', 'controlled-backlog-release', 'rail-barge-rebalance',
  ].some((choice) => choices.has(choice as CoreActionChoiceId))) return 'capacity-control';
  return 'hold-plan';
};

export const loadCoreOperationsChampionStatus = async () => {
  const report = await readStoredEvidence();
  return {
    protocolVersion: 'core-operations-runtime-status.v1' as const,
    generatedAt: report.generatedAt,
    evidenceLabel: report.evidenceLabel,
    contract: {
      version: CORE_OPERATIONS_RL_CONTRACT_VERSION,
      observationCount: CORE_OPERATIONS_OBSERVATIONS.length,
      actionHeadCount: CORE_OPERATIONS_ACTION_HEADS.length,
      actionChoiceCount: CORE_OPERATIONS_ACTION_HEADS.reduce((sum, head) => sum + head.choices.length, 0),
      rewardComponentCount: CORE_OPERATIONS_REWARD_COMPONENTS.length,
    },
    dataset: report.dataset,
    champion: {
      admitted: report.training.champion.admitted,
      algorithmId: report.training.champion.algorithmId,
      attemptId: report.training.champion.attemptId,
      seedPolicyCount: report.training.champion.seedPolicies.length,
      validationGate: report.training.champion.validationGate,
      finalTestGate: report.training.champion.finalTestGate,
    },
    valueAttribution: report.valueAttribution,
    boundary: CORE_OPERATIONS_AUTHORITY_BOUNDARY,
    simulationExecutionAdmitted: report.releaseDecision.simulationExecutionAdmitted,
    operationalDeploymentAdmitted: report.releaseDecision.operationalDeploymentAdmitted,
  };
};

export const inferCoreOperationsChampion = async (snapshot: OperationsSnapshot) => {
  const report = await readStoredEvidence();
  const observation = buildRuntimeCoreObservation(snapshot);
  const inference = inferFactorizedCoreEnsemble(
    report.training.champion.seedPolicies,
    observation.tensor,
    observation.context,
  );
  const minimumVoteShare = 0.6;
  const domainAbstentions = inference.heads
    .filter((head) => head.voteShare < minimumVoteShare)
    .map((head) => head.domain);
  const confidencePlan: CoreActionPlan = {
    choices: { ...inference.requestedPlan.choices },
  };
  for (const domain of domainAbstentions) confidencePlan.choices[domain] = CORE_OPERATIONS_HOLD_CHOICES[domain];
  const projection = projectCoreActionPlan(confidencePlan, observation.context);
  const effect = corePlanEffect(projection.executed);
  const activeDomains = CORE_OPERATIONS_ACTION_HEADS
    .filter((head) => projection.executed.choices[head.id] !== CORE_OPERATIONS_HOLD_CHOICES[head.id])
    .map((head) => head.id);
  const checks = {
    offlineChampionAdmitted: report.training.champion.admitted,
    dataQuality: observation.context.dataQualityScore >= 0.95,
    communicationAvailable: observation.context.communicationAvailable,
    observationRange: inference.outOfRangeObservationCount <= 3,
    atLeastOneActiveDomain: activeDomains.length > 0,
    throughputNonRegression: 100 * (1 - effect.defer - effect.divert) >= 98.5,
    safetyProjectionClean: projection.modifiedDomains.length === 0,
  };
  const blockerLabels: Record<keyof typeof checks, string> = {
    offlineChampionAdmitted: '离线冠军业务价值门禁未通过',
    dataQuality: '输入数据完整性不足百分之九十五',
    communicationAvailable: '控制通信链不可用',
    observationRange: '超过三个运行观测超出训练包络',
    atLeastOneActiveDomain: '当前状态下各领域均保持计划',
    throughputNonRegression: '联合计划吞吐保持率低于百分之九十八点五',
    safetyProjectionClean: '至少一个动作头被确定性安全投影器替换',
  };
  const blockers = (Object.entries(checks) as Array<[keyof typeof checks, boolean]>)
    .filter(([, passed]) => !passed)
    .map(([key]) => blockerLabels[key]);
  const admitted = blockers.length === 0;
  const executedPlan = admitted ? projection.executed : { choices: { ...CORE_OPERATIONS_HOLD_CHOICES } };
  const finalEffect = corePlanEffect(executedPlan);
  const proposalId = `core-${createHash('sha256').update(JSON.stringify({
    dataset: report.dataset.fingerprint,
    snapshot: snapshot.snapshot_hash,
    requested: inference.requestedPlan,
  })).digest('hex').slice(0, 20)}`;
  const projectionMetrics = {
    queueVessels: { before: snapshot.kpis.queue_vessels, after: round(Math.max(0, snapshot.kpis.queue_vessels - finalEffect.queueRelief * 5)) },
    delayMinutes: { before: snapshot.kpis.delay_minutes, after: round(Math.max(0, snapshot.kpis.delay_minutes * (1 - finalEffect.queueRelief * 0.22))) },
    throughputTeu: { before: snapshot.kpis.throughput_teu, after: round(snapshot.kpis.throughput_teu * finalEffect.capacity * (1 - finalEffect.defer - finalEffect.divert)) },
    yardOccupancyPercent: {
      before: numberField(snapshot, 'terminal', 'yard_occupancy_percent'),
      after: round(Math.max(0, numberField(snapshot, 'terminal', 'yard_occupancy_percent') - finalEffect.yardRelief * 100)),
    },
    truckTurnMinutes: { before: numberField(snapshot, 'terminal', 'truck_turn_time_minutes'), after: round(Math.max(0, numberField(snapshot, 'terminal', 'truck_turn_time_minutes') - finalEffect.gateRelief * 60)) },
    energyKwh: { before: snapshot.kpis.energy_kwh, after: round(snapshot.kpis.energy_kwh * finalEffect.energy) },
    peakGridKw: { before: snapshot.kpis.peak_grid_kw, after: round(snapshot.kpis.peak_grid_kw * finalEffect.peak) },
    costMyr: { before: snapshot.kpis.cost_myr, after: round(snapshot.kpis.cost_myr * finalEffect.energy * finalEffect.peak) },
    carbonTons: { before: snapshot.kpis.carbon_tons, after: round(snapshot.kpis.carbon_tons * finalEffect.energy * finalEffect.carbon) },
    maintenanceDueCount: {
      before: numberField(snapshot, 'equipment', 'maintenance_due_count'),
      after: round(Math.max(0, numberField(snapshot, 'equipment', 'maintenance_due_count') - finalEffect.maintenanceRelief * 12)),
    },
    throughputRetentionPercent: round((1 - finalEffect.defer - finalEffect.divert) * 100),
  };
  return {
    protocolVersion: 'core-operations-runtime-decision.v1' as const,
    proposalId,
    generatedAt: new Date().toISOString(),
    inputEvidence: {
      snapshotHash: snapshot.snapshot_hash,
      sequence: snapshot.sequence,
      eventTime: snapshot.event_time,
      source: snapshot.source,
      dataQualityScore: observation.context.dataQualityScore,
      measuredFieldCount: snapshot.quality.measured_fields,
      simulatedFieldCount: snapshot.quality.simulated_fields,
      liveDataVerified: snapshot.authority.live_data_verified,
    },
    champion: {
      algorithmId: report.training.champion.algorithmId,
      attemptId: report.training.champion.attemptId,
      seedPolicyCount: report.training.champion.seedPolicies.length,
      datasetFingerprint: report.dataset.fingerprint,
      evidenceLabel: report.evidenceLabel,
    },
    inference,
    domainAbstentions,
    projection,
    executedPlan,
    activeDomains: admitted ? activeDomains : [],
    primaryOperationalActionId: operationalActionFromPlan(executedPlan),
    projectedBusinessValue: projectionMetrics,
    admission: {
      status: admitted ? 'admitted_for_simulation_approval' : 'abstain_hold_plan',
      minimumVoteShare,
      checks,
      blockers,
      recommendationSource: admitted
        ? domainAbstentions.length
          ? 'factorized-reinforcement-learning-with-domain-abstention'
          : 'factorized-reinforcement-learning'
        : 'deterministic-hold-plan',
    },
    approval: {
      status: admitted ? 'pending_simulation_review' : 'not_required',
      requiredRoles: admitted ? ['operator', 'safety_officer'] : [],
      approvals: [] as Array<{ approverId: string; role: string; approvedAt: string }>,
    },
    execution: {
      status: 'not_executed' as 'not_executed' | 'executed' | 'rolled_back' | 'failed',
      dispatchAllowed: false as const,
      productionAuthority: false as const,
      receipt: null as null | Record<string, unknown>,
      reason: '联合计划可进入独立沙盘执行器并返回回执；不连接现场船舶交通服务、码头操作系统或设备控制系统',
    },
    authority: CORE_OPERATIONS_AUTHORITY_BOUNDARY,
  };
};
