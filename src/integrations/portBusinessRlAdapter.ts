import type { PortOperationsSnapshot } from './operationsControlAdapter';

export type PortBusinessActionId =
  | 'hold-plan'
  | 'eco-speed-advisory'
  | 'arrival-window-smooth'
  | 'berth-reassign'
  | 'crane-rebalance'
  | 'yard-gate-smooth'
  | 'pilot-tug-priority'
  | 'shore-power-priority'
  | 'intermodal-rebalance'
  | 'recovery-capacity'
  | 'neighbor-port-advisory';

export interface PortBusinessChampionStatus {
  protocolVersion: 'port-business-runtime-status.v1';
  generatedAt: string;
  evidenceLabel: string;
  contract: {
    version: 'port-business-rl.v3';
    observationCount: number;
    actionCount: number;
    rewardComponentCount: number;
  };
  dataset: {
    id: string;
    fingerprint: string;
    evidenceLevel: string;
    operationalClaimAllowed: boolean;
    recordCount: number;
  };
  champion: {
    admitted: boolean;
    algorithmId: string;
    attemptId: string;
    seedPolicyCount: number;
    finalTestGate: unknown;
    finalTest: unknown;
  };
  boundary: Record<string, boolean>;
  operationalDeploymentAdmitted: boolean;
}

export interface PortBusinessRuntimeDecision {
  protocolVersion: 'port-business-runtime-decision.v1';
  proposalId: string;
  generatedAt: string;
  champion: {
    algorithmId: string;
    attemptId: string;
    seedPolicyCount: number;
    datasetFingerprint: string;
    evidenceLabel: string;
  };
  inputEvidence: {
    recordTimestamp: string;
    portId: string;
    terminalId: string;
    dataQualityScore: number;
    forecastUncertainty: number;
    sourceProtocolVersion: string;
    snapshotHash: string;
    source: string;
    liveDataVerified: boolean;
    operatorMeasuredFieldCount: number;
  };
  inference: {
    protocolVersion: 'port-business-runtime-inference.v1';
    observationTensor: Array<{ id: string; raw: number; normalized: number; inRange: boolean }>;
    applicableActionIds: PortBusinessActionId[];
    actionDistribution: Array<{
      actionId: PortBusinessActionId;
      label: string;
      meanValue: number;
      ensembleStd: number;
      probability: number;
      voteShare: number;
      applicable: boolean;
    }>;
    selectedAction: {
      actionId: PortBusinessActionId;
      label: string;
      probability: number;
      voteShare: number;
      requiresHumanApproval: boolean;
    };
    uncertainty: {
      normalizedEntropy: number;
      outOfRangeObservationCount: number;
      ensemblePolicyCount: number;
    };
  };
  projected: {
    requestedActionId: PortBusinessActionId;
    executedActionId: PortBusinessActionId;
    modified: boolean;
    feasible: boolean;
    reasons: string[];
    hardConstraintViolations: 0;
    requiresHumanApproval: boolean;
    dispatchAllowed: false;
  };
  deterministicFallback: {
    owner: 'deterministic-optimizer';
    selectedActionId: PortBusinessActionId;
    candidates: Array<{ actionId: PortBusinessActionId; score: number; predictedQueue: number; predictedYard: number }>;
    constraintsApplied: true;
    humanApprovalRequired: boolean;
    dispatchAllowed: false;
  };
  businessProjection: Record<string, unknown> & {
    queueVessels: { before: number; after: number };
    meanWaitingHours: { before: number; after: number };
    yardOccupancy: { before: number; after: number };
    gateQueuePressure: { before: number; after: number };
    carbonIntensity: { before: number; after: number };
    fairnessGap: { before: number; after: number };
    recoveryBacklogVessels: { before: number; after: number };
    throughputRetentionPercent: number;
  };
  admission: {
    status: 'admitted_for_simulation_review' | 'abstain_use_deterministic_fallback';
    thresholds: Record<string, number>;
    checks: Record<string, boolean>;
    blockers: string[];
    recommendationSource: 'reinforcement-learning-advisory' | 'deterministic-optimizer';
    recommendedActionId: PortBusinessActionId;
  };
  authority: Record<string, boolean>;
  approval: {
    status: 'not_required' | 'pending_simulation_review' | 'approved_for_sandbox';
    requiredRoles: string[];
    approvals: Array<{ approverId: string; role: string; approvedAt: string }>;
  };
  execution: { dispatchAllowed: false; receiptIssued: false; reason: string };
}

