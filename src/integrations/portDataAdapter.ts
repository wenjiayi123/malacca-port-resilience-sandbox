import type { MalaccaScenario, PortNode, VesselMarker } from '../types/sandbox';

export type PortDataMode = 'demo' | 'public' | 'live';
export type PortDataConnectionStatus = 'demo' | 'connecting' | 'public' | 'live' | 'fallback';

export interface PublicEvidenceSummary {
  mode: 'public-evidence';
  mpa: {
    agency: string;
    dataset: string;
    collectionId: string;
    datasetIds: string[];
    period: string;
    monthlyVessels: number;
    grossTonnage: number;
    retrievedAt: string;
    url: string;
  };
  weather: {
    provider: string;
    modelType: string;
    observedAt: string;
    coordinate: { lat: number; lon: number };
    url: string;
    navigationDisclaimer: string;
  };
  ais: {
    mode: 'public-research-baseline' | 'authorized-live-adapter-configured';
    source: string;
    period: string;
    facts: Record<string, number>;
    doi: string;
    liveEndpointConfigured: boolean;
    recordsMapped?: number;
    notice: string;
  };
  carbon: {
    source: string;
    method: string;
    factorsKgCo2PerKgFuel: Record<string, number>;
    url: string;
  };
}

export interface PortDataConfig {
  mode: PortDataMode;
  endpoint: string;
  apiKey: string;
  pollingSeconds: number;
}

export interface PortTelemetrySnapshot {
  protocolVersion: 'port-digital-twin.snapshot.v1';
  observedAt: string;
  source: string;
  scenario?: Partial<MalaccaScenario>;
  telemetry?: {
    ports?: Array<Partial<PortNode> & Pick<PortNode, 'id'>>;
    vessels?: Array<Partial<VesselMarker> & Pick<VesselMarker, 'id'>>;
    weather?: Partial<MalaccaScenario['weather']>;
    overview?: Partial<MalaccaScenario['overview']>;
    metrics?: MalaccaScenario['metrics'];
    riskAlerts?: MalaccaScenario['riskAlerts'];
    eventLog?: MalaccaScenario['eventLog'];
  };
  evidence?: PublicEvidenceSummary;
}

export interface PortDataLoadResult {
  scenario: MalaccaScenario;
  observedAt: string;
  source: string;
  evidence?: PublicEvidenceSummary;
}

export const defaultPortDataConfig: PortDataConfig = {
  mode: 'public',
  endpoint: '/api/public-data/snapshot',
  apiKey: '',
  pollingSeconds: 30,
};

const mergeById = <T extends { id: string }>(baseline: T[], patches?: Array<Partial<T> & Pick<T, 'id'>>) => {
  if (!patches?.length) return baseline;
  const patchById = new Map(patches.map((item) => [item.id, item]));
  const merged = baseline.map((item) => ({ ...item, ...patchById.get(item.id) }));
  const knownIds = new Set(baseline.map((item) => item.id));
  return [...merged, ...patches.filter((item): item is T => !knownIds.has(item.id) && Boolean(item.id))];
};

export const mergePortTelemetry = (
  demoScenario: MalaccaScenario,
  snapshot: PortTelemetrySnapshot,
): MalaccaScenario => {
  const scenarioPatch = snapshot.scenario ?? {};
  const telemetry = snapshot.telemetry ?? {};
  const scenarioPorts = scenarioPatch.ports as
    | Array<Partial<PortNode> & Pick<PortNode, 'id'>>
    | undefined;
  const scenarioVessels = scenarioPatch.vesselMarkers as Array<
    Partial<VesselMarker> & Pick<VesselMarker, 'id'>
  > | undefined;

  return {
    ...demoScenario,
    ...scenarioPatch,
    currentTime: snapshot.observedAt || scenarioPatch.currentTime || demoScenario.currentTime,
    overview: { ...demoScenario.overview, ...scenarioPatch.overview, ...telemetry.overview },
    weather: { ...demoScenario.weather, ...scenarioPatch.weather, ...telemetry.weather },
    ports: mergeById(demoScenario.ports, telemetry.ports ?? scenarioPorts),
    vesselMarkers: mergeById(demoScenario.vesselMarkers, telemetry.vessels ?? scenarioVessels),
    channels: scenarioPatch.channels ?? demoScenario.channels,
    routeOverlays: scenarioPatch.routeOverlays ?? demoScenario.routeOverlays,
    metrics: telemetry.metrics ?? scenarioPatch.metrics ?? demoScenario.metrics,
    riskAlerts: telemetry.riskAlerts ?? scenarioPatch.riskAlerts ?? demoScenario.riskAlerts,
    eventLog: telemetry.eventLog ?? scenarioPatch.eventLog ?? demoScenario.eventLog,
    vesselTypeStats: scenarioPatch.vesselTypeStats ?? demoScenario.vesselTypeStats,
    carbon: scenarioPatch.carbon ?? demoScenario.carbon,
    congestionHeatmap: scenarioPatch.congestionHeatmap ?? demoScenario.congestionHeatmap,
    strategies: scenarioPatch.strategies ?? demoScenario.strategies,
  };
};

const assertSnapshot = (value: unknown): PortTelemetrySnapshot => {
  if (!value || typeof value !== 'object') throw new Error('接口返回不是 JSON 对象');
  const snapshot = value as Partial<PortTelemetrySnapshot>;
  if (snapshot.protocolVersion !== 'port-digital-twin.snapshot.v1') {
    throw new Error('protocolVersion 必须为 port-digital-twin.snapshot.v1');
  }
  if (!snapshot.observedAt || Number.isNaN(Date.parse(snapshot.observedAt))) {
    throw new Error('observedAt 缺失或格式无效');
  }
  return snapshot as PortTelemetrySnapshot;
};

export const loadPortTelemetry = async (
  config: PortDataConfig,
  demoScenario: MalaccaScenario,
  signal?: AbortSignal,
): Promise<PortDataLoadResult> => {
  const response = await fetch(config.endpoint, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    signal,
  });
  if (!response.ok) throw new Error(`港口数据接口返回 HTTP ${response.status}`);
  const snapshot = assertSnapshot(await response.json());
  return {
    scenario: mergePortTelemetry(demoScenario, snapshot),
    observedAt: snapshot.observedAt,
    source:
      snapshot.source ||
      (config.endpoint.startsWith('http') ? new URL(config.endpoint).host : config.endpoint),
    evidence: snapshot.evidence,
  };
};
