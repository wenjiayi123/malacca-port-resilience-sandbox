import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPortTrainingDataset } from './portTrainingDataset.ts';

export type PortBusinessEvidenceLevel =
  | 'public-aggregate-with-engineering-augmentation'
  | 'operator-supplied-unverified'
  | 'operator-authorized';

export interface PortBusinessRecord {
  portId: string;
  terminalId: string;
  timestamp: string;
  sourceMonth: string;
  publicAnchorArrivals: number;
  publicAnchorGrossTonnage: number;
  publicAnchorWindSpeedMs: number;
  arrivals: number;
  grossTonnage: number;
  effectiveCapacity: number;
  etaDeviationHours: number;
  berthUtilization: number;
  craneProductivityIndex: number;
  craneAvailabilityRatio: number;
  yardOccupancy: number;
  truckTurnTimeMinutes: number;
  gateQueuePressure: number;
  railTransferDemand: number;
  waterTransferDemand: number;
  transferCapacity: number;
  channelAvailable: boolean;
  tideWindowOpen: boolean;
  pilotAvailabilityRatio: number;
  tugAvailabilityRatio: number;
  windSpeedMs: number;
  waveHeightM: number;
  visibilityKm: number;
  currentSpeedKnots: number;
  safetyRisk: number;
  hazmatRestrictionActive: boolean;
  shorePowerAvailability: number;
  carbonIntensity: number;
  energyPriceIndex: number;
  capacityLossRatio: number;
  vesselSizeIndex: number;
  fairnessDemandSkew: number;
  forecastUncertainty: number;
  dataQualityScore: number;
}

export interface PortBusinessFieldLineage {
  field: keyof PortBusinessRecord;
  mode: 'public-anchor' | 'public-anchor-disaggregated' | 'engineering-derived' | 'operator-measured';
  replaceWith: string;
}

export interface PortBusinessDataset {
  protocolVersion: 'port-business-dataset.v3';
  id: string;
  label: string;
  evidenceLevel: PortBusinessEvidenceLevel;
  operationalClaimAllowed: boolean;
  source: string;
  sourceUrls: string[];
  license: string;
  fingerprint: string;
  sourceFingerprint: string;
  generatorVersion: string;
  records: PortBusinessRecord[];
  trainRecords: PortBusinessRecord[];
  validationRecords: PortBusinessRecord[];
  testRecords: PortBusinessRecord[];
  split: {
    method: 'chronological';
    trainRange: [string, string];
    validationRange: [string, string];
    testRange: [string, string];
  };
  lineage: PortBusinessFieldLineage[];
  quality: {
    recordCount: number;
    publicAnchorFieldCount: number;
    engineeringDerivedFieldCount: number;
    operatorMeasuredFieldCount: number;
    publicAnchorCoveragePercent: number;
    operatorMeasurementCoveragePercent: number;
    dataQualityScoreMean: number;
    leakageChecks: {
      chronologicalSplit: boolean;
      capacityCalibratedOnTrainOnly: boolean;
      validationExcludedFromTraining: boolean;
      testSealedUntilChampionSelection: boolean;
    };
  };
  limitations: string[];
}

const GENERATOR_VERSION = 'public-anchor-reality-augmentation.v3.1';
const DEFAULT_PORT_ID = 'SGSIN-PUBLIC-ANCHOR';
const DEFAULT_TERMINAL_ID = 'AGGREGATE-SCENARIO';
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));
const round = (value: number, digits = 6) => Number(value.toFixed(digits));
const REQUIRED_FIELDS = [
  'portId', 'terminalId', 'timestamp', 'arrivals', 'grossTonnage', 'effectiveCapacity',
  'etaDeviationHours', 'berthUtilization', 'craneProductivityIndex', 'craneAvailabilityRatio',
  'yardOccupancy', 'truckTurnTimeMinutes', 'gateQueuePressure', 'railTransferDemand',
  'waterTransferDemand', 'transferCapacity', 'channelAvailable', 'tideWindowOpen',
  'pilotAvailabilityRatio', 'tugAvailabilityRatio', 'windSpeedMs', 'waveHeightM',
  'visibilityKm', 'currentSpeedKnots', 'safetyRisk', 'hazmatRestrictionActive',
  'shorePowerAvailability', 'carbonIntensity', 'energyPriceIndex', 'capacityLossRatio',
  'vesselSizeIndex', 'fairnessDemandSkew', 'forecastUncertainty', 'dataQualityScore',
] satisfies Array<keyof PortBusinessRecord>;

