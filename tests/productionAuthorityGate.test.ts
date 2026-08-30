import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import {
  IDENTITY_APPROVAL_VERSION,
  OT_INTERLOCK_RECEIPT_VERSION,
  evaluateProductionRelease,
  signIdentityBoundApproval,
  signIndependentOtInterlock,
  type IdentityBoundApproval,
  type ProductionReleaseBundle,
} from '../server/productionAuthorityGate.ts';

const NOW = new Date('2026-08-30T08:00:00.000Z');
const identityKeys = generateKeyPairSync('ed25519');
const interlockKeys = generateKeyPairSync('ed25519');
const publicPem = (key: typeof identityKeys.publicKey) => key.export({ type: 'spki', format: 'pem' }).toString();
const options = {
  identityTrustBundle: { 'idp-key-01': publicPem(identityKeys.publicKey) },
  interlockTrustBundle: { 'plc-key-01': publicPem(interlockKeys.publicKey) },
  audience: 'port.production.gate',
  acceptedSiteID: 'site.sgsin.01',
  acceptedSiteReference: 'SITE-ACCEPT-2026-001',
  clock: () => NOW,
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const decision = {
  decisionID: 'decision.production.001',
  creatorSubjectID: 'planner.subject.01',
  decisionDigest: digest('decision-production-001'),
  inputSnapshotHash: digest('snapshot-production-001'),
  actionID: 'arrival-window',
  riskTier: 'HIGH' as const,
};

const approval = (subjectID: string, role: IdentityBoundApproval['roles'][number], assertionID: string) =>
  signIdentityBoundApproval({
    protocolVersion: IDENTITY_APPROVAL_VERSION,
    assertionID,
    keyID: 'idp-key-01',
    issuer: 'test.identity.provider',
    audience: options.audience,
    subjectID,
    subjectType: 'HUMAN',
    organizationID: 'port.operator.organization',
    roles: [role],
    sessionID: `session.${subjectID}`,
    mfa: true,
    assuranceLevel: 'AAL3',
    decisionID: decision.decisionID,
    decisionDigest: decision.decisionDigest,
    inputSnapshotHash: decision.inputSnapshotHash,
    actionID: decision.actionID,
    issuedAt: '2026-08-30T07:59:00.000Z',
    expiresAt: '2026-08-30T08:05:00.000Z',
  }, identityKeys.privateKey);

const bundle = (): ProductionReleaseBundle => ({
  decision,
  approvals: [
    approval('operator.subject.01', 'OPERATOR', 'assertion.operator.001'),
    approval('safety.subject.01', 'SAFETY_OFFICER', 'assertion.safety.001'),
  ],
  interlock: signIndependentOtInterlock({
    protocolVersion: OT_INTERLOCK_RECEIPT_VERSION,
    receiptID: 'interlock.receipt.001',
    keyID: 'plc-key-01',
    issuer: 'independent.safety.plc',
    siteID: options.acceptedSiteID,
    decisionID: decision.decisionID,
    decisionDigest: decision.decisionDigest,
    inputSnapshotHash: decision.inputSnapshotHash,
    safeToProceed: true,
    emergencyStopClear: true,
    communicationsHealthy: true,
    maintenanceBypassActive: false,
    observedAt: '2026-08-30T07:59:50.000Z',
    expiresAt: '2026-08-30T08:00:20.000Z',
  }, interlockKeys.privateKey),
  change: {
    changeTicketID: 'CHANGE-2026-001',
    approvedWindowStart: '2026-08-30T07:30:00.000Z',
    approvedWindowEnd: '2026-08-30T08:30:00.000Z',
    siteAcceptanceReference: options.acceptedSiteReference,
    rollbackPlanReference: 'ROLLBACK-PLAN-2026-001',
    independentSafetyValidationReference: 'SAFETY-VALIDATION-2026-001',
  },
});

test('two identity-bound human approvals and an independent fresh interlock pass the policy gate only', () => {
  const result = evaluateProductionRelease(bundle(), options);
  assert.equal(result.releaseCandidateReady, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.controls.separationOfDutiesVerified, true);
  assert.equal(result.controls.independentInterlockVerified, true);
  assert.equal(result.authority.physicalDispatchAdapterInstalled, false);
  assert.equal(result.authority.dispatchAllowed, false);
  assert.equal(result.authority.productionAuthority, false);
});

test('tampered identity bindings, self-approval and missing MFA fail closed', () => {
  const value = bundle();
  value.approvals[0].decisionDigest = digest('tampered');
  value.approvals[1] = structuredClone(value.approvals[0]);
  value.approvals[1].subjectID = decision.creatorSubjectID;
  value.approvals[1].mfa = false as true;
  const result = evaluateProductionRelease(value, options);
  assert.equal(result.releaseCandidateReady, false);
  assert.ok(result.blockers.some((item) => item.includes('signature_invalid')));
  assert.ok(result.blockers.some((item) => item.includes('creator_cannot_approve')));
  assert.ok(result.blockers.some((item) => item.includes('strong_auth_required')));
  assert.ok(result.blockers.includes('separation_of_duties_failed'));
});

test('unsafe, stale or bypassed OT interlock blocks release even with valid human approvals', () => {
  const value = bundle();
  value.interlock.safeToProceed = false;
  value.interlock.maintenanceBypassActive = true;
  const result = evaluateProductionRelease(value, options);
  assert.equal(result.releaseCandidateReady, false);
  assert.ok(result.blockers.includes('interlock_signature_invalid'));
  assert.ok(result.blockers.includes('independent_ot_interlock_blocked'));
});
