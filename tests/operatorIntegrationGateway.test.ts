import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  OperatorIntegrationGateway,
  payloadSha256,
  signOperatorEnvelope,
  type OperatorSnapshotEnvelope,
} from '../server/operatorIntegrationGateway.ts';
import { assessOperatorSourceManifest, OPERATOR_ADAPTER_IDS } from '../server/operatorSourceManifest.ts';
import { PORT_OPERATIONAL_FIELDS } from '../shared/portOperationalContract.ts';
import {
  FIXTURE_NOW,
  buildAllFixtureEnvelopes,
  buildFixtureEnvelope,
  fixtureManifest,
  fixtureSigningKeys,
} from '../scripts/integration/operatorDataFixture.ts';

const createGateway = (stateFile: string | null) => new OperatorIntegrationGateway({
  signingKeys: fixtureSigningKeys,
  stateFile,
  manifestReadiness: assessOperatorSourceManifest(fixtureManifest, FIXTURE_NOW),
  clock: () => FIXTURE_NOW,
});

const resign = (envelope: OperatorSnapshotEnvelope) => {
  const unsigned = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== 'signature'),
  ) as Omit<OperatorSnapshotEnvelope, 'signature'>;
  return signOperatorEnvelope(unsigned, fixtureSigningKeys[envelope.adapter_id]);
};

test('six signed operator sources atomically release a complete read-only shadow snapshot', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'operator-gateway-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'state.json');
  const gateway = createGateway(stateFile);
  const before = gateway.shadowSnapshot();
  assert.equal(before.protocolVersion, 'operator-shadow-blocked.v1');

  for (const envelope of buildAllFixtureEnvelopes()) {
    const result = gateway.ingest(envelope);
    assert.equal(result.accepted, true);
    assert.equal(result.production_authority, false);
  }

  const status = gateway.status();
  assert.equal(status.ready_adapter_count, OPERATOR_ADAPTER_IDS.length);
  assert.equal(status.operator_data_ready, true);
  assert.equal(status.live_data_verified, true);
  assert.equal(status.read_only_shadow_ready, true);
  assert.equal(status.site_delivery_ready, false);
  assert.equal(status.authority.dispatch_allowed, false);
  assert.equal(status.authority.production_authority, false);

  const shadow = gateway.shadowSnapshot();
  assert.equal(shadow.protocolVersion, 'port-digital-twin.snapshot.v1');
  const operatorData = (shadow as unknown as {
    operatorData: {
      record: Record<string, unknown>;
      fieldLineage: Record<string, unknown>;
      assets: { aisVessels: unknown[] };
      quality: { fieldCount: number; gate: string };
      authority: Record<string, boolean>;
    };
  }).operatorData;
  assert.equal(operatorData.quality.gate, 'PASS');
  assert.equal(operatorData.quality.fieldCount, PORT_OPERATIONAL_FIELDS.length);
  assert.deepEqual(Object.keys(operatorData.record).sort(), PORT_OPERATIONAL_FIELDS.map(({ field }) => field).sort());
  assert.equal(Object.keys(operatorData.fieldLineage).length, PORT_OPERATIONAL_FIELDS.length);
  assert.equal(operatorData.assets.aisVessels.length, 1);
  assert.equal(operatorData.authority.live_data_verified, true);
  assert.equal(operatorData.authority.dispatch_allowed, false);

  const persisted = await readFile(stateFile, 'utf8');
  assert.doesNotMatch(persisted, /"arrivals"|"vessels"|"carbon_emissions_tons"/);
  const restarted = createGateway(stateFile);
  assert.equal(restarted.status().read_only_shadow_ready, false);
  assert.equal(restarted.shadowSnapshot().protocolVersion, 'operator-shadow-blocked.v1');
});

test('gateway rejects tampering, missing fields, unit mismatch and stale evidence', () => {
  const gateway = createGateway(null);

  const tampered = buildFixtureEnvelope('energy_carbon_feed');
  tampered.payload.carbon_emissions_tons = 999;
  const tamperedResult = gateway.ingest(tampered);
  assert.equal(tamperedResult.accepted, false);
  assert.ok(tamperedResult.errors?.includes('payload_sha256_mismatch'));
  assert.ok(tamperedResult.errors?.includes('signature_invalid'));

  const missing = buildFixtureEnvelope('terminal_operating_system');
  delete missing.payload.arrivals;
  missing.payload_sha256 = payloadSha256(missing.payload);
  const missingResult = gateway.ingest(resign(missing));
  assert.equal(missingResult.accepted, false);
  assert.ok(missingResult.errors?.some((error) => error.startsWith('missing_fields:arrivals')));

  const wrongUnit = buildFixtureEnvelope('vessel_traffic_service');
  wrongUnit.units.wind_speed_ms = 'knots';
  const unitResult = gateway.ingest(resign(wrongUnit));
  assert.equal(unitResult.accepted, false);
  assert.ok(unitResult.errors?.includes('unit_mismatch:wind_speed_ms:m/s'));

  const stale = buildFixtureEnvelope('intermodal_transfer_feed', {
    snapshot_id: 'fixture.intermodal.stale',
    source_record_id: 'test.record.intermodal.stale',
    observed_at: '2026-08-30T07:40:00.000Z',
    emitted_at: '2026-08-30T07:40:01.000Z',
  });
  const staleResult = gateway.ingest(stale);
  assert.equal(staleResult.accepted, false);
  assert.ok(staleResult.errors?.includes('snapshot_stale'));
});

test('gateway accepts exact replay idempotently and blocks sequence rollback', () => {
  const gateway = createGateway(null);
  const accepted = buildFixtureEnvelope('safety_regulatory_feed');
  assert.equal(gateway.ingest(accepted).accepted, true);
  assert.equal(gateway.ingest(accepted).idempotent_replay, true);

  const rollback = buildFixtureEnvelope('safety_regulatory_feed', {
    snapshot_id: 'fixture.safety.rollback',
    source_record_id: 'test.record.safety.rollback',
    sequence: 0,
  });
  const result = gateway.ingest(rollback);
  assert.equal(result.accepted, false);
  assert.ok(result.errors?.includes('sequence_not_increasing'));
});
