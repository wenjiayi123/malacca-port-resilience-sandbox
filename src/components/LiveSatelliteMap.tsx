import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, {
  type Map as MapLibreMap,
  type Marker as MapLibreMarker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle, CheckCircle2, Mountain, RefreshCw, Satellite, Ship, WifiOff } from 'lucide-react';
import type { FeatureCollection, LineString } from 'geojson';
import type { PortNode } from '../types/sandbox';
import {
  loadGeospatialLiveSnapshot,
  type GeospatialLiveSnapshot,
  type LiveAisVessel,
} from '../integrations/geospatialLiveAdapter';

interface LiveSatelliteMapProps {
  ports: PortNode[];
}

type TileState = 'checking' | 'loaded' | 'failed';

const PUBLIC_BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const PUBLIC_SATELLITE_TILE_URL =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
const MAPTERHORN_TERRAIN_URL = 'https://tiles.mapterhorn.com/tilejson.json';
const TERRAIN_EXAGGERATION = 1.5;
const PUBLIC_SATELLITE_ATTRIBUTION =
  '<a href="https://cloudless.eox.at/">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)';

const add3DSatelliteSurface = (map: MapLibreMap, snapshot: GeospatialLiveSnapshot) => {
  const configuredSatellite = snapshot.satellite.configured && snapshot.satellite.tileUrlTemplate;
  const styleLayers = map.getStyle().layers ?? [];
  const firstNonFillLayer = styleLayers.find(
    (layer) => layer.type !== 'fill' && layer.type !== 'background',
  );
  const firstSymbolLayer = styleLayers.find((layer) => layer.type === 'symbol');

  map.addSource('satellite-3d-surface', {
    type: 'raster',
    tiles: [configuredSatellite ? snapshot.satellite.tileUrlTemplate as string : PUBLIC_SATELLITE_TILE_URL],
    tileSize: 256,
    minzoom: 0,
    maxzoom: configuredSatellite ? 20 : 14,
    attribution: configuredSatellite
      ? snapshot.satellite.attribution ?? undefined
      : PUBLIC_SATELLITE_ATTRIBUTION,
  });
  map.addSource('terrain-3d-source', {
    type: 'raster-dem',
    url: MAPTERHORN_TERRAIN_URL,
  });
  map.addSource('terrain-hillshade-source', {
    type: 'raster-dem',
    url: MAPTERHORN_TERRAIN_URL,
  });
  map.addLayer({
    id: 'satellite-3d-imagery',
    type: 'raster',
    source: 'satellite-3d-surface',
    paint: {
      'raster-opacity': 1,
      'raster-saturation': 0.04,
      'raster-contrast': 0.12,
      'raster-brightness-min': 0,
      'raster-brightness-max': 1,
    },
  }, firstNonFillLayer?.id);
  map.addLayer({
    id: 'terrain-3d-hillshade',
    type: 'hillshade',
    source: 'terrain-hillshade-source',
    paint: {
      'hillshade-exaggeration': 0.42,
      'hillshade-shadow-color': '#17201c',
      'hillshade-highlight-color': '#f2f0dc',
      'hillshade-accent-color': '#53665d',
    },
  }, firstSymbolLayer?.id);
  map.setTerrain({ source: 'terrain-3d-source', exaggeration: TERRAIN_EXAGGERATION });
  map.setSky({
    'sky-color': '#69a9d3',
    'horizon-color': '#d9f0fa',
    'fog-color': '#d9f0fa',
    'sky-horizon-blend': 0.14,
    'horizon-fog-blend': 0,
    'fog-ground-blend': 0,
    'atmosphere-blend': 0,
  });
};

const buildReferenceRoutes = (ports: PortNode[]): FeatureCollection<LineString> => {
  const portById = new Map(ports.map((port) => [port.id, port]));
  const routeIds = [
    ['port-klang', 'tanjung-pelepas'],
    ['tanjung-pelepas', 'singapore'],
    ['singapore', 'dumai'],
  ];
  return {
    type: 'FeatureCollection',
    features: routeIds.flatMap(([originId, destinationId], index) => {
      const origin = portById.get(originId);
      const destination = portById.get(destinationId);
      if (!origin || !destination) return [];
      return [{
        type: 'Feature' as const,
        properties: { id: `reference-route-${index + 1}` },
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.geo.lon, origin.geo.lat],
            [destination.geo.lon, destination.geo.lat],
          ],
        },
      }];
    }),
  };
};