const percentile = (values: number[], ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)))] ?? 1;
};

const deterministicNoise = (index: number, slot: number, salt: number) => {
  const raw = Math.sin((index + 1) * (12.9898 + salt) + (slot + 1) * 78.233) * 43_758.5453;
  return (raw - Math.floor(raw)) * 2 - 1;
};

const lineageFor = (
  fields: Array<keyof PortBusinessRecord>,
  mode: PortBusinessFieldLineage['mode'],
  replaceWith: string,
) => fields.map((field) => ({ field, mode, replaceWith }));

const DEFAULT_LINEAGE: PortBusinessFieldLineage[] = [
  ...lineageFor(
    ['sourceMonth', 'publicAnchorArrivals', 'publicAnchorGrossTonnage', 'publicAnchorWindSpeedMs'],
    'public-anchor',
    '对应月份的港口统计、船舶事件或现场气象测量',
  ),
  ...lineageFor(
    ['timestamp', 'arrivals', 'grossTonnage', 'windSpeedMs'],
    'public-anchor-disaggregated',
    '统一时区的船舶到港事件、自动识别系统聚合和港区气象时间序列',
  ),
  ...lineageFor(
    [
      'portId',
      'terminalId',
      'effectiveCapacity',
      'etaDeviationHours',
      'berthUtilization',
      'craneProductivityIndex',
      'craneAvailabilityRatio',
      'yardOccupancy',
      'truckTurnTimeMinutes',
      'gateQueuePressure',
      'railTransferDemand',
      'waterTransferDemand',
      'transferCapacity',
      'channelAvailable',
      'tideWindowOpen',
      'pilotAvailabilityRatio',
      'tugAvailabilityRatio',
      'waveHeightM',
      'visibilityKm',
      'currentSpeedKnots',
      'safetyRisk',
      'hazmatRestrictionActive',
      'shorePowerAvailability',
      'carbonIntensity',
      'energyPriceIndex',
      'capacityLossRatio',
      'vesselSizeIndex',
      'fairnessDemandSkew',
      'forecastUncertainty',
      'dataQualityScore',
    ],
    'engineering-derived',
    'terminal-operations.v2 对应现场字段或经现场校准的派生量',
  ),
];

interface PublicAnchorSeed {
  sourceMonth: string;
  slot: number;
  timestamp: string;
  publicAnchorArrivals: number;
  publicAnchorGrossTonnage: number;
  publicAnchorWindSpeedMs: number;
  arrivals: number;
  grossTonnage: number;
}

const expandPublicAnchors = async () => {
  const aggregate = await loadPortTrainingDataset();
  const seeds: PublicAnchorSeed[] = [];
  aggregate.records.forEach((record, monthIndex) => {
    const baseShares = [0.235, 0.255, 0.245, 0.265];
    const rawShares = baseShares.map((share, slot) =>
      share * (1 + deterministicNoise(monthIndex, slot, 0.71) * 0.045));
    const shareTotal = rawShares.reduce((sum, share) => sum + share, 0);
    rawShares.forEach((rawShare, slot) => {
      const share = rawShare / shareTotal;
      const day = [1, 8, 15, 22][slot];
      seeds.push({
        sourceMonth: record.timestamp,
        slot,
        timestamp: `${record.timestamp}-${String(day).padStart(2, '0')}T00:00:00+08:00`,
        publicAnchorArrivals: record.arrivals,
        publicAnchorGrossTonnage: record.grossTonnage,
        publicAnchorWindSpeedMs: record.windSpeedMs,
        arrivals: record.arrivals * share,
        grossTonnage: record.grossTonnage * share,
      });
    });
  });
  return { aggregate, seeds };
};

