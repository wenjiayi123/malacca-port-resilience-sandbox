import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PORT_COMMUNITY_PROTOCOL_VERSION,
  PortCommunityGateway,
  portCommunityPayloadSha256,
  signPortCommunityEnvelope,
  toDcsaPortCallProjection,
  toIalaS211Projection,
  type AuthorizedCommunityPartner,
  type PortCommunityEnvelope,
  type PortCommunityMessageType,
  type PortCommunityPartyRole,
} from '../server/portCommunityGateway.ts';

const NOW = new Date('2026-08-30T08:00:00.000Z');
const localParty = { partyID: 'test.local.pcs', role: 'PORT_COMMUNITY_SYSTEM' as const };
const partner = (partyID: string, role: PortCommunityPartyRole, types: PortCommunityMessageType[]): AuthorizedCommunityPartner => ({
  partyID,
  role,
  signingKey: `test-only-${partyID}-key-material-000000000000`,
  allowedMessageTypes: types,
});
const partners = [
  partner('test.terminal', 'TERMINAL', ['PORT_CALL_EVENT']),
  partner('test.customs', 'CUSTOMS', ['CLEARANCE_STATUS']),
  partner('test.immigration', 'IMMIGRATION', ['CLEARANCE_STATUS']),
  partner('test.health', 'HEALTH_AUTHORITY', ['CLEARANCE_STATUS']),
  partner('test.security', 'SECURITY_AUTHORITY', ['CLEARANCE_STATUS']),
  partner('test.port.authority', 'PORT_AUTHORITY', ['CLEARANCE_STATUS']),
];

const portCallPayload = {
  protocolVersion: 'port-call-event.v1',
  portCallID: 'PC-SGSIN-20260830-001',
  vesselVisitReference: 'VISIT-001',
  UNLocationCode: 'SGSIN',
  vessel: { IMO: '9319466', MMSI: '563123456', name: 'Test Vessel' },
  portCallServiceTypeCode: 'BERTH',
  eventTypeCode: 'ARRIVAL',
  eventClassifierCode: 'PLN',
  eventDateTime: '2026-08-30T09:00:00.000Z',
  facility: { facilityTypeCode: 'BERTH', facilityCode: 'B01', facilityName: 'Berth 01' },
  source: { system: 'test.terminal', recordID: 'TOS-001', observedAt: NOW.toISOString() },
  quality: { status: 'VERIFIED', confidence: 0.99 },
};

const message = (
  senderID: string,
  role: PortCommunityPartyRole,
  messageType: PortCommunityMessageType,
  payload: Record<string, unknown>,
  suffix: string,
): PortCommunityEnvelope => {
  const unsigned: Omit<PortCommunityEnvelope, 'signature'> = {
    protocolVersion: PORT_COMMUNITY_PROTOCOL_VERSION,
    messageID: `message.${suffix}`,
    conversationID: 'conversation.portcall.001',
    sender: { partyID: senderID, role },
    recipient: localParty,
    sentAt: NOW.toISOString(),
    idempotencyKey: `idempotency.${suffix}`,
    messageType,
    payload,
    payloadSHA256: portCommunityPayloadSha256(payload),
  };
  return signPortCommunityEnvelope(unsigned, partners.find((item) => item.partyID === senderID)!.signingKey);
};

test('community gateway accepts signed port-call events and exposes explicit standards projections', () => {
  const gateway = new PortCommunityGateway({ localParty, partners, clock: () => NOW });
  const result = gateway.ingest(message('test.terminal', 'TERMINAL', 'PORT_CALL_EVENT', portCallPayload, 'event.1'));
  assert.equal(result.accepted, true);
  assert.equal(result.productionAuthority, false);
  const event = result.normalizedPayload as Parameters<typeof toDcsaPortCallProjection>[0];
  assert.equal(toDcsaPortCallProjection(event).conformanceClaim, false);
  assert.equal(toIalaS211Projection(event).conformanceClaim, false);
  assert.match(String(result.auditHead), /^[a-f0-9]{64}$/);
});

