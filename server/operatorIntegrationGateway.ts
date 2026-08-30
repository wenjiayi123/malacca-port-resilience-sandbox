import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PORT_OPERATIONAL_FIELDS, type PortOperationalField } from '../shared/portOperationalContract.ts';
import {
  OPERATOR_ADAPTER_IDS,
  assessOperatorSourceManifest,
  loadOperatorSourceManifest,
  type OperatorAdapterId,
  type OperatorSourceManifestReadiness,
} from './operatorSourceManifest.ts';

export const OPERATOR_SNAPSHOT_VERSION = 'operator-snapshot.v1' as const;
export const OPERATOR_INTEGRATION_STATE_VERSION = 'operator-integration-state.v1' as const;

export type PayloadValue = string | number | boolean | Array<Record<string, unknown>>;

export interface OperatorSnapshotEnvelope {
  schema_version: typeof OPERATOR_SNAPSHOT_VERSION;
  snapshot_id: string;
  port_id: string;
  terminal_id: string;
  adapter_id: OperatorAdapterId;
  source_system: string;
  source_record_id: string;
  sequence: number;
  observed_at: string;
  emitted_at: string;
  payload: Record<string, PayloadValue>;
  units: Record<string, string>;
  payload_sha256: string;
  signature: string;
}

interface AdapterContract {
  maxAgeSeconds: number;
  requiredFields: readonly string[];
  units: Readonly<Record<string, string>>;
}

const TERMINAL_FIELDS = [
  'arrivals',
  'gross_tonnage',
  'effective_service_capacity',
  'queue_vessels',
  'average_waiting_hours',
  'berth_utilization_percent',
  'yard_occupancy_percent',
  'quay_crane_moves_per_hour',
  'truck_turn_time_minutes',
  'planned_eta',
  'actual_eta',
  'vessel_class',
  'queue_entry_time',
  'service_start_time',
] as const;

const VTS_FIELDS = [
  'channel_available',
  'tide_window_open',
  'pilot_available_count',
  'tug_available_count',
  'wind_speed_ms',
  'wave_height_m',
  'visibility_km',
  'current_speed_knots',
] as const;

const SAFETY_FIELDS = ['safety_incidents', 'hazmat_restriction_active'] as const;

const ENERGY_FIELDS = [
  'shore_power_available',
  'shore_power_used',
  'fuel_consumption_tons',
  'carbon_emissions_tons',
  'fuel_price',
  'carbon_price',
] as const;

const INTERMODAL_FIELDS = [
  'rail_transfer_teu',
  'water_transfer_teu',
  'transfer_capacity',
  'transfer_cost',
] as const;

const AIS_VESSEL_UNITS = {
  latitude: 'degree',
  longitude: 'degree',
  speed_over_ground_knots: 'kn',
  course_over_ground_deg: 'degree',
} as const;

export const OPERATOR_ADAPTER_CONTRACTS: Record<OperatorAdapterId, AdapterContract> = {
  ais_vessel_feed: {
    maxAgeSeconds: 60,
    requiredFields: ['vessels'],
    units: AIS_VESSEL_UNITS,
  },
  terminal_operating_system: {
    maxAgeSeconds: 300,
    requiredFields: TERMINAL_FIELDS,
    units: {
      arrivals: 'vessels/interval',
      gross_tonnage: 'GT/interval',
      effective_service_capacity: 'vessels/interval',
      queue_vessels: 'vessels',
      average_waiting_hours: 'hours',
      berth_utilization_percent: 'percent',
      yard_occupancy_percent: 'percent',
      quay_crane_moves_per_hour: 'moves/hour',
      truck_turn_time_minutes: 'minutes',
      planned_eta: 'ISO8601',
      actual_eta: 'ISO8601',
      vessel_class: 'controlled-vocabulary',
      queue_entry_time: 'ISO8601',
      service_start_time: 'ISO8601',
    },
  },
  vessel_traffic_service: {
    maxAgeSeconds: 120,
    requiredFields: VTS_FIELDS,
    units: {
      channel_available: '0/1',
      tide_window_open: '0/1',
      pilot_available_count: 'people/interval',
      tug_available_count: 'vessels/interval',
      wind_speed_ms: 'm/s',
      wave_height_m: 'm',
      visibility_km: 'km',
      current_speed_knots: 'knots',
    },
  },
  safety_regulatory_feed: {
    maxAgeSeconds: 300,
    requiredFields: SAFETY_FIELDS,
    units: {
      safety_incidents: 'events/interval',
      hazmat_restriction_active: '0/1',
    },
  },
  energy_carbon_feed: {
    maxAgeSeconds: 300,
    requiredFields: ENERGY_FIELDS,
    units: {
      shore_power_available: '0/1',
      shore_power_used: '0/1',
      fuel_consumption_tons: 't/interval',
      carbon_emissions_tons: 'tCO2e/interval',
      fuel_price: 'currency/t',
      carbon_price: 'currency/tCO2e',
    },
  },
  intermodal_transfer_feed: {
    maxAgeSeconds: 600,
    requiredFields: INTERMODAL_FIELDS,
    units: {
      rail_transfer_teu: 'TEU/interval',
      water_transfer_teu: 'TEU/interval',
      transfer_capacity: 'TEU/interval',
      transfer_cost: 'currency/TEU',
    },
  },
};

