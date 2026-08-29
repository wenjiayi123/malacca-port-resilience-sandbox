const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';

export const MALACCA_AIS_BOUNDING_BOX = [
  [[0.35, 99.0], [6.25, 105.0]],
] as const;

export const LIVE_AIS_STALE_AFTER_MS = 5 * 60_000;

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

interface AisStreamEnvelope {
  MessageType?: unknown;
  MetaData?: Record<string, unknown>;
  Metadata?: Record<string, unknown>;
  Message?: Record<string, Record<string, unknown>>;
  error?: unknown;
}

interface RealtimeAisGatewayOptions {
  apiKey?: string;
  websocketUrl?: string;
  staleAfterMs?: number;
  autoStart?: boolean;
  now?: () => number;
  websocketFactory?: (url: string) => WebSocket;
}

const finite = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const bounded = (value: number | null, minimum: number, maximum: number, fallback: number) =>
  value === null ? fallback : Math.min(maximum, Math.max(minimum, value));

const normalizedTimestamp = (value: unknown, fallbackEpochMs: number) => {
  if (typeof value !== 'string' || !value.trim()) {
    return { value: new Date(fallbackEpochMs).toISOString(), quality: 'receive-time-fallback' as const };
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? { value: new Date(parsed).toISOString(), quality: 'provider' as const }
    : { value: new Date(fallbackEpochMs).toISOString(), quality: 'receive-time-fallback' as const };
};

const isInsideMalaccaBox = (latitude: number, longitude: number) =>
  latitude >= 0.35 && latitude <= 6.25 && longitude >= 99 && longitude <= 105;

export const parseAisStreamMessage = (
  payload: string | AisStreamEnvelope,
  receivedAtEpochMs = Date.now(),
): LiveAisVessel | null => {
  let envelope: AisStreamEnvelope;
  try {
    envelope = typeof payload === 'string' ? JSON.parse(payload) as AisStreamEnvelope : payload;
  } catch {
    return null;
  }
  if (envelope.error) return null;
  const messageType = typeof envelope.MessageType === 'string' ? envelope.MessageType : '';
  if (!['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport'].includes(messageType)) {
    return null;
  }
  const metadata = envelope.MetaData ?? envelope.Metadata ?? {};
  const body = envelope.Message?.[messageType] ?? {};
  const latitude = finite(body.Latitude ?? metadata.latitude ?? metadata.Latitude);
  const longitude = finite(body.Longitude ?? metadata.longitude ?? metadata.Longitude);
  if (latitude === null || longitude === null || !isInsideMalaccaBox(latitude, longitude)) return null;
  const mmsiValue = body.UserID ?? metadata.MMSI;
  if (mmsiValue === undefined || mmsiValue === null || !String(mmsiValue).trim()) return null;
  const mmsi = String(mmsiValue).trim();
  const courseDeg = bounded(finite(body.Cog), 0, 359.9, 0);
  const heading = finite(body.TrueHeading);
  const timestamp = normalizedTimestamp(metadata.time_utc ?? metadata.TimeUtc, receivedAtEpochMs);
  const shipName = String(metadata.ShipName ?? metadata.shipName ?? '').replace(/@+$/g, '').trim();
  return {
    id: `ais-${mmsi}`,
    mmsi,
    name: shipName || `MMSI ${mmsi}`,
    latitude,
    longitude,
    speedKnots: bounded(finite(body.Sog), 0, 80, 0),
    courseDeg,
    headingDeg: heading !== null && heading >= 0 && heading < 360 ? heading : courseDeg,
    navigationStatus: finite(body.NavigationalStatus),
    positionAccuracy: typeof body.PositionAccuracy === 'boolean' ? body.PositionAccuracy : null,
    raim: typeof body.Raim === 'boolean' ? body.Raim : null,
    observedAt: timestamp.value,
    receivedAt: new Date(receivedAtEpochMs).toISOString(),
    timestampQuality: timestamp.quality,
    messageType,
    source: 'aisstream-authorized-live',
  };
};

export class RealtimeAisGateway {
  private readonly apiKey: string;
  private readonly websocketUrl: string;
  private readonly staleAfterMs: number;
  private readonly now: () => number;
  private readonly websocketFactory: (url: string) => WebSocket;
  private readonly vessels = new Map<string, LiveAisVessel>();
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private state: RealtimeAisConnectionState;
  private connectedAt: string | null = null;
  private latestPositionAt: string | null = null;
  private lastError: string | null = null;

  constructor(options: RealtimeAisGatewayOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? process.env.AISSTREAM_API_KEY?.trim() ?? '';
    this.websocketUrl = options.websocketUrl ?? process.env.AISSTREAM_WEBSOCKET_URL ?? AISSTREAM_URL;
    this.staleAfterMs = options.staleAfterMs ?? LIVE_AIS_STALE_AFTER_MS;
    this.now = options.now ?? Date.now;
    this.websocketFactory = options.websocketFactory ?? ((url) => new WebSocket(url));
    this.state = this.apiKey ? 'stopped' : 'not-configured';
    if (options.autoStart !== false) this.start();
  }

  start() {
    if (!this.apiKey || this.socket || this.state === 'connecting' || this.state === 'connected') return;
    this.connect();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, 'service-shutdown');
    this.socket = null;
    this.state = this.apiKey ? 'stopped' : 'not-configured';
  }

  ingestForTest(payload: string | AisStreamEnvelope, receivedAtEpochMs = this.now()) {
    const vessel = parseAisStreamMessage(payload, receivedAtEpochMs);
    if (!vessel) return null;
    this.vessels.set(vessel.mmsi, vessel);
    this.latestPositionAt = vessel.observedAt;
    return vessel;
  }

  snapshot() {
    const now = this.now();
    const freshVessels = [...this.vessels.values()]
      .filter((vessel) =>
        vessel.timestampQuality === 'provider'
        && Math.abs(now - Date.parse(vessel.observedAt)) <= this.staleAfterMs
        && now - Date.parse(vessel.receivedAt) <= this.staleAfterMs)
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, 500);
    const liveDataVerified = this.state === 'connected' && freshVessels.length > 0;
    return {
      protocolVersion: 'authorized-live-ais.v1' as const,
      observedAt: new Date(now).toISOString(),
      provider: 'AISStream',
      configured: Boolean(this.apiKey),
      connectionState: this.state,
      connectedAt: this.connectedAt,
      latestPositionAt: this.latestPositionAt,
      staleAfterSeconds: Math.round(this.staleAfterMs / 1_000),
      freshVesselCount: freshVessels.length,
      cachedVesselCount: this.vessels.size,
      liveDataVerified,
      lastError: this.lastError,
      boundingBoxes: MALACCA_AIS_BOUNDING_BOX,
      vessels: freshVessels,
      disclosure: liveDataVerified
        ? '船位来自后端持有密钥的授权 AISStream 实时流；仅用于态势展示，不授予导航或生产调度权限。'
        : '无新鲜授权 AIS 船位时严格失败关闭，不显示模拟船舶为实时目标。',
    };
  }

  private connect() {
    this.state = 'connecting';
    this.lastError = null;
    let socket: WebSocket;
    try {
      socket = this.websocketFactory(this.websocketUrl);
    } catch (error) {
      this.degrade(error instanceof Error ? error.message : 'WebSocket initialization failed');
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.state = 'connected';
      this.connectedAt = new Date(this.now()).toISOString();
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: MALACCA_AIS_BOUNDING_BOX,
        FilterMessageTypes: [
          'PositionReport',
          'StandardClassBPositionReport',
          'ExtendedClassBPositionReport',
        ],
      }));
    });
    socket.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      try {
        const envelope = JSON.parse(raw) as AisStreamEnvelope;
        if (envelope.error) {
          this.lastError = String(envelope.error);
          this.state = 'degraded';
          return;
        }
        this.ingestForTest(envelope);
      } catch {
        this.lastError = 'AISStream returned invalid JSON';
      }
    });
    socket.addEventListener('error', () => {
      this.lastError = 'AISStream WebSocket error';
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.state === 'stopped') return;
      this.degrade(`AISStream closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`);
    });
  }

  private degrade(message: string) {
    this.state = 'degraded';
    this.lastError = message;
    if (!this.apiKey || this.reconnectTimer) return;
    const delayMs = Math.min(60_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 6));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.socket) this.connect();
    }, delayMs);
    this.reconnectTimer.unref();
  }
}

export interface SatelliteMapConfiguration {
  configured: boolean;
  provider: 'MapTiler Satellite' | 'not-configured';
  tileUrlTemplate: string | null;
  attribution: string | null;
  styleId: 'satellite-v4' | null;
  disclosure: string;
}

export const getSatelliteMapConfiguration = (): SatelliteMapConfiguration => {
  const key = process.env.MAPTILER_API_KEY?.trim() ?? '';
  if (!key) {
    return {
      configured: false,
      provider: 'not-configured',
      tileUrlTemplate: null,
      attribution: null,
      styleId: null,
      disclosure: '未配置 MAPTILER_API_KEY；客户端使用带署名的 EOX Sentinel-2 cloudless 2025 真彩色合成影像与 DEM，不是实时拍摄；授权实时 AIS 仍保持失败关闭。',
    };
  }
  return {
    configured: true,
    provider: 'MapTiler Satellite',
    tileUrlTemplate: `https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}.jpg?key=${encodeURIComponent(key)}`,
    attribution: '© MapTiler © OpenStreetMap contributors',
    styleId: 'satellite-v4',
    disclosure: '卫星影像由 MapTiler Satellite 瓦片提供；影像拍摄时间不等于 AIS 船位时间。',
  };
};
