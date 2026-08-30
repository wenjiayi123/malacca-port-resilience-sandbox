import type {
  SimulatorAuthorityBoundary,
  TelemetryField,
  TelemetryQualitySummary,
} from '../../shared/portTelemetryContract';

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
export type RegulatoryScenarioId =
  | 'baseline'
  | 'maritime-inspection'
  | 'customs-document-hold'
  | 'dual-inspection-recovery';

export interface RegulatoryResilienceEvidence {
  protocolVersion: 'port-regulatory-resilience.v1';
  sequence: number;
  eventTime: string;
  scenario: RegulatoryScenarioId;
  inputSnapshotHash: string;
  responseHash: string;
  authority: Record<string, boolean>;
  observationContract: string[];
  state: Record<string, number>;
  exogenousSignals: Record<string, number>;
  impact: Record<string, number>;
  strategy: {
    id: string;
    status: string;
    inspectionReadinessRatio: number;
    postReleaseRecoveryPriorityRatio: number;
    preservedOperationalActions: string[];
    selectedSeed: number;
    training: { seeds: number[]; episodesPerSeed: number; rendering: false };
  };
  businessEvidence: {
    costReductionPercent: number;
    carbonReductionPercent: number;
    energyReductionPercent: number;
    regulatoryDelayReductionPercent: number;
    recoveryServiceChangePercent: number;
    endingRecoveryBacklogChange: number;
    expectedSafetyViolationChange: number;
    authorityViolationChange: number;
    costReductionCi95: { lower95Percent: number; upper95Percent: number; pairedRows: number };
    evidenceSha256: string;
    blockedCandidateArtifact: string;
    qualifiedCandidateArtifact: string;
    scope: string;
  };
  sources: Array<{ authority: string; subject: string; url: string }>;
  lineage: {
    scenarioFields: string;
    inspectionTelemetryMeasured: boolean;
    reportArtifact: string;
  };
  generatedAt: string;
}

export interface PortOperationsSnapshot {
  protocolVersion: 'port-operations.telemetry.v1';
  sequence: number;
  seed: number;
  run_id: string;
  event_time: string;
  ingest_time: string;
  site_id: string;
  correlation_id: string;
  source: string;
  simulator: {
    running: boolean;
    scenario: OperationalScenarioId;
    tick_simulation_minutes: number;
    wall_tick_milliseconds: number;
    deterministic_seed: number;
  };
  authority: SimulatorAuthorityBoundary;
  truth_labels: string[];
  calibration: {
    cross_port_reference: string;
    datasets: Array<{ id: string; hash: string; role: string; evidence: string }>;
    model_hash: string;
    config_hash: string;
  };
  quality: TelemetryQualitySummary;
  snapshot_hash: string;
  operationalTelemetry: Record<string, Record<string, TelemetryField>>;
  assets: { vessels: Array<Record<string, TelemetryField | string>> };
  forecast: {
    protocol_version: string;
    output_status: string;
    model: {
      id: string;
      alpha: number;
      trainRows: number;
      validationRows: number;
      trainRmseVesselsPerMonth: number;
      validationRmseVesselsPerMonth: number;
      hash: string;
      training_split: string;
      validation_split: string;
      limitation: string;
    };
    input_snapshot_hash: string;
    points: Array<{
      horizon_minutes: number;
      arrivals: number;
      queue_vessels: number;
      delay_minutes: number;
      energy_kwh: number;
      carbon_tons: number;
    }>;
  };
  kpis: Record<string, number>;
}

export interface OperationalCandidate {
  controller_id: OperationalControllerId;
  family: string;
  action_id: string;
  action_label: string;
  objective_value: number;
  projected_kpis: Record<string, number>;
  constraints: string[];
  eligible: boolean;
  rejection_reason: string | null;
  evidence: string;
}

export interface OperationalRecommendationResponse {
  protocol_version: string;
  generated_at: string;
  input_snapshot_hash: string;
  dataset_hash: string;
  model_hash: string;
  config_hash: string;
  authority: SimulatorAuthorityBoundary;
  recommended_controller: OperationalControllerId;
  candidates: OperationalCandidate[];
}

export interface OperationalDecision {
  protocol_version: string;
  decision_id: string;
  created_at: string;
  correlation_id: string;
  input_snapshot_hash: string;
  dataset_hash: string;
  model_hash: string;
  config_hash: string;
  controller_id: OperationalControllerId;
  model_version: string;
  recommended_action: string;
  projected_action: {
    before: Record<string, number>;
    after: Record<string, number>;
    triggered_constraints: string[];
    modified: boolean;
  };
  status: 'pending_approval' | 'approved' | 'executed' | 'rolled_back' | 'failed';
  approvals: Array<{ approver_id: string; role: string; approved_at: string }>;
  receipt: null | {
    receipt_id: string;
    executor: string;
    status: string;
    executed_at: string;
    before_kpis: Record<string, number>;
    after_kpis: Record<string, number>;
    kpi_delta: Record<string, number>;
    failure_reason: string | null;
    rollback_reason: string | null;
  };
}

export interface AuditTrail {
  protocol_version: string;
  verified: boolean;
  record_count: number;
  head_hash: string;
  records: Array<{
    sequence: number;
    audit_time: string;
    event_type: string;
    correlation_id: string;
    payload: Record<string, unknown>;
    previous_hash: string;
    hash: string;
  }>;
}