const splitIndexes = (recordCount: number) => {
  const trainEnd = Math.max(80, Math.floor(recordCount * 0.7));
  const validationEnd = Math.max(trainEnd + 20, Math.floor(recordCount * 0.85));
  return { trainEnd, validationEnd: Math.min(recordCount - 20, validationEnd) };
};

const buildDefaultRecords = async () => {
  const { aggregate, seeds } = await expandPublicAnchors();
  const { trainEnd } = splitIndexes(seeds.length);
  const trainSeeds = seeds.slice(0, trainEnd);
  const slotCapacities = Array.from({ length: 4 }, (_, slot) =>
    percentile(trainSeeds.filter((seed) => seed.slot === slot).map((seed) => seed.arrivals), 0.9) * 1.04);
  const trainMedianVesselSize = percentile(
    trainSeeds.map((seed) => seed.grossTonnage / Math.max(1, seed.arrivals)),
    0.5,
  );
  const records = seeds.map((seed, index): PortBusinessRecord => {
    const noise = deterministicNoise(Math.floor(index / 4), seed.slot, 1.37);
    const pressure = seed.arrivals / Math.max(1, slotCapacities[seed.slot]);
    const weatherPressure = clamp(seed.publicAnchorWindSpeedMs / 20, 0, 1);
    const plannedMaintenance = index % 53 === 0 ? 0.12 : index % 89 === 0 ? 0.08 : 0;
    const weatherLoss = Math.max(0, weatherPressure - 0.5) * 0.12;
    const channelAvailable = index % 197 !== 0;
    const tideWindowOpen = (index + seed.slot) % 5 !== 0;
    const capacityLossRatio = clamp(plannedMaintenance + weatherLoss + (channelAvailable ? 0 : 0.42), 0, 0.6);
    const effectiveCapacity = slotCapacities[seed.slot] * (1 - capacityLossRatio);
    const berthUtilization = clamp(0.54 + pressure * 0.34 + noise * 0.035, 0.38, 1.08);
    const craneAvailabilityRatio = clamp(0.93 - plannedMaintenance * 0.8 + noise * 0.025, 0.72, 1);
    const craneProductivityIndex = clamp(
      1.03 - Math.max(0, berthUtilization - 0.82) * 0.28 - plannedMaintenance * 0.35 + noise * 0.025,
      0.68,
      1.16,
    );
    const yardOccupancy = clamp(0.51 + pressure * 0.25 + berthUtilization * 0.12 + noise * 0.025, 0.42, 1.06);
    const truckTurnTimeMinutes = clamp(32 + Math.max(0, yardOccupancy - 0.62) * 88 + pressure * 8, 26, 125);
    const gateQueuePressure = clamp((truckTurnTimeMinutes - 28) / 70 + Math.max(0, yardOccupancy - 0.78), 0, 2);
    const waveHeightM = clamp(0.35 + weatherPressure * 1.5 + Math.max(0, noise) * 0.25, 0.25, 2.4);
    const visibilityKm = clamp(18 - weatherPressure * 8 - Math.max(0, -noise) * 3, 4, 20);
    const currentSpeedKnots = clamp(0.45 + seed.slot * 0.08 + Math.abs(noise) * 0.18, 0.3, 1.2);
    const pilotAvailabilityRatio = clamp(0.88 - pressure * 0.12 - plannedMaintenance * 0.4, 0.58, 1);
    const tugAvailabilityRatio = clamp(0.9 - pressure * 0.1 - plannedMaintenance * 0.45, 0.58, 1);
    const hazmatRestrictionActive = index % 47 === 0;
    const safetyRisk = clamp(
      weatherPressure * 0.38 + waveHeightM / 4 * 0.22 + Math.max(0, 8 - visibilityKm) / 8 * 0.18 +
      (channelAvailable ? 0 : 0.16) + (hazmatRestrictionActive ? 0.1 : 0),
      0,
      1,
    );
    const vesselSize = seed.grossTonnage / Math.max(1, seed.arrivals);
    return {
      portId: DEFAULT_PORT_ID,
      terminalId: DEFAULT_TERMINAL_ID,
      timestamp: seed.timestamp,
      sourceMonth: seed.sourceMonth,
      publicAnchorArrivals: seed.publicAnchorArrivals,
      publicAnchorGrossTonnage: seed.publicAnchorGrossTonnage,
      publicAnchorWindSpeedMs: seed.publicAnchorWindSpeedMs,
      arrivals: round(seed.arrivals),
      grossTonnage: round(seed.grossTonnage),
      effectiveCapacity: round(effectiveCapacity),
      etaDeviationHours: round(clamp((pressure - 0.82) * 8 + noise * 1.5, -4, 12)),
      berthUtilization: round(berthUtilization),
      craneProductivityIndex: round(craneProductivityIndex),
      craneAvailabilityRatio: round(craneAvailabilityRatio),
      yardOccupancy: round(yardOccupancy),
      truckTurnTimeMinutes: round(truckTurnTimeMinutes),
      gateQueuePressure: round(gateQueuePressure),
      railTransferDemand: round(seed.arrivals * (0.08 + Math.max(0, pressure - 0.8) * 0.04)),
      waterTransferDemand: round(seed.arrivals * (0.12 + Math.max(0, pressure - 0.82) * 0.05)),
      transferCapacity: round(effectiveCapacity * (0.24 + (index % 7) * 0.006)),
      channelAvailable,
      tideWindowOpen,
      pilotAvailabilityRatio: round(pilotAvailabilityRatio),
      tugAvailabilityRatio: round(tugAvailabilityRatio),
      windSpeedMs: round(seed.publicAnchorWindSpeedMs * (0.88 + seed.slot * 0.045)),
      waveHeightM: round(waveHeightM),
      visibilityKm: round(visibilityKm),
      currentSpeedKnots: round(currentSpeedKnots),
      safetyRisk: round(safetyRisk),
      hazmatRestrictionActive,
      shorePowerAvailability: round(clamp(0.52 + (index % 6) * 0.06 - plannedMaintenance * 0.7, 0.3, 0.86)),
      carbonIntensity: round(clamp(1 + pressure * 0.12 + Math.max(0, yardOccupancy - 0.8) * 0.16, 0.9, 1.35)),
      energyPriceIndex: round(clamp(0.9 + (index % 12) * 0.025 + weatherPressure * 0.06, 0.85, 1.28)),
      capacityLossRatio: round(capacityLossRatio),
      vesselSizeIndex: round(clamp(vesselSize / Math.max(1, trainMedianVesselSize), 0.4, 2)),
      fairnessDemandSkew: round(clamp(0.12 + Math.abs(noise) * 0.2 + Math.max(0, pressure - 0.9) * 0.15, 0, 0.6)),
      forecastUncertainty: round(clamp(0.16 + Math.abs(noise) * 0.12 + Math.max(0, pressure - 1) * 0.12, 0.12, 0.48)),
      dataQualityScore: 0.56,
    };
  });
  return { aggregate, records };
};

