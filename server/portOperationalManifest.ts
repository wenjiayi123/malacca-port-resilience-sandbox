import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assessPortOperationalReadiness,
  PORT_OPERATIONAL_CONTRACT_VERSION,
  type PortOperationalField,
  type PortOperationalReadiness,
} from '../shared/portOperationalContract.ts';

export type PortOperationalEvidenceLevel =
  | 'operator-authorized'
  | 'public-external-validation'
  | 'synthetic-contract-example';

export interface PortOperationalManifest {
  protocolVersion: typeof PORT_OPERATIONAL_CONTRACT_VERSION;
  datasetId: string;
  portId: string;
  sceneProfileId: string;
  source: string;
  sourceUrl: string;
  license: string;
  evidenceLevel: PortOperationalEvidenceLevel;
  timezone: string;
  samplingInterval: string;
  dataPath: string;
  availableFields: PortOperationalField[];
  fieldMappings: Partial<Record<PortOperationalField, string>>;
  notes: string[];
}

export interface PortOperationalManifestStatus {
  configured: boolean;
  manifestPath: string | null;
  manifest: PortOperationalManifest | null;
  readiness: PortOperationalReadiness;
}

const nonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`);
  return value.trim();
};

export const parsePortOperationalManifest = (value: unknown): PortOperationalManifest => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('港口运行清单必须是 JSON 对象');
  }
  const input = value as Record<string, unknown>;
  if (input.protocolVersion !== PORT_OPERATIONAL_CONTRACT_VERSION) {
    throw new Error(`protocolVersion 必须是 ${PORT_OPERATIONAL_CONTRACT_VERSION}`);
  }
  if (!Array.isArray(input.availableFields)) throw new Error('availableFields 必须是数组');
  if (!input.fieldMappings || typeof input.fieldMappings !== 'object' || Array.isArray(input.fieldMappings)) {
    throw new Error('fieldMappings 必须是对象');
  }
  const evidenceLevel = input.evidenceLevel;
  if (!['operator-authorized', 'public-external-validation', 'synthetic-contract-example'].includes(String(evidenceLevel))) {
    throw new Error('evidenceLevel 无效');
  }
  const readiness = assessPortOperationalReadiness(input.availableFields.map(String));
  const mappings = input.fieldMappings as Record<string, unknown>;
  for (const field of readiness.availableFields) {
    if (typeof mappings[field] !== 'string' || !String(mappings[field]).trim()) {
      throw new Error(`fieldMappings.${field} 缺失`);
    }
  }
  return {
    protocolVersion: PORT_OPERATIONAL_CONTRACT_VERSION,
    datasetId: nonEmptyString(input.datasetId, 'datasetId'),
    portId: nonEmptyString(input.portId, 'portId'),
    sceneProfileId: nonEmptyString(input.sceneProfileId, 'sceneProfileId'),
    source: nonEmptyString(input.source, 'source'),
    sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '',
    license: nonEmptyString(input.license, 'license'),
    evidenceLevel: evidenceLevel as PortOperationalEvidenceLevel,
    timezone: nonEmptyString(input.timezone, 'timezone'),
    samplingInterval: nonEmptyString(input.samplingInterval, 'samplingInterval'),
    dataPath: nonEmptyString(input.dataPath, 'dataPath'),
    availableFields: readiness.availableFields,
    fieldMappings: Object.fromEntries(readiness.availableFields.map((field) => [
      field,
      String(mappings[field]).trim(),
    ])),
    notes: Array.isArray(input.notes) ? input.notes.map(String).filter(Boolean) : [],
  };
};

export const loadPortOperationalManifest = async (
  manifestPath = process.env.PORT_OPERATIONAL_MANIFEST_PATH,
): Promise<PortOperationalManifestStatus> => {
  if (!manifestPath) {
    return {
      configured: false,
      manifestPath: null,
      manifest: null,
      readiness: assessPortOperationalReadiness([]),
    };
  }
  const resolvedPath = path.resolve(manifestPath);
  const manifest = parsePortOperationalManifest(JSON.parse(await readFile(resolvedPath, 'utf8')));
  return {
    configured: true,
    manifestPath: resolvedPath,
    manifest,
    readiness: assessPortOperationalReadiness(manifest.availableFields),
  };
};
