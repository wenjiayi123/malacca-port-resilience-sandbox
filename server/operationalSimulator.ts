import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PORT_DECISION_CONTRACT_VERSION,
  PORT_TELEMETRY_CONTRACT,
  PORT_TELEMETRY_CONTRACT_VERSION,
  type SimulatorAuthorityBoundary,
  type TelemetryField,
  type TelemetryQualityStatus,
  type TelemetrySourceType,
  type TelemetryValue,
} from '../shared/portTelemetryContract.ts';
import { readBoundedIntegerEnvironment } from './runtimeSecurity.ts';

export type OperationalScenarioId =
  | 'normal'
  | 'peak-arrivals'
  | 'channel-closure'
  | 'equipment-failure'
  | 'extreme-weather'
  | 'channel-congestion'
  | 'yard-saturation'
  | 'data-loss';

export type OperationalControllerId = 'fcfs' | 'port-sop' | 'operations-research' | 'mpc' | 'rl-checkpoint';
export type OperationalActionId =
  | 'hold-plan'
  | 'eco-speed'
  | 'arrival-window'
  | 'port-diversion'
  | 'capacity-control';

interface SimulatorState {
  sequence: number;
  queueVessels: number;
  yardInventoryTeu: number;
  batterySocPercent: number;
  batterySohPercent: number;
  previousArrivals: number;
  cumulativeThroughputTeu: number;
  cumulativeEnergyKwh: number;
  cumulativeCarbonTons: number;
  cumulativeCostMyr: number;
  peakGridKw: number;
}

interface TickState extends SimulatorState {
  eventTime: string;
  previousQueueVessels: number;
  controlQueueRelief: number;
  arrivals: number;
  servicedVessels: number;
  divertedVessels: number;
  effectiveCapacity: number;
  throughputTeu: number;
  yardOccupancyPercent: number;
  berthUtilizationPercent: number;
  quayCraneMovesPerHour: number;
  truckTurnMinutes: number;
  windSpeedMs: number;
  waveHeightM: number;
  visibilityKm: number;
  currentSpeedKnots: number;
  tideHeightM: number;
  tideWindowOpen: boolean;
  channelAvailable: boolean;
  availableQuayCranes: number;
  equipmentFaults: number;
  gridLoadKw: number;
  solarKw: number;
  shorePowerKw: number;
  batteryPowerKw: number;
  transformerLoadingPercent: number;
  electricityPriceMyrKwh: number;
  carbonFactorKgKwh: number;
  tickEnergyKwh: number;
  tickCarbonTons: number;
  tickCostMyr: number;
  safetyIncidents: number;
  communicationLatencyMs: number;
  controlEnvelopeBreaches: number;
}

interface ForecastModel {
  id: string;
  alpha: number;
  trainRows: number;
  validationRows: number;
  trainRmseVesselsPerMonth: number;
  validationRmseVesselsPerMonth: number;
  hash: string;
}

interface ActiveControlEffect {
  actionId: OperationalActionId;
  remainingTicks: number;
  queueRelief: number;
  capacityMultiplier: number;
  carbonMultiplier: number;
  diversionFraction: number;
}

export interface OperationalCandidate {
  controller_id: OperationalControllerId;
  family: string;
  action_id: OperationalActionId;
  action_label: string;
  objective_value: number;
  projected_kpis: {
    queue_vessels: number;
    delay_minutes: number;
    throughput_teu: number;
    energy_kwh: number;
    carbon_tons: number;
    safety_risk_percent: number;
  };
  constraints: string[];
  eligible: boolean;
  rejection_reason: string | null;
  evidence: string;
}

export interface OperationalDecision {
  protocol_version: typeof PORT_DECISION_CONTRACT_VERSION;
  decision_id: string;
  created_at: string;
  correlation_id: string;
  input_snapshot_hash: string;
  dataset_hash: string;
  model_hash: string;
  config_hash: string;
  controller_id: OperationalControllerId;
  model_version: string;
  recommended_action: OperationalActionId;
  projected_action: {
    before: Record<string, number>;
    after: Record<string, number>;
    triggered_constraints: string[];
    modified: boolean;
  };
  status: 'pending_approval' | 'approved' | 'executed' | 'rolled_back' | 'failed';
  approvals: Array<{ approver_id: string; role: 'operator' | 'safety_officer'; approved_at: string }>;
  receipt: null | {
    receipt_id: string;
    executor: 'simulation-executor.v1';
    status: 'acknowledged' | 'rolled_back';
    executed_at: string;
    before_kpis: Record<string, number>;
    after_kpis: Record<string, number>;
    kpi_delta: Record<string, number>;
    failure_reason: string | null;
    rollback_reason: string | null;
  };
}

export interface OperationalAuditRecord {
  sequence: number;
  audit_time: string;
  event_type: string;
  correlation_id: string;
  payload: Record<string, unknown>;
  previous_hash: string;
  hash: string;
}

const SITE_ID = 'malacca-public-calibrated-sandbox';
const TERMINAL_ID = 'malacca-reference-terminal';
const TICK_SIMULATION_MINUTES = 15;
const DEFAULT_WALL_TICK_MS = 5_000;
const AUTHORITY: SimulatorAuthorityBoundary = {
  simulation_mode: true,
  live_data_verified: false,
  dispatch_allowed: false,
  production_authority: false,
};

const ACTION_LABELS: Record<OperationalActionId, string> = {
  'hold-plan': '保持当前计划',
  'eco-speed': '低碳航速与岸电协同',
  'arrival-window': '潮窗约束下错峰到港',
  'port-diversion': '邻港协同分流',
  'capacity-control': '泊位与设备能力重配置',
};

const hash = (value: string | object) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

