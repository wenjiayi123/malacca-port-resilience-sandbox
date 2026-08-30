import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './operatorIntegrationGateway.ts';
import { validatePortCallEvent, type PortCallEventContract } from './portCallContract.ts';

export const PORT_COMMUNITY_PROTOCOL_VERSION = 'port-community-message.v1' as const;
export const PORT_COMMUNITY_MESSAGE_TYPES = ['PORT_CALL_EVENT', 'CLEARANCE_STATUS', 'ACKNOWLEDGEMENT'] as const;
export const PORT_COMMUNITY_PARTY_ROLES = [
  'CARRIER', 'SHIP_AGENT', 'TERMINAL', 'PORT_AUTHORITY', 'VESSEL_TRAFFIC_SERVICE',
  'MARITIME_SINGLE_WINDOW', 'PORT_COMMUNITY_SYSTEM', 'CUSTOMS', 'IMMIGRATION',
  'HEALTH_AUTHORITY', 'SECURITY_AUTHORITY', 'SERVICE_PROVIDER',
] as const;

export type PortCommunityMessageType = typeof PORT_COMMUNITY_MESSAGE_TYPES[number];
export type PortCommunityPartyRole = typeof PORT_COMMUNITY_PARTY_ROLES[number];

export interface PortCommunityParty {
  partyID: string;
  role: PortCommunityPartyRole;
}

export interface PortCommunityEnvelope {
  protocolVersion: typeof PORT_COMMUNITY_PROTOCOL_VERSION;
  messageID: string;
  conversationID: string;
  correlationID?: string;
  sender: PortCommunityParty;
  recipient: PortCommunityParty;
  sentAt: string;
  idempotencyKey: string;
  messageType: PortCommunityMessageType;
  payload: Record<string, unknown>;
  payloadSHA256: string;
  signature: string;
}

export interface AuthorizedCommunityPartner {
  partyID: string;
  role: PortCommunityPartyRole;
  signingKey: string;
  allowedMessageTypes: PortCommunityMessageType[];
}

export interface PortCommunityGatewayOptions {
  localParty: PortCommunityParty;
  partners: AuthorizedCommunityPartner[];
  clock?: () => Date;
  maximumMessageAgeSeconds?: number;
}

export interface ClearanceStatus {
  portCallID: string;
  UNLocationCode: string;
  clearanceType: 'CUSTOMS' | 'IMMIGRATION' | 'HEALTH' | 'SECURITY' | 'PORT_CLEARANCE';
  status: 'PENDING' | 'GRANTED' | 'REJECTED' | 'REVOKED';
  authorityReference: string;
  effectiveAt: string;
  expiresAt?: string;
}

