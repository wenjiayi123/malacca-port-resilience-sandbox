import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadPortOperationalManifest,
  type PortOperationalManifest,
} from './portOperationalManifest.ts';
import {
  loadPortTrainingDataset,
  type PortTrainingDataset,
} from './portTrainingDataset.ts';
import {
  PORT_OPERATIONAL_FIELDS,
  type PortOperationalField,
} from '../shared/portOperationalContract.ts';

type UnknownRecord = Record<string, unknown>;

const parseCsvLine = (line: string) => {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
};

const parseRecords = (content: string, sourcePath: string): UnknownRecord[] => {
  if (sourcePath.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) return parsed as UnknownRecord[];
    if (parsed && typeof parsed === 'object') {
      const object = parsed as { records?: unknown[]; data?: unknown[] };
      const records = object.records ?? object.data;
      if (Array.isArray(records)) return records as UnknownRecord[];
    }
    throw new Error('运行数据 JSON 必须是数组，或包含 records/data 数组');
  }
  const lines = content.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
};

const sourceValue = (
  record: UnknownRecord,
  manifest: PortOperationalManifest,
  field: keyof PortOperationalManifest['fieldMappings'],
) => {
  const mapped = manifest.fieldMappings[field];
  return mapped ? record[mapped] : undefined;
};

const adaptOperationalRecords = (
  records: UnknownRecord[],
  manifest: PortOperationalManifest,
) => records.map((record) => ({
  port_id: sourceValue(record, manifest, 'port_id'),
  terminal_id: sourceValue(record, manifest, 'terminal_id'),
  timestamp: sourceValue(record, manifest, 'timestamp'),
  arrivals: sourceValue(record, manifest, 'arrivals'),
  gross_tonnage: sourceValue(record, manifest, 'gross_tonnage'),
  capacity: sourceValue(record, manifest, 'effective_service_capacity'),
  wind_speed_ms: sourceValue(record, manifest, 'wind_speed_ms'),
  wave_height_m: sourceValue(record, manifest, 'wave_height_m'),
  visibility_km: sourceValue(record, manifest, 'visibility_km'),
  safety_incidents: sourceValue(record, manifest, 'safety_incidents'),
  operational_context: Object.fromEntries(manifest.availableFields.map((field) => [
    field,
    sourceValue(record, manifest, field),
  ])),
}));

const requiredOperationalFields = PORT_OPERATIONAL_FIELDS
  .filter((definition) => definition.requiredForTraining)
  .map((definition) => definition.field);
const timestampFields = new Set<PortOperationalField>(['timestamp', 'planned_eta', 'actual_eta']);
const identifierFields = new Set<PortOperationalField>(['port_id', 'terminal_id']);
const binaryFields = new Set<PortOperationalField>([
  'channel_available',
  'tide_window_open',
  'hazmat_restriction_active',
]);
const percentFields = new Set<PortOperationalField>([
  'berth_utilization_percent',
  'yard_occupancy_percent',
]);

const validateOperationalRecords = (
  records: UnknownRecord[],
  manifest: PortOperationalManifest,
) => {
  if (records.length < 20) {
    throw new Error('terminal-operations.v2 至少需要 20 条按时间排序的运行记录');
  }
  records.forEach((record, index) => {
    for (const field of requiredOperationalFields) {
      const value = sourceValue(record, manifest, field);
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new Error(`terminal-operations.v2 第 ${index + 1} 条记录缺少 ${field}`);
      }
      if (identifierFields.has(field)) continue;
      if (timestampFields.has(field)) {
        const text = String(value).trim();
        if (Number.isNaN(Date.parse(text)) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
          throw new Error(`terminal-operations.v2 第 ${index + 1} 条记录的 ${field} 必须包含有效时区`);
        }
        continue;
      }
      if (binaryFields.has(field)) {
        const normalized = String(value).trim().toLowerCase();
        if (!['0', '1', 'true', 'false'].includes(normalized)) {
          throw new Error(`terminal-operations.v2 第 ${index + 1} 条记录的 ${field} 必须是 0/1 或 true/false`);
        }
        continue;
      }
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error(`terminal-operations.v2 第 ${index + 1} 条记录的 ${field} 必须是非负数`);
      }
      if (percentFields.has(field) && numeric > 100) {
        throw new Error(`terminal-operations.v2 第 ${index + 1} 条记录的 ${field} 不得超过 100`);
      }
    }
  });
};

export const loadResolvedRlTrainingDataset = async (): Promise<PortTrainingDataset> => {
  const status = await loadPortOperationalManifest();
  if (!status.configured || !status.manifest) return loadPortTrainingDataset();
  if (!status.readiness.trainingReady) {
    throw new Error(
      `terminal-operations.v2 数据门禁未通过：缺少 ${status.readiness.missingTrainingFields.join(', ')}`,
    );
  }
  const manifest = status.manifest;
  const sourcePath = path.resolve(path.dirname(status.manifestPath!), manifest.dataPath);
  const sourceContent = await readFile(sourcePath, 'utf8');
  const sourceRecords = parseRecords(sourceContent, sourcePath);
  validateOperationalRecords(sourceRecords, manifest);
  const adapted = adaptOperationalRecords(sourceRecords, manifest);
  const digest = createHash('sha256')
    .update(JSON.stringify({ manifest, sourceContent }))
    .digest('hex');
  const runtimeDirectory = path.resolve(process.env.RL_OPERATIONAL_ADAPTER_DIR || '.runtime/operational-adapter');
  const adaptedPath = path.join(runtimeDirectory, `${digest.slice(0, 20)}.json`);
  await mkdir(runtimeDirectory, { recursive: true });
  await writeFile(adaptedPath, JSON.stringify(adapted), 'utf8');
  const dataset = await loadPortTrainingDataset(adaptedPath, manifest.portId);
  return {
    ...dataset,
    id: manifest.datasetId,
    label: `${manifest.portId} terminal-operations.v2`,
    source: manifest.source,
    sourceUrl: manifest.sourceUrl,
    license: manifest.license,
    evidenceLevel: 'operator-supplied',
    quality: {
      ...dataset.quality,
      operationalClaimAllowed:
        manifest.evidenceLevel === 'operator-authorized' &&
        status.readiness.trainingReady &&
        dataset.quality.operationalClaimAllowed,
    },
  };
};