const formatTime = (value: string | null) => {
  if (!value) return '--';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
};

const formatPositionAge = (vessel: LiveAisVessel | undefined, observedAt: string | undefined) => {
  if (!vessel || !observedAt) return '--';
  const seconds = Math.max(0, Math.round((Date.parse(observedAt) - Date.parse(vessel.receivedAt)) / 1_000));
  return seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
};

const createTextLine = (label: string, value: string) => {
  const line = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}：`;
  line.append(strong, document.createTextNode(value));
  return line;
};

export function LiveSatelliteMap({ ports }: LiveSatelliteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vesselMarkersRef = useRef<MapLibreMarker[]>([]);
  const portMarkersRef = useRef<MapLibreMarker[]>([]);
  const [mapPorts] = useState(ports);
  const [snapshot, setSnapshot] = useState<GeospatialLiveSnapshot | null>(null);
  const [mapSetupSnapshot, setMapSetupSnapshot] = useState<GeospatialLiveSnapshot | null>(null);
  const [requestStatus, setRequestStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [tileState, setTileState] = useState<TileState>('checking');
  const [baseMapLoaded, setBaseMapLoaded] = useState(false);

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await loadGeospatialLiveSnapshot(signal);
      setSnapshot(next);
      setMapSetupSnapshot((current) => current ?? next);
      setRequestStatus('ready');
      setRequestError(null);
    } catch (error) {
      if (signal?.aborted) return;
      setRequestStatus('failed');
      setRequestError(error instanceof Error ? error.message : '卫星实时状态读取失败');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void loadSnapshot(controller.signal), 0);
    const timer = window.setInterval(() => void loadSnapshot(), 5_000);
    return () => {
      controller.abort();
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadSnapshot]);

  useEffect(() => {
    if (!mapSetupSnapshot || !containerRef.current || mapRef.current) return;
    setTileState('checking');
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: PUBLIC_BASEMAP_STYLE_URL,
      bounds: [
        [mapSetupSnapshot.region.bounds.west, mapSetupSnapshot.region.bounds.south],
        [mapSetupSnapshot.region.bounds.east, mapSetupSnapshot.region.bounds.north],
      ],
      fitBoundsOptions: {
        padding: { top: 116, right: 58, bottom: 72, left: 58 },
        maxZoom: 5.65,
      },
      minZoom: 2.5,
      maxZoom: 18,
      maxPitch: 85,
      pitch: 58,
      bearing: -18,
      attributionControl: { compact: true },
      pitchWithRotate: true,
      canvasContextAttributes: { antialias: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({
      showCompass: true,
      showZoom: true,
      visualizePitch: true,
    }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-left');
    map.on('style.load', () => {
      setBaseMapLoaded(true);
      add3DSatelliteSurface(map, mapSetupSnapshot);
      map.addControl(new maplibregl.TerrainControl({
        source: 'terrain-3d-source',
        exaggeration: TERRAIN_EXAGGERATION,
      }), 'top-right');
      map.addControl(new maplibregl.GlobeControl(), 'top-right');
      map.easeTo({
        center: [102.25, 2.7],
        zoom: 6.7,
        pitch: 68,
        bearing: -25,
        duration: 0,
      });
    });
    map.on('load', () => {
      setBaseMapLoaded(true);
      map.addSource('reference-routes', {
        type: 'geojson',
        data: buildReferenceRoutes(mapPorts),
      });
      map.addLayer({
        id: 'reference-routes-glow',
        type: 'line',
        source: 'reference-routes',
        paint: {
          'line-color': '#00dfff',
          'line-width': 7,
          'line-opacity': 0.22,
          'line-blur': 5,
        },
      });
      map.addLayer({
        id: 'reference-routes',
        type: 'line',
        source: 'reference-routes',
        paint: {
          'line-color': '#45dcff',
          'line-width': 2,
          'line-opacity': 0.66,
          'line-dasharray': [2, 2],
        },
      });
      for (const port of mapPorts) {
        const element = document.createElement('button');
        element.className = 'satellite-port-marker';
        element.type = 'button';
        element.title = `${port.name} / ${port.englishName}`;
        element.setAttribute('aria-label', `卫星地图港口 ${port.name}`);
        const dot = document.createElement('span');
        const label = document.createElement('strong');
        label.textContent = port.name;
        element.append(dot, label);
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([port.geo.lon, port.geo.lat])
          .addTo(map);
        portMarkersRef.current.push(marker);
      }
    });
    map.on('sourcedata', (event) => {
      if (event.sourceId === 'satellite-3d-surface' && event.isSourceLoaded) {
        setTileState('loaded');
      }
    });
    map.on('error', (event) => {
      const sourceId = (event as typeof event & { sourceId?: string }).sourceId;
      if (sourceId === 'satellite-3d-surface') setTileState('failed');
    });
    return () => {
      vesselMarkersRef.current.forEach((marker) => marker.remove());
      portMarkersRef.current.forEach((marker) => marker.remove());
      vesselMarkersRef.current = [];
      portMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [mapPorts, mapSetupSnapshot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !snapshot) return;
    vesselMarkersRef.current.forEach((marker) => marker.remove());
    vesselMarkersRef.current = [];
    if (!snapshot.authority.live_data_verified) return;
    for (const vessel of snapshot.ais.vessels.slice(0, 250)) {
      const element = document.createElement('button');
      element.className = 'live-ais-vessel-marker';
      element.type = 'button';
      element.setAttribute('aria-label', `实时 AIS 船舶 ${vessel.name}，MMSI ${vessel.mmsi}`);
      element.title = `${vessel.name}\nMMSI ${vessel.mmsi}\n${vessel.latitude.toFixed(5)}, ${vessel.longitude.toFixed(5)}`;
      const glyph = document.createElement('span');
      glyph.textContent = '▲';
      const pulse = document.createElement('i');
      element.append(pulse, glyph);
      const popupContent = document.createElement('section');
      popupContent.className = 'live-ais-popup';
      const heading = document.createElement('h3');
      heading.textContent = vessel.name;
      popupContent.append(
        heading,
        createTextLine('MMSI', vessel.mmsi),
        createTextLine('经纬度', `${vessel.latitude.toFixed(5)}, ${vessel.longitude.toFixed(5)}`),
        createTextLine('航速/航向', `${vessel.speedKnots.toFixed(1)} kn / ${vessel.headingDeg.toFixed(0)}°`),
        createTextLine('AIS时间', formatTime(vessel.observedAt)),
        createTextLine('时间质量', vessel.timestampQuality === 'provider' ? '提供方事件时间' : '仅接收时间'),
        createTextLine('定位精度标记', vessel.positionAccuracy === null ? '未提供' : vessel.positionAccuracy ? '高' : '低'),
      );
      const marker = new maplibregl.Marker({
        element,
        anchor: 'center',
        rotation: vessel.headingDeg,
        rotationAlignment: 'map',
      })
        .setLngLat([vessel.longitude, vessel.latitude])
        .setPopup(new maplibregl.Popup({ offset: 18, closeButton: true }).setDOMContent(popupContent))
        .addTo(map);
      vesselMarkersRef.current.push(marker);
    }
  }, [snapshot]);

  const newestVessel = useMemo(
    () => snapshot?.ais.vessels.reduce<LiveAisVessel | undefined>(
      (latest, vessel) => !latest || Date.parse(vessel.receivedAt) > Date.parse(latest.receivedAt) ? vessel : latest,
      undefined,
    ),
    [snapshot],
  );
  const satelliteLoaded = tileState === 'loaded';
  const publicSatelliteLoaded = Boolean(!snapshot?.satellite.configured && satelliteLoaded);
  const publicBaseMapLoaded = Boolean(!snapshot?.satellite.configured && baseMapLoaded);
  const realtimeVerified = Boolean(snapshot?.authority.live_data_verified);
  const fullyReady = Boolean(
    satelliteLoaded
    && realtimeVerified
    && snapshot?.authority.satellite_realtime_ready,
  );
  const lockReasons = [
    !snapshot?.satellite.configured
      ? publicSatelliteLoaded
        ? '当前影像为 Sentinel-2 cloudless 2025 合成层，非实时拍摄'
        : '高分影像缺少 MAPTILER_API_KEY'
      : tileState === 'failed' ? '卫星瓦片加载失败' : null,
    !snapshot?.ais.configured ? '缺少 AISSTREAM_API_KEY' : null,
    snapshot?.ais.configured && !realtimeVerified
      ? `AIS ${snapshot.ais.connectionState}，暂无五分钟内新鲜船位`
      : null,
    requestStatus === 'failed' ? requestError : null,
  ].filter(Boolean) as string[];

  return (
    <section className="live-satellite-map" aria-label="卫星实时定位地图">
      <div className="live-satellite-map__canvas" ref={containerRef} />
      <header className={`live-satellite-map__status live-satellite-map__status--${fullyReady ? 'ready' : 'locked'}`}>
        <span className="live-satellite-map__eyebrow">
          <Satellite size={14} />
          卫星实时定位
        </span>
        <strong>
          {fullyReady
            ? '3D卫星地貌 + 授权实时 AIS 已验证'
            : satelliteLoaded
              ? publicSatelliteLoaded
                ? '3D卫星地貌已加载 · 实时 AIS 待授权'
                : '高分3D卫星地貌已加载 · 实时 AIS 待授权'
              : publicBaseMapLoaded
                ? '3D地理引擎已加载 · 卫星纹理加载中'
              : '实时模式严格失败关闭'}
        </strong>
        <div className="live-satellite-map__badges">
          <span className={satelliteLoaded ? 'is-ready' : publicBaseMapLoaded ? 'is-fallback' : 'is-locked'}>
            {satelliteLoaded || publicBaseMapLoaded ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {satelliteLoaded
              ? publicSatelliteLoaded ? 'Sentinel-2 3D影像 已加载' : '高分卫星瓦片 已加载'
              : publicBaseMapLoaded
                ? '三维高程引擎 已加载'
                : `卫星瓦片 ${tileState === 'checking' ? '检查中' : '失败'}`}
          </span>
          <span className={realtimeVerified ? 'is-ready' : 'is-locked'}>
            {realtimeVerified ? <CheckCircle2 size={12} /> : <WifiOff size={12} />}
            AIS {snapshot?.ais.connectionState ?? '检查中'}
          </span>
          <span className={realtimeVerified ? 'is-ready' : 'is-locked'}>
            <Ship size={12} />
            真实船位 {snapshot?.ais.freshVesselCount ?? 0}
          </span>
        </div>
        <small>
          最新 AIS {formatTime(snapshot?.ais.latestPositionAt ?? null)} · 接收延迟 {formatPositionAge(newestVessel, snapshot?.observedAt)}
        </small>
      </header>

      {!fullyReady && (
        <section className="live-satellite-map__lock" role="status">
          <WifiOff size={26} />
          <strong>
            {satelliteLoaded ? '3D卫星地貌可用；当前没有授权实时 AIS' : '不显示模拟船位为实时目标'}
          </strong>
          <p>{lockReasons.join('；') || '正在校验卫星瓦片与授权 AIS 实时流。'}</p>
          <small>
            {publicBaseMapLoaded
              ? '海岸线、城市和海域来自公开地图；配置完成后才切换卫星瓦片与授权 AIS。'
              : '配置完成后后端自动订阅马六甲区域；AIS 密钥不会下发到浏览器。'}
          </small>
          <button onClick={() => void loadSnapshot()} type="button">
            <RefreshCw size={13} />
            重新检查
          </button>
        </section>
      )}

      <footer className="live-satellite-map__disclosure">
        <span>
          {publicSatelliteLoaded
            ? '3D地貌：EOX Sentinel-2 cloudless 2025 真彩色合成影像 + Mapterhorn DEM（高程1.5×显示）；无雾化，非实时拍摄。'
            : publicBaseMapLoaded
              ? '地理引擎：OpenFreeMap / OpenMapTiles / OpenStreetMap；卫星纹理加载中。'
            : snapshot?.satellite.disclosure ?? '正在读取卫星影像配置。'}
        </span>
        <span>{snapshot?.ais.disclosure ?? '正在读取 AIS 实时流状态。'}</span>
        <strong>非 ECDIS / VTS / 导航或生产调度授权</strong>
      </footer>

      <button
        className="live-satellite-map__perspective"
        onClick={() => mapRef.current?.easeTo({
          center: [102.25, 2.7],
          zoom: 6.7,
          pitch: 68,
          bearing: -25,
          duration: 1_200,
        })}
        title="恢复马六甲海峡三维倾斜视角"
        type="button"
      >
        <Mountain size={13} />
        3D地貌
      </button>
    </section>
  );
}
