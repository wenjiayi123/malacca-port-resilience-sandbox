import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parsePortOperationalManifest,
} from '../server/portOperationalManifest.ts';
import { loadResolvedRlTrainingDataset } from '../server/rlDatasetResolver.ts';
import { PORT_OPERATIONAL_FIELDS } from '../shared/portOperationalContract.ts';

const completeFields = PORT_OPERATIONAL_FIELDS.map((definition) => definition.field);

test('operator manifest validates field mappings and reaches terminal training readiness', () => {
  const manifest = parsePortOperationalManifest({
    protocolVersion: 'terminal-operations.v2',
    datasetId: 'sipg-terminal-history',
    portId: 'CNSHA',
    sceneProfileId: 'shanghai-international-port',
    source: 'authorized SIPG export',
    sourceUrl: '',
    license: 'operator-confidential',
    evidenceLevel: 'operator-authorized',
    timezone: 'Asia/Shanghai',
    samplingInterval: '15 minutes',
    dataPath: '/secure/port/history.parquet',
    availableFields: completeFields,
    fieldMappings: Object.fromEntries(completeFields.map((field) => [field, field])),
  });
  assert.equal(manifest.portId, 'CNSHA');
  assert.equal(manifest.availableFields.length, completeFields.length);
});

test('operator manifest rejects declared fields without mappings', () => {
  assert.throws(() => parsePortOperationalManifest({
    protocolVersion: 'terminal-operations.v2',
    datasetId: 'invalid',
    portId: 'CNSHA',
    sceneProfileId: 'shanghai-international-port',
    source: 'test',
    license: 'test',
    evidenceLevel: 'synthetic-contract-example',
    timezone: 'Asia/Shanghai',
    samplingInterval: '15 minutes',
    dataPath: '/tmp/example.csv',
    availableFields: ['port_id', 'timestamp'],
    fieldMappings: { port_id: 'port_code' },
  }), /fieldMappings.timestamp/);
});

test('authorized terminal manifest resolves into the existing five-method training dataset', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shanghai-operational-manifest-'));
  const previousManifestPath = process.env.PORT_OPERATIONAL_MANIFEST_PATH;
  context.after(async () => {
    if (previousManifestPath === undefined) delete process.env.PORT_OPERATIONAL_MANIFEST_PATH;
    else process.env.PORT_OPERATIONAL_MANIFEST_PATH = previousManifestPath;
    await rm(directory, { recursive: true, force: true });
  });
  const records = Array.from({ length: 24 }, (_, index) => Object.fromEntries(
    completeFields.map((field) => {
      if (field === 'port_id') return [field, 'CNSHA'];
      if (field === 'terminal_id') return [field, 'YANGSHAN-IV'];
      if (field === 'timestamp' || field === 'planned_eta' || field === 'actual_eta') {
        return [field, `2025-01-${String(index + 1).padStart(2, '0')}T00:00:00+08:00`];
      }
      if (field === 'arrivals') return [field, 20 + index];
      if (field === 'gross_tonnage') return [field, 200_000 + index * 1_000];
      if (field === 'effective_service_capacity') return [field, 28];
      if (field === 'wind_speed_ms') return [field, 8];
      if (field === 'wave_height_m') return [field, 0.8];
      if (field === 'visibility_km') return [field, 12];
      if (field === 'safety_incidents') return [field, 0];
      return [field, 1];
    }),
  ));
  const dataPath = path.join(directory, 'operations.json');
  const manifestPath = path.join(directory, 'manifest.json');
  await writeFile(dataPath, JSON.stringify(records), 'utf8');
  await writeFile(manifestPath, JSON.stringify({
    protocolVersion: 'terminal-operations.v2',
    datasetId: 'authorized-shanghai-test',
    portId: 'CNSHA',
    sceneProfileId: 'shanghai-international-port',
    source: 'authorized test fixture',
    sourceUrl: '',
    license: 'operator-confidential',
    evidenceLevel: 'operator-authorized',
    timezone: 'Asia/Shanghai',
    samplingInterval: 'daily',
    dataPath,
    availableFields: completeFields,
    fieldMappings: Object.fromEntries(completeFields.map((field) => [field, field])),
  }), 'utf8');
  process.env.PORT_OPERATIONAL_MANIFEST_PATH = manifestPath;
  const dataset = await loadResolvedRlTrainingDataset();
  assert.equal(dataset.id, 'authorized-shanghai-test');
  assert.equal(dataset.portId, 'CNSHA');
  assert.equal(dataset.records.length, 24);
  assert.equal(dataset.quality.capacityMode, 'measured');
  assert.equal(dataset.quality.weatherCoveragePercent, 100);
  assert.equal(dataset.quality.operationalClaimAllowed, true);

  records[0].tide_window_open = '';
  await writeFile(dataPath, JSON.stringify(records), 'utf8');
  await assert.rejects(
    () => loadResolvedRlTrainingDataset(),
    /第 1 条记录缺少 tide_window_open/,
  );
});