const TIMESTAMP_FIELDS = new Set(['planned_eta', 'actual_eta', 'queue_entry_time', 'service_start_time']);
const BINARY_FIELDS = new Set([
  'channel_available', 'tide_window_open', 'hazmat_restriction_active',
  'shore_power_available', 'shore_power_used',
]);
const PERCENT_FIELDS = new Set(['berth_utilization_percent', 'yard_occupancy_percent']);
const STRING_FIELDS = new Set(['vessel_class']);
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|credential|password|private[_-]?key|secret|token)/i;
const STABLE_ID_PATTERN = /^[A-Za-z0-9._:-]{2,160}$/;
const MAX_DYNAMIC_ALIGNMENT_SECONDS = 300;

interface PersistedAdapterEvidence {
  adapter_id: OperatorAdapterId;
  port_id: string;
  terminal_id: string;
  source_system: string;
  source_record_id: string;
  snapshot_id: string;
  sequence: number;
  observed_at: string;
  emitted_at: string;
  validated_at: string;
  payload_sha256: string;
  signature_valid: true;
  accepted: true;
  recent_snapshot_ids: Record<string, string>;
}

interface IntegrationState {
  schema_version: typeof OPERATOR_INTEGRATION_STATE_VERSION;
  updated_at?: string;
  adapters: Partial<Record<OperatorAdapterId, PersistedAdapterEvidence>>;
}

export interface OperatorIntegrationGatewayOptions {
  signingKeys?: Partial<Record<OperatorAdapterId, string>>;
  stateFile?: string | null;
  manifestReadiness?: OperatorSourceManifestReadiness;
  clock?: () => Date;
  maxClockSkewSeconds?: number;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, candidate]) => [key, canonicalize(candidate)]));
  }
  return value;
};

export const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value));
export const payloadSha256 = (payload: Record<string, PayloadValue>) =>
  createHash('sha256').update(canonicalJson(payload)).digest('hex');

export const operatorEnvelopeSigningBytes = (envelope: Omit<OperatorSnapshotEnvelope, 'signature'>) =>
  Buffer.from(canonicalJson(envelope));

export const signOperatorEnvelope = (
  envelope: Omit<OperatorSnapshotEnvelope, 'signature'>,
  signingKey: string,
): OperatorSnapshotEnvelope => ({
  ...envelope,
  signature: createHmac('sha256', signingKey).update(operatorEnvelopeSigningBytes(envelope)).digest('hex'),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const assertStableId = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) throw new Error(`${field}_invalid`);
  return value;
};

const assertTimestamp = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field}_invalid`);
  }
  return value;
};

const assertNoSensitiveKeys = (value: unknown, pathPrefix = '') => {
  if (Array.isArray(value)) {
    value.forEach((candidate, index) => assertNoSensitiveKeys(candidate, `${pathPrefix}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, candidate] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error(`sensitive_field_rejected:${pathPrefix}${key}`);
    assertNoSensitiveKeys(candidate, `${pathPrefix}${key}.`);
  }
};

