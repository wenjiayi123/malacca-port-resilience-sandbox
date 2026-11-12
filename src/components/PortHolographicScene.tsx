import { useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Anchor, ArrowRight, Crosshair, Layers, Minus, Navigation, Plus, Radar, RotateCcw, Ship } from 'lucide-react';
import type { PortCongestionSimulation, PortNode, RouteOverlay, VesselDelaySimulation, VesselMarker } from '../types/sandbox';
import { buildTerrainPresentation, networkCountryNames, networkPortName, pointOnNetworkEdge } from '../ui/networkPresentation';

export type NetworkFocus = { type: 'route' | 'port' | 'vessel'; id: string } | null;
interface Props {
  ports: PortNode[];
  routes: RouteOverlay[];
  vessels: VesselMarker[];
  congestion: PortCongestionSimulation[];
  delays: VesselDelaySimulation[];
  affectedVesselIds: string[];
  backgroundAsset?: string;
  clock: string;
  eventLabel?: string;
  pending: boolean;
  focus: NetworkFocus;
  visibleRouteIds: Set<string>;
  showVessels: boolean;
  onToggleVessels: () => void;
  onSelect: (focus: NetworkFocus) => void;
  onShowDetails: () => void;
}

const clamp = (value: number, bound: number) => Math.max(-bound, Math.min(bound, value));

