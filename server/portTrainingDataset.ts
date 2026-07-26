import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { RL_OPERATIONAL_CALIBRATION } from '../shared/rlOperationalCalibration.ts';

export interface PortTrainingRecord {
  portId: string;
  timestamp: string;
  arrivals: number;
  grossTonnage: number;
  capacity: number;
  windSpeedMs: number;
  waveHeightM: number;
  visibilityKm: number;
  safetyIncidents: number;
}

export interface PortTrainingDataset {
  id: string;
  label: string;
  source: string;
  sourceUrl: string;
  license: string;
  path: string;
  fingerprint: string;
  portId: string;
  samplingInterval: 'monthly' | 'operator-defined';
  evidenceLevel: 'public-aggregate-proxy' | 'operator-supplied';
  quality: {
    rawRecordCount: number;
    rejectedRecordCount: number;
    availablePortIds: string[];
    duplicateTimestampCount: 0;
    capacityCoveragePercent: number;
    windCoveragePercent: number;
    waveCoveragePercent: number;
    visibilityCoveragePercent: number;
    weatherCoveragePercent: number;
    safetyCoveragePercent: number;
    capacityMode: 'measured' | 'mixed' | 'empirical-proxy';
    capacityProxyCalibratedOn: 'train-only' | null;
    capacityProxyMethod: string | null;
    capacityProxyValue: number | null;
    operationalClaimAllowed: boolean;
    validationArrivalDriftPercent: number;
    testArrivalDriftPercent: number;
  };
  records: PortTrainingRecord[];
  trainRecords: PortTrainingRecord[];
  validationRecords: PortTrainingRecord[];
  testRecords: PortTrainingRecord[];
  split: {
    method: 'chronological';
    trainRatio: number;
    validationRatio: number;
    testRatio: number;
    trainRange: [string, string];
    validationRange: [string, string];
    testRange: [string, string];
  };
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_DATASET_PATH = path.resolve(process.cwd(), 'data/rl/mpa_vessel_arrivals_monthly.csv');
const FIELD_ALIASES = {
  portId: ['port_id', 'portId', 'unlocode', 'port_code', 'terminal_id'],
  timestamp: ['timestamp', 'datetime', 'date', 'time', 'month', 'period'],
  arrivals: ['arrivals', 'arrival_count', 'vessel_arrivals', 'number_of_vessels', 'vessels'],
  grossTonnage: ['gross_tonnage', 'grossTonnage', 'tonnage', 'gross_tons'],
  capacity: ['capacity', 'service_capacity', 'port_capacity', 'berth_capacity'],
  windSpeedMs: ['wind_speed_ms', 'windSpeedMs', 'wind_speed'],
  waveHeightM: ['wave_height_m', 'waveHeightM', 'wave_height'],
  visibilityKm: ['visibility_km', 'visibilityKm', 'visibility'],
  safetyIncidents: ['safety_incidents', 'safetyIncidents', 'incident_count'],
} as const;

const numberValue = (value: unknown, fallback = Number.NaN) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pick = (record: UnknownRecord, aliases: readonly string[]) => {
  const key = aliases.find((alias) => record[alias] !== undefined && record[alias] !== '');
  return key ? record[key] : undefined;
};

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

const parseCsv = (content: string): UnknownRecord[] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
};

const parseJson = (content: string): UnknownRecord[] => {
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) return parsed as UnknownRecord[];
  if (parsed && typeof parsed === 'object') {
    const object = parsed as { records?: unknown[]; data?: unknown[] };
    const records = object.records ?? object.data;
    if (Array.isArray(records)) return records as UnknownRecord[];
  }
  throw new Error('JSON 训练集必须是数组，或包含 records/data 数组');
};

const percentile = (values: number[], ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index] ?? 1;
};

