const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Reports are exportable evidence: a transport-level object check alone cannot
// establish that the response belongs to the requested proposal or lifecycle.
export const validateDecisionReport = (
  value: unknown,
  expectedProposalId: string,
  kind: 'port-business' | 'core-operations',
): void => {
  const invalid = () => new Error('决策报告格式或完成状态无效，请重新读取当前提案报告');
  if (!record(value) || value.protocolVersion !== `${kind}-decision-report.v1`
    || typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))
    || typeof value.auditHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.auditHash)
    || typeof value.completionStatus !== 'string' || !record(value.proposal)) throw invalid();

  const proposal = value.proposal;
  if (typeof proposal.proposalId !== 'string' || proposal.proposalId !== expectedProposalId) {
    throw new Error('决策报告与当前提案不匹配，请重新读取当前提案报告');
  }
  if (proposal.protocolVersion !== `${kind}-runtime-decision.v1`
    || !record(proposal.approval) || !record(proposal.execution) || !record(proposal.authority)
    || proposal.authority.simulation_mode !== true || proposal.authority.live_data_verified !== false
    || proposal.authority.dispatch_allowed !== false || proposal.authority.production_authority !== false
    || proposal.execution.dispatchAllowed !== false) throw invalid();

  const approvalStatus = proposal.approval.status;
  if (typeof approvalStatus !== 'string'
    || !['approved_for_sandbox', 'not_required', 'pending_simulation_review'].includes(approvalStatus)) throw invalid();
  let completionStatus: string;
  if (kind === 'port-business') {
    if (proposal.execution.receiptIssued !== false) throw invalid();
    completionStatus = approvalStatus === 'approved_for_sandbox'
      ? 'APPROVED_SIMULATION_ONLY'
      : approvalStatus === 'not_required' ? 'NO_ACTION_APPROVAL_REQUIRED' : 'PENDING_SIMULATION_REVIEW';
  } else {
    const executionStatus = proposal.execution.status;
    if (proposal.execution.productionAuthority !== false
      || typeof executionStatus !== 'string'
      || !['not_executed', 'executed', 'rolled_back', 'failed'].includes(executionStatus)) throw invalid();
    if ((executionStatus === 'executed' || executionStatus === 'rolled_back') && approvalStatus !== 'approved_for_sandbox') throw invalid();
    completionStatus = executionStatus === 'executed'
      ? 'EXECUTED_SIMULATION_ONLY'
      : executionStatus === 'rolled_back' ? 'ROLLED_BACK_SIMULATION_ONLY'
        : approvalStatus === 'approved_for_sandbox' ? 'APPROVED_NOT_EXECUTED' : 'PENDING_SIMULATION_REVIEW';
  }
  if (value.completionStatus !== completionStatus) throw invalid();
};
