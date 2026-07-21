export const PORT_CALL_SERVICE_TYPES = [
  'BERTH',
  'PILOTAGE',
  'TOWAGE',
  'MOORING',
  'BUNKERING',
  'CARGO_OPERATIONS',
  'ANCHORAGE',
] as const;

export const PORT_CALL_EVENT_TYPES = ['ARRIVAL', 'DEPARTURE', 'START', 'END'] as const;
export const PORT_CALL_EVENT_CLASSIFIERS = ['EST', 'REQ', 'PLN', 'ACT'] as const;
export const PORT_CALL_FACILITY_TYPES = ['BERTH', 'ANCHORAGE', 'PILOT_BOARDING_PLACE', 'TERMINAL'] as const;

export interface PortCallEventContract {
  protocolVersion: 'port-call-event.v1';
  portCallID: string;
  vesselVisitReference: string;
  UNLocationCode: string;
  vessel: {
    IMO?: string;
    MMSI?: string;
    name?: string;
  };
  portCallServiceTypeCode: typeof PORT_CALL_SERVICE_TYPES[number];
  eventTypeCode: typeof PORT_CALL_EVENT_TYPES[number];
  eventClassifierCode: typeof PORT_CALL_EVENT_CLASSIFIERS[number];
  eventDateTime: string;
  facility: {
    facilityTypeCode: typeof PORT_CALL_FACILITY_TYPES[number];
    facilityCode: string;
    facilityName?: string;
  };
  source: {
    system: string;
    recordID: string;
    observedAt: string;
  };
  quality: {
    status: 'VERIFIED' | 'ESTIMATED' | 'UNVERIFIED';
    confidence: number;
  };
}

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const rejectUnknownKeys = (value: Record<string, unknown>, allowed: string[], path: string, errors: string[]) => {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}${key} 是未定义字段`);
};

const requiredString = (value: unknown, path: string, errors: string[]) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) errors.push(`${path} 必须是非空字符串`);
  return normalized;
};

const enumValue = <T extends readonly string[]>(value: unknown, values: T, path: string, errors: string[]) => {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!values.includes(normalized)) errors.push(`${path} 必须是 ${values.join('/')}`);
  return normalized as T[number];
};

const isoDateTime = (value: unknown, path: string, errors: string[]) => {
  const normalized = requiredString(value, path, errors);
  if (normalized && (!/^\d{4}-\d{2}-\d{2}T/.test(normalized) || !Number.isFinite(Date.parse(normalized)))) {
    errors.push(`${path} 必须是带时区的 ISO 8601 日期时间`);
  }
  if (normalized && !/(Z|[+-]\d{2}:\d{2})$/.test(normalized)) errors.push(`${path} 必须包含时区`);
  return normalized;
};

export const validatePortCallEvent = (input: unknown) => {
  const errors: string[] = [];
  if (!record(input)) return { valid: false as const, errors: ['请求体必须是 JSON 对象'] };
  const vessel = record(input.vessel) ? input.vessel : {};
  const facility = record(input.facility) ? input.facility : {};
  const source = record(input.source) ? input.source : {};
  const quality = record(input.quality) ? input.quality : {};
  rejectUnknownKeys(input, [
    'protocolVersion', 'portCallID', 'vesselVisitReference', 'UNLocationCode', 'vessel',
    'portCallServiceTypeCode', 'eventTypeCode', 'eventClassifierCode', 'eventDateTime',
    'facility', 'source', 'quality',
  ], '', errors);
  rejectUnknownKeys(vessel, ['IMO', 'MMSI', 'name'], 'vessel.', errors);
  rejectUnknownKeys(facility, ['facilityTypeCode', 'facilityCode', 'facilityName'], 'facility.', errors);
  rejectUnknownKeys(source, ['system', 'recordID', 'observedAt'], 'source.', errors);
  rejectUnknownKeys(quality, ['status', 'confidence'], 'quality.', errors);
  if (input.protocolVersion !== 'port-call-event.v1') errors.push('protocolVersion 必须是 port-call-event.v1');
  const imo = typeof vessel.IMO === 'string' ? vessel.IMO.trim() : '';
  const mmsi = typeof vessel.MMSI === 'string' ? vessel.MMSI.trim() : '';
  const vesselName = typeof vessel.name === 'string' ? vessel.name.trim() : '';
  if (!imo && !mmsi && !vesselName) errors.push('vessel 至少提供 IMO、MMSI 或 name 之一');
  if (imo && !/^\d{7}$/.test(imo)) errors.push('vessel.IMO 必须是 7 位数字');
  if (mmsi && !/^\d{9}$/.test(mmsi)) errors.push('vessel.MMSI 必须是 9 位数字');
  const unLocationCode = requiredString(input.UNLocationCode, 'UNLocationCode', errors).toUpperCase();
  if (unLocationCode && !/^[A-Z]{2}[A-Z0-9]{3}$/.test(unLocationCode)) {
    errors.push('UNLocationCode 必须符合 5 位 UN/LOCODE 形式，例如 SGSIN');
  }
  const confidence = quality.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.push('quality.confidence 必须是 0 到 1 的数值');
  }
  const qualityStatus = enumValue(quality.status, ['VERIFIED', 'ESTIMATED', 'UNVERIFIED'] as const, 'quality.status', errors);
  const normalized: PortCallEventContract = {
    protocolVersion: 'port-call-event.v1',
    portCallID: requiredString(input.portCallID, 'portCallID', errors),
    vesselVisitReference: requiredString(input.vesselVisitReference, 'vesselVisitReference', errors),
    UNLocationCode: unLocationCode,
    vessel: {
      ...(imo ? { IMO: imo } : {}),
      ...(mmsi ? { MMSI: mmsi } : {}),
      ...(vesselName ? { name: vesselName } : {}),
    },
    portCallServiceTypeCode: enumValue(input.portCallServiceTypeCode, PORT_CALL_SERVICE_TYPES, 'portCallServiceTypeCode', errors),
    eventTypeCode: enumValue(input.eventTypeCode, PORT_CALL_EVENT_TYPES, 'eventTypeCode', errors),
    eventClassifierCode: enumValue(input.eventClassifierCode, PORT_CALL_EVENT_CLASSIFIERS, 'eventClassifierCode', errors),
    eventDateTime: isoDateTime(input.eventDateTime, 'eventDateTime', errors),
    facility: {
      facilityTypeCode: enumValue(facility.facilityTypeCode, PORT_CALL_FACILITY_TYPES, 'facility.facilityTypeCode', errors),
      facilityCode: requiredString(facility.facilityCode, 'facility.facilityCode', errors),
      ...(typeof facility.facilityName === 'string' && facility.facilityName.trim()
        ? { facilityName: facility.facilityName.trim() }
        : {}),
    },
    source: {
      system: requiredString(source.system, 'source.system', errors),
      recordID: requiredString(source.recordID, 'source.recordID', errors),
      observedAt: isoDateTime(source.observedAt, 'source.observedAt', errors),
    },
    quality: { status: qualityStatus, confidence: typeof confidence === 'number' ? confidence : Number.NaN },
  };
  return errors.length
    ? { valid: false as const, errors }
    : { valid: true as const, event: normalized, errors: [] as string[] };
};