export interface ModelRegistry {
  protocol_version: string;
  generated_at: string;
  models: Array<{
    id: string;
    version: string;
    run_id: string;
    status: 'champion' | 'candidate' | 'rollback' | 'archive' | 'rejected';
    family: string;
    model_hash?: string;
    dataset_hash?: string;
    config_hash?: string;
    evidence_artifact?: string;
    evidence_scope: string;
    rejection_reason?: string;
  }>;
}

export interface ProductionReadinessStatus {
  protocolVersion: 'production-readiness-status.v1';
  generatedAt: string;
  gates: {
    identityAndOtSafety: {
      policyDecisionPointAvailable: boolean;
      identityTrustKeyCount: number;
      interlockTrustKeyCount: number;
      acceptedSiteID: string;
      acceptedSiteReference: string;
      readyForPolicyEvaluation: boolean;
      blockers: string[];
    };
    siteAcceptance: {
      evidencePath: string;
      evidenceLevel: string;
      decision: {
        softwareEvidenceComplete: boolean;
        siteDeliveryReady: boolean;
        blockers: string[];
        validSignoffCount: number;
        requiredSignoffCount: number;
      };
    };
    reliability: {
      softwareControlsReady: boolean;
      siteReliabilityAccepted: boolean;
      blockers: string[];
      targets: {
        rpoMinutes: number;
        rtoMinutes: number;
        availabilityPercent: number;
        observationDays: number;
      };
    };
  };
  externalBlockers: string[];
  siteDeliveryReady: boolean;
  authority: {
    simulationMode: true;
    liveDataVerified: false;
    productionAuthority: false;
    dispatchAllowed: false;
  };
}

export interface XiaoyiOperationalHandoff {
  protocol_version: 'xiaoyi-operational-handoff.v1';
  generated_at: string;
  generator: {
    id: string;
    kind: string;
    model_used: boolean;
    disclosure: string;
  };
  input_snapshot_hash: string;
  correlation_id: string;
  state_summary: string;
  warnings: string[];
  strategy: {
    controller_id: OperationalControllerId | null;
    action_id: string | null;
    action_label: string;
    evidence: string;
  };
  shift_handoff: {
    gate_status: string;
    authority: SimulatorAuthorityBoundary;
    simulator_running: boolean;
    scenario: OperationalScenarioId;
    data_quality_percent: number;
    pending_decisions: number;
    last_audit_hash: string;
  };
  evidence: {
    trace_ids: string[];
    dataset_hash: string;
    model_hash: string;
    config_hash: string;
  };
  xiaoyi_model: {
    status: 'connected' | 'not-configured' | 'unavailable';
    model_used: boolean;
    answer: string | null;
    disclosure: string;
  };
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

export const fetchOperationsSnapshot = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/snapshot', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<PortOperationsSnapshot>(response));

export const fetchRegulatoryResilience = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/regulatory-resilience', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<RegulatoryResilienceEvidence>(response));

export const injectRegulatoryScenario = (scenario: RegulatoryScenarioId, authToken = '') =>
  fetch('/api/operations/regulatory-resilience/scenario', {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ scenario }),
  }).then((response) => parseResponse<RegulatoryResilienceEvidence>(response));

export const fetchOperationalRecommendations = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/recommendations', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<OperationalRecommendationResponse>(response));

export const createOperationalDecision = (controllerId: OperationalControllerId, authToken = '') =>
  fetch('/api/operations/decisions', {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ controller_id: controllerId }),
  }).then((response) => parseResponse<OperationalDecision>(response));

export const approveOperationalDecision = (decisionId: string, authToken = '') =>
  fetch(`/api/operations/decisions/${encodeURIComponent(decisionId)}/approve`, {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json', 'X-Operator-Role': 'operator,safety_officer' }),
    body: JSON.stringify({
      approvers: [
        { approver_id: 'local-operator-review', role: 'operator' },
        { approver_id: 'local-safety-review', role: 'safety_officer' },
      ],
    }),
  }).then((response) => parseResponse<OperationalDecision>(response));

export const executeOperationalDecision = (decisionId: string, authToken = '') =>
  fetch(`/api/operations/decisions/${encodeURIComponent(decisionId)}/execute`, {
    method: 'POST',
    headers: headers(authToken, {
      'Content-Type': 'application/json',
      'Idempotency-Key': `ui-execute-${decisionId}`,
    }),
    body: '{}',
  }).then((response) => parseResponse<{ decision: OperationalDecision; idempotent_replay: boolean }>(response));

export const rollbackOperationalDecision = (decisionId: string, authToken = '') =>
  fetch(`/api/operations/decisions/${encodeURIComponent(decisionId)}/rollback`, {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason: 'local_acceptance_operator_rollback' }),
  }).then((response) => parseResponse<OperationalDecision>(response));

export const injectOperationalScenario = (scenario: OperationalScenarioId, authToken = '') =>
  fetch('/api/operations/scenarios', {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ scenario }),
  }).then((response) => parseResponse<PortOperationsSnapshot>(response));

export const setOperationalSimulatorRunning = (running: boolean, authToken = '') =>
  fetch('/api/operations/simulator/control', {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: running ? 'start' : 'stop' }),
  }).then((response) => parseResponse<{ running: boolean; scenario: OperationalScenarioId; sequence: number }>(response));

export const fetchOperationalAudit = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/audit', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<AuditTrail>(response));

export const fetchOperationalModels = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/models', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<ModelRegistry>(response));

export const fetchProductionReadiness = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/operations/production-readiness', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<ProductionReadinessStatus>(response));

export const fetchXiaoyiOperationalHandoff = (authToken = '') =>
  fetch('/api/operations/handoff', { cache: 'no-store', headers: headers(authToken) })
    .then((response) => parseResponse<XiaoyiOperationalHandoff>(response));