const validateAisVessels = (value: unknown, observedAt: string) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5_000) {
    throw new Error('ais_vessels_count_invalid');
  }
  const identities = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) throw new Error(`ais_vessel_${index}_invalid`);
    const mmsi = typeof candidate.mmsi === 'string' ? candidate.mmsi : '';
    if (!/^\d{9}$/.test(mmsi)) throw new Error(`ais_vessel_${index}_mmsi_invalid`);
    if (identities.has(mmsi)) throw new Error(`ais_vessel_duplicate_mmsi:${mmsi}`);
    identities.add(mmsi);
    const numbers: Array<[string, number, number]> = [
      ['latitude', -90, 90],
      ['longitude', -180, 180],
      ['speed_over_ground_knots', 0, 80],
      ['course_over_ground_deg', 0, 360],
    ];
    for (const [field, minimum, maximum] of numbers) {
      const numeric = candidate[field];
      if (typeof numeric !== 'number' || !Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
        throw new Error(`ais_vessel_${index}_${field}_invalid`);
      }
    }
    const positionTime = assertTimestamp(candidate.observed_at, `ais_vessel_${index}_observed_at`);
    if (Math.abs(Date.parse(positionTime) - Date.parse(observedAt)) > 60_000) {
      throw new Error(`ais_vessel_${index}_timestamp_not_aligned`);
    }
    if (candidate.imo !== undefined && (typeof candidate.imo !== 'string' || !/^\d{7}$/.test(candidate.imo))) {
      throw new Error(`ais_vessel_${index}_imo_invalid`);
    }
    if (candidate.vessel_type !== undefined &&
        !['cargo', 'tanker', 'container', 'bulk', 'other'].includes(String(candidate.vessel_type))) {
      throw new Error(`ais_vessel_${index}_vessel_type_invalid`);
    }
  }
};