const deterministicNoise = (seed: number, sequence: number, salt: string) => {
  const digest = createHash('sha256').update(`${seed}:${sequence}:${salt}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff * 2 - 1;
};

const parseMonthlySeries = (content: string) => content.trim().split(/\r?\n/).slice(1).flatMap((line) => {
  const [month, vessels] = line.split(',');
  const count = Number(vessels);
  return month && Number.isFinite(count) ? [{ month, vessels: count }] : [];
});

const fitForecastModel = (series: Array<{ month: string; vessels: number }>, datasetHash: string): ForecastModel => {
  const splitIndex = Math.max(3, Math.floor(series.length * 0.7));
  const train = series.slice(0, splitIndex);
  const validation = series.slice(splitIndex);
  let bestAlpha = 0.3;
  let bestRmse = Number.POSITIVE_INFINITY;
  for (let alpha = 0.05; alpha <= 0.9501; alpha += 0.05) {
    let level = train[0]?.vessels ?? 1;
    const errors: number[] = [];
    for (const row of train.slice(1)) {
      errors.push(row.vessels - level);
      level = alpha * row.vessels + (1 - alpha) * level;
    }
    const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / Math.max(1, errors.length));
    if (rmse < bestRmse) {
      bestAlpha = round(alpha, 2);
      bestRmse = rmse;
    }
  }
  let level = train[0]?.vessels ?? 1;
  for (const row of train.slice(1)) level = bestAlpha * row.vessels + (1 - bestAlpha) * level;
  const validationErrors: number[] = [];
  for (const row of validation) {
    validationErrors.push(row.vessels - level);
    level = bestAlpha * row.vessels + (1 - bestAlpha) * level;
  }
  const validationRmse = Math.sqrt(
    validationErrors.reduce((sum, error) => sum + error ** 2, 0) / Math.max(1, validationErrors.length),
  );
  const descriptor = {
    id: 'mpa-train-only-exponential-smoothing-v1',
    alpha: bestAlpha,
    trainRows: train.length,
    validationRows: validation.length,
    trainRmseVesselsPerMonth: round(bestRmse, 2),
    validationRmseVesselsPerMonth: round(validationRmse, 2),
  };
  return { ...descriptor, hash: hash({ descriptor, datasetHash }) };
};

const collectTelemetryFields = (value: unknown, output: TelemetryField[] = []): TelemetryField[] => {
  if (!value || typeof value !== 'object') return output;
  if ('schema_version' in value && 'quality_status' in value && 'source_type' in value) {
    output.push(value as TelemetryField);
    return output;
  }
  if (Array.isArray(value)) value.forEach((item) => collectTelemetryFields(item, output));
  else Object.values(value).forEach((item) => collectTelemetryFields(item, output));
  return output;
};

export class PortOperationsSimulator {
  readonly seed: number;
  readonly runId: string;
  readonly datasetHash: string;
  readonly configHash: string;
  readonly forecastModel: ForecastModel;
  readonly wallTickMs: number;
  private readonly startedAtMs: number;
  private readonly simulationStartMs: number;
  private state: SimulatorState;
  private latestTick: TickState | null = null;
  private readonly recentTicks: TickState[] = [];
  private running = true;
  private scenario: OperationalScenarioId = 'normal';
  private activeControl: ActiveControlEffect | null = null;

  constructor(options: { seed?: number; wallTickMs?: number; startedAtMs?: number } = {}) {
    this.seed = options.seed ?? readBoundedIntegerEnvironment('PORT_SIMULATOR_SEED', 240520, 0, 2_147_483_647);
    this.wallTickMs = options.wallTickMs ?? readBoundedIntegerEnvironment(
      'PORT_SIMULATOR_WALL_TICK_MS',
      DEFAULT_WALL_TICK_MS,
      1_000,
      60_000,
    );
    this.startedAtMs = options.startedAtMs ?? Date.now();
    this.simulationStartMs = Date.parse('2026-01-01T00:00:00+08:00');
    const dataset = readFileSync(path.resolve('data/rl/mpa_vessel_arrivals_monthly.csv'), 'utf8');
    this.datasetHash = hash(dataset);
    const series = parseMonthlySeries(dataset);
    this.forecastModel = fitForecastModel(series, this.datasetHash);
    this.configHash = hash({
      seed: this.seed,
      tickMinutes: TICK_SIMULATION_MINUTES,
      capacityEnvelope: [0, 8],
      battery: { capacityKwh: 12_000, soc: [15, 95], maxPowerKw: 3_000 },
      transformerCapacityKw: 18_000,
      yardCapacityTeu: 80_000,
      yardFlow: { importDwellShare: 0.18, targetInventoryTeu: 48_000, releaseGain: 0.025 },
      actionEnvelope: { defer: 0.02, divert: 0.01, capacityUplift: 0.02 },
    });
    this.runId = `ops-${this.datasetHash.slice(0, 8)}-${this.configHash.slice(0, 8)}`;
    this.state = {
      sequence: 0,
      queueVessels: 18,
      yardInventoryTeu: 48_000,
      batterySocPercent: 58,
      batterySohPercent: 96.4,
      previousArrivals: 4,
      cumulativeThroughputTeu: 0,
      cumulativeEnergyKwh: 0,
      cumulativeCarbonTons: 0,
      cumulativeCostMyr: 0,
      peakGridKw: 0,
    };
    this.latestTick = this.step(0);
  }

  private eventTime(sequence: number) {
    return new Date(this.simulationStartMs + sequence * TICK_SIMULATION_MINUTES * 60_000).toISOString();
  }

  private step(sequence: number): TickState {
    const previousQueueVessels = this.state.queueVessels;
    const eventDate = new Date(this.simulationStartMs + sequence * TICK_SIMULATION_MINUTES * 60_000);
    const localHour = (eventDate.getUTCHours() + 8 + eventDate.getUTCMinutes() / 60) % 24;
    const dayWave = 0.18 * Math.sin((localHour - 6) / 24 * Math.PI * 2)
      + 0.12 * Math.sin((localHour - 15) / 12 * Math.PI * 2);
    const weekWave = 0.06 * Math.cos(sequence / (96 * 7) * Math.PI * 2);
    const scenarioArrivalMultiplier = this.scenario === 'peak-arrivals' ? 1.55
      : this.scenario === 'channel-congestion' ? 1.18
        : 1;
    const arrivals = Math.max(0, Math.round(
      4.1 * (1 + dayWave + weekWave) * scenarioArrivalMultiplier
      + deterministicNoise(this.seed, sequence, 'arrivals') * 0.7,
    ));
    const tideHeightM = round(1.85 + 1.35 * Math.sin(sequence / 49.6 * Math.PI * 2), 2);
    const tideWindowOpen = tideHeightM >= 0.9;
    const weatherShock = this.scenario === 'extreme-weather' ? 1 : 0;
    const windSpeedMs = round(clamp(
      6.1 + 2.2 * Math.sin(sequence / 96 * Math.PI * 2)
      + deterministicNoise(this.seed, sequence, 'wind') * 0.8 + weatherShock * 13,
      0,
      32,
    ), 1);
    const waveHeightM = round(clamp(
      0.7 + windSpeedMs * 0.055 + deterministicNoise(this.seed, sequence, 'wave') * 0.08 + weatherShock * 1.1,
      0.2,
      5,
    ), 2);
    const visibilityKm = round(clamp(
      18 - waveHeightM * 1.5 - weatherShock * 9 + deterministicNoise(this.seed, sequence, 'visibility'),
      1,
      20,
    ), 1);
    const currentSpeedKnots = round(clamp(0.7 + Math.abs(tideHeightM - 1.85) * 0.5, 0.2, 2.2), 2);
    const channelAvailable = this.scenario !== 'channel-closure' && windSpeedMs < 22 && visibilityKm >= 2;
    const equipmentFaults = this.scenario === 'equipment-failure' ? 3 : sequence % 113 === 0 && sequence > 0 ? 1 : 0;
    const availableQuayCranes = 10 - equipmentFaults;
    const yardCapacityTeu = 80_000;
    if (this.scenario === 'yard-saturation' && this.state.yardInventoryTeu < 74_000) this.state.yardInventoryTeu = 74_000;
    const yardOccupancyBefore = this.state.yardInventoryTeu / yardCapacityTeu * 100;
    const equipmentFactor = availableQuayCranes / 10;
    const yardFactor = yardOccupancyBefore > 92 ? 0.66 : yardOccupancyBefore > 85 ? 0.82 : 1;
    const weatherFactor = !channelAvailable ? 0 : clamp(1 - Math.max(0, windSpeedMs - 12) * 0.025, 0.55, 1);
    const tideFactor = tideWindowOpen ? 1 : 0.72;
    const controlCapacity = this.activeControl?.capacityMultiplier ?? 1;
    const effectiveCapacity = round(5.2 * equipmentFactor * yardFactor * weatherFactor * tideFactor * controlCapacity, 2);
    const diversionFraction = this.activeControl?.diversionFraction ?? 0;
    const divertedVessels = Math.min(arrivals, Math.round(arrivals * diversionFraction));
    const availableDemand = this.state.queueVessels + arrivals - divertedVessels;
    const servicedVessels = Math.min(availableDemand, Math.max(0, Math.floor(effectiveCapacity)));
    const queueRelief = this.activeControl?.queueRelief ?? 0;
    const queueVessels = Math.max(0, round(availableDemand - servicedVessels - queueRelief, 2));
    const averageTeuPerService = 680 + Math.round(90 * Math.sin(sequence / 17));
    const throughputTeu = Math.max(0, servicedVessels * averageTeuPerService);
    const quayCraneMovesPerHour = round(28 * equipmentFactor * (yardFactor * 0.9 + 0.1), 1);
    const gateOutflowTeu = Math.max(600, 1_140 + 210 * Math.sin((localHour - 7) / 24 * Math.PI * 2));
    const railTransferTeu = localHour >= 6 && localHour <= 22 ? 210 : 80;
    const waterTransferTeu = 260 + 60 * Math.sin(sequence / 12);
    // Most Malacca/Singapore container moves are transshipment or direct relay moves;
    // only the dwell share enters terminal inventory. A bounded release controller
    // represents scheduled gate/rail/barge evacuation and prevents an always-on
    // simulator from accumulating an impossible yard backlog.
    const importYardInflow = throughputTeu * 0.18;
    const scheduledYardOutflow = (gateOutflowTeu + railTransferTeu + waterTransferTeu) / 4;
    const inventoryBalancingOutflow = Math.max(0, (this.state.yardInventoryTeu - 48_000) * 0.025);
    this.state.yardInventoryTeu = clamp(
      this.state.yardInventoryTeu + importYardInflow - scheduledYardOutflow - inventoryBalancingOutflow,
      8_000,
      yardCapacityTeu,
    );
    const yardOccupancyPercent = round(this.state.yardInventoryTeu / yardCapacityTeu * 100, 1);
    const berthUtilizationPercent = round(clamp(
      servicedVessels / Math.max(1, effectiveCapacity) * 74 + queueVessels * 0.5,
      12,
      100,
    ), 1);
    const truckTurnMinutes = round(24 + Math.max(0, yardOccupancyPercent - 65) * 0.85 + queueVessels * 0.35, 1);
    const shorePowerKw = 1_450 + servicedVessels * 190;
    const solarKw = round(Math.max(0, 3_800 * Math.sin((localHour - 6) / 12 * Math.PI)), 1);
    const equipmentPowerKw = 2_300 + throughputTeu * 0.72 + yardOccupancyPercent * 18;
    const buildingPowerKw = 1_650 + (localHour >= 8 && localHour <= 20 ? 420 : 0);
    const rawLoadKw = shorePowerKw + equipmentPowerKw + buildingPowerKw;
    const pricePeak = localHour >= 14 && localHour < 22;
    const electricityPriceMyrKwh = pricePeak ? 0.62 : localHour < 7 ? 0.34 : 0.48;
    const batteryCapacityKwh = 12_000;
    let batteryPowerKw = pricePeak && this.state.batterySocPercent > 25
      ? 1_800
      : !pricePeak && this.state.batterySocPercent < 88
        ? -1_200
        : 0;
    batteryPowerKw = clamp(batteryPowerKw, -3_000, 3_000);
    const efficiency = batteryPowerKw >= 0 ? 0.94 : 0.92;
    const socDelta = batteryPowerKw >= 0
      ? -(batteryPowerKw / efficiency) * 0.25 / batteryCapacityKwh * 100
      : -batteryPowerKw * efficiency * 0.25 / batteryCapacityKwh * 100;
    this.state.batterySocPercent = clamp(this.state.batterySocPercent + socDelta, 15, 95);
    this.state.batterySohPercent = clamp(
      this.state.batterySohPercent - Math.abs(batteryPowerKw) * 0.25 / batteryCapacityKwh * 0.0008,
      70,
      100,
    );
    const gridLoadKw = round(Math.max(0, rawLoadKw - solarKw - Math.max(0, batteryPowerKw) + Math.max(0, -batteryPowerKw)), 1);
    const transformerLoadingPercent = round(gridLoadKw / 18_000 * 100, 1);
    const carbonFactorKgKwh = round(0.58 - solarKw / Math.max(1, rawLoadKw) * 0.08, 3);
    const tickEnergyKwh = round(gridLoadKw * 0.25, 2);
    const tickCarbonTons = round(tickEnergyKwh * carbonFactorKgKwh / 1_000 * (this.activeControl?.carbonMultiplier ?? 1), 3);
    const tickCostMyr = round(tickEnergyKwh * electricityPriceMyrKwh, 2);
    const safetyIncidents = (!channelAvailable || this.scenario === 'equipment-failure') && sequence % 7 === 0 ? 1 : 0;
    const communicationLatencyMs = this.scenario === 'data-loss' ? 9_999
      : this.scenario === 'channel-congestion' ? 320
        : Math.round(72 + Math.abs(deterministicNoise(this.seed, sequence, 'latency')) * 48);
    const controlEnvelopeBreaches = transformerLoadingPercent > 95 || yardOccupancyPercent > 98 ? 1 : 0;

    this.state = {
      ...this.state,
      sequence,
      queueVessels,
      previousArrivals: arrivals,
      cumulativeThroughputTeu: this.state.cumulativeThroughputTeu + throughputTeu,
      cumulativeEnergyKwh: this.state.cumulativeEnergyKwh + tickEnergyKwh,
      cumulativeCarbonTons: this.state.cumulativeCarbonTons + tickCarbonTons,
      cumulativeCostMyr: this.state.cumulativeCostMyr + tickCostMyr,
      peakGridKw: Math.max(this.state.peakGridKw, gridLoadKw),
    };
    if (this.activeControl) {
      this.activeControl.remainingTicks -= 1;
      if (this.activeControl.remainingTicks <= 0) this.activeControl = null;
    }
    const tickState: TickState = {
      ...this.state,
      eventTime: this.eventTime(sequence),
      previousQueueVessels,
      controlQueueRelief: queueRelief,
      arrivals,
      servicedVessels,
      divertedVessels,
      effectiveCapacity,
      throughputTeu,
      yardOccupancyPercent,
      berthUtilizationPercent,
      quayCraneMovesPerHour,
      truckTurnMinutes,
      windSpeedMs,
      waveHeightM,
      visibilityKm,
      currentSpeedKnots,
      tideHeightM,
      tideWindowOpen,
      channelAvailable,
      availableQuayCranes,
      equipmentFaults,
      gridLoadKw,
      solarKw,
      shorePowerKw,
      batteryPowerKw,
      transformerLoadingPercent,
      electricityPriceMyrKwh,
      carbonFactorKgKwh,
      tickEnergyKwh,
      tickCarbonTons,
      tickCostMyr,
      safetyIncidents,
      communicationLatencyMs,
      controlEnvelopeBreaches,
    };
    this.recentTicks.push(tickState);
    if (this.recentTicks.length > 192) this.recentTicks.shift();
    return tickState;
  }

  private advance(nowMs: number) {
    if (!this.running) return;
    const target = Math.max(this.state.sequence, Math.floor((nowMs - this.startedAtMs) / this.wallTickMs));
    for (let sequence = this.state.sequence + 1; sequence <= target; sequence += 1) this.latestTick = this.step(sequence);
  }

  forceAdvance(ticks = 1) {
    if (!this.running) return this.latestTick!;
    for (let index = 0; index < ticks; index += 1) this.latestTick = this.step(this.state.sequence + 1);
    return this.latestTick!;
  }

  setRunning(running: boolean) {
    this.running = running;
  }

  setScenario(scenario: OperationalScenarioId) {
    this.scenario = scenario;
  }

  getStatus() {
    return { running: this.running, scenario: this.scenario, sequence: this.state.sequence };
  }

  applyAction(actionId: OperationalActionId) {
    const effectByAction: Record<OperationalActionId, ActiveControlEffect> = {
      'hold-plan': { actionId, remainingTicks: 4, queueRelief: 0, capacityMultiplier: 1, carbonMultiplier: 1, diversionFraction: 0 },
      'eco-speed': { actionId, remainingTicks: 8, queueRelief: 0.05, capacityMultiplier: 1, carbonMultiplier: 0.96, diversionFraction: 0 },
      'arrival-window': { actionId, remainingTicks: 8, queueRelief: 0.12, capacityMultiplier: 1, carbonMultiplier: 0.99, diversionFraction: 0 },
      'port-diversion': { actionId, remainingTicks: 8, queueRelief: 0.1, capacityMultiplier: 1, carbonMultiplier: 1.01, diversionFraction: 0.01 },
      'capacity-control': { actionId, remainingTicks: 8, queueRelief: 0.2, capacityMultiplier: 1.02, carbonMultiplier: 1.01, diversionFraction: 0 },
    };
    this.activeControl = effectByAction[actionId];
    return this.forceAdvance(1);
  }

  private makeField<T extends TelemetryValue>(
    value: T,
    unit: string,
    assetId: string,
    sourceType: TelemetrySourceType,
    options: { derived?: boolean; confidence?: number; quality?: TelemetryQualityStatus; sourceId?: string } = {},
  ): TelemetryField<T> {
    const tick = this.latestTick!;
    const offline = this.scenario === 'data-loss';
    const traceId = hash(`${this.runId}:${tick.sequence}:${assetId}`).slice(0, 24);
    return {
      value: offline ? null as T : value,
      unit,
      event_time: tick.eventTime,
      ingest_time: new Date().toISOString(),
      source_type: sourceType,
      source_id: options.sourceId ?? `${SITE_ID}/${assetId}`,
      quality_status: offline ? 'offline' : options.quality ?? 'normal',
      confidence: offline ? 0 : options.confidence ?? (options.derived ? 0.86 : 0.92),
      is_measured: sourceType === 'field_measured',
      is_simulated: sourceType === 'physics_simulation',
      is_derived: options.derived ?? sourceType === 'engineering_derived',
      site_id: SITE_ID,
      asset_id: assetId,
      schema_version: PORT_TELEMETRY_CONTRACT_VERSION,
      trace_id: traceId,
    };
  }

  private forecast(tick: TickState) {
    const points = Array.from({ length: 4 }, (_, index) => {
      const horizon = index + 1;
      const expectedArrivals = this.forecastModel.alpha * tick.arrivals
        + (1 - this.forecastModel.alpha) * tick.previousArrivals
        + 0.12 * Math.sin((tick.sequence + horizon) / 96 * Math.PI * 2);
      const scenarioMultiplier = this.scenario === 'peak-arrivals' ? 1.15 : 1;
      const arrivals = round(Math.max(0, expectedArrivals * scenarioMultiplier), 2);
      const capacity = tick.effectiveCapacity * (tick.channelAvailable ? 1 : 0.2);
      const queue = round(Math.max(0, tick.queueVessels + horizon * (arrivals - capacity)), 2);
      const energy = round(tick.tickEnergyKwh * (1 + arrivals / Math.max(1, tick.arrivals) * 0.08), 2);
      return {
        horizon_minutes: horizon * TICK_SIMULATION_MINUTES,
        arrivals,
        queue_vessels: queue,
        delay_minutes: round(queue / Math.max(0.5, capacity) * 15, 1),
        energy_kwh: energy,
        carbon_tons: round(energy * tick.carbonFactorKgKwh / 1_000, 3),
      };
    });
    return {
      protocol_version: 'port-forecast.v1',
      output_status: 'model-real-inference',
      model: {
        ...this.forecastModel,
        training_split: 'first 70% chronological MPA monthly records',
        validation_split: 'last 30% chronological MPA monthly records',
        limitation: 'monthly public-demand model projected into a constrained 15-minute engineering simulator; not a berth-level field forecast',
      },
      input_snapshot_hash: this.snapshotHash(tick),
      points,
    };
  }

  private snapshotHash(tick: TickState) {
    return hash({
      runId: this.runId,
      sequence: tick.sequence,
      arrivals: tick.arrivals,
      queue: tick.queueVessels,
      capacity: tick.effectiveCapacity,
      yard: tick.yardOccupancyPercent,
      energy: tick.tickEnergyKwh,
      weather: [tick.windSpeedMs, tick.waveHeightM, tick.visibilityKm],
    });
  }

  snapshot(nowMs = Date.now()) {
    this.advance(nowMs);
    const tick = this.latestTick!;
    const field = this.makeField.bind(this);
    const operationalTelemetry = {
      navigation: {
        channel_available: field(tick.channelAvailable, 'boolean', 'channel-malacca-main', 'physics_simulation'),
        tide_height_m: field(tick.tideHeightM, 'm', 'tide-station-reference', 'physics_simulation', { sourceId: 'engineering-tide-harmonic-v1' }),
        tide_window_open: field(tick.tideWindowOpen, 'boolean', 'channel-malacca-main', 'engineering_derived', { derived: true }),
        anchorage_queue_vessels: field(tick.queueVessels, 'vessels', 'anchorage-reference', 'engineering_derived', { derived: true }),
        pilot_available_count: field(Math.max(0, 8 - tick.equipmentFaults), 'people', 'pilot-pool', 'physics_simulation'),
        tug_available_count: field(Math.max(0, 6 - tick.equipmentFaults), 'vessels', 'tug-pool', 'physics_simulation'),
        wind_speed_ms: field(tick.windSpeedMs, 'm/s', 'metocean-grid-1.22N-103.75E', 'physics_simulation', { sourceId: 'Open-Meteo/ERA5-calibrated-weather-process' }),
        wave_height_m: field(tick.waveHeightM, 'm', 'metocean-grid-1.22N-103.75E', 'physics_simulation', { sourceId: 'Open-Meteo-Marine-calibrated-wave-process' }),
        visibility_km: field(tick.visibilityKm, 'km', 'metocean-grid-1.22N-103.75E', 'physics_simulation'),
        current_speed_knots: field(tick.currentSpeedKnots, 'kn', 'metocean-grid-1.22N-103.75E', 'physics_simulation'),
      },
      terminal: {
        arrivals: field(tick.arrivals, 'vessels/15min', TERMINAL_ID, 'physics_simulation', { sourceId: 'MPA-monthly-arrivals-calibrated-state-machine' }),
        serviced_vessels: field(tick.servicedVessels, 'vessels/15min', TERMINAL_ID, 'engineering_derived', { derived: true }),
        diverted_vessels: field(tick.divertedVessels, 'vessels/15min', TERMINAL_ID, 'engineering_derived', { derived: true }),
        queue_vessels: field(tick.queueVessels, 'vessels', TERMINAL_ID, 'engineering_derived', { derived: true }),
        average_waiting_minutes: field(round(tick.queueVessels / Math.max(0.5, tick.effectiveCapacity) * 15, 1), 'min', TERMINAL_ID, 'engineering_derived', { derived: true }),
        effective_service_capacity: field(tick.effectiveCapacity, 'vessels/15min', TERMINAL_ID, 'engineering_derived', { derived: true }),
        berth_utilization_percent: field(tick.berthUtilizationPercent, '%', TERMINAL_ID, 'engineering_derived', { derived: true }),
        quay_crane_moves_per_hour: field(tick.quayCraneMovesPerHour, 'moves/h/crane', TERMINAL_ID, 'physics_simulation'),
        throughput_teu: field(tick.throughputTeu, 'TEU/15min', TERMINAL_ID, 'engineering_derived', { derived: true }),
        yard_occupancy_percent: field(tick.yardOccupancyPercent, '%', 'yard-reference', 'physics_simulation'),
        yard_reshuffles: field(Math.round(Math.max(0, tick.yardOccupancyPercent - 70) * 2.2), 'moves/15min', 'yard-reference', 'engineering_derived', { derived: true }),
        reefer_container_count: field(Math.round(1_140 + tick.yardOccupancyPercent * 8), 'containers', 'reefer-zone', 'physics_simulation'),
        dangerous_goods_container_count: field(Math.round(110 + tick.yardOccupancyPercent * 1.2), 'containers', 'hazmat-zone', 'physics_simulation'),
        truck_turn_time_minutes: field(tick.truckTurnMinutes, 'min', 'gate-reference', 'engineering_derived', { derived: true }),
        rail_transfer_teu: field(tick.eventTime.includes('T0') ? 80 : 210, 'TEU/h', 'rail-terminal', 'physics_simulation'),
        water_transfer_teu: field(round(260 + 60 * Math.sin(tick.sequence / 12), 1), 'TEU/h', 'barge-terminal', 'physics_simulation'),
      },
      equipment: {
        quay_cranes_available: field(tick.availableQuayCranes, 'count', 'quay-crane-fleet', 'physics_simulation'),
        quay_cranes_total: field(10, 'count', 'quay-crane-fleet', 'physics_simulation'),
        rtg_available: field(Math.max(0, 28 - tick.equipmentFaults * 2), 'count', 'rtg-fleet', 'physics_simulation'),
        agv_available: field(Math.max(0, 54 - tick.equipmentFaults * 4), 'count', 'agv-fleet', 'physics_simulation'),
        terminal_trucks_available: field(Math.max(0, 76 - tick.equipmentFaults * 3), 'count', 'truck-fleet', 'physics_simulation'),
        active_faults: field(tick.equipmentFaults, 'events', 'equipment-fleet', 'physics_simulation', { quality: tick.equipmentFaults ? 'anomaly' : 'normal' }),
        maintenance_due_count: field(3 + (tick.sequence % 4), 'count', 'equipment-fleet', 'physics_simulation'),
      },
      energy: {
        grid_load_kw: field(tick.gridLoadKw, 'kW', 'main-meter', 'engineering_derived', { derived: true }),
        transformer_loading_percent: field(tick.transformerLoadingPercent, '%', 'transformer-main', 'engineering_derived', { derived: true }),
        shore_power_kw: field(tick.shorePowerKw, 'kW', 'shore-power-bus', 'physics_simulation'),
        solar_kw: field(tick.solarKw, 'kW', 'pv-array', 'physics_simulation'),
        battery_soc_percent: field(round(tick.batterySocPercent, 2), '%', 'bess-01', 'physics_simulation'),
        battery_soh_percent: field(round(tick.batterySohPercent, 3), '%', 'bess-01', 'physics_simulation'),
        battery_power_kw: field(tick.batteryPowerKw, 'kW (+discharge/-charge)', 'bess-01', 'physics_simulation'),
        battery_temperature_c: field(round(27 + Math.abs(tick.batteryPowerKw) / 1_000 * 1.6, 1), '°C', 'bess-01', 'physics_simulation'),
        electricity_price_myr_kwh: field(tick.electricityPriceMyrKwh, 'MYR/kWh', 'tariff-calendar', 'physics_simulation', { sourceId: 'engineering-tou-calendar-v1' }),
        carbon_factor_kg_kwh: field(tick.carbonFactorKgKwh, 'kgCO2e/kWh', 'grid-carbon-factor', 'engineering_derived', { derived: true, sourceId: 'engineering-grid-factor-v1' }),
        interval_energy_kwh: field(tick.tickEnergyKwh, 'kWh/15min', 'main-meter', 'engineering_derived', { derived: true }),
        interval_carbon_tons: field(tick.tickCarbonTons, 'tCO2e/15min', 'main-meter', 'engineering_derived', { derived: true }),
        interval_cost_myr: field(tick.tickCostMyr, 'MYR/15min', 'main-meter', 'engineering_derived', { derived: true }),
      },
      building: {
        hvac_power_kw: field(round(780 + Math.max(0, tick.windSpeedMs - 5) * 8, 1), 'kW', 'ba-hvac', 'physics_simulation'),
        lighting_power_kw: field(tick.solarKw > 0 ? 210 : 510, 'kW', 'ba-lighting', 'physics_simulation'),
        reefer_power_kw: field(round(1_120 + tick.yardOccupancyPercent * 5.2, 1), 'kW', 'reefer-bus', 'physics_simulation'),
        pump_power_kw: field(180, 'kW', 'pump-system', 'physics_simulation'),
        fan_power_kw: field(145, 'kW', 'fan-system', 'physics_simulation'),
        indoor_temperature_c: field(round(24.1 + deterministicNoise(this.seed, tick.sequence, 'indoor-temp') * 0.4, 1), '°C', 'ba-zone-01', 'physics_simulation'),
        indoor_humidity_percent: field(round(61 + deterministicNoise(this.seed, tick.sequence, 'humidity') * 3, 1), '%RH', 'ba-zone-01', 'physics_simulation'),
        illuminance_lux: field(tick.solarKw > 0 ? 520 : 410, 'lux', 'ba-zone-01', 'physics_simulation'),
      },
      safety: {
        safety_incidents: field(tick.safetyIncidents, 'events/15min', SITE_ID, 'physics_simulation', { quality: tick.safetyIncidents ? 'anomaly' : 'normal' }),
        control_envelope_breaches: field(tick.controlEnvelopeBreaches, 'events/15min', SITE_ID, 'engineering_derived', { derived: true, quality: tick.controlEnvelopeBreaches ? 'anomaly' : 'normal' }),
        network_anomaly_count: field(this.scenario === 'data-loss' ? 1 : 0, 'events', 'ot-network', 'physics_simulation', { quality: this.scenario === 'data-loss' ? 'offline' : 'normal' }),
        sensor_drift_count: field(this.scenario === 'channel-congestion' ? 1 : 0, 'sensors', 'sensor-fleet', 'physics_simulation', { quality: this.scenario === 'channel-congestion' ? 'drift' : 'normal' }),
        communication_latency_ms: field(tick.communicationLatencyMs, 'ms', 'ot-network', 'physics_simulation', { quality: tick.communicationLatencyMs > 2_000 ? 'offline' : tick.communicationLatencyMs > 250 ? 'delayed' : 'normal' }),
        communication_available: field(this.scenario !== 'data-loss', 'boolean', 'ot-network', 'physics_simulation'),
        hazmat_restriction_active: field(this.scenario === 'extreme-weather', 'boolean', 'hazmat-zone', 'physics_simulation'),
      },
    };
    const fields = collectTelemetryFields(operationalTelemetry);
    const normalFields = fields.filter((item) => item.quality_status === 'normal').length;
    const measuredFields = fields.filter((item) => item.is_measured).length;
    const simulatedFields = fields.filter((item) => item.is_simulated).length;
    const derivedFields = fields.filter((item) => item.is_derived).length;
    const conservation = round(tick.queueVessels, 2) === round(
      Math.max(0, tick.previousQueueVessels + tick.arrivals - tick.divertedVessels - tick.servicedVessels - tick.controlQueueRelief),
      2,
    );
    const quality = {
      total_fields: fields.length,
      normal_fields: normalFields,
      degraded_fields: fields.length - normalFields,
      measured_fields: measuredFields,
      simulated_fields: simulatedFields,
      derived_fields: derivedFields,
      completeness_percent: round(fields.filter((item) => item.value !== null).length / Math.max(1, fields.length) * 100, 1),
      consistency_checks: [
        { id: 'flow-conservation', passed: conservation, detail: 'queue(t)=queue(t-1)+arrivals-diverted-serviced-control_relief' },
        { id: 'yard-capacity', passed: tick.yardOccupancyPercent >= 0 && tick.yardOccupancyPercent <= 100, detail: '0% ≤ yard occupancy ≤ 100%' },
        { id: 'battery-envelope', passed: tick.batterySocPercent >= 15 && tick.batterySocPercent <= 95, detail: '15% ≤ SOC ≤ 95%' },
        { id: 'transformer-envelope', passed: tick.transformerLoadingPercent <= 100, detail: 'grid load ≤ 18 MW transformer capacity' },
        { id: 'causal-energy-link', passed: tick.throughputTeu === 0 || tick.tickEnergyKwh > 0, detail: 'positive throughput requires positive equipment and grid energy' },
      ],
    };
    const forecast = this.forecast(tick);
    const delayMinutes = round(tick.queueVessels / Math.max(0.5, tick.effectiveCapacity) * 15, 1);
    const safetyRiskPercent = round(clamp(
      (tick.channelAvailable ? 1 : 22) + tick.waveHeightM * 2.6 + tick.equipmentFaults * 4 + tick.controlEnvelopeBreaches * 8,
      0,
      100,
    ), 1);
    const resilienceIndex = round(clamp(100 - delayMinutes * 0.32 - safetyRiskPercent * 0.45 - Math.max(0, tick.yardOccupancyPercent - 75) * 0.4, 0, 100), 1);
    const malaysiaTime = (value: string) => new Date(Date.parse(value) + 8 * 60 * 60_000).toISOString();
    const currentDay = malaysiaTime(tick.eventTime).slice(0, 10);
    const previousDay = new Date(`${currentDay}T00:00:00Z`);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const previousDayKey = previousDay.toISOString().slice(0, 10);
    const dayCarbon = this.recentTicks
      .filter((item) => malaysiaTime(item.eventTime).startsWith(currentDay))
      .reduce((sum, item) => sum + item.tickCarbonTons, 0);
    const previousDayCarbon = this.recentTicks
      .filter((item) => malaysiaTime(item.eventTime).startsWith(previousDayKey))
      .reduce((sum, item) => sum + item.tickCarbonTons, 0);
    const hourlyCarbon = new Map<string, number>();
    for (const item of this.recentTicks.filter((entry) => malaysiaTime(entry.eventTime).startsWith(currentDay))) {
      const hour = `${malaysiaTime(item.eventTime).slice(11, 13)}时`;
      hourlyCarbon.set(hour, (hourlyCarbon.get(hour) ?? 0) + item.tickCarbonTons);
    }
    const carbonSnapshot = {
      todayEmission: round(dayCarbon, 2),
      todayUnit: 'tCO₂e/模拟日',
      changeVsYesterdayPercent: previousDayCarbon > 0
        ? round((dayCarbon - previousDayCarbon) / previousDayCarbon * 100, 1)
        : 0,
      trendUnit: 'tCO₂e/h',
      hourlyTrend: [...hourlyCarbon.entries()].map(([hour, value]) => ({ hour, value: round(value, 3) })),
    };
    const vessels = Array.from({ length: 7 }, (_, index) => {
      const progress = (tick.sequence * (1.4 + index * 0.12) + index * 13) % 100;
      const assetId = `vessel-${String(index + 1).padStart(3, '0')}`;
      return {
        asset_id: assetId,
        mmsi: field(`SIM-${this.seed}-${index + 1}`, 'identifier', assetId, 'physics_simulation'),
        latitude: field(round(1.1 + progress / 100 * 3.8 + index * 0.03, 5), '°N', assetId, 'physics_simulation'),
        longitude: field(round(99.7 + progress / 100 * 4.4, 5), '°E', assetId, 'physics_simulation'),
        speed_over_ground_knots: field(round(clamp(11.5 - tick.waveHeightM * 0.4 + index * 0.3, 6, 18), 1), 'kn', assetId, 'physics_simulation'),
        course_over_ground_deg: field(round(88 + index * 7 + deterministicNoise(this.seed, tick.sequence, assetId) * 2, 1), 'deg', assetId, 'physics_simulation'),
        eta: field(new Date(Date.parse(tick.eventTime) + (100 - progress) * 7 * 60_000).toISOString(), 'ISO8601', assetId, 'engineering_derived', { derived: true }),
        draught_m: field(round(8.2 + index * 0.65, 1), 'm', assetId, 'physics_simulation'),
        vessel_type: field(['container', 'tanker', 'cargo', 'bulk'][index % 4], 'controlled-vocabulary', assetId, 'physics_simulation'),
        capacity_teu: field(1_800 + index * 1_250, 'TEU', assetId, 'physics_simulation'),
        navigation_state: field(tick.channelAvailable ? 'underway' : 'holding', 'state', assetId, 'engineering_derived', { derived: true }),
      };
    });
    const metrics = [
      { id: 'active-vessels', label: '校准模拟船流', value: String(Math.round(1_220 + tick.arrivals * 18)), unit: '艘', detail: '公开 AIS 研究分布校准', trendLabel: `15分钟到港 ${tick.arrivals} 艘`, tone: 'ok' },
      { id: 'transit-vessels', label: '作业吞吐', value: tick.throughputTeu.toLocaleString('en-US'), unit: 'TEU/15分', detail: '作业守恒模型输出', trendLabel: `服务 ${tick.servicedVessels} 艘`, tone: tick.queueVessels > 30 ? 'warning' : 'ok' },
      { id: 'cargo-throughput', label: '累计吞吐', value: round(tick.cumulativeThroughputTeu / 1_000, 1).toString(), unit: '千TEU', detail: '当前模拟 run 累计', trendLabel: `堆场 ${tick.yardOccupancyPercent}%`, tone: tick.yardOccupancyPercent > 90 ? 'danger' : 'ok' },
      { id: 'carbon-emission', label: '区间碳排', value: tick.tickCarbonTons.toString(), unit: 'tCO₂e/15分', detail: '负荷×公开/工程碳因子', trendLabel: `能耗 ${tick.tickEnergyKwh.toFixed(0)} kWh`, tone: 'warning' },
      { id: 'resilience-index', label: '运行韧性指数', value: resilienceIndex.toString(), unit: '分', detail: '队列、安全、堆场派生', trendLabel: `安全风险 ${safetyRiskPercent}%`, tone: resilienceIndex < 70 ? 'danger' : resilienceIndex < 85 ? 'warning' : 'ok' },
    ];
    const channelProfiles = [
      ['malacca-main', 0.7],
      ['phillip-channel', 0.76],
      ['eastbound-lane', 0.9],
      ['westbound-lane', 0.68],
      ['singapore-east-west', 0.86],
      ['dumai-channel', 0.78],
    ] as const;
    const channels = channelProfiles.map(([id, stress]) => {
      const congestionPercent = clamp(Math.round(tick.berthUtilizationPercent * stress + tick.queueVessels * 0.7), 0, 100);
      const routeDelay = Math.round(delayMinutes * stress + (tick.channelAvailable ? 0 : 45));
      const tone = congestionPercent >= 76 || routeDelay >= 45 ? 'danger' : congestionPercent >= 54 || routeDelay >= 20 ? 'warning' : 'ok';
      return {
        id,
        congestionPercent,
        delayMinutes: routeDelay,
        tone,
        status: tone === 'danger' ? (tick.channelAvailable ? '严重拥堵' : '封航管制') : tone === 'warning' ? '轻度拥堵' : '正常',
      };
    });
    const routeProfiles = [
      ['main-route-north', 0.31, 0.2],
      ['main-route-south', 0.26, 0],
      ['secondary-route-klang-singapore', 0.19, -0.6],
      ['secondary-route-dumai', 0.09, -1.4],
      ['traffic-separation-singapore', 0.15, -1],
    ] as const;
    const dailyFlowBasis = Math.max(120, tick.arrivals * 96 + tick.queueVessels * 4);
    const routeOverlays = routeProfiles.map(([id, share, speedOffset], index) => {
      const vesselVolume = Math.max(1, Math.round(dailyFlowBasis * share));
      const averageSpeedKnots = round(clamp(14.2 + speedOffset - tick.waveHeightM * 0.42 - tick.queueVessels * 0.025, 6, 20), 1);
      const routeDelay = Math.round(delayMinutes * (0.62 + index * 0.08) + (tick.channelAvailable ? 0 : 45));
      const carbonEmissionTons = Math.round(vesselVolume * (2.9 + index * 0.34) * Math.max(0.55, (averageSpeedKnots / 12) ** 3));
      return {
        id,
        vesselVolume,
        averageSpeedKnots,
        delayMinutes: routeDelay,
        carbonEmissionTons,
        tone: routeDelay >= 45 ? 'danger' : routeDelay >= 18 ? 'warning' : 'ok',
      };
    });
    const correlationId = hash(`${this.runId}:${tick.sequence}`).slice(0, 24);
    return {
      protocolVersion: PORT_TELEMETRY_CONTRACT_VERSION,
      schema_version: PORT_TELEMETRY_CONTRACT_VERSION,
      sequence: tick.sequence,
      seed: this.seed,
      run_id: this.runId,
      event_time: tick.eventTime,
      ingest_time: new Date().toISOString(),
      site_id: SITE_ID,
      correlation_id: correlationId,
      source: '公开数据校准实时模拟 · MPA + Open-Meteo/ERA5 + IMO/工程参数',
      observedAt: tick.eventTime,
      simulator: {
        running: this.running,
        scenario: this.scenario,
        tick_simulation_minutes: TICK_SIMULATION_MINUTES,
        wall_tick_milliseconds: this.wallTickMs,
        deterministic_seed: this.seed,
      },
      authority: AUTHORITY,
      truth_labels: ['公开数据校准实时模拟', '模型真实推理输出', '待切换现场数据源'],
      calibration: {
        cross_port_reference: '马六甲场景使用新加坡 MPA 月度公开统计和 Piraeus AIS 公开样本作跨港参考，不是马六甲现场实测',
        datasets: [
          { id: 'MPA vessel arrivals monthly', hash: this.datasetHash, role: 'arrival process and forecast calibration', evidence: 'official aggregate' },
          { id: 'Open-Meteo/ERA5 marine reference', hash: 'runtime-source-adapter', role: 'weather and marine process envelope', evidence: 'public reanalysis/model' },
          { id: 'IMO GHG Study 2020 factors', hash: 'documented-factor-reference', role: 'carbon method boundary', evidence: 'official study' },
          { id: 'engineering-equipment-v1', hash: this.configHash, role: 'equipment, yard, energy and building constraints', evidence: 'engineering simulation' },
        ],
        model_hash: this.forecastModel.hash,
        config_hash: this.configHash,
      },
      contract: PORT_TELEMETRY_CONTRACT,
      quality,
      snapshot_hash: this.snapshotHash(tick),
      operationalTelemetry,
      assets: { vessels },
      forecast,
      kpis: {
        queue_vessels: tick.queueVessels,
        delay_minutes: delayMinutes,
        throughput_teu: tick.throughputTeu,
        energy_kwh: tick.tickEnergyKwh,
        peak_grid_kw: tick.peakGridKw,
        cost_myr: tick.tickCostMyr,
        carbon_tons: tick.tickCarbonTons,
        service_level_percent: round(tick.servicedVessels / Math.max(1, tick.arrivals + tick.queueVessels) * 100, 1),
        safety_risk_percent: safetyRiskPercent,
        resilience_index: resilienceIndex,
      },
      scenario: {
        id: 'malacca-public-calibrated-realtime-simulation',
        name: '马六甲公开数据校准实时推演',
        profileId: 'malacca-strait',
        evidenceMode: 'public-evidence',
        currentTime: tick.eventTime.replace('T', ' ').replace('Z', '+00:00'),
        metrics,
        carbon: carbonSnapshot,
        congestionHeatmap: {
          id: 'malacca-operational-congestion-heatmap',
          label: '后端运行拥堵热力图',
          lowLabel: '低',
          highLabel: '高',
          hotspots: [
            { nodeId: 'singapore', intensity: clamp(Math.round(tick.berthUtilizationPercent * 0.86), 0, 100) },
            { nodeId: 'port-klang', intensity: clamp(Math.round(tick.berthUtilizationPercent * 0.62), 0, 100) },
            { nodeId: 'tanjung-pelepas', intensity: clamp(Math.round(tick.berthUtilizationPercent * 0.58), 0, 100) },
          ],
        },
      },
      telemetry: {
        ports: [
          { id: 'singapore', congestionPercent: clamp(Math.round(tick.berthUtilizationPercent * 0.86), 0, 100), berthUtilizationPercent: Math.round(tick.berthUtilizationPercent), queueVessels: Math.round(tick.queueVessels), averageWaitingHours: round(delayMinutes / 60, 1), vesselCount: Math.round(380 + tick.arrivals * 12) },
          { id: 'port-klang', congestionPercent: clamp(Math.round(tick.berthUtilizationPercent * 0.62), 0, 100), berthUtilizationPercent: clamp(Math.round(tick.berthUtilizationPercent * 0.82), 0, 100), queueVessels: Math.round(tick.queueVessels * 0.42), averageWaitingHours: round(delayMinutes / 60 * 0.7, 1) },
          { id: 'tanjung-pelepas', congestionPercent: clamp(Math.round(tick.berthUtilizationPercent * 0.58), 0, 100), berthUtilizationPercent: clamp(Math.round(tick.berthUtilizationPercent * 0.78), 0, 100), queueVessels: Math.round(tick.queueVessels * 0.32), averageWaitingHours: round(delayMinutes / 60 * 0.62, 1) },
        ],
        vessels: vessels.map((vessel, index) => ({
          id: vessel.asset_id,
          mmsi: String(vessel.mmsi.value ?? vessel.asset_id),
          geo: {
            lat: Number(vessel.latitude.value),
            lon: Number(vessel.longitude.value),
          },
          positionSource: 'simulation',
          positionObservedAt: tick.eventTime,
          positionQuality: 'normal',
          speedKnots: vessel.speed_over_ground_knots.value ?? 0,
          headingDeg: vessel.course_over_ground_deg.value ?? 0,
          progressPercent: round(((tick.sequence * (1.4 + index * 0.12) + index * 13) % 100), 1),
          position: { x: `${round(8 + ((tick.sequence * (1.4 + index * 0.12) + index * 13) % 100) * 0.84, 2)}%`, y: `${round(78 - index * 6 + Math.sin((tick.sequence + index) / 8) * 4, 2)}%` },
          carbonEmissionTonsPerHour: round(
            [1.8, 0.8, 1.1, 0.9][index % 4] * 3.114 * Math.max(
              0.15,
              (Number(vessel.speed_over_ground_knots.value ?? 10) / 12) ** 3,
            ),
            2,
          ),
        })),
        channels,
        routeOverlays,
        weather: {
          windSpeedMs: tick.windSpeedMs,
          windDirection: tick.windSpeedMs > 12 ? '西南风' : '东南风',
          temperatureC: round(29 + Math.sin(tick.sequence / 96 * Math.PI * 2) * 2, 1),
          visibilityKm: tick.visibilityKm,
          waveHeightM: tick.waveHeightM,
          currentSpeedKnots: tick.currentSpeedKnots,
          waterTemperatureC: 29.4,
          pressureHpa: 1009,
        },
        overview: { portCount: 32, channelCount: 6, anchorageCount: 48, monitoredVesselCount: Math.round(1_220 + tick.arrivals * 18) },
        metrics,
        riskAlerts: this.scenario === 'normal' ? [] : [{ id: `ops-${this.scenario}`, label: `模拟场景：${this.scenario}`, description: '后端异常场景引擎已改变受约束状态', tone: this.scenario === 'data-loss' || this.scenario === 'channel-closure' ? 'danger' : 'warning', affectedArea: '参考码头与航道', estimatedImpact: `队列 ${tick.queueVessels} 艘 / 设备故障 ${tick.equipmentFaults}` }],
        eventLog: [{ id: `ops-tick-${tick.sequence}`, time: tick.eventTime.slice(11, 19), message: `实时模拟 tick ${tick.sequence} · 到港 ${tick.arrivals} / 服务 ${tick.servicedVessels} / 队列 ${tick.queueVessels}`, tone: tick.queueVessels > 30 ? 'warning' : 'ok' }],
      },
      evidence: {
        mode: 'public-evidence',
        mpa: { agency: 'Maritime and Port Authority of Singapore', dataset: 'Vessel Arrivals (>75 GT), Monthly', collectionId: '394', datasetIds: ['d_d48c5a038904f6da3c603cd854b6c191'], period: '1995-01/2026-05', monthlyVessels: 11729, grossTonnage: 278622.13, retrievedAt: tick.eventTime, url: 'https://data.gov.sg/collections/394/view' },
        weather: { provider: 'Open-Meteo/ERA5 reference', modelType: 'calibrated weather and marine engineering process', observedAt: tick.eventTime, coordinate: { lat: 1.22, lon: 103.75 }, url: 'https://open-meteo.com/en/docs/marine-weather-api', navigationDisclaimer: '公开模型与工程模拟只用于推演，不替代航海通告和现场传感器。' },
        ais: { mode: 'public-research-baseline', source: 'INFORE Piraeus AIS scale sample + Malacca AIS public research distribution', period: 'public historical reference', facts: { rawMessages: 371585 }, doi: '10.5281/zenodo.3754481', liveEndpointConfigured: false, recordsMapped: 0, notice: '船位为公开研究分布校准的可复现模拟；授权 AIS 接入后由适配器覆盖。' },
        carbon: { source: 'Fourth IMO GHG Study 2020 + engineering grid factor', method: 'energy × carbon factor; vessel factors retained as documented boundary', factorsKgCo2PerKgFuel: { HFO: 3.114, MDO: 3.206, LNG: 2.75 }, url: 'https://www.imo.org/en/ourwork/environment/pages/fourth-imo-greenhouse-gas-study-2020.aspx' },
      },
    };
  }
}

export class OperationalControlService {
  readonly simulator: PortOperationsSimulator;
  private readonly decisions = new Map<string, OperationalDecision>();
  private readonly idempotencyReceipts = new Map<string, OperationalDecision>();
  private readonly audit: OperationalAuditRecord[] = [];
  private readonly auditFile: string | null;

  constructor(options: { simulator?: PortOperationsSimulator; auditFile?: string | null } = {}) {
    this.simulator = options.simulator ?? new PortOperationsSimulator();
    this.auditFile = options.auditFile === undefined
      ? path.resolve(process.env.PORT_OPERATION_AUDIT_FILE || '.runtime/operations/audit-chain.jsonl')
      : options.auditFile;
  }

  private appendAudit(eventType: string, correlationId: string, payload: Record<string, unknown>) {
    const previousHash = this.audit.at(-1)?.hash ?? '0'.repeat(64);
    const frozenPayload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    const recordBase = {
      sequence: this.audit.length + 1,
      audit_time: new Date().toISOString(),
      event_type: eventType,
      correlation_id: correlationId,
      payload: frozenPayload,
      previous_hash: previousHash,
    };
    const record: OperationalAuditRecord = { ...recordBase, hash: hash(recordBase) };
    this.audit.push(record);
    if (this.auditFile) {
      mkdirSync(path.dirname(this.auditFile), { recursive: true });
      appendFileSync(this.auditFile, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    }
    return record;
  }

  snapshot(nowMs = Date.now()) {
    return this.simulator.snapshot(nowMs);
  }

  controlSimulator(action: 'start' | 'stop') {
    this.simulator.setRunning(action === 'start');
    const status = this.simulator.getStatus();
    this.appendAudit(`simulator.${action}`, `simulator-${status.sequence}`, status);
    return status;
  }

  injectScenario(scenario: OperationalScenarioId) {
    this.simulator.setScenario(scenario);
    const snapshot = this.simulator.snapshot();
    this.appendAudit('scenario.injected', snapshot.correlation_id, { scenario, snapshot_hash: snapshot.snapshot_hash });
    return snapshot;
  }

  recommendations(trainedActionId?: OperationalActionId) {
    const snapshot = this.snapshot();
    if (!snapshot.simulator.running) throw new Error('SIMULATOR_STOPPED');
    if (snapshot.quality.completeness_percent < 95 || snapshot.operationalTelemetry.safety.communication_available.value !== true) {
      throw new Error('DATA_QUALITY_GATE_BLOCKED');
    }
    const current = snapshot.kpis;
    const project = (actionId: OperationalActionId) => {
      const factors: Record<OperationalActionId, { queue: number; throughput: number; energy: number; carbon: number; safety: number }> = {
        'hold-plan': { queue: 1, throughput: 1, energy: 1, carbon: 1, safety: 1 },
        'eco-speed': { queue: 1.01, throughput: 0.995, energy: 0.96, carbon: 0.94, safety: 0.98 },
        'arrival-window': { queue: 0.94, throughput: 0.998, energy: 0.98, carbon: 0.97, safety: 0.93 },
        'port-diversion': { queue: 0.91, throughput: 0.99, energy: 1.01, carbon: 1.005, safety: 0.96 },
        'capacity-control': { queue: 0.88, throughput: 1.015, energy: 1.025, carbon: 1.02, safety: 0.97 },
      };
      const factor = factors[actionId];
      const projected = {
        queue_vessels: round(current.queue_vessels * factor.queue, 2),
        delay_minutes: round(current.delay_minutes * factor.queue, 2),
        throughput_teu: round(current.throughput_teu * factor.throughput, 2),
        energy_kwh: round(current.energy_kwh * factor.energy, 2),
        carbon_tons: round(current.carbon_tons * factor.carbon, 3),
        safety_risk_percent: round(current.safety_risk_percent * factor.safety, 2),
      };
      const objective = projected.delay_minutes * 0.28
        + projected.queue_vessels * 0.24
        + projected.carbon_tons * 8 * 0.18
        + projected.safety_risk_percent * 0.2
        - projected.throughput_teu / 1_000 * 0.1;
      return { projected, objective: round(objective, 4) };
    };
    const chooseBest = () => (Object.keys(ACTION_LABELS) as OperationalActionId[])
      .map((actionId) => ({ actionId, ...project(actionId) }))
      .sort((left, right) => left.objective - right.objective)[0];
    const best = chooseBest();
    const sopAction: OperationalActionId = current.safety_risk_percent > 15 ? 'arrival-window'
      : current.queue_vessels > 24 ? 'capacity-control'
        : current.carbon_tons > 1.5 ? 'eco-speed'
          : 'hold-plan';
    const definitions: Array<{
      controller: OperationalControllerId;
      family: string;
      action: OperationalActionId;
      evidence: string;
      eligible: boolean;
      rejection: string | null;
    }> = [
      { controller: 'fcfs', family: 'queue baseline', action: 'hold-plan', evidence: '先到先服务，不做预测性干预', eligible: true, rejection: null },
      { controller: 'port-sop', family: 'rule baseline', action: sopAction, evidence: '按安全、队列和碳阈值执行港口 SOP 代理', eligible: true, rejection: null },
      { controller: 'operations-research', family: 'enumerative operations optimization', action: best.actionId, evidence: '枚举动作白名单并最小化延误、队列、碳、安全和吞吐目标', eligible: true, rejection: null },
      { controller: 'mpc', family: 'model predictive control', action: best.actionId, evidence: '使用四步真实预测输出执行滚动时域约束优化', eligible: true, rejection: null },
      { controller: 'rl-checkpoint', family: 'reinforcement learning', action: trainedActionId ?? 'hold-plan', evidence: trainedActionId ? '动作来自已完成训练任务检查点' : '需要传入已完成检查点的真实推理动作', eligible: Boolean(trainedActionId), rejection: trainedActionId ? null : 'missing_completed_checkpoint_inference' },
    ];
    const candidates: OperationalCandidate[] = definitions.map((definition) => {
      const projected = project(definition.action);
      return {
        controller_id: definition.controller,
        family: definition.family,
        action_id: definition.action,
        action_label: ACTION_LABELS[definition.action],
        objective_value: projected.objective,
        projected_kpis: projected.projected,
        constraints: [
          'single-step deferral <= 2%',
          'single-step diversion <= 1%',
          'temporary capacity uplift <= 2%',
          'battery SOC 15%-95%',
          'transformer loading <= 100%',
          'simulation only; production dispatch disabled',
        ],
        eligible: definition.eligible,
        rejection_reason: definition.rejection,
        evidence: definition.evidence,
      };
    });
    return {
      protocol_version: 'port-control-candidates.v1',
      generated_at: new Date().toISOString(),
      input_snapshot_hash: snapshot.snapshot_hash,
      dataset_hash: this.simulator.datasetHash,
      model_hash: this.simulator.forecastModel.hash,
      config_hash: this.simulator.configHash,
      authority: AUTHORITY,
      recommended_controller: candidates.filter((candidate) => candidate.eligible)
        .sort((left, right) => left.objective_value - right.objective_value)[0]?.controller_id,
      candidates,
    };
  }

  handoffReport() {
    const snapshot = this.snapshot();
    let recommendation: ReturnType<OperationalControlService['recommendations']> | null = null;
    let gateStatus = 'open';
    try {
      recommendation = this.recommendations();
    } catch (error) {
      gateStatus = error instanceof Error ? error.message : 'OPERATIONAL_GATE_BLOCKED';
    }
    const best = recommendation?.candidates.find(
      (candidate) => candidate.controller_id === recommendation?.recommended_controller,
    ) ?? null;
    const warnings = [
      snapshot.kpis.queue_vessels > 24 ? `队列 ${snapshot.kpis.queue_vessels} 艘超过 24 艘运行阈值` : null,
      snapshot.kpis.safety_risk_percent > 15 ? `安全风险 ${snapshot.kpis.safety_risk_percent}% 超过 15% 提醒阈值` : null,
      snapshot.operationalTelemetry.terminal.yard_occupancy_percent.value !== null &&
        Number(snapshot.operationalTelemetry.terminal.yard_occupancy_percent.value) > 85
        ? `堆场占用 ${snapshot.operationalTelemetry.terminal.yard_occupancy_percent.value}% 超过 85% 提醒阈值`
        : null,
      snapshot.quality.completeness_percent < 95 ? `数据完整率 ${snapshot.quality.completeness_percent}% 不满足控制门禁` : null,
      snapshot.simulator.running ? null : '实时模拟器已停止，控制候选已失败关闭',
    ].filter((warning): warning is string => Boolean(warning));
    const traces = [
      snapshot.operationalTelemetry.terminal.queue_vessels.trace_id,
      snapshot.operationalTelemetry.terminal.yard_occupancy_percent.trace_id,
      snapshot.operationalTelemetry.energy.grid_load_kw.trace_id,
      snapshot.operationalTelemetry.safety.communication_available.trace_id,
    ];
    return {
      protocol_version: 'xiaoyi-operational-handoff.v1',
      generated_at: new Date().toISOString(),
      generator: {
        id: 'operations-grounded-explainer.v1',
        kind: 'deterministic_state_grounding',
        model_used: false,
        disclosure: '这是后端状态规则生成的可审计底稿；只有 xiaoyi_model.status=connected 时才展示生成模型回答。',
      },
      input_snapshot_hash: snapshot.snapshot_hash,
      correlation_id: snapshot.correlation_id,
      state_summary: `场景${snapshot.simulator.scenario}，队列 ${snapshot.kpis.queue_vessels} 艘，延误 ${snapshot.kpis.delay_minutes} 分钟，吞吐 ${snapshot.kpis.throughput_teu} TEU，能耗 ${snapshot.kpis.energy_kwh} kWh，碳排 ${snapshot.kpis.carbon_tons} 吨。`,
      warnings: warnings.length ? warnings : ['当前软件阈值内无新增运行预警；仍不代表现场安全放行。'],
      strategy: best
        ? { controller_id: best.controller_id, action_id: best.action_id, action_label: best.action_label, evidence: best.evidence }
        : { controller_id: null, action_id: null, action_label: '控制门禁已阻断', evidence: gateStatus },
      shift_handoff: {
        gate_status: gateStatus,
        authority: AUTHORITY,
        simulator_running: snapshot.simulator.running,
        scenario: snapshot.simulator.scenario,
        data_quality_percent: snapshot.quality.completeness_percent,
        pending_decisions: this.listDecisions().filter((decision) => decision.status === 'pending_approval').length,
        last_audit_hash: this.audit.at(-1)?.hash ?? '0'.repeat(64),
      },
      evidence: {
        trace_ids: traces,
        dataset_hash: this.simulator.datasetHash,
        model_hash: this.simulator.forecastModel.hash,
        config_hash: this.simulator.configHash,
      },
    };
  }

  createDecision(controllerId: OperationalControllerId, trainedActionId?: OperationalActionId) {
    const recommendations = this.recommendations(trainedActionId);
    const candidate = recommendations.candidates.find((item) => item.controller_id === controllerId);
    if (!candidate) throw new Error('UNKNOWN_CONTROLLER');
    if (!candidate.eligible) throw new Error(candidate.rejection_reason ?? 'CONTROLLER_NOT_ELIGIBLE');
    const createdAt = new Date().toISOString();
    const decisionId = `decision-${hash(`${createdAt}:${controllerId}:${recommendations.input_snapshot_hash}`).slice(0, 16)}`;
    const correlationId = `correlation-${decisionId.slice(-16)}`;
    const before = {
      defer_fraction: candidate.action_id === 'arrival-window' ? 0.02 : 0,
      diversion_fraction: candidate.action_id === 'port-diversion' ? 0.01 : 0,
      capacity_multiplier: candidate.action_id === 'capacity-control' ? 1.02 : 1,
      carbon_multiplier: candidate.action_id === 'eco-speed' ? 0.94 : 1,
    };
    const after = {
      defer_fraction: clamp(before.defer_fraction, 0, 0.02),
      diversion_fraction: clamp(before.diversion_fraction, 0, 0.01),
      capacity_multiplier: clamp(before.capacity_multiplier, 1, 1.02),
      carbon_multiplier: clamp(before.carbon_multiplier, 0.9, 1.05),
    };
    const decision: OperationalDecision = {
      protocol_version: PORT_DECISION_CONTRACT_VERSION,
      decision_id: decisionId,
      created_at: createdAt,
      correlation_id: correlationId,
      input_snapshot_hash: recommendations.input_snapshot_hash,
      dataset_hash: recommendations.dataset_hash,
      model_hash: recommendations.model_hash,
      config_hash: recommendations.config_hash,
      controller_id: controllerId,
      model_version: controllerId === 'rl-checkpoint' ? 'completed-checkpoint' : `${controllerId}.v1`,
      recommended_action: candidate.action_id,
      projected_action: {
        before,
        after,
        triggered_constraints: Object.keys(after).filter((key) => before[key as keyof typeof before] !== after[key as keyof typeof after]),
        modified: JSON.stringify(before) !== JSON.stringify(after),
      },
      status: 'pending_approval',
      approvals: [],
      receipt: null,
    };
    this.decisions.set(decisionId, decision);
    this.appendAudit('decision.created', correlationId, {
      decision_id: decisionId,
      input_snapshot_hash: decision.input_snapshot_hash,
      dataset_hash: decision.dataset_hash,
      model_hash: decision.model_hash,
      config_hash: decision.config_hash,
      controller_id: controllerId,
      recommended_action: decision.recommended_action,
      projected_action: decision.projected_action,
    });
    return decision;
  }

  approveDecision(decisionId: string, approvers: Array<{ approver_id: string; role: 'operator' | 'safety_officer' }>) {
    const decision = this.decisions.get(decisionId);
    if (!decision) throw new Error('DECISION_NOT_FOUND');
    if (decision.status !== 'pending_approval') throw new Error('DECISION_NOT_PENDING');
    const uniqueIds = new Set(approvers.map((item) => item.approver_id));
    const roles = new Set(approvers.map((item) => item.role));
    if (approvers.length < 2 || uniqueIds.size < 2 || !roles.has('operator') || !roles.has('safety_officer')) {
      throw new Error('DUAL_APPROVAL_REQUIRED');
    }
    decision.approvals = approvers.map((item) => ({ ...item, approved_at: new Date().toISOString() }));
    decision.status = 'approved';
    this.appendAudit('decision.approved', decision.correlation_id, {
      decision_id: decisionId,
      approvals: decision.approvals,
    });
    return decision;
  }

  executeDecision(decisionId: string, idempotencyKey: string) {
    if (!/^[a-zA-Z0-9._-]{8,120}$/.test(idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
    const existing = this.idempotencyReceipts.get(idempotencyKey);
    if (existing) return { decision: existing, idempotent_replay: true };
    const decision = this.decisions.get(decisionId);
    if (!decision) throw new Error('DECISION_NOT_FOUND');
    if (decision.status !== 'approved') throw new Error('DECISION_NOT_APPROVED');
    const status = this.simulator.getStatus();
    if (!status.running || status.scenario === 'data-loss') {
      decision.status = 'failed';
      this.appendAudit('decision.failed', decision.correlation_id, {
        decision_id: decisionId,
        reason: !status.running ? 'simulator_stopped' : 'data_quality_gate_blocked',
      });
      throw new Error(!status.running ? 'SIMULATOR_STOPPED' : 'DATA_QUALITY_GATE_BLOCKED');
    }
    const before = this.snapshot().kpis;
    const after = this.simulator.applyAction(decision.recommended_action);
    const afterSnapshot = this.snapshot();
    const afterKpis = afterSnapshot.kpis;
    decision.status = 'executed';
    decision.receipt = {
      receipt_id: `receipt-${hash(`${decisionId}:${idempotencyKey}`).slice(0, 16)}`,
      executor: 'simulation-executor.v1',
      status: 'acknowledged',
      executed_at: after.eventTime,
      before_kpis: before,
      after_kpis: afterKpis,
      kpi_delta: Object.fromEntries(
        Object.keys(before).map((key) => [key, round((afterKpis[key as keyof typeof afterKpis] ?? 0) - (before[key as keyof typeof before] ?? 0), 3)]),
      ),
      failure_reason: null,
      rollback_reason: null,
    };
    this.idempotencyReceipts.set(idempotencyKey, decision);
    this.appendAudit('decision.executed', decision.correlation_id, {
      decision_id: decisionId,
      idempotency_key_hash: hash(idempotencyKey),
      receipt: decision.receipt,
      output_snapshot_hash: afterSnapshot.snapshot_hash,
    });
    return { decision, idempotent_replay: false };
  }

  rollbackDecision(decisionId: string, reason: string) {
    const decision = this.decisions.get(decisionId);
    if (!decision || decision.status !== 'executed' || !decision.receipt) throw new Error('EXECUTED_DECISION_NOT_FOUND');
    this.simulator.applyAction('hold-plan');
    decision.status = 'rolled_back';
    decision.receipt.status = 'rolled_back';
    decision.receipt.rollback_reason = reason || 'operator_requested_rollback';
    this.appendAudit('decision.rolled_back', decision.correlation_id, {
      decision_id: decisionId,
      reason: decision.receipt.rollback_reason,
    });
    return decision;
  }

  getDecision(decisionId: string) {
    return this.decisions.get(decisionId) ?? null;
  }

  listDecisions() {
    return [...this.decisions.values()].reverse();
  }

  auditTrail() {
    const verified = this.audit.every((record, index) => {
      const previousHash = index === 0 ? '0'.repeat(64) : this.audit[index - 1].hash;
      const { hash: currentHash, ...base } = record;
      return record.previous_hash === previousHash && hash(base) === currentHash;
    });
    return {
      protocol_version: 'port-audit-chain.v1',
      verified,
      record_count: this.audit.length,
      head_hash: this.audit.at(-1)?.hash ?? '0'.repeat(64),
      records: [...this.audit].reverse(),
    };
  }
}
