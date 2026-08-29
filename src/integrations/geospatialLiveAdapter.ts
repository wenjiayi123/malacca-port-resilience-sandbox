export type RealtimeAisConnectionState =
  | 'not-configured'
  | 'connecting'
  | 'connected'
  | 'degraded'
  | 'stopped';

export interface LiveAisVessel {
  id: string;
  mmsi: string;
  name: string;
  latitude: number;
  longitude: number;
  speedKnots: number;
  courseDeg: number;
  headingDeg: number;
  navigationStatus: number | null;
  positionAccuracy: boolean | null;
  raim: boolean | null;
  observedAt: string;
  receivedAt: string;
  timestampQuality: 'provider' | 'receive-time-fallback';
  messageType: string;
  source: 'aisstream-authorized-live';
}

export interface GeospatialLiveSnapshot {
  protocolVersion: 'geospatial-live-map.v1';
  observedAt: string;
  region: {
    id: 'malacca-strait';
    center: { latitude: number; longitude: number };
    bounds: { south: number; west: number; north: number; east: number };
  };
  satellite: {
    configured: boolean;
    provider: 'MapTiler Satellite' | 'not-configured';
    tileUrlTemplate: string | null;
    attribution: string | null;
    styleId: 'satellite-v4' | null;
    disclosure: string;
  };
  ais: {
    protocolVersion: 'authorized-live-ais.v1';
    provider: 'AISStream';
    configured: boolean;
    connectionState: RealtimeAisConnectionState;
    connectedAt: string | null;
    latestPositionAt: string | null;
    staleAfterSeconds: number;
    freshVesselCount: number;
    cachedVesselCount: number;
    liveDataVerified: boolean;
    lastError: string | null;
    vessels: LiveAisVessel[];
    disclosure: string;
  };
  authority: {
    satellite_imagery_configured: boolean;
    live_data_verified: boolean;
    satellite_realtime_ready: boolean;
    navigation_authority: false;
    dispatch_allowed: false;
    production_authority: false;
  };
  claimBoundary: string[];
}

const assertSnapshot = (value: unknown): GeospatialLiveSnapshot => {
  if (!value || typeof value !== 'object') throw new Error('卫星实时接口没有返回 JSON 对象');
  const snapshot = value as Partial<GeospatialLiveSnapshot>;
  if (snapshot.protocolVersion !== 'geospatial-live-map.v1') {
    throw new Error('卫星实时接口协议版本不兼容');
  }
  if (!snapshot.satellite || !snapshot.ais || !snapshot.authority || !snapshot.region) {
    throw new Error('卫星实时接口缺少配置、AIS、权限或区域字段');
  }
  return snapshot as GeospatialLiveSnapshot;
};

export const loadGeospatialLiveSnapshot = async (signal?: AbortSignal) => {
  const response = await fetch('/api/geospatial/live', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`卫星实时接口返回 HTTP ${response.status}`);
  return assertSnapshot(await response.json());
};