const range = (records: PortBusinessRecord[]): [string, string] => [
  records[0]?.timestamp ?? '',
  records.at(-1)?.timestamp ?? '',
];

const assembleDataset = (
  records: PortBusinessRecord[],
  metadata: {
    id: string;
    label: string;
    evidenceLevel: PortBusinessEvidenceLevel;
    source: string;
    sourceUrls: string[];
    license: string;
    sourceFingerprint: string;
    lineage: PortBusinessFieldLineage[];
    limitations: string[];
  },
): PortBusinessDataset => {
  const sorted = [...records].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  const { trainEnd, validationEnd } = splitIndexes(sorted.length);
  const trainRecords = sorted.slice(0, trainEnd);
  const validationRecords = sorted.slice(trainEnd, validationEnd);
  const testRecords = sorted.slice(validationEnd);
  const modes = metadata.lineage.reduce((counts, item) => {
    counts[item.mode] = (counts[item.mode] ?? 0) + 1;
    return counts;
  }, {} as Record<PortBusinessFieldLineage['mode'], number>);
  const publicFields = (modes['public-anchor'] ?? 0) + (modes['public-anchor-disaggregated'] ?? 0);
  const operatorFields = modes['operator-measured'] ?? 0;
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ generatorVersion: GENERATOR_VERSION, sourceFingerprint: metadata.sourceFingerprint, records: sorted }))
    .digest('hex');
  return {
    protocolVersion: 'port-business-dataset.v3',
    id: metadata.id,
    label: metadata.label,
    evidenceLevel: metadata.evidenceLevel,
    operationalClaimAllowed: metadata.evidenceLevel === 'operator-authorized',
    source: metadata.source,
    sourceUrls: metadata.sourceUrls,
    license: metadata.license,
    fingerprint,
    sourceFingerprint: metadata.sourceFingerprint,
    generatorVersion: GENERATOR_VERSION,
    records: sorted,
    trainRecords,
    validationRecords,
    testRecords,
    split: {
      method: 'chronological',
      trainRange: range(trainRecords),
      validationRange: range(validationRecords),
      testRange: range(testRecords),
    },
    lineage: metadata.lineage,
    quality: {
      recordCount: sorted.length,
      publicAnchorFieldCount: publicFields,
      engineeringDerivedFieldCount: modes['engineering-derived'] ?? 0,
      operatorMeasuredFieldCount: operatorFields,
      publicAnchorCoveragePercent: round(publicFields / Math.max(1, metadata.lineage.length) * 100, 2),
      operatorMeasurementCoveragePercent: round(operatorFields / Math.max(1, metadata.lineage.length) * 100, 2),
      dataQualityScoreMean: round(sorted.reduce((sum, record) => sum + record.dataQualityScore, 0) / sorted.length, 4),
      leakageChecks: {
        chronologicalSplit: true,
        capacityCalibratedOnTrainOnly: metadata.evidenceLevel === 'public-aggregate-with-engineering-augmentation',
        validationExcludedFromTraining: true,
        testSealedUntilChampionSelection: true,
      },
    },
    limitations: metadata.limitations,
  };
};