test('five authoritative clearance sources are preserved as exogenous receipts without dispatch authority', () => {
  const gateway = new PortCommunityGateway({ localParty, partners, clock: () => NOW });
  const clearances: Array<[string, PortCommunityPartyRole, string]> = [
    ['test.customs', 'CUSTOMS', 'CUSTOMS'],
    ['test.immigration', 'IMMIGRATION', 'IMMIGRATION'],
    ['test.health', 'HEALTH_AUTHORITY', 'HEALTH'],
    ['test.security', 'SECURITY_AUTHORITY', 'SECURITY'],
    ['test.port.authority', 'PORT_AUTHORITY', 'PORT_CLEARANCE'],
  ];
  clearances.forEach(([partyID, role, clearanceType], index) => {
    const payload = {
      portCallID: 'PC-SGSIN-20260830-001',
      UNLocationCode: 'SGSIN',
      clearanceType,
      status: 'GRANTED',
      authorityReference: `AUTH-${index + 1}`,
      effectiveAt: NOW.toISOString(),
    };
    assert.equal(gateway.ingest(message(partyID, role, 'CLEARANCE_STATUS', payload, `clearance.${index}`)).accepted, true);
  });
  const status = gateway.status();
  assert.equal(status.allFiveClearancesGranted, true);
  assert.equal(status.siteInteroperabilityAccepted, false);
  assert.equal(status.authority.dispatchAllowed, false);
  assert.equal(status.authority.productionAuthority, false);
});

test('community gateway blocks tampering, stale messages, role impersonation and idempotency conflict', () => {
  const gateway = new PortCommunityGateway({ localParty, partners, clock: () => NOW });
  const valid = message('test.terminal', 'TERMINAL', 'PORT_CALL_EVENT', portCallPayload, 'event.2');
  assert.equal(gateway.ingest(valid).accepted, true);
  assert.equal(gateway.ingest(valid).idempotentReplay, true);

  const tampered = structuredClone(valid);
  tampered.payload.eventClassifierCode = 'ACT';
  assert.equal(gateway.ingest(tampered).accepted, false);

  const stale = message('test.terminal', 'TERMINAL', 'PORT_CALL_EVENT', portCallPayload, 'stale');
  stale.sentAt = '2026-08-30T07:00:00.000Z';
  const staleSigned = signPortCommunityEnvelope(
    Object.fromEntries(Object.entries(stale).filter(([key]) => key !== 'signature')) as Omit<PortCommunityEnvelope, 'signature'>,
    partners[0].signingKey,
  );
  assert.ok(gateway.ingest(staleSigned).errors?.includes('message_stale'));

  const impersonation = message('test.customs', 'CUSTOMS', 'CLEARANCE_STATUS', {
    portCallID: 'PC-SGSIN-20260830-001', UNLocationCode: 'SGSIN', clearanceType: 'HEALTH',
    status: 'GRANTED', authorityReference: 'BAD-ROLE', effectiveAt: NOW.toISOString(),
  }, 'bad.role');
  assert.ok(gateway.ingest(impersonation).errors?.includes('clearance_sender_role_not_authoritative'));

  const conflict = message('test.terminal', 'TERMINAL', 'PORT_CALL_EVENT', {
    ...portCallPayload,
    eventClassifierCode: 'ACT',
  }, 'event.3');
  conflict.idempotencyKey = valid.idempotencyKey;
  const conflictSigned = signPortCommunityEnvelope(
    Object.fromEntries(Object.entries(conflict).filter(([key]) => key !== 'signature')) as Omit<PortCommunityEnvelope, 'signature'>,
    partners[0].signingKey,
  );
  assert.ok(gateway.ingest(conflictSigned).errors?.includes('idempotency_key_conflict'));
});
