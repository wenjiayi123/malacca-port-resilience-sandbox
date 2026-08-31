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

export interface CoreOperationsChampionStatus {
  protocolVersion: 'core-operations-runtime-status.v1';
  generatedAt: string;
  evidenceLabel: string;
  contract: {
    version: 'core-operations-rl.v1';
    observationCount: number;
    actionHeadCount: number;
    actionChoiceCount: number;
    rewardComponentCount: number;
  };
  champion: {
    admitted: boolean;
    algorithmId: string;
    attemptId: string;
    seedPolicyCount: number;
    validationGate: unknown;
    finalTestGate: unknown;
  };
  boundary: Record<string, boolean>;
  simulationExecutionAdmitted: boolean;
  operationalDeploymentAdmitted: boolean;
}

export interface CoreOperationsRuntimeDecision {
  protocolVersion: 'core-operations-runtime-decision.v1';
  proposalId: string;
  generatedAt: string;
  inputEvidence: {
    snapshotHash: string;
    sequence: number;
    eventTime: string;
    source: string;
    dataQualityScore: number;
    measuredFieldCount: number;
    simulatedFieldCount: number;
    liveDataVerified: boolean;
  };
  champion: {
    algorithmId: string;
    attemptId: string;
    seedPolicyCount: number;
    datasetFingerprint: string;
    evidenceLabel: string;
  };
  inference: {
    heads: Array<{
      domain: CoreOperationsDomain;
      selectedChoiceId: string;
      voteShare: number;
      probability: number;
    }>;
    outOfRangeObservationCount: number;
  };
  domainAbstentions: CoreOperationsDomain[];
  activeDomains: CoreOperationsDomain[];
  primaryOperationalActionId: string;
  projectedBusinessValue: Record<string, { before: number; after: number } | number>;
  admission: {
    status: 'admitted_for_simulation_approval' | 'abstain_hold_plan';
    minimumVoteShare: number;
    checks: Record<string, boolean>;
    blockers: string[];
    recommendationSource: string;
  };
  approval: {
    status: 'pending_simulation_review' | 'approved_for_sandbox' | 'not_required';
    requiredRoles: string[];
    approvals: Array<{ approverId: string; role: string; approvedAt: string }>;
  };
  execution: {
    status: 'not_executed' | 'executed' | 'rolled_back' | 'failed';
    dispatchAllowed: false;
    productionAuthority: false;
    receipt: null | {
      receipt_id?: string;
      active_domains?: string[];
      kpi_delta?: Record<string, number>;
      domain_delta?: Record<string, number>;
      counterfactual?: {
        design: string;
        baseline_output_snapshot_hash: string;
        baseline_kpis: Record<string, number>;
        rl_vs_baseline_kpi_delta: Record<string, number>;
        rl_vs_baseline_domain_delta: Record<string, number>;
      };
      attribution?: string;
    };
    reason: string;
  };
  authority: Record<string, boolean>;
}

export interface CoreOperationsDecisionReport {
  protocolVersion: 'core-operations-decision-report.v1';
  generatedAt: string;
  completionStatus:
    | 'EXECUTED_SIMULATION_ONLY'
    | 'ROLLED_BACK_SIMULATION_ONLY'
    | 'APPROVED_NOT_EXECUTED'
    | 'PENDING_SIMULATION_REVIEW';
  proposal: CoreOperationsRuntimeDecision;
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

export const fetchCoreOperationsChampionStatus = (authToken = '', signal?: AbortSignal) =>
  fetch('/api/rl/core/status', { cache: 'no-store', headers: headers(authToken), signal })
    .then((response) => parseResponse<CoreOperationsChampionStatus>(response));

export const inferCoreOperationsPolicy = (authToken = '') =>
  fetch('/api/rl/core/infer', {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: '{}',
  }).then((response) => parseResponse<CoreOperationsRuntimeDecision>(response));

export const approveCoreOperationsProposal = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/core/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ approvers: [
      { approverId: 'local-core-operator-test', role: 'operator' },
      { approverId: 'local-core-safety-test', role: 'safety_officer' },
    ] }),
  }).then((response) => parseResponse<CoreOperationsRuntimeDecision>(response));

export const executeCoreOperationsProposal = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/core/proposals/${encodeURIComponent(proposalId)}/execute`, {
    method: 'POST',
    headers: headers(authToken, {
      'Content-Type': 'application/json',
      'Idempotency-Key': `ui-core-execute-${proposalId}`,
    }),
    body: '{}',
  }).then((response) => parseResponse<{ proposal: CoreOperationsRuntimeDecision }>(response))
    .then((result) => result.proposal);

export const rollbackCoreOperationsProposal = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/core/proposals/${encodeURIComponent(proposalId)}/rollback`, {
    method: 'POST',
    headers: headers(authToken, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ reason: 'local_core_plan_acceptance_rollback' }),
  }).then((response) => parseResponse<CoreOperationsRuntimeDecision>(response));

export const fetchCoreOperationsDecisionReport = (proposalId: string, authToken = '') =>
  fetch(`/api/rl/core/proposals/${encodeURIComponent(proposalId)}/report`, {
    cache: 'no-store',
    headers: headers(authToken),
  }).then((response) => parseResponse<CoreOperationsDecisionReport>(response));