const STABLE_ID = /^[A-Za-z0-9._:/-]{2,180}$/;
const UNLOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const timestamp = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field}_invalid`);
  }
  return value;
};

const stableId = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) throw new Error(`${field}_invalid`);
  return value;
};

const parseParty = (value: unknown, field: string): PortCommunityParty => {
  if (!record(value)) throw new Error(`${field}_invalid`);
  const role = String(value.role ?? '') as PortCommunityPartyRole;
  if (!PORT_COMMUNITY_PARTY_ROLES.includes(role)) throw new Error(`${field}.role_invalid`);
  return { partyID: stableId(value.partyID, `${field}.partyID`), role };
};

export const portCommunityPayloadSha256 = (payload: Record<string, unknown>) =>
  createHash('sha256').update(canonicalJson(payload)).digest('hex');

export const signPortCommunityEnvelope = (
  envelope: Omit<PortCommunityEnvelope, 'signature'>,
  signingKey: string,
): PortCommunityEnvelope => ({
  ...envelope,
  signature: createHmac('sha256', signingKey).update(canonicalJson(envelope)).digest('hex'),
});

export const parsePortCommunityEnvelope = (value: unknown): PortCommunityEnvelope => {
  if (!record(value)) throw new Error('message_must_be_object');
  const allowed = new Set([
    'protocolVersion', 'messageID', 'conversationID', 'correlationID', 'sender', 'recipient',
    'sentAt', 'idempotencyKey', 'messageType', 'payload', 'payloadSHA256', 'signature',
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`message_unknown_fields:${unknown.join(',')}`);
  if (value.protocolVersion !== PORT_COMMUNITY_PROTOCOL_VERSION) throw new Error('protocol_version_invalid');
  const messageType = String(value.messageType ?? '') as PortCommunityMessageType;
  if (!PORT_COMMUNITY_MESSAGE_TYPES.includes(messageType)) throw new Error('message_type_invalid');
  if (!record(value.payload)) throw new Error('payload_invalid');
  const payloadSHA256 = String(value.payloadSHA256 ?? '');
  const signature = String(value.signature ?? '');
  if (!/^[a-f0-9]{64}$/.test(payloadSHA256)) throw new Error('payload_sha256_invalid');
  if (!/^[a-f0-9]{64}$/.test(signature)) throw new Error('signature_invalid');
  return {
    protocolVersion: PORT_COMMUNITY_PROTOCOL_VERSION,
    messageID: stableId(value.messageID, 'messageID'),
    conversationID: stableId(value.conversationID, 'conversationID'),
    ...(value.correlationID === undefined ? {} : { correlationID: stableId(value.correlationID, 'correlationID') }),
    sender: parseParty(value.sender, 'sender'),
    recipient: parseParty(value.recipient, 'recipient'),
    sentAt: timestamp(value.sentAt, 'sentAt'),
    idempotencyKey: stableId(value.idempotencyKey, 'idempotencyKey'),
    messageType,
    payload: value.payload,
    payloadSHA256,
    signature,
  };
};

const expectedClearanceRole: Record<ClearanceStatus['clearanceType'], PortCommunityPartyRole> = {
  CUSTOMS: 'CUSTOMS',
  IMMIGRATION: 'IMMIGRATION',
  HEALTH: 'HEALTH_AUTHORITY',
  SECURITY: 'SECURITY_AUTHORITY',
  PORT_CLEARANCE: 'PORT_AUTHORITY',
};

const validateClearance = (payload: Record<string, unknown>, sender: PortCommunityParty): ClearanceStatus => {
  const clearanceType = String(payload.clearanceType ?? '') as ClearanceStatus['clearanceType'];
  const status = String(payload.status ?? '') as ClearanceStatus['status'];
  if (!(clearanceType in expectedClearanceRole)) throw new Error('clearance_type_invalid');
  if (!['PENDING', 'GRANTED', 'REJECTED', 'REVOKED'].includes(status)) throw new Error('clearance_status_invalid');
  if (sender.role !== expectedClearanceRole[clearanceType]) throw new Error('clearance_sender_role_not_authoritative');
  const unLocationCode = String(payload.UNLocationCode ?? '').toUpperCase();
  if (!UNLOCODE.test(unLocationCode)) throw new Error('clearance_unlocode_invalid');
  const effectiveAt = timestamp(payload.effectiveAt, 'clearance.effectiveAt');
  const expiresAt = payload.expiresAt === undefined ? undefined : timestamp(payload.expiresAt, 'clearance.expiresAt');
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveAt)) throw new Error('clearance_period_invalid');
  return {
    portCallID: stableId(payload.portCallID, 'clearance.portCallID'),
    UNLocationCode: unLocationCode,
    clearanceType,
    status,
    authorityReference: stableId(payload.authorityReference, 'clearance.authorityReference'),
    effectiveAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
};

const validateAcknowledgement = (payload: Record<string, unknown>) => {
  const status = String(payload.status ?? '');
  if (!['ACCEPTED', 'REJECTED'].includes(status)) throw new Error('acknowledgement_status_invalid');
  return {
    acknowledgedMessageID: stableId(payload.acknowledgedMessageID, 'acknowledgedMessageID'),
    status,
    ...(payload.reasonCode === undefined ? {} : { reasonCode: stableId(payload.reasonCode, 'reasonCode') }),
  };
};

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class PortCommunityGateway {
  private readonly localParty: PortCommunityParty;
  private readonly partners: Map<string, AuthorizedCommunityPartner>;
  private readonly clock: () => Date;
  private readonly maximumMessageAgeSeconds: number;
  private readonly messages = new Map<string, { digest: string; envelope: PortCommunityEnvelope; normalizedPayload: unknown }>();
  private readonly idempotency = new Map<string, string>();
  private readonly clearances = new Map<string, ClearanceStatus>();
  private auditHead = 'GENESIS';

  constructor(options: PortCommunityGatewayOptions) {
    this.localParty = options.localParty;
    this.partners = new Map(options.partners.map((partner) => [partner.partyID, partner]));
    this.clock = options.clock ?? (() => new Date());
    this.maximumMessageAgeSeconds = options.maximumMessageAgeSeconds ?? 600;
  }

  ingest(value: unknown) {
    try {
      const envelope = parsePortCommunityEnvelope(value);
      const partner = this.partners.get(envelope.sender.partyID);
      if (!partner || partner.role !== envelope.sender.role) throw new Error('sender_not_authorized');
      if (!partner.allowedMessageTypes.includes(envelope.messageType)) throw new Error('message_type_not_authorized');
      if (envelope.recipient.partyID !== this.localParty.partyID || envelope.recipient.role !== this.localParty.role) {
        throw new Error('recipient_mismatch');
      }
      const now = this.clock().getTime();
      const sentAt = Date.parse(envelope.sentAt);
      if (sentAt > now + 30_000) throw new Error('message_from_future');
      if (now - sentAt > this.maximumMessageAgeSeconds * 1_000) throw new Error('message_stale');
      const actualPayloadDigest = portCommunityPayloadSha256(envelope.payload);
      if (actualPayloadDigest !== envelope.payloadSHA256) throw new Error('payload_sha256_mismatch');
      const unsigned = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'signature')) as Omit<PortCommunityEnvelope, 'signature'>;
      const expectedSignature = createHmac('sha256', partner.signingKey).update(canonicalJson(unsigned)).digest('hex');
      if (!safeEqual(envelope.signature, expectedSignature)) throw new Error('signature_invalid');
      const messageDigest = createHash('sha256').update(canonicalJson(envelope)).digest('hex');
      const previousMessage = this.messages.get(envelope.messageID);
      if (previousMessage) {
        if (previousMessage.digest !== messageDigest) throw new Error('message_id_conflict');
        return { accepted: true, idempotentReplay: true, messageID: envelope.messageID, auditHead: this.auditHead };
      }
      const priorIdempotencyMessage = this.idempotency.get(`${envelope.sender.partyID}:${envelope.idempotencyKey}`);
      if (priorIdempotencyMessage) throw new Error('idempotency_key_conflict');
      let normalizedPayload: unknown;
      if (envelope.messageType === 'PORT_CALL_EVENT') {
        const validation = validatePortCallEvent(envelope.payload);
        if (!validation.valid) throw new Error(`port_call_event_invalid:${validation.errors.join('|')}`);
        normalizedPayload = validation.event;
      } else if (envelope.messageType === 'CLEARANCE_STATUS') {
        const clearance = validateClearance(envelope.payload, envelope.sender);
        const key = `${clearance.portCallID}:${clearance.clearanceType}`;
        const previous = this.clearances.get(key);
        if (previous && Date.parse(clearance.effectiveAt) <= Date.parse(previous.effectiveAt)) {
          throw new Error('clearance_effective_time_not_increasing');
        }
        this.clearances.set(key, clearance);
        normalizedPayload = clearance;
      } else {
        normalizedPayload = validateAcknowledgement(envelope.payload);
      }
      const auditEntry = {
        previousHash: this.auditHead,
        messageID: envelope.messageID,
        conversationID: envelope.conversationID,
        senderPartyID: envelope.sender.partyID,
        messageType: envelope.messageType,
        payloadSHA256: envelope.payloadSHA256,
        acceptedAt: this.clock().toISOString(),
      };
      this.auditHead = createHash('sha256').update(canonicalJson(auditEntry)).digest('hex');
      this.messages.set(envelope.messageID, { digest: messageDigest, envelope, normalizedPayload });
      this.idempotency.set(`${envelope.sender.partyID}:${envelope.idempotencyKey}`, envelope.messageID);
      return {
        accepted: true,
        idempotentReplay: false,
        messageID: envelope.messageID,
        normalizedPayload,
        auditHead: this.auditHead,
        dispatchAllowed: false,
        productionAuthority: false,
      };
    } catch (error) {
      return {
        accepted: false,
        idempotentReplay: false,
        errors: [error instanceof Error ? error.message : String(error)],
        dispatchAllowed: false,
        productionAuthority: false,
      };
    }
  }

  status() {
    const currentClearances = [...this.clearances.values()];
    const granted = new Set(currentClearances.filter((item) => item.status === 'GRANTED').map((item) => item.clearanceType));
    return {
      protocolVersion: 'port-community-readiness.v1',
      localParty: this.localParty,
      authorizedPartnerCount: this.partners.size,
      acceptedMessageCount: this.messages.size,
      auditHead: this.auditHead,
      currentClearances,
      allFiveClearancesGranted: (['CUSTOMS', 'IMMIGRATION', 'HEALTH', 'SECURITY', 'PORT_CLEARANCE'] as const)
        .every((clearance) => granted.has(clearance)),
      mappingProfiles: {
        dcsaPortCall: '2.0 concept mapping; official conformance not asserted',
        ialaS211: 'port call timestamp projection boundary; official conformance not asserted',
        imoCompendium: 'clearance adapter boundary; Maritime Single Window implementation not asserted',
        unLocode: 'five-character syntax validated; current UNECE list membership requires site reference-data service',
      },
      siteInteroperabilityAccepted: false,
      remainingExternalBlockers: [
        'partner_certificates_not_exchanged',
        'official_conformance_tests_not_completed',
        'national_maritime_single_window_not_connected',
        'port_community_system_acceptance_not_completed',
        'unlocode_reference_dataset_not_bound',
      ],
      authority: { dispatchAllowed: false, productionAuthority: false },
    };
  }
}

export const toDcsaPortCallProjection = (event: PortCallEventContract) => ({
  portCallID: event.portCallID,
  vesselVisitReference: event.vesselVisitReference,
  UNLocationCode: event.UNLocationCode,
  portCallServiceTypeCode: event.portCallServiceTypeCode,
  eventTypeCode: event.eventTypeCode,
  eventClassifierCode: event.eventClassifierCode,
  eventDateTime: event.eventDateTime,
  facility: event.facility,
  conformanceClaim: false,
});

export const toIalaS211Projection = (event: PortCallEventContract) => ({
  portCallId: event.portCallID,
  location: event.UNLocationCode,
  serviceObject: event.portCallServiceTypeCode,
  timeType: event.eventClassifierCode,
  eventType: event.eventTypeCode,
  time: event.eventDateTime,
  conformanceClaim: false,
});