export interface PortBusinessDecisionReport {
  protocolVersion: 'port-business-decision-report.v1';
  generatedAt: string;
  completionStatus: 'APPROVED_SIMULATION_ONLY' | 'NO_ACTION_APPROVAL_REQUIRED' | 'PENDING_SIMULATION_REVIEW';
  proposal: PortBusinessRuntimeDecision;
  auditHash: string;
}

const headers = (authToken = '', extra: Record<string, string> = {}) => ({
  Accept: 'application/json',
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  ...extra,
});

const parseResponse = async <T>(response: Response): Promise<T> => {
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
  return payload as T;
};

const numberField = (
  snapshot: PortOperationsSnapshot,
  domain: string,
  name: string,
  fallback = 0,
) => {
  const value = snapshot.operationalTelemetry[domain]?.[name]?.value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const booleanField = (
  snapshot: PortOperationsSnapshot,
  domain: string,
  name: string,
  fallback = false,
) => {
  const value = snapshot.operationalTelemetry[domain]?.[name]?.value;
  return typeof value === 'boolean' ? value : fallback;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const buildPortBusinessRuntimeInput = (snapshot: PortOperationsSnapshot) => {
  const arrivals = numberField(snapshot, 'terminal', 'arrivals');
  const effectiveCapacity = Math.max(1, numberField(snapshot, 'terminal', 'effective_service_capacity', 1));
  const queueVessels = numberField(snapshot, 'terminal', 'queue_vessels');
  const yardOccupancy = clamp(numberField(snapshot, 'terminal', 'yard_occupancy_percent') / 100, 0, 1.2);
  const truckTurnTimeMinutes = numberField(snapshot, 'terminal', 'truck_turn_time_minutes', 30);
  const railTransferDemand = numberField(snapshot, 'terminal', 'rail_transfer_teu');
  const waterTransferDemand = numberField(snapshot, 'terminal', 'water_transfer_teu');
  const quayCranesAvailable = numberField(snapshot, 'equipment', 'quay_cranes_available');
  const quayCranesTotal = Math.max(1, numberField(snapshot, 'equipment', 'quay_cranes_total', 1));
  const pilotAvailable = numberField(snapshot, 'navigation', 'pilot_available_count');
  const tugAvailable = numberField(snapshot, 'navigation', 'tug_available_count');
  const carbonFactor = numberField(snapshot, 'energy', 'carbon_factor_kg_kwh', 0.58);
  const energyPrice = numberField(snapshot, 'energy', 'electricity_price_myr_kwh', 0.48);
  const transformerLoading = numberField(snapshot, 'energy', 'transformer_loading_percent', 65);
  const capacityLossRatio = clamp(1 - effectiveCapacity / 5.2, 0, 1);
  const qualityScore = clamp(snapshot.quality.completeness_percent / 100, 0, 1);
  const forecastUncertainty = clamp(
    snapshot.forecast.model.validationRmseVesselsPerMonth /
      Math.max(1, snapshot.forecast.points[0]?.arrivals ?? arrivals) / 100,
    0.08,
    0.55,
  );
  const sourceMonth = snapshot.event_time.slice(0, 7);
  const record = {
    portId: snapshot.site_id,
    terminalId: 'malacca-reference-terminal',
    timestamp: snapshot.event_time,
    sourceMonth,
    publicAnchorArrivals: arrivals,
    publicAnchorGrossTonnage: arrivals * 45_000,
    publicAnchorWindSpeedMs: numberField(snapshot, 'navigation', 'wind_speed_ms'),
    arrivals,
    grossTonnage: arrivals * 45_000,
    effectiveCapacity,
    etaDeviationHours: numberField(snapshot, 'terminal', 'average_waiting_minutes') / 60,
    berthUtilization: clamp(numberField(snapshot, 'terminal', 'berth_utilization_percent') / 100, 0, 1.2),
    craneProductivityIndex: clamp(numberField(snapshot, 'terminal', 'quay_crane_moves_per_hour', 28) / 28, 0, 1.5),
    craneAvailabilityRatio: clamp(quayCranesAvailable / quayCranesTotal, 0, 1),
    yardOccupancy,
    truckTurnTimeMinutes,
    gateQueuePressure: clamp(truckTurnTimeMinutes / 60 + queueVessels / effectiveCapacity * 0.12, 0, 2),
    railTransferDemand,
    waterTransferDemand,
    transferCapacity: Math.max(1, (railTransferDemand + waterTransferDemand) * 1.24),
    channelAvailable: booleanField(snapshot, 'navigation', 'channel_available'),
    tideWindowOpen: booleanField(snapshot, 'navigation', 'tide_window_open'),
    pilotAvailabilityRatio: clamp(pilotAvailable / 4, 0, 1),
    tugAvailabilityRatio: clamp(tugAvailable / 6, 0, 1),
    windSpeedMs: numberField(snapshot, 'navigation', 'wind_speed_ms'),
    waveHeightM: numberField(snapshot, 'navigation', 'wave_height_m'),
    visibilityKm: numberField(snapshot, 'navigation', 'visibility_km'),
    currentSpeedKnots: numberField(snapshot, 'navigation', 'current_speed_knots'),
    safetyRisk: clamp(snapshot.kpis.safety_risk_percent / 100, 0, 1),
    hazmatRestrictionActive: booleanField(snapshot, 'safety', 'hazmat_restriction_active'),
    shorePowerAvailability: clamp((100 - transformerLoading) / 35, 0, 1),
    carbonIntensity: clamp(carbonFactor / 0.52, 0, 2),
    energyPriceIndex: clamp(energyPrice / 0.48, 0, 2),
    capacityLossRatio,
    vesselSizeIndex: 1,
    fairnessDemandSkew: clamp(0.18 + queueVessels / effectiveCapacity * 0.035, 0, 1),
    forecastUncertainty,
    dataQualityScore: qualityScore,
  };
  return {
    record,
    state: {
      queueVessels,
      deferredBacklogVessels: 0,
      recoveryBacklogVessels: queueVessels * capacityLossRatio,
      yardOccupancy,
      gateQueuePressure: record.gateQueuePressure,
      fairnessGap: record.fairnessDemandSkew,
      previousActionId: 'hold-plan' as const,
    },
    provenance: {
      sourceProtocolVersion: snapshot.protocolVersion,
      snapshotHash: snapshot.snapshot_hash,
      source: snapshot.source,
      liveDataVerified: snapshot.authority.live_data_verified,
      operatorMeasuredFieldCount: snapshot.quality.measured_fields,
    },
  };
};

export const fetchPortBusinessChampionStatus = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/rl/business/status', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<PortBusinessChampionStatus>(response));

export const inferCurrentPortBusinessPolicy = (
  snapshot: PortOperationsSnapshot,
  authToken = '',
) => fetch('/api/rl/business/infer', {
  method: 'POST',
  headers: headers(authToken, { 'Content-Type': 'application/json' }),
  body: JSON.stringify(buildPortBusinessRuntimeInput(snapshot)),
}).then((response) => parseResponse<PortBusinessRuntimeDecision>(response));

export const approvePortBusinessProposal = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/business/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      approvers: [
        { approverId: 'local-business-operator-test', role: 'operator' },
        { approverId: 'local-business-safety-test', role: 'safety_officer' },
      ],
    }),
  }).then((response) => parseResponse<PortBusinessRuntimeDecision>(response));

export const fetchPortBusinessDecisionReport = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/business/proposals/${encodeURIComponent(proposalId)}/report`, {
    cache: 'no-store',
    headers: headers(authToken),
  }).then((response) => parseResponse<PortBusinessDecisionReport>(response));
