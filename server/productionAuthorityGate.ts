import { createHash, sign, verify, type KeyLike } from 'node:crypto';
import { canonicalJson } from './operatorIntegrationGateway.ts';

export const IDENTITY_APPROVAL_VERSION = 'identity-bound-approval.v1' as const;
export const OT_INTERLOCK_RECEIPT_VERSION = 'independent-ot-interlock.v1' as const;

export interface ProductionDecisionReference {
  decisionID: string;
  creatorSubjectID: string;
  decisionDigest: string;
  inputSnapshotHash: string;
  actionID: string;
  riskTier: 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface IdentityBoundApproval {
  protocolVersion: typeof IDENTITY_APPROVAL_VERSION;
  assertionID: string;
  keyID: string;
  issuer: string;
  audience: string;
  subjectID: string;
  subjectType: 'HUMAN';
  organizationID: string;
  roles: Array<'OPERATOR' | 'SAFETY_OFFICER' | 'RELEASE_MANAGER' | 'AUDITOR'>;
  sessionID: string;
  mfa: true;
  assuranceLevel: 'AAL2' | 'AAL3';
  decisionID: string;
  decisionDigest: string;
  inputSnapshotHash: string;
  actionID: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface IndependentOtInterlockReceipt {
  protocolVersion: typeof OT_INTERLOCK_RECEIPT_VERSION;
  receiptID: string;
  keyID: string;
  issuer: string;
  siteID: string;
  decisionID: string;
  decisionDigest: string;
  inputSnapshotHash: string;
  safeToProceed: boolean;
  emergencyStopClear: boolean;
  communicationsHealthy: boolean;
  maintenanceBypassActive: boolean;
  observedAt: string;
  expiresAt: string;
  signature: string;
}

export interface ChangeAuthorization {
  changeTicketID: string;
  approvedWindowStart: string;
  approvedWindowEnd: string;
  siteAcceptanceReference: string;
  rollbackPlanReference: string;
  independentSafetyValidationReference: string;
}

export interface ProductionReleaseBundle {
  decision: ProductionDecisionReference;
  approvals: IdentityBoundApproval[];
  interlock: IndependentOtInterlockReceipt;
  change: ChangeAuthorization;
}

export interface ProductionAuthorityGateOptions {
  identityTrustBundle: Record<string, string>;
  interlockTrustBundle: Record<string, string>;
  audience: string;
  acceptedSiteID: string;
  acceptedSiteReference: string;
  clock?: () => Date;
}

const STABLE_ID = /^[A-Za-z0-9._:/-]{2,180}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PLACEHOLDER = /(?:example|replace|pending|placeholder|todo|tbd|test-only|待填写|待确认)/i;

const unsigned = <T extends { signature: string }>(value: T) => Object.fromEntries(
  Object.entries(value).filter(([key]) => key !== 'signature'),
) as Omit<T, 'signature'>;

const signedBytes = <T>(value: T) => Buffer.from(canonicalJson(value));

export const signIdentityBoundApproval = (
  value: Omit<IdentityBoundApproval, 'signature'>,
  privateKey: KeyLike,
): IdentityBoundApproval => ({
  ...value,
  signature: sign(null, signedBytes(value), privateKey).toString('base64url'),
});

export const signIndependentOtInterlock = (
  value: Omit<IndependentOtInterlockReceipt, 'signature'>,
  privateKey: KeyLike,
): IndependentOtInterlockReceipt => ({
  ...value,
  signature: sign(null, signedBytes(value), privateKey).toString('base64url'),
});

const validTime = (value: string) => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));

const verifyDetached = (value: { keyID: string; signature: string }, trustBundle: Record<string, string>) => {
  const publicKey = trustBundle[value.keyID];
  if (!publicKey) return false;
  try {
    return verify(null, signedBytes(unsigned(value)), publicKey, Buffer.from(value.signature, 'base64url'));
  } catch {
    return false;
  }
};