const validateExternalRecords = (records: PortBusinessRecord[]) => {
  if (records.length < 120) throw new Error('port-business-dataset.v3 至少需要 120 条记录');
  const numericFields = Object.keys(records[0]).filter((field) =>
    typeof records[0][field as keyof PortBusinessRecord] === 'number') as Array<keyof PortBusinessRecord>;
  const timestamps = new Set<string>();
  for (const [index, record] of records.entries()) {
    for (const field of REQUIRED_FIELDS) {
      if (record[field] === undefined || record[field] === null || record[field] === '') {
        throw new Error(`port-business-dataset.v3 第 ${index + 1} 条缺少 ${field}`);
      }
    }
    if (!record.portId || !record.terminalId || Number.isNaN(Date.parse(record.timestamp)) ||
      !/(?:Z|[+-]\d{2}:\d{2})$/i.test(record.timestamp)) {
      throw new Error(`port-business-dataset.v3 第 ${index + 1} 条标识或带时区时间戳无效`);
    }
    if (timestamps.has(record.timestamp)) throw new Error(`port-business-dataset.v3 存在重复时间戳 ${record.timestamp}`);
    timestamps.add(record.timestamp);
    for (const field of numericFields) {
      if (!Number.isFinite(record[field] as number)) {
        throw new Error(`port-business-dataset.v3 第 ${index + 1} 条 ${field} 不是有限数值`);
      }
    }
    if (record.arrivals < 0 || record.effectiveCapacity <= 0 || record.dataQualityScore < 0 || record.dataQualityScore > 1) {
      throw new Error(`port-business-dataset.v3 第 ${index + 1} 条超出基础数值范围`);
    }
  }
};