const normalizeRecords = (records: UnknownRecord[], requestedPortId?: string) => {
  const base = records.flatMap((record) => {
    const portId = String(pick(record, FIELD_ALIASES.portId) ?? 'default-port').trim();
    const timestamp = String(pick(record, FIELD_ALIASES.timestamp) ?? '').trim();
    const arrivals = numberValue(pick(record, FIELD_ALIASES.arrivals));
    const grossTonnage = numberValue(pick(record, FIELD_ALIASES.grossTonnage));
    if (!timestamp || !Number.isFinite(arrivals) || arrivals <= 0 || !Number.isFinite(grossTonnage)) return [];
    return [{
      portId,
      timestamp,
      arrivals,
      grossTonnage,
      capacity: numberValue(pick(record, FIELD_ALIASES.capacity)),
      windSpeedMs: numberValue(pick(record, FIELD_ALIASES.windSpeedMs), 0),
      waveHeightM: numberValue(pick(record, FIELD_ALIASES.waveHeightM), 0),
      visibilityKm: numberValue(pick(record, FIELD_ALIASES.visibilityKm), 20),
      safetyIncidents: numberValue(pick(record, FIELD_ALIASES.safetyIncidents), 0),
      hasCapacity: Number.isFinite(numberValue(pick(record, FIELD_ALIASES.capacity))),
      hasWind: pick(record, FIELD_ALIASES.windSpeedMs) !== undefined,
      hasWave: pick(record, FIELD_ALIASES.waveHeightM) !== undefined,
      hasVisibility: pick(record, FIELD_ALIASES.visibilityKm) !== undefined,
      hasWeather: [FIELD_ALIASES.windSpeedMs, FIELD_ALIASES.waveHeightM, FIELD_ALIASES.visibilityKm]
        .every((aliases) => pick(record, aliases) !== undefined),
      hasSafety: pick(record, FIELD_ALIASES.safetyIncidents) !== undefined,
    }];
  }).sort((left, right) => left.portId.localeCompare(right.portId) || left.timestamp.localeCompare(right.timestamp));

  const portIds = [...new Set(base.map((record) => record.portId))];
  const selectedPortId = requestedPortId?.trim() || (portIds.length === 1 ? portIds[0] : '');
  if (!selectedPortId) {
    throw new Error(`训练集包含多个港口（${portIds.join(', ')}），请设置 PORT_TRAINING_PORT_ID`);
  }
  const selected = base.filter((record) => record.portId === selectedPortId);
  if (!selected.length) {
    throw new Error(`训练集不存在港口 ${selectedPortId}；可用港口：${portIds.join(', ')}`);
  }
  if (selected.length < 20) throw new Error(`港口 ${selectedPortId} 只有 ${selected.length} 条有效记录，至少需要 20 条`);
  const duplicateTimestamp = selected.find((record, index) => index > 0 && record.timestamp === selected[index - 1].timestamp);
  if (duplicateTimestamp) throw new Error(`港口 ${selectedPortId} 存在重复时间戳 ${duplicateTimestamp.timestamp}`);
  const capacityRecords = selected.filter((record) => record.hasCapacity && record.capacity > 0).length;
  const normalized = selected.map((record) => ({
    portId: record.portId,
    timestamp: record.timestamp,
    arrivals: record.arrivals,
    grossTonnage: record.grossTonnage,
    capacity: record.hasCapacity && record.capacity > 0 ? record.capacity : Number.NaN,
    windSpeedMs: record.windSpeedMs,
    waveHeightM: record.waveHeightM,
    visibilityKm: record.visibilityKm,
    safetyIncidents: record.safetyIncidents,
  }));
  return {
    records: normalized,
    quality: {
      rawRecordCount: records.length,
      rejectedRecordCount: records.length - base.length,
      availablePortIds: portIds,
      duplicateTimestampCount: 0 as const,
      capacityCoveragePercent: Number((capacityRecords / selected.length * 100).toFixed(1)),
      windCoveragePercent: Number((selected.filter((record) => record.hasWind).length / selected.length * 100).toFixed(1)),
      waveCoveragePercent: Number((selected.filter((record) => record.hasWave).length / selected.length * 100).toFixed(1)),
      visibilityCoveragePercent: Number((selected.filter((record) => record.hasVisibility).length / selected.length * 100).toFixed(1)),
      weatherCoveragePercent: Number((selected.filter((record) => record.hasWeather).length / selected.length * 100).toFixed(1)),
      safetyCoveragePercent: Number((selected.filter((record) => record.hasSafety).length / selected.length * 100).toFixed(1)),
      capacityMode: capacityRecords === selected.length
        ? 'measured' as const
        : capacityRecords === 0 ? 'empirical-proxy' as const : 'mixed' as const,
    },
  };
};