const validateDecision = (decision: ProductionDecisionReference, blockers: string[]) => {
  for (const [field, value] of Object.entries({
    decisionID: decision.decisionID,
    creatorSubjectID: decision.creatorSubjectID,
    actionID: decision.actionID,
  })) if (!STABLE_ID.test(value)) blockers.push(`decision_${field}_invalid`);
  if (!SHA256.test(decision.decisionDigest)) blockers.push('decision_digest_invalid');
  if (!SHA256.test(decision.inputSnapshotHash)) blockers.push('input_snapshot_hash_invalid');
  if (!['MEDIUM', 'HIGH', 'CRITICAL'].includes(decision.riskTier)) blockers.push('decision_risk_tier_invalid');
};

export const evaluateProductionRelease = (
  bundle: ProductionReleaseBundle,
  options: ProductionAuthorityGateOptions,
) => {
  const now = (options.clock ?? (() => new Date()))();
  const nowMs = now.getTime();
  const blockers: string[] = [];
  validateDecision(bundle.decision, blockers);
  if (!Array.isArray(bundle.approvals) || bundle.approvals.length < 2) blockers.push('dual_approval_missing');
  const validApprovals: IdentityBoundApproval[] = [];
  for (const [index, approval] of (bundle.approvals ?? []).entries()) {
    const prefix = `approval_${index}`;
    if (approval.protocolVersion !== IDENTITY_APPROVAL_VERSION) blockers.push(`${prefix}_protocol_invalid`);
    if (!verifyDetached(approval, options.identityTrustBundle)) blockers.push(`${prefix}_signature_invalid`);
    if (approval.audience !== options.audience) blockers.push(`${prefix}_audience_invalid`);
    if (approval.subjectType !== 'HUMAN') blockers.push(`${prefix}_human_subject_required`);
    if (approval.mfa !== true || !['AAL2', 'AAL3'].includes(approval.assuranceLevel)) blockers.push(`${prefix}_strong_auth_required`);
    if (!validTime(approval.issuedAt) || !validTime(approval.expiresAt)) blockers.push(`${prefix}_time_invalid`);
    else {
      const issuedAt = Date.parse(approval.issuedAt);
      const expiresAt = Date.parse(approval.expiresAt);
      if (issuedAt > nowMs + 30_000 || expiresAt <= nowMs || expiresAt - issuedAt > 10 * 60_000) blockers.push(`${prefix}_time_window_invalid`);
    }
    if (approval.decisionID !== bundle.decision.decisionID || approval.decisionDigest !== bundle.decision.decisionDigest ||
        approval.inputSnapshotHash !== bundle.decision.inputSnapshotHash || approval.actionID !== bundle.decision.actionID) {
      blockers.push(`${prefix}_decision_binding_invalid`);
    }
    if (approval.subjectID === bundle.decision.creatorSubjectID) blockers.push(`${prefix}_creator_cannot_approve`);
    if (!STABLE_ID.test(approval.subjectID) || !STABLE_ID.test(approval.sessionID) || !STABLE_ID.test(approval.organizationID)) {
      blockers.push(`${prefix}_identity_invalid`);
    }
    if (!STABLE_ID.test(approval.assertionID) || !STABLE_ID.test(approval.keyID) ||
        !Array.isArray(approval.roles) || approval.roles.length === 0 ||
        approval.roles.some((role) => !['OPERATOR', 'SAFETY_OFFICER', 'RELEASE_MANAGER', 'AUDITOR'].includes(role))) {
      blockers.push(`${prefix}_claims_invalid`);
    }
    validApprovals.push(approval);
  }
  const subjects = new Set(validApprovals.map((approval) => approval.subjectID));
  const sessions = new Set(validApprovals.map((approval) => approval.sessionID));
  const roles = new Set(validApprovals.flatMap((approval) => approval.roles));
  if (subjects.size < 2 || sessions.size < 2) blockers.push('separation_of_duties_failed');
  if (!roles.has('OPERATOR') || !roles.has('SAFETY_OFFICER')) blockers.push('operator_and_safety_roles_required');
  const operatorSubjects = new Set(validApprovals.filter((approval) => approval.roles.includes('OPERATOR')).map((approval) => approval.subjectID));
  const safetySubjects = new Set(validApprovals.filter((approval) => approval.roles.includes('SAFETY_OFFICER')).map((approval) => approval.subjectID));
  if (![...operatorSubjects].some((operatorSubject) => [...safetySubjects].some((safetySubject) => safetySubject !== operatorSubject))) {
    blockers.push('required_roles_not_separated');
  }

  const interlock = bundle.interlock;
  if (interlock.protocolVersion !== OT_INTERLOCK_RECEIPT_VERSION) blockers.push('interlock_protocol_invalid');
  if (!verifyDetached(interlock, options.interlockTrustBundle)) blockers.push('interlock_signature_invalid');
  if (interlock.siteID !== options.acceptedSiteID) blockers.push('interlock_site_invalid');
  if (interlock.decisionID !== bundle.decision.decisionID || interlock.decisionDigest !== bundle.decision.decisionDigest ||
      interlock.inputSnapshotHash !== bundle.decision.inputSnapshotHash) blockers.push('interlock_decision_binding_invalid');
  if (!validTime(interlock.observedAt) || !validTime(interlock.expiresAt)) blockers.push('interlock_time_invalid');
  else {
    const observedAt = Date.parse(interlock.observedAt);
    const expiresAt = Date.parse(interlock.expiresAt);
    if (observedAt > nowMs + 5_000 || nowMs - observedAt > 30_000 || expiresAt <= nowMs || expiresAt - observedAt > 60_000) {
      blockers.push('interlock_freshness_invalid');
    }
  }
  if (!interlock.safeToProceed || !interlock.emergencyStopClear || !interlock.communicationsHealthy || interlock.maintenanceBypassActive) {
    blockers.push('independent_ot_interlock_blocked');
  }

  const change = bundle.change;
  if (!validTime(change.approvedWindowStart) || !validTime(change.approvedWindowEnd) ||
      nowMs < Date.parse(change.approvedWindowStart) || nowMs > Date.parse(change.approvedWindowEnd)) {
    blockers.push('approved_change_window_closed');
  } else if (Date.parse(change.approvedWindowEnd) - Date.parse(change.approvedWindowStart) > 8 * 3_600_000) {
    blockers.push('approved_change_window_too_long');
  }
  for (const [field, value] of Object.entries({
    changeTicketID: change.changeTicketID,
    siteAcceptanceReference: change.siteAcceptanceReference,
    rollbackPlanReference: change.rollbackPlanReference,
    independentSafetyValidationReference: change.independentSafetyValidationReference,
  })) {
    if (!STABLE_ID.test(value) || PLACEHOLDER.test(value)) blockers.push(`${field}_invalid`);
  }
  if (change.siteAcceptanceReference !== options.acceptedSiteReference) blockers.push('site_acceptance_reference_mismatch');

  const uniqueBlockers = [...new Set(blockers)];
  const releaseCandidateReady = uniqueBlockers.length === 0;
  const evidenceDigest = createHash('sha256').update(canonicalJson({
    decision: bundle.decision,
    approvalAssertionIDs: validApprovals.map((approval) => approval.assertionID).sort(),
    interlockReceiptID: interlock.receiptID,
    change,
  })).digest('hex');
  return {
    protocolVersion: 'production-release-policy-decision.v1',
    evaluatedAt: now.toISOString(),
    decisionID: bundle.decision.decisionID,
    releaseCandidateReady,
    blockers: uniqueBlockers,
    evidenceDigest,
    controls: {
      identitySignaturesVerified: !uniqueBlockers.some((blocker) => blocker.includes('approval_') && blocker.includes('signature')),
      strongAuthenticationVerified: !uniqueBlockers.some((blocker) => blocker.includes('strong_auth')),
      separationOfDutiesVerified: !uniqueBlockers.includes('separation_of_duties_failed'),
      independentInterlockVerified: !uniqueBlockers.some((blocker) => blocker.startsWith('interlock_') || blocker === 'independent_ot_interlock_blocked'),
      approvedChangeWindowVerified: !uniqueBlockers.includes('approved_change_window_closed'),
      rollbackPlanBound: !uniqueBlockers.includes('rollbackPlanReference_invalid'),
    },
    authority: {
      policyDecisionOnly: true,
      physicalDispatchAdapterInstalled: false,
      dispatchAllowed: false,
      productionAuthority: false,
    },
  };
};
