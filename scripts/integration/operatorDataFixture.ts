import {
  OPERATOR_ADAPTER_CONTRACTS,
  OPERATOR_SNAPSHOT_VERSION,
  payloadSha256,
  signOperatorEnvelope,
  type OperatorSnapshotEnvelope,
  type PayloadValue,
} from '../../server/operatorIntegrationGateway.ts';
import {
  OPERATOR_ADAPTER_IDS,
  OPERATOR_SOURCE_MANIFEST_VERSION,
  parseOperatorSourceManifest,
  type OperatorAdapterId,
} from '../../server/operatorSourceManifest.ts';

export const FIXTURE_NOW = new Date('2026-08-30T08:00:00.000Z');

export const fixtureSigningKeys = Object.fromEntries(
  OPERATOR_ADAPTER_IDS.map((adapterId) => [adapterId, `test-only-${adapterId}-key-material-00000000`]),
) as Record<OperatorAdapterId, string>;

export const fixtureManifest = parseOperatorSourceManifest({
  protocolVersion: OPERATOR_SOURCE_MANIFEST_VERSION,
  manifestId: 'test.operator.manifest.v1',
  siteId: 'test.site',
  portId: 'SGSIN',
  terminalId: 'TEST-T1',
  sceneProfileId: 'malacca-strait',
  scenePortNodeId: 'singapore',
  operatorOrganization: 'Test Port Operator',
  evidenceLevel: 'operator-authorized',
  timezone: 'Asia/Singapore',
  authorization: {
    reference: 'TEST-AUTH-READ-ONLY-001',
    approvedBy: 'Test Data Owner',
    approvedAt: '2026-01-01T00:00:00+08:00',
    expiresAt: '2027-01-01T00:00:00+08:00',
    permittedPurpose: 'read-only-shadow',
    redistributionAllowed: false,
  },
  adapters: OPERATOR_ADAPTER_IDS.map((adapterId) => ({
    adapterId,
    sourceSystem: `test.${adapterId}`,
    dataOwnerRole: `test-owner-${adapterId}`,
    signingKeyId: `test-key-${adapterId}`,
    fieldMappingReviewed: true,
    unitsReviewed: true,
    timezoneReviewed: true,
    dataOwnerApproved: true,
  })),
  notes: ['Automated test fixture only; it is not evidence of a live port connection.'],
});

const payloads: Record<OperatorAdapterId, Record<string, PayloadValue>> = {
  ais_vessel_feed: {
    vessels: [{
      mmsi: '563123456',
      imo: '9876543',
      vessel_type: 'container',
      latitude: 1.245,
      longitude: 103.82,
      speed_over_ground_knots: 8.4,
      course_over_ground_deg: 94,
      observed_at: FIXTURE_NOW.toISOString(),
    }],
  },
  terminal_operating_system: {
    arrivals: 18,
    gross_tonnage: 212000,
    effective_service_capacity: 24,
    queue_vessels: 7,
    average_waiting_hours: 3.2,
    berth_utilization_percent: 76,
    yard_occupancy_percent: 71,
    quay_crane_moves_per_hour: 31,
    truck_turn_time_minutes: 38,
    planned_eta: '2026-08-30T08:30:00.000Z',
    actual_eta: '2026-08-30T08:35:00.000Z',
    vessel_class: 'container-panamax',
    queue_entry_time: '2026-08-30T07:10:00.000Z',
    service_start_time: '2026-08-30T08:15:00.000Z',
  },
  vessel_traffic_service: {
    channel_available: 1,
    tide_window_open: 1,
    pilot_available_count: 5,
    tug_available_count: 6,
    wind_speed_ms: 7.8,
    wave_height_m: 0.7,
    visibility_km: 12.4,
    current_speed_knots: 1.1,
  },
  safety_regulatory_feed: {
    safety_incidents: 0,
    hazmat_restriction_active: 0,
  },
  energy_carbon_feed: {
    shore_power_available: 1,
    shore_power_used: 1,
    fuel_consumption_tons: 14.2,
    carbon_emissions_tons: 44.9,
    fuel_price: 648,
    carbon_price: 28,
  },
  intermodal_transfer_feed: {
    rail_transfer_teu: 860,
    water_transfer_teu: 420,
    transfer_capacity: 1600,
    transfer_cost: 38,
  },
};

export const buildFixtureEnvelope = (
  adapterId: OperatorAdapterId,
  overrides: Partial<Omit<OperatorSnapshotEnvelope, 'adapter_id' | 'payload' | 'units' | 'signature'>> = {},
): OperatorSnapshotEnvelope => {
  const payload = structuredClone(payloads[adapterId]);
  const unsigned: Omit<OperatorSnapshotEnvelope, 'signature'> = {
    schema_version: OPERATOR_SNAPSHOT_VERSION,
    snapshot_id: `fixture.${adapterId}.1`,
    port_id: fixtureManifest.portId,
    terminal_id: fixtureManifest.terminalId,
    adapter_id: adapterId,
    source_system: `test.${adapterId}`,
    source_record_id: `test.record.${adapterId}.1`,
    sequence: 1,
    observed_at: FIXTURE_NOW.toISOString(),
    emitted_at: FIXTURE_NOW.toISOString(),
    payload,
    units: { ...OPERATOR_ADAPTER_CONTRACTS[adapterId].units },
    payload_sha256: payloadSha256(payload),
    ...overrides,
  };
  return signOperatorEnvelope(unsigned, fixtureSigningKeys[adapterId]);
};

export const buildAllFixtureEnvelopes = () => OPERATOR_ADAPTER_IDS.map((adapterId) => buildFixtureEnvelope(adapterId));
