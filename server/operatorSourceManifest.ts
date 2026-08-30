import { readFileSync } from 'node:fs';
import path from 'node:path';

export const OPERATOR_SOURCE_MANIFEST_VERSION = 'operator-data-source-manifest.v1' as const;

export const OPERATOR_ADAPTER_IDS = [
  'ais_vessel_feed',
  'terminal_operating_system',
  'vessel_traffic_service',
  'safety_regulatory_feed',
  'energy_carbon_feed',
  'intermodal_transfer_feed',
] as const;

export type OperatorAdapterId = typeof OPERATOR_ADAPTER_IDS[number];

export interface OperatorSourceAdapterManifest {
  adapterId: OperatorAdapterId;
  sourceSystem: string;
  dataOwnerRole: string;
  signingKeyId: string;
  fieldMappingReviewed: boolean;
  unitsReviewed: boolean;
  timezoneReviewed: boolean;
  dataOwnerApproved: boolean;
}

export interface OperatorSourceManifest {
  protocolVersion: typeof OPERATOR_SOURCE_MANIFEST_VERSION;
  manifestId: string;
  siteId: string;
  portId: string;
  terminalId: string;
  sceneProfileId: string;
  scenePortNodeId: string;
  operatorOrganization: string;
  evidenceLevel: 'operator-authorized' | 'site-template';
  timezone: string;
  authorization: {
    reference: string;
    approvedBy: string;
    approvedAt: string;
    expiresAt: string;
    permittedPurpose: 'read-only-shadow';
    redistributionAllowed: false;
  };
  adapters: OperatorSourceAdapterManifest[];
  notes: string[];
}

export interface OperatorSourceManifestReadiness {
  configured: boolean;
  manifestPath: string | null;
  manifest: OperatorSourceManifest | null;
  authorizationReady: boolean;
  missingAdapters: OperatorAdapterId[];
  blockers: string[];
}

const PLACEHOLDER_PATTERN = /(?:replace|placeholder|example|pending|todo|tbd|待填写|待确认|示例)/i;
const STABLE_ID_PATTERN = /^[A-Za-z0-9._:-]{2,128}$/;

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} 必须是非空字符串`);
  return value.trim();
};

const stableId = (value: unknown, field: string) => {
  const normalized = nonEmptyString(value, field);
  if (!STABLE_ID_PATTERN.test(normalized)) throw new Error(`${field} 只能使用稳定 ID 字符`);
  return normalized;
};

const timezoneDate = (value: unknown, field: string) => {
  const normalized = nonEmptyString(value, field);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} 必须是带时区的 ISO 8601 时间`);
  }
  return normalized;
};

export const parseOperatorSourceManifest = (value: unknown): OperatorSourceManifest => {
  if (!record(value)) throw new Error('现场数据源清单必须是 JSON 对象');
  const allowed = new Set([
    'protocolVersion', 'manifestId', 'siteId', 'portId', 'terminalId', 'sceneProfileId',
    'scenePortNodeId', 'operatorOrganization', 'evidenceLevel', 'timezone', 'authorization',
    'adapters', 'notes',
  ]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`清单包含未定义字段 ${key}`);
  if (value.protocolVersion !== OPERATOR_SOURCE_MANIFEST_VERSION) {
    throw new Error(`protocolVersion 必须是 ${OPERATOR_SOURCE_MANIFEST_VERSION}`);
  }
  if (!record(value.authorization)) throw new Error('authorization 必须是对象');
  if (!Array.isArray(value.adapters)) throw new Error('adapters 必须是数组');
  const authorization = value.authorization;
  const authorizationAllowed = new Set([
    'reference', 'approvedBy', 'approvedAt', 'expiresAt', 'permittedPurpose', 'redistributionAllowed',
  ]);
  for (const key of Object.keys(authorization)) {
    if (!authorizationAllowed.has(key)) throw new Error(`authorization 包含未定义字段 ${key}`);
  }
  if (authorization.permittedPurpose !== 'read-only-shadow') {
    throw new Error('authorization.permittedPurpose 必须是 read-only-shadow');
  }
  if (authorization.redistributionAllowed !== false) {
    throw new Error('authorization.redistributionAllowed 必须明确为 false');
  }
  const adapters = value.adapters.map((candidate, index): OperatorSourceAdapterManifest => {
    if (!record(candidate)) throw new Error(`adapters[${index}] 必须是对象`);
    const adapterId = nonEmptyString(candidate.adapterId, `adapters[${index}].adapterId`) as OperatorAdapterId;
    if (!OPERATOR_ADAPTER_IDS.includes(adapterId)) throw new Error(`未知 adapterId ${adapterId}`);
    for (const field of ['fieldMappingReviewed', 'unitsReviewed', 'timezoneReviewed', 'dataOwnerApproved'] as const) {
      if (typeof candidate[field] !== 'boolean') throw new Error(`adapters[${index}].${field} 必须是布尔值`);
    }
    return {
      adapterId,
      sourceSystem: nonEmptyString(candidate.sourceSystem, `adapters[${index}].sourceSystem`),
      dataOwnerRole: nonEmptyString(candidate.dataOwnerRole, `adapters[${index}].dataOwnerRole`),
      signingKeyId: nonEmptyString(candidate.signingKeyId, `adapters[${index}].signingKeyId`),
      fieldMappingReviewed: candidate.fieldMappingReviewed as boolean,
      unitsReviewed: candidate.unitsReviewed as boolean,
      timezoneReviewed: candidate.timezoneReviewed as boolean,
      dataOwnerApproved: candidate.dataOwnerApproved as boolean,
    };
  });
  if (new Set(adapters.map((adapter) => adapter.adapterId)).size !== adapters.length) {
    throw new Error('adapters 不得包含重复 adapterId');
  }
  const evidenceLevel = value.evidenceLevel;
  if (evidenceLevel !== 'operator-authorized' && evidenceLevel !== 'site-template') {
    throw new Error('evidenceLevel 必须是 operator-authorized 或 site-template');
  }
  const timezone = nonEmptyString(value.timezone, 'timezone');
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error('timezone 必须是有效的 IANA 时区');
  }
  return {
    protocolVersion: OPERATOR_SOURCE_MANIFEST_VERSION,
    manifestId: stableId(value.manifestId, 'manifestId'),
    siteId: stableId(value.siteId, 'siteId'),
    portId: stableId(value.portId, 'portId'),
    terminalId: stableId(value.terminalId, 'terminalId'),
    sceneProfileId: stableId(value.sceneProfileId, 'sceneProfileId'),
    scenePortNodeId: stableId(value.scenePortNodeId, 'scenePortNodeId'),
    operatorOrganization: nonEmptyString(value.operatorOrganization, 'operatorOrganization'),
    evidenceLevel,
    timezone,
    authorization: {
      reference: nonEmptyString(authorization.reference, 'authorization.reference'),
      approvedBy: nonEmptyString(authorization.approvedBy, 'authorization.approvedBy'),
      approvedAt: timezoneDate(authorization.approvedAt, 'authorization.approvedAt'),
      expiresAt: timezoneDate(authorization.expiresAt, 'authorization.expiresAt'),
      permittedPurpose: 'read-only-shadow',
      redistributionAllowed: false,
    },
    adapters,
    notes: Array.isArray(value.notes) ? value.notes.map(String).filter(Boolean) : [],
  };
};