export function PortHolographicScene(props: Props) {
  const graph = useMemo(() => buildTerrainPresentation(props.ports, props.routes), [props.ports, props.routes]);
  const [layers, setLayers] = useState({ routes: true, pressure: true, risk: true, motion: true });
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const drag = useRef<{ pointer: number; x: number; y: number; cameraX: number; cameraY: number } | null>(null);
  const id = useId().replace(/:/g, '');
  const portById = new Map(props.ports.map((port) => [port.id, port]));
  const congestionById = new Map(props.congestion.map((item) => [item.portId, item]));
  const delayById = new Map(props.delays.map((item) => [item.vesselId, item]));
  const affected = new Set(props.affectedVesselIds);
  const affectedRoutes = new Set(props.vessels.filter((vessel) => affected.has(vessel.id)).map((vessel) => vessel.flowId));
  const vessel = props.focus?.type === 'vessel' ? props.vessels.find((item) => item.id === props.focus?.id) : undefined;
  const route = props.routes.find((item) => item.id === (props.focus?.type === 'route' ? props.focus.id : vessel?.flowId));
  const port = props.focus?.type === 'port' ? portById.get(props.focus.id) : undefined;
  const routeName = (item: RouteOverlay) => `${networkPortName(portById.get(item.originPortId)!)} → ${networkPortName(portById.get(item.destinationPortId)!)}`;
  const edgeVisible = (item: RouteOverlay) => props.visibleRouteIds.has(item.id) && (!route || route.id === item.id)
    && (!port || item.originPortId === port.id || item.destinationPortId === port.id);
  const toggle = (key: keyof typeof layers) => setLayers((value) => ({ ...value, [key]: !value[key] }));
  const resetCamera = () => setCamera({ zoom: 1, x: 0, y: 0 });
  const zoom = (delta: number) => setCamera((value) => {
    const next = Math.min(2.5, Math.max(1, Math.round((value.zoom + delta) * 100) / 100));
    return { zoom: next, x: clamp(value.x, (next - 1) * 50), y: clamp(value.y, (next - 1) * 50) };
  });
  const focusCamera = () => {
    const edge = graph.edges.find((item) => item.route.id === route?.id);
    const position = port ? graph.positions.get(port.id) : vessel && edge ? pointOnNetworkEdge(edge, vessel.progressPercent / 100) : edge?.middle;
    if (position) setCamera({ zoom: 1.7, x: clamp((.5 - position.x / 960) * 170, 35), y: clamp((.5 - position.y / 640) * 170, 35) });
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (camera.zoom <= 1 || event.button !== 0 || (event.target as Element).closest('button, [role="button"]')) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCamera((value) => ({ ...value,
      x: clamp(drag.current!.cameraX + (event.clientX - drag.current!.x) / bounds.width * 100, (value.zoom - 1) * 50),
      y: clamp(drag.current!.cameraY + (event.clientY - drag.current!.y) / bounds.height * 100, (value.zoom - 1) * 50) }));
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const background = graph.stylizedMalacca ? '/assets/backgrounds/malacca_background_clean.png' : props.backgroundAsset;
  const counterScale = { '--holo-counter-scale': 1 / camera.zoom } as CSSProperties;

  return <div className={`holo-scene-shell${layers.motion ? '' : ' is-motion-paused'}`}>
    <div className="holo-layer-toolbar" aria-label="科技态势图层">
      <span><Layers size={13} />图层</span>
      {([['routes', '航段'], ['pressure', '拥堵热区'], ['risk', '事件影响'], ['motion', '动态光效']] as const).map(([key, label]) =>
        <button aria-pressed={layers[key]} key={key} onClick={() => toggle(key)} type="button">{label}</button>)}
      <button aria-pressed={props.showVessels} onClick={props.onToggleVessels} type="button"><Ship size={12} />船流</button>
    </div>
    <div className={`holo-scene${camera.zoom > 1 ? ' is-zoomed' : ''}`} aria-label="卫星风格港航科技态势图" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="holo-world" style={{ transform: `translate(${camera.x}%, ${camera.y}%) scale(${camera.zoom})`, ...counterScale }}>
        <div className="holo-terrain" style={{ backgroundImage: background ? `url("${background}")` : undefined }} />
        <div className="holo-grid" /><div className="holo-radar-rings" /><div className="holo-radar-sweep" />
        <svg className="holo-map-vectors" viewBox="0 0 960 640" preserveAspectRatio="none" aria-label="港口锚点、模拟航段与影响范围">
          <defs>
            <filter id={`${id}-glow`} x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="3" /></filter>
            <radialGradient id={`${id}-pressure`}><stop stopColor="#ffbf58" stopOpacity=".44" /><stop offset="1" stopColor="#ff8c41" stopOpacity="0" /></radialGradient>
          </defs>
          {graph.stylizedMalacca && <g className="holo-region-labels"><text x="622" y="103">马来西亚</text><text x="622" y="122">MALAYSIA</text><text x="186" y="522">苏门答腊 · 印度尼西亚</text><text x="186" y="541">SUMATRA / INDONESIA</text><text className="holo-strait-label" x="431" y="196" transform="rotate(34 431 196)">MALACCA STRAIT</text></g>}
          {layers.pressure && !props.pending && props.ports.map((item) => {
            const point = graph.positions.get(item.id)!;
            const pressure = congestionById.get(item.id)?.congestionScore ?? item.congestionPercent;
            return pressure >= 40 ? <circle className="holo-pressure" key={item.id} cx={point.x} cy={point.y} r={24 + pressure * .5} fill={`url(#${id}-pressure)`}><title>{networkPortName(item)} · 模拟拥堵 {pressure}%</title></circle> : null;
          })}
          {graph.edges.map((edge) => {
            const muted = !edgeVisible(edge.route);
            const impacted = layers.risk && affectedRoutes.has(edge.route.id);
            return <g className={`holo-route holo-route--${edge.route.role}${muted ? ' is-muted' : ''}${impacted ? ' is-impacted' : ''}${route?.id === edge.route.id ? ' is-selected' : ''}`} key={edge.route.id} style={{ display: layers.routes ? undefined : 'none' }}>
              <path className="holo-route-glow" d={edge.path} filter={`url(#${id}-glow)`} />
              <path className="holo-route-line" d={edge.path} /><path className="holo-route-flow" d={edge.path} />
              <path className="holo-route-hit" aria-label={`科技地图查看航段 ${edge.code} ${edge.route.label}`} d={edge.path} onClick={() => props.onSelect({ type: 'route', id: edge.route.id })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelect({ type: 'route', id: edge.route.id }); } }} role="button" tabIndex={muted ? -1 : 0}><title>{routeName(edge.route)}</title></path>
              {edge.badge !== edge.middle && <path className="holo-label-leader" d={`M${edge.middle.x} ${edge.middle.y} L${edge.badge.x} ${edge.badge.y}`} />}

            </g>;
          })}
          {props.ports.map((item) => {
            const point = graph.positions.get(item.id)!; const label = graph.labels.get(item.id)!;
            const connected = graph.connectedPorts.some((candidate) => candidate.id === item.id);
            return <g className={`holo-port-anchor is-${item.tone}${connected ? '' : ' is-observation'}`} key={item.id}>
              <path className="holo-label-leader" d={`M${point.x} ${point.y} L${label.x} ${label.y}`} />
              <circle className="holo-beacon-outer" cx={point.x} cy={point.y} r="14" /><circle className="holo-beacon-inner" cx={point.x} cy={point.y} r="7" /><circle className="holo-beacon-core" cx={point.x} cy={point.y} r="3" />
            </g>;
          })}
        </svg>
        {layers.routes && graph.edges.map((edge) => {
          const angle = Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x) * 180 / Math.PI;
          const muted = !edgeVisible(edge.route);
          return <button className={`holo-route-code-button holo-route--${edge.route.role}${muted ? ' is-muted' : ''}${route?.id === edge.route.id ? ' is-selected' : ''}`} aria-label={`航段 ${edge.code} ${edge.route.label}`} aria-pressed={route?.id === edge.route.id} disabled={muted} key={edge.route.id} onClick={() => props.onSelect({ type: 'route', id: edge.route.id })} style={{ left: `${edge.badge.x / 9.6}%`, top: `${edge.badge.y / 6.4}%` }} type="button"><span>{edge.code}</span><ArrowRight size={12} style={{ transform: `rotate(${angle}deg)` }} /></button>;
        })}
        {props.ports.map((item) => {
          const point = graph.labels.get(item.id)!;
          const connected = graph.connectedPorts.some((candidate) => candidate.id === item.id);
          const selected = port?.id === item.id || route?.originPortId === item.id || route?.destinationPortId === item.id;
          return <button aria-label={`科技地图查看港口 ${networkPortName(item)}`} aria-pressed={port?.id === item.id} className={`holo-port-label is-${item.tone}${selected ? ' is-selected' : ''}${connected ? '' : ' is-observation'}`} key={item.id} onClick={() => props.onSelect({ type: 'port', id: item.id })} style={{ left: `${point.x / 9.6}%`, top: `${point.y / 6.4}%` }} type="button">
            <span><Anchor size={11} />{networkCountryNames[item.country]}{!connected && <em>观察</em>}</span><strong>{networkPortName(item)}</strong><small>{props.pending ? '等待授权遥测' : `排队 ${congestionById.get(item.id)?.queueingVessels ?? item.queueVessels} 艘 · ${item.status}`}</small>
          </button>;
        })}
        {props.showVessels && props.vessels.map((item, index) => {
          const edge = graph.edges.find((candidate) => candidate.route.id === item.flowId);
          if (!edge || !edgeVisible(edge.route)) return null;
          const point = pointOnNetworkEdge(edge, item.progressPercent / 100);
          const angle = Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x) * 180 / Math.PI + 45;
          return <button className={`holo-vessel${vessel?.id === item.id ? ' is-selected' : ''}${layers.risk && affected.has(item.id) ? ' is-impacted' : ''}`} aria-label={`查看样船 ${item.name}`} aria-pressed={vessel?.id === item.id} key={item.id} onClick={() => props.onSelect({ type: 'vessel', id: item.id })} style={{ left: `${point.x / 9.6}%`, top: `${point.y / 6.4}%` }} title={`${item.name} · ${item.speedKnots.toFixed(1)} kn · ${props.pending ? '等待遥测' : `模拟延误 ${delayById.get(item.id)?.delayMinutes ?? 0} 分钟`}`} type="button"><Navigation size={14} style={{ transform: `rotate(${angle}deg)` }} /><span>S{String(index + 1).padStart(2, '0')}</span></button>;
        })}
      </div>
      <div className="holo-hud-title"><small>MARITIME DIGITAL TWIN</small><strong>{graph.stylizedMalacca ? '马六甲海峡' : '港航运行区域'}<i>模拟态势</i></strong><span>{props.ports.length} 港口 · {graph.edges.length} 航段 · {props.vessels.length} 样船</span></div>
      <div className="holo-hud-clock"><Radar size={14} /><span>{props.clock}</span><small>{props.pending ? '等待遥测' : '公开校准模拟'}</small>{props.eventLabel && <small className="holo-hud-event">{props.eventLabel} · 影响 {affected.size} 艘样船</small>}</div>
      <div className="holo-compass" aria-hidden="true"><span>N</span><Navigation size={22} /></div>
      <button className="holo-minimap" aria-label="缩略图恢复全域" onClick={resetCamera} style={{ backgroundImage: background ? `url("${background}")` : undefined }} type="button"><i style={{ width: `${100 / camera.zoom}%`, height: `${100 / camera.zoom}%`, left: `${clamp(50 - 50 / camera.zoom - camera.x / camera.zoom, 100)}%`, top: `${clamp(50 - 50 / camera.zoom - camera.y / camera.zoom, 100)}%` }} /><span>全域导航</span></button>
      <div className="holo-camera-controls" aria-label="科技态势图缩放控制"><button aria-label="缩小科技态势图" disabled={camera.zoom <= 1} onClick={() => zoom(-.25)} type="button"><Minus size={14} /></button><span>{Math.round(camera.zoom * 100)}%</span><button aria-label="放大科技态势图" disabled={camera.zoom >= 2.5} onClick={() => zoom(.25)} type="button"><Plus size={14} /></button><button aria-label="科技态势图恢复全域" onClick={resetCamera} type="button"><RotateCcw size={13} />全域</button></div>
      <div className="holo-data-boundary">卫星风格底图 · 模拟航段与船位 · 非实时影像 / AIS 航迹</div>
    </div>
    <div className="holo-context" aria-live="polite">
      <Crosshair size={16} /><div><strong>{vessel?.name ?? (route ? routeName(route) : port ? networkPortName(port) : '点击港口、航段或样船，查看运行信息')}</strong><span>{vessel ? `${vessel.speedKnots.toFixed(1)} kn · ${props.pending ? '等待遥测' : `模拟延误 ${delayById.get(vessel.id)?.delayMinutes ?? 0} 分钟`}` : route ? `${graph.edges.find((edge) => edge.route.id === route.id)?.code} · ${route.label} · ${props.pending ? '等待遥测' : `${route.vesselVolume} 艘/日 · 延误 ${route.delayMinutes} 分钟`}` : port ? `${networkCountryNames[port.country]} · ${graph.edges.filter((edge) => edge.route.originPortId === port.id || edge.route.destinationPortId === port.id).length} 条关联场景航段` : '航段编号对应清单；放大后可拖拽，选中后可聚焦对象。'}</span></div>
      {props.focus && <><button onClick={focusCamera} type="button"><Crosshair size={13} />聚焦</button><button onClick={props.onShowDetails} type="button">完整详情<ArrowRight size={13} /></button><button aria-label="清除科技地图选择" onClick={() => props.onSelect(null)} type="button">清除</button></>}
    </div>
  </div>;
}