const validateAdapterPayload = (envelope: OperatorSnapshotEnvelope) => {
  const contract = OPERATOR_ADAPTER_CONTRACTS[envelope.adapter_id];
  const payloadKeys = Object.keys(envelope.payload);
  const unexpected = payloadKeys.filter((field) => !contract.requiredFields.includes(field));
  if (unexpected.length) throw new Error(`unexpected_fields:${unexpected.join(',')}`);
  const missing = contract.requiredFields.filter((field) => !(field in envelope.payload));
  if (missing.length) throw new Error(`missing_fields:${missing.join(',')}`);
  for (const [field, expectedUnit] of Object.entries(contract.units)) {
    if (envelope.units[field] !== expectedUnit) throw new Error(`unit_mismatch:${field}:${expectedUnit}`);
  }
  const unexpectedUnits = Object.keys(envelope.units).filter((field) => !(field in contract.units));
  if (unexpectedUnits.length) throw new Error(`unexpected_units:${unexpectedUnits.join(',')}`);
  if (envelope.adapter_id === 'ais_vessel_feed') {
    validateAisVessels(envelope.payload.vessels, envelope.observed_at);
    return;
  }
  for (const field of contract.requiredFields) {
    const value = envelope.payload[field];
    if (TIMESTAMP_FIELDS.has(field)) {
      assertTimestamp(value, field);
      continue;
    }
    if (STRING_FIELDS.has(field)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 80) throw new Error(`field_invalid:${field}`);
      continue;
    }
    if (BINARY_FIELDS.has(field)) {
      if (value !== 0 && value !== 1) throw new Error(`binary_field_invalid:${field}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`numeric_field_invalid:${field}`);
    if (PERCENT_FIELDS.has(field) && value > 100) throw new Error(`percent_field_invalid:${field}`);
  }
};

export const parseOperatorSnapshotEnvelope = (value: unknown): OperatorSnapshotEnvelope => {
  if (!isRecord(value)) throw new Error('snapshot_envelope_must_be_object');
  const allowed = new Set([
    'schema_version', 'snapshot_id', 'port_id', 'terminal_id', 'adapter_id', 'source_system',
    'source_record_id', 'sequence', 'observed_at', 'emitted_at', 'payload', 'units',
    'payload_sha256', 'signature',
  ]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`envelope_unexpected_fields:${unexpected.join(',')}`);
  if (value.schema_version !== OPERATOR_SNAPSHOT_VERSION) throw new Error('snapshot_schema_version_invalid');
  const adapterId = assertStableId(value.adapter_id, 'adapter_id') as OperatorAdapterId;
  if (!OPERATOR_ADAPTER_IDS.includes(adapterId)) throw new Error(`adapter_id_unknown:${adapterId}`);
  if (!isRecord(value.payload) || !isRecord(value.units)) throw new Error('payload_and_units_must_be_objects');
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) throw new Error('sequence_invalid');
  if (typeof value.payload_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.payload_sha256)) {
    throw new Error('payload_sha256_invalid');
  }
  if (typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)) {
    throw new Error('signature_invalid');
  }
  assertNoSensitiveKeys(value.payload, 'payload.');
  const envelope: OperatorSnapshotEnvelope = {
    schema_version: OPERATOR_SNAPSHOT_VERSION,
    snapshot_id: assertStableId(value.snapshot_id, 'snapshot_id'),
    port_id: assertStableId(value.port_id, 'port_id'),
    terminal_id: assertStableId(value.terminal_id, 'terminal_id'),
    adapter_id: adapterId,
    source_system: assertStableId(value.source_system, 'source_system'),
    source_record_id: assertStableId(value.source_record_id, 'source_record_id'),
    sequence: Number(value.sequence),
    observed_at: assertTimestamp(value.observed_at, 'observed_at'),
    emitted_at: assertTimestamp(value.emitted_at, 'emitted_at'),
    payload: value.payload as Record<string, PayloadValue>,
    units: Object.fromEntries(Object.entries(value.units).map(([key, unit]) => {
      if (typeof unit !== 'string' || !unit.trim()) throw new Error(`unit_invalid:${key}`);
      return [key, unit.trim()];
    })),
    payload_sha256: value.payload_sha256,
    signature: value.signature,
  };
  validateAdapterPayload(envelope);
  return envelope;
};

const parseSigningKeysFromEnvironment = () => {
  const errors: string[] = [];
  const keys: Partial<Record<OperatorAdapterId, string>> = {};
  const raw = process.env.PORT_OPERATOR_SIGNING_KEYS_JSON;
  if (!raw) return { keys, errors: ['operator_signing_keys_not_configured'] };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!isRecord(value)) throw new Error('must be an object');
    for (const [adapterId, candidate] of Object.entries(value)) {
      if (!OPERATOR_ADAPTER_IDS.includes(adapterId as OperatorAdapterId)) {
        errors.push(`unknown_signing_key_adapter:${adapterId}`);
        continue;
      }
      if (typeof candidate !== 'string' || candidate.length < 32) {
        errors.push(`signing_key_too_short:${adapterId}`);
        continue;
      }
      keys[adapterId as OperatorAdapterId] = candidate;
    }
  } catch (error) {
    errors.push(`operator_signing_keys_invalid:${error instanceof Error ? error.message : String(error)}`);
  }
  return { keys, errors };
};

const safeSignatureEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export class OperatorIntegrationGateway {
  readonly signingKeys: Partial<Record<OperatorAdapterId, string>>;
  readonly stateFile: string | null;
  readonly manifestReadiness: OperatorSourceManifestReadiness;
  readonly clock: () => Date;
  readonly maxClockSkewSeconds: number;
  readonly configurationErrors: string[];
  private state: IntegrationState = { schema_version: OPERATOR_INTEGRATION_STATE_VERSION, adapters: {} };
  private residentEnvelopes = new Map<OperatorAdapterId, OperatorSnapshotEnvelope>();

  constructor(options: OperatorIntegrationGatewayOptions = {}) {
    const environmentKeys = options.signingKeys ? { keys: options.signingKeys, errors: [] } : parseSigningKeysFromEnvironment();
    this.signingKeys = environmentKeys.keys;
    this.configurationErrors = environmentKeys.errors;
    this.stateFile = options.stateFile === undefined
      ? path.resolve(process.env.PORT_OPERATOR_INTEGRATION_STATE_FILE || '.runtime/operator-integration/state.json')
      : options.stateFile;
    this.clock = options.clock ?? (() => new Date());
    this.maxClockSkewSeconds = options.maxClockSkewSeconds ?? 30;
    this.manifestReadiness = options.manifestReadiness ?? loadOperatorSourceManifest(undefined, this.clock());
    this.loadState();
  }

  static contract() {
    return {
      schema_version: OPERATOR_SNAPSHOT_VERSION,
      mode: 'read_only_shadow_ingestion',
      adapters: Object.fromEntries(Object.entries(OPERATOR_ADAPTER_CONTRACTS).map(([adapterId, contract]) => [
        adapterId,
        {
          max_age_seconds: contract.maxAgeSeconds,
          required_fields: contract.requiredFields,
          units: contract.units,
        },
      ])),
      integrity: {
        payload_digest: 'SHA-256 over canonical payload JSON',
        signature: 'per-adapter HMAC-SHA256 over canonical envelope excluding signature',
        replay_protection: 'unique snapshot_id plus strictly increasing sequence per adapter',
        persistence: 'lineage and digests only; raw operational payload remains process-local',
      },
      composite: {
        output_protocol: 'port-digital-twin.snapshot.v1',
        terminal_contract: 'terminal-operations.v2',
        required_terminal_fields: PORT_OPERATIONAL_FIELDS.length,
        maximum_dynamic_alignment_seconds: MAX_DYNAMIC_ALIGNMENT_SECONDS,
        atomic_release: 'no operational values are released until every source and authorization gate passes',
        restart_behavior: 'resident payloads are cleared and every source must resend',
      },
      authority: {
        read_only_shadow: true,
        dispatch_allowed: false,
        production_authority: false,
      },
    };
  }

  private loadState() {
    if (!this.stateFile || !existsSync(this.stateFile)) return;
    try {
      const value = JSON.parse(readFileSync(this.stateFile, 'utf8')) as IntegrationState;
      if (value.schema_version === OPERATOR_INTEGRATION_STATE_VERSION && isRecord(value.adapters)) this.state = value;
    } catch {
      this.state = { schema_version: OPERATOR_INTEGRATION_STATE_VERSION, adapters: {} };
    }
  }

  private persistState() {
    if (!this.stateFile) return;
    mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.stateFile);
  }

  ingest(value: unknown) {
    let envelope: OperatorSnapshotEnvelope;
    try {
      envelope = parseOperatorSnapshotEnvelope(value);
    } catch (error) {
      return {
        accepted: false,
        idempotent_replay: false,
        errors: [error instanceof Error ? error.message : String(error)],
        dispatch_allowed: false,
        production_authority: false,
      };
    }
    const now = this.clock();
    const errors = [...this.configurationErrors];
    const manifest = this.manifestReadiness.manifest;
    const manifestStatus = manifest ? assessOperatorSourceManifest(manifest, now) : this.manifestReadiness;
    if (!manifestStatus.authorizationReady) errors.push(...manifestStatus.blockers);
    if (manifest) {
      if (envelope.port_id !== manifest.portId) errors.push('port_id_mismatch');
      if (envelope.terminal_id !== manifest.terminalId) errors.push('terminal_id_mismatch');
      const adapterManifest = manifest.adapters.find((candidate) => candidate.adapterId === envelope.adapter_id);
      if (!adapterManifest) errors.push('adapter_not_authorized_by_manifest');
      else if (adapterManifest.sourceSystem !== envelope.source_system) errors.push('source_system_mismatch');
    }
    if (envelope.payload_sha256 !== payloadSha256(envelope.payload)) errors.push('payload_sha256_mismatch');
    const signingKey = this.signingKeys[envelope.adapter_id];
    if (!signingKey) errors.push('adapter_signing_key_unconfigured');
    else if (signingKey.length < 32) errors.push('adapter_signing_key_too_short');
    else {
      const unsigned = Object.fromEntries(
        Object.entries(envelope).filter(([key]) => key !== 'signature'),
      ) as Omit<OperatorSnapshotEnvelope, 'signature'>;
      const expected = createHmac('sha256', signingKey).update(operatorEnvelopeSigningBytes(unsigned)).digest('hex');
      if (!safeSignatureEqual(envelope.signature, expected)) errors.push('signature_invalid');
    }
    const observedAt = new Date(envelope.observed_at);
    const emittedAt = new Date(envelope.emitted_at);
    if (emittedAt.getTime() < observedAt.getTime()) errors.push('emitted_before_observed');
    if (observedAt.getTime() - now.getTime() > this.maxClockSkewSeconds * 1_000) errors.push('observed_at_in_future');
    if (emittedAt.getTime() - now.getTime() > this.maxClockSkewSeconds * 1_000) errors.push('emitted_at_in_future');
    const ageSeconds = Math.max(0, (now.getTime() - observedAt.getTime()) / 1_000);
    if (ageSeconds > OPERATOR_ADAPTER_CONTRACTS[envelope.adapter_id].maxAgeSeconds) errors.push('snapshot_stale');
    const previous = this.state.adapters[envelope.adapter_id];
    const recent = { ...(previous?.recent_snapshot_ids ?? {}) };
    const priorDigest = recent[envelope.snapshot_id];
    if (priorDigest) {
      if (priorDigest !== envelope.payload_sha256) errors.push('snapshot_id_digest_conflict');
      else if (errors.length === 0) {
        this.residentEnvelopes.set(envelope.adapter_id, structuredClone(envelope));
        return {
          accepted: true,
          idempotent_replay: true,
          snapshot_id: envelope.snapshot_id,
          adapter_id: envelope.adapter_id,
          payload_sha256: envelope.payload_sha256,
          dispatch_allowed: false,
          production_authority: false,
        };
      }
    }
    if (previous && envelope.sequence <= previous.sequence) errors.push('sequence_not_increasing');
    if (errors.length) {
      return {
        accepted: false,
        idempotent_replay: false,
        snapshot_id: envelope.snapshot_id,
        adapter_id: envelope.adapter_id,
        errors: [...new Set(errors)],
        dispatch_allowed: false,
        production_authority: false,
      };
    }
    recent[envelope.snapshot_id] = envelope.payload_sha256;
    const trimmedRecent = Object.fromEntries(Object.entries(recent).slice(-100));
    const validatedAt = now.toISOString();
    const evidence: PersistedAdapterEvidence = {
      adapter_id: envelope.adapter_id,
      port_id: envelope.port_id,
      terminal_id: envelope.terminal_id,
      source_system: envelope.source_system,
      source_record_id: envelope.source_record_id,
      snapshot_id: envelope.snapshot_id,
      sequence: envelope.sequence,
      observed_at: envelope.observed_at,
      emitted_at: envelope.emitted_at,
      validated_at: validatedAt,
      payload_sha256: envelope.payload_sha256,
      signature_valid: true,
      accepted: true,
      recent_snapshot_ids: trimmedRecent,
    };
    this.state.adapters[envelope.adapter_id] = evidence;
    this.state.updated_at = validatedAt;
    this.residentEnvelopes.set(envelope.adapter_id, structuredClone(envelope));
    this.persistState();
    return {
      ...evidence,
      recent_snapshot_ids: undefined,
      idempotent_replay: false,
      dispatch_allowed: false,
      production_authority: false,
    };
  }

  status() {
    const now = this.clock();
    const manifest = this.manifestReadiness.manifest;
    const manifestStatus = manifest ? assessOperatorSourceManifest(manifest, now) : this.manifestReadiness;
    const adapters = OPERATOR_ADAPTER_IDS.map((adapterId) => {
      const evidence = this.state.adapters[adapterId];
      const ageSeconds = evidence
        ? Math.max(0, (now.getTime() - Date.parse(evidence.observed_at)) / 1_000)
        : null;
      const fresh = ageSeconds !== null && ageSeconds <= OPERATOR_ADAPTER_CONTRACTS[adapterId].maxAgeSeconds;
      const resident = this.residentEnvelopes.get(adapterId);
      const residentPayloadReady = Boolean(
        fresh && resident && evidence && resident.snapshot_id === evidence.snapshot_id &&
        resident.payload_sha256 === evidence.payload_sha256,
      );
      return {
        adapter_id: adapterId,
        ready: Boolean(fresh && evidence?.signature_valid && residentPayloadReady),
        fresh,
        resident_payload_ready: residentPayloadReady,
        max_age_seconds: OPERATOR_ADAPTER_CONTRACTS[adapterId].maxAgeSeconds,
        age_seconds: ageSeconds === null ? null : Number(ageSeconds.toFixed(3)),
        snapshot_id: evidence?.snapshot_id ?? null,
        sequence: evidence?.sequence ?? null,
        source_system: evidence?.source_system ?? null,
        observed_at: evidence?.observed_at ?? null,
        payload_sha256: evidence?.payload_sha256 ?? null,
        signature_valid: Boolean(evidence?.signature_valid),
      };
    });
    const readyAdapters = adapters.filter((adapter) => adapter.ready);
    const dynamicTimes = readyAdapters
      .filter((adapter) => adapter.adapter_id !== 'intermodal_transfer_feed')
      .map((adapter) => Date.parse(String(adapter.observed_at)));
    const alignmentSeconds = dynamicTimes.length === OPERATOR_ADAPTER_IDS.length - 1
      ? (Math.max(...dynamicTimes) - Math.min(...dynamicTimes)) / 1_000
      : null;
    const alignmentReady = alignmentSeconds !== null && alignmentSeconds <= MAX_DYNAMIC_ALIGNMENT_SECONDS;
    const signedFeedEvidenceReady = readyAdapters.length === OPERATOR_ADAPTER_IDS.length;
    const readOnlyShadowReady = Boolean(
      manifestStatus.authorizationReady && signedFeedEvidenceReady && alignmentReady && this.configurationErrors.length === 0,
    );
    return {
      protocol_version: 'operator-integration-readiness.v1',
      generated_at: now.toISOString(),
      mode: 'read-only-shadow',
      manifest: {
        configured: manifestStatus.configured,
        manifest_id: manifest?.manifestId ?? null,
        evidence_level: manifest?.evidenceLevel ?? null,
        authorization_ready: manifestStatus.authorizationReady,
        blockers: manifestStatus.blockers,
      },
      adapters,
      ready_adapter_count: readyAdapters.length,
      required_adapter_count: OPERATOR_ADAPTER_IDS.length,
      missing_adapters: adapters.filter((adapter) => !adapter.ready).map((adapter) => adapter.adapter_id),
      dynamic_time_alignment: {
        ready: alignmentReady,
        maximum_seconds: MAX_DYNAMIC_ALIGNMENT_SECONDS,
        observed_skew_seconds: alignmentSeconds === null ? null : Number(alignmentSeconds.toFixed(3)),
      },
      signed_feed_evidence_ready: signedFeedEvidenceReady,
      operator_data_ready: readOnlyShadowReady,
      read_only_shadow_ready: readOnlyShadowReady,
      live_data_verified: readOnlyShadowReady,
      configuration_errors: this.configurationErrors,
      site_delivery_ready: false,
      remaining_site_blockers: [
        'identity_provider_and_role_binding_not_accepted',
        'independent_ot_interlocks_not_accepted',
        'shadow_run_duration_not_completed',
        'rollback_drill_not_accepted',
        'operator_field_acceptance_not_completed',
      ],
      authority: {
        dispatch_allowed: false,
        production_authority: false,
        production_dispatch_enabled: false,
      },
    };
  }

  shadowSnapshot() {
    const status = this.status();
    if (!status.read_only_shadow_ready) {
      return {
        protocolVersion: 'operator-shadow-blocked.v1',
        status: 'blocked',
        generatedAt: this.clock().toISOString(),
        blockers: [
          ...status.manifest.blockers,
          ...status.configuration_errors,
          ...status.missing_adapters.map((adapterId) => `adapter_not_ready:${adapterId}`),
          ...(status.dynamic_time_alignment.ready ? [] : ['dynamic_time_alignment_not_ready']),
        ],
        releasedOperationalValues: false,
        authority: status.authority,
      };
    }
    const manifest = this.manifestReadiness.manifest!;
    const nonAisEnvelopes = OPERATOR_ADAPTER_IDS
      .filter((adapterId) => adapterId !== 'ais_vessel_feed')
      .map((adapterId) => this.residentEnvelopes.get(adapterId)!);
    const latestObservedAt = nonAisEnvelopes
      .map((envelope) => envelope.observed_at)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
    const record = Object.assign(
      {
        port_id: manifest.portId,
        terminal_id: manifest.terminalId,
        timestamp: latestObservedAt,
      },
      ...nonAisEnvelopes.map((envelope) => envelope.payload),
    ) as Record<PortOperationalField, string | number>;
    const expectedFields = new Set(PORT_OPERATIONAL_FIELDS.map((definition) => definition.field));
    const actualFields = new Set(Object.keys(record));
    const missingFields = [...expectedFields].filter((field) => !actualFields.has(field));
    const unexpectedFields = [...actualFields].filter((field) => !expectedFields.has(field as PortOperationalField));
    if (missingFields.length || unexpectedFields.length) {
      return {
        protocolVersion: 'operator-shadow-blocked.v1',
        status: 'blocked',
        generatedAt: this.clock().toISOString(),
        blockers: [
          ...(missingFields.length ? [`terminal_record_missing_fields:${missingFields.join(',')}`] : []),
          ...(unexpectedFields.length ? [`terminal_record_unexpected_fields:${unexpectedFields.join(',')}`] : []),
        ],
        releasedOperationalValues: false,
        authority: status.authority,
      };
    }
    const lineage = Object.fromEntries([
      ['port_id', { source: 'operator-source-manifest', manifest_id: manifest.manifestId }],
      ['terminal_id', { source: 'operator-source-manifest', manifest_id: manifest.manifestId }],
      ['timestamp', { source: 'gateway-time-alignment', observed_at: latestObservedAt }],
      ...nonAisEnvelopes.flatMap((envelope) => Object.keys(envelope.payload).map((field) => [
        field,
        {
          adapter_id: envelope.adapter_id,
          source_system: envelope.source_system,
          source_record_id: envelope.source_record_id,
          snapshot_id: envelope.snapshot_id,
          sequence: envelope.sequence,
          observed_at: envelope.observed_at,
          unit: envelope.units[field],
          payload_sha256: envelope.payload_sha256,
          quality_status: 'source-reported',
          measurement_verified: false,
        },
      ])),
    ]);
    const aisEnvelope = this.residentEnvelopes.get('ais_vessel_feed')!;
    const aisVessels = structuredClone(aisEnvelope.payload.vessels as Array<Record<string, unknown>>);
    const queue = Number(record.queue_vessels);
    const capacity = Math.max(1, Number(record.effective_service_capacity));
    const congestionPercent = Number(Math.min(100, queue / capacity * 100).toFixed(1));
    const metrics = [
      {
        id: 'operator-live-vessels', label: '授权源新鲜船位', value: String(aisVessels.length), unit: '艘',
        detail: `${aisEnvelope.source_system} · HMAC/SHA-256 已验证`, trendLabel: '只读影子数据', tone: 'ok',
      },
      {
        id: 'operator-live-queue', label: '现场队列', value: String(record.queue_vessels), unit: '艘',
        detail: '码头操作系统源报值', trendLabel: `等待 ${record.average_waiting_hours} 小时`, tone: congestionPercent > 80 ? 'danger' : 'warning',
      },
      {
        id: 'operator-live-throughput', label: '区间到港', value: String(record.arrivals), unit: '艘',
        detail: `有效服务能力 ${record.effective_service_capacity}`, trendLabel: latestObservedAt, tone: 'ok',
      },
      {
        id: 'operator-live-carbon', label: '区间碳排源报值', value: String(record.carbon_emissions_tons), unit: 'tCO₂e',
        detail: '尚未完成独立计量核证', trendLabel: '不得用于结算', tone: 'warning',
      },
    ];
    const core = {
      protocolVersion: 'port-digital-twin.snapshot.v1' as const,
      observedAt: latestObservedAt,
      source: `${manifest.operatorOrganization} · signed read-only shadow feeds`,
      topologyMode: 'patch' as const,
      scenario: {
        profileId: manifest.sceneProfileId,
        evidenceMode: 'operator-live',
        currentTime: latestObservedAt,
      },
      telemetry: {
        overview: { monitoredVesselCount: aisVessels.length },
        ports: [{
          id: manifest.scenePortNodeId,
          vesselCount: aisVessels.length,
          congestionPercent,
          berthUtilizationPercent: record.berth_utilization_percent,
          queueVessels: record.queue_vessels,
          averageWaitingHours: record.average_waiting_hours,
          status: congestionPercent > 80 ? '拥堵' : '现场影子',
          tone: congestionPercent > 80 ? 'danger' : 'ok',
        }],
        weather: {
          windSpeedMs: record.wind_speed_ms,
          windDirection: '现场源报值',
          visibilityKm: record.visibility_km,
          waveHeightM: record.wave_height_m,
          currentSpeedKnots: record.current_speed_knots,
        },
        metrics,
      },
      operatorData: {
        protocolVersion: 'operator-shadow-terminal-operations.v1',
        status: 'ready',
        mode: 'read-only-shadow',
        manifestId: manifest.manifestId,
        record,
        fieldLineage: lineage,
        assets: { aisVessels },
        quality: {
          gate: 'PASS',
          fieldCount: Object.keys(record).length,
          signedAdapterCount: OPERATOR_ADAPTER_IDS.length,
          observationSkewSeconds: status.dynamic_time_alignment.observed_skew_seconds,
          sourceReportedValues: true,
          measurementCalibrationVerified: false,
        },
        authority: {
          simulation_mode: false,
          live_data_verified: true,
          read_only_shadow: true,
          dispatch_allowed: false,
          production_authority: false,
        },
      },
    };
    return {
      ...core,
      operatorData: {
        ...core.operatorData,
        snapshotSha256: createHash('sha256').update(canonicalJson(core)).digest('hex'),
      },
    };
  }
}