export const loadPortBusinessDataset = async (
  datasetPath = process.env.PORT_BUSINESS_DATASET_PATH,
): Promise<PortBusinessDataset> => {
  if (!datasetPath) {
    const { aggregate, records } = await buildDefaultRecords();
    return assembleDataset(records, {
      id: 'mpa-public-anchor-port-business-v3',
      label: 'MPA 到港与总吨位公开数据锚定的港口业务闭环数据集',
      evidenceLevel: 'public-aggregate-with-engineering-augmentation',
      source: 'Maritime and Port Authority of Singapore / data.gov.sg + Open-Meteo ERA5; missing terminal fields are engineering-derived',
      sourceUrls: [
        'https://data.gov.sg/collections/394/view',
        'https://open-meteo.com/en/docs/historical-weather-api',
      ],
      license: 'Singapore Open Data Licence; engineering augmentation is project-generated',
      sourceFingerprint: aggregate.fingerprint,
      lineage: DEFAULT_LINEAGE,
      limitations: [
        'Public anchors are monthly Singapore aggregates, not Malacca terminal measurements.',
        'Within-month allocation and all berth, crane, yard, gate, navigation, energy and network fields are engineering-derived scenario variables.',
        'Offline business-value gates apply only to the public-anchored simulator and do not prove field savings.',
        'Production use requires replacement with synchronized terminal-operations.v2 measurements, calibration, shadow replay and site acceptance.',
      ],
    });
  }

  const resolved = path.resolve(datasetPath);
  const content = await readFile(resolved, 'utf8');
  const parsed = JSON.parse(content) as {
    records?: PortBusinessRecord[];
    metadata?: {
      id?: string;
      label?: string;
      source?: string;
      sourceUrls?: string[];
      license?: string;
      evidenceLevel?: PortBusinessEvidenceLevel;
      lineage?: PortBusinessFieldLineage[];
      limitations?: string[];
    };
  } | PortBusinessRecord[];
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error('port-business-dataset.v3 JSON 必须是记录数组或包含 records');
  validateExternalRecords(records);
  const metadata = Array.isArray(parsed) ? undefined : parsed.metadata;
  // A self-declared field inside a data file is not authority evidence. The
  // loader accepts the replacement for research training but keeps operational
  // claims closed; promotion must come from the signed operator gateway and
  // site-acceptance gate, not from mutable dataset metadata.
  const evidenceLevel: PortBusinessEvidenceLevel = 'operator-supplied-unverified';
  const lineage = metadata?.lineage?.length
    ? metadata.lineage
    : Object.keys(records[0]).map((field) => ({
        field: field as keyof PortBusinessRecord,
        mode: 'operator-measured' as const,
        replaceWith: 'operator source field',
      }));
  return assembleDataset(records, {
    id: metadata?.id ?? path.basename(resolved),
    label: metadata?.label ?? path.basename(resolved),
    evidenceLevel,
    source: metadata?.source ?? 'operator-supplied-file',
    sourceUrls: metadata?.sourceUrls ?? [],
    license: metadata?.license ?? 'operator-controlled; redistribution not authorized by this loader',
    sourceFingerprint: createHash('sha256').update(content).digest('hex'),
    lineage,
    limitations: [
      ...(metadata?.limitations ?? []),
      'Operator evidence and calibration status were not independently verified; any self-declared operator-authorized value was downgraded.',
    ],
  });
};

export const PORT_BUSINESS_DATASET_REQUIRED_FIELDS = Object.freeze([...REQUIRED_FIELDS]);