export const assessOperatorSourceManifest = (
  manifest: OperatorSourceManifest,
  now = new Date(),
): OperatorSourceManifestReadiness => {
  const blockers: string[] = [];
  if (manifest.evidenceLevel !== 'operator-authorized') blockers.push('operator_authorization_not_declared');
  const placeholderFields = [
    manifest.manifestId,
    manifest.siteId,
    manifest.portId,
    manifest.terminalId,
    manifest.sceneProfileId,
    manifest.scenePortNodeId,
    manifest.operatorOrganization,
    manifest.authorization.reference,
    manifest.authorization.approvedBy,
  ];
  if (placeholderFields.some((field) => PLACEHOLDER_PATTERN.test(field))) blockers.push('site_placeholders_present');
  const approvedAt = Date.parse(manifest.authorization.approvedAt);
  const expiresAt = Date.parse(manifest.authorization.expiresAt);
  if (approvedAt > now.getTime()) blockers.push('authorization_approval_in_future');
  if (expiresAt <= now.getTime()) blockers.push('authorization_expired');
  if (expiresAt <= approvedAt) blockers.push('authorization_period_invalid');
  const adaptersById = new Map(manifest.adapters.map((adapter) => [adapter.adapterId, adapter]));
  const missingAdapters = OPERATOR_ADAPTER_IDS.filter((adapterId) => !adaptersById.has(adapterId));
  if (missingAdapters.length) blockers.push(`missing_adapters:${missingAdapters.join(',')}`);
  for (const adapter of manifest.adapters) {
    if ([adapter.sourceSystem, adapter.dataOwnerRole, adapter.signingKeyId]
      .some((field) => PLACEHOLDER_PATTERN.test(field))) {
      blockers.push(`adapter_placeholder:${adapter.adapterId}`);
    }
    if (!adapter.fieldMappingReviewed) blockers.push(`field_mapping_not_reviewed:${adapter.adapterId}`);
    if (!adapter.unitsReviewed) blockers.push(`units_not_reviewed:${adapter.adapterId}`);
    if (!adapter.timezoneReviewed) blockers.push(`timezone_not_reviewed:${adapter.adapterId}`);
    if (!adapter.dataOwnerApproved) blockers.push(`data_owner_not_approved:${adapter.adapterId}`);
  }
  return {
    configured: true,
    manifestPath: null,
    manifest,
    authorizationReady: blockers.length === 0,
    missingAdapters,
    blockers: [...new Set(blockers)],
  };
};

export const loadOperatorSourceManifest = (
  manifestPath = process.env.PORT_OPERATOR_SOURCE_MANIFEST_PATH,
  now = new Date(),
): OperatorSourceManifestReadiness => {
  if (!manifestPath) {
    return {
      configured: false,
      manifestPath: null,
      manifest: null,
      authorizationReady: false,
      missingAdapters: [...OPERATOR_ADAPTER_IDS],
      blockers: ['operator_source_manifest_not_configured'],
    };
  }
  const resolvedPath = path.resolve(manifestPath);
  try {
    const manifest = parseOperatorSourceManifest(JSON.parse(readFileSync(resolvedPath, 'utf8')));
    return { ...assessOperatorSourceManifest(manifest, now), manifestPath: resolvedPath };
  } catch (error) {
    return {
      configured: true,
      manifestPath: resolvedPath,
      manifest: null,
      authorizationReady: false,
      missingAdapters: [...OPERATOR_ADAPTER_IDS],
      blockers: [`operator_source_manifest_invalid:${error instanceof Error ? error.message : String(error)}`],
    };
  }
};