export const loadPortTrainingDataset = async (
  datasetPath = process.env.PORT_TRAINING_DATASET_PATH,
  portId = process.env.PORT_TRAINING_PORT_ID,
) => {
  const resolvedPath = path.resolve(datasetPath || DEFAULT_DATASET_PATH);
  const content = await readFile(resolvedPath, 'utf8');
  const isDefault = resolvedPath === DEFAULT_DATASET_PATH;
  const parsedRecords = resolvedPath.toLowerCase().endsWith('.json') ? parseJson(content) : parseCsv(content);
  const rawRecords = isDefault
    ? parsedRecords.map((record) => ({ port_id: 'SGSIN-AGGREGATE', ...record }))
    : parsedRecords;
  const normalized = normalizeRecords(rawRecords, portId);
  const trainEnd = Math.max(8, Math.floor(normalized.records.length * 0.7));
  const validationEnd = Math.min(
    normalized.records.length - 4,
    Math.max(trainEnd + 4, Math.floor(normalized.records.length * 0.85)),
  );
  // Capacity proxies must be calibrated on the training segment only. Using
  // validation/test arrivals here would leak future demand into the environment.
  const inferredCapacity = percentile(
    normalized.records.slice(0, trainEnd).map((record) => record.arrivals),
    RL_OPERATIONAL_CALIBRATION.capacityProxy.quantile,
  ) * RL_OPERATIONAL_CALIBRATION.capacityProxy.multiplier;
  const records = normalized.records.map((record) => ({
    ...record,
    capacity: Number.isFinite(record.capacity) && record.capacity > 0
      ? record.capacity
      : inferredCapacity,
  }));
  const trainRecords = records.slice(0, trainEnd);
  const validationRecords = records.slice(trainEnd, validationEnd);
  const testRecords = records.slice(validationEnd);
  const meanArrivals = (values: PortTrainingRecord[]) =>
    values.reduce((sum, record) => sum + record.arrivals, 0) / Math.max(1, values.length);
  const trainArrivalMean = meanArrivals(trainRecords);
  const arrivalDrift = (values: PortTrainingRecord[]) => Number(((meanArrivals(values) - trainArrivalMean) /
    Math.max(1, trainArrivalMean) * 100).toFixed(2));
  return {
    id: isDefault ? 'mpa-vessel-arrivals-monthly' : path.basename(resolvedPath),
    label: isDefault ? 'MPA 月度到港船舶 + ERA5 风场公开数据' : path.basename(resolvedPath),
    source: isDefault ? 'Maritime and Port Authority of Singapore / data.gov.sg + Open-Meteo ERA5' : 'operator-provided-file',
    sourceUrl: isDefault
      ? 'https://data.gov.sg/collections/394/view ; https://open-meteo.com/en/docs/historical-weather-api'
      : '',
    license: isDefault ? 'Singapore Open Data Licence' : 'operator-supplied; verify before redistribution',
    path: resolvedPath,
    fingerprint: createHash('sha256').update(content).digest('hex').slice(0, 16),
    portId: records[0].portId,
    samplingInterval: isDefault ? 'monthly' : 'operator-defined',
    evidenceLevel: isDefault ? 'public-aggregate-proxy' : 'operator-supplied',
    quality: {
      ...normalized.quality,
      capacityProxyCalibratedOn: normalized.quality.capacityMode === 'measured' ? null : 'train-only',
      capacityProxyMethod: normalized.quality.capacityMode === 'measured'
        ? null
        : RL_OPERATIONAL_CALIBRATION.capacityProxy.method,
      capacityProxyValue: normalized.quality.capacityMode === 'measured'
        ? null
        : Number(inferredCapacity.toFixed(2)),
      operationalClaimAllowed:
        normalized.quality.capacityMode === 'measured' &&
        normalized.quality.weatherCoveragePercent === 100 &&
        normalized.quality.safetyCoveragePercent === 100,
      validationArrivalDriftPercent: arrivalDrift(validationRecords),
      testArrivalDriftPercent: arrivalDrift(testRecords),
    },
    records,
    trainRecords,
    validationRecords,
    testRecords,
    split: {
      method: 'chronological',
      trainRatio: trainRecords.length / records.length,
      validationRatio: validationRecords.length / records.length,
      testRatio: testRecords.length / records.length,
      trainRange: [trainRecords[0].timestamp, trainRecords.at(-1)!.timestamp],
      validationRange: [validationRecords[0].timestamp, validationRecords.at(-1)!.timestamp],
      testRange: [testRecords[0].timestamp, testRecords.at(-1)!.timestamp],
    },
  } satisfies PortTrainingDataset;
};
