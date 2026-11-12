import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Activity, Anchor, ArrowDown, ArrowRight, Check, ChevronRight, CircleAlert, Layers, ListFilter, Maximize2, Minimize2, Radar, RotateCcw, Share2, Ship } from 'lucide-react';
import { PortHolographicScene } from './PortHolographicScene';
import type { ChannelStatus, PortCongestionSimulation, PortNode, RouteOverlay, VesselDelaySimulation, VesselMarker } from '../types/sandbox';
import { buildNetworkPresentation, networkCountryNames, networkPortName, networkRoleNames, pointOnNetworkEdge } from '../ui/networkPresentation';

interface PortNetworkMapProps {
  region: string;
  clock: string;
  ports: PortNode[];
  routes: RouteOverlay[];
  channels: ChannelStatus[];
  vessels: VesselMarker[];
  congestion: PortCongestionSimulation[];
  delays: VesselDelaySimulation[];
  pending: boolean;
  eventLabel?: string;
  eventDescription?: string;
  affectedVessels: number;
  affectedVesselIds: string[];
  backgroundAsset?: string;
  onValidateRoute: (routeId: string) => void;
  onValidateVessel: (vesselId: string) => void;
  onInspectPort: (port: PortNode) => void;
  onOpenLayers: () => void;
}
type Focus = { type: 'route' | 'port' | 'vessel'; id: string } | null;
type Filter = 'all' | RouteOverlay['role'] | 'attention';

export function PortNetworkMap(props: PortNetworkMapProps) {
  const { ports, routes, channels, vessels, pending } = props;
  const [focus, setFocus] = useState<Focus>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [showVessels, setShowVessels] = useState(true);
  const [presentation, setPresentation] = useState<'terrain' | 'network'>('terrain');
  const [immersive, setImmersive] = useState(false);
  const [sceneResetKey, setSceneResetKey] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!immersive) return;
    const previous = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setImmersive(false);
      if (event.key !== 'Tab') return;
      const controls = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls[controls.length - 1];
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)
        || !sectionRef.current?.contains(document.activeElement)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); previous?.focus(); };
  }, [immersive]);
  const detailRef = useRef<HTMLElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const selectAndReveal = (value: Focus) => {
    setFocus(value);
    window.requestAnimationFrame(() => {
      const target = value?.type === 'vessel' ? detailRef.current?.querySelector('.network-vessel-focus') : detailRef.current;
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  const id = useId().replace(/:/g, '');
  const graph = useMemo(() => buildNetworkPresentation(ports, routes), [ports, routes]);
  const portById = new Map(ports.map((port) => [port.id, port]));
  const channelById = new Map(channels.map((channel) => [channel.id, channel]));
  const congestionById = new Map(props.congestion.map((item) => [item.portId, item]));
  const delayById = new Map(props.delays.map((item) => [item.vesselId, item]));
  const focusPort = focus?.type === 'port' ? portById.get(focus.id) : undefined;
  const focusVessel = focus?.type === 'vessel' ? vessels.find((vessel) => vessel.id === focus.id) : undefined;
  const focusRoute = routes.find((route) => route.id === (focus?.type === 'route' ? focus.id : focusVessel?.flowId));
  const focusChannel = focusRoute ? channelById.get(focusRoute.channelId) : undefined;
  const focusEdge = graph.edges.find((edge) => edge.route.id === focusRoute?.id);
  const name = (portId: string) => { const port = portById.get(portId); return port ? networkPortName(port) : '端点未绑定'; };
  const read = (value: number, unit = '', digits = 0) => pending ? '待接入' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: digits })}${unit}`;
  const status = (route: RouteOverlay) => pending ? '等待遥测' : channelById.get(route.channelId)?.status ?? (route.tone === 'ok' ? '正常' : '需关注');
  const worstRoute = [...routes].sort((a, b) => b.delayMinutes - a.delayMinutes)[0];
  const peakPort = [...ports].sort((a, b) => (congestionById.get(b.id)?.congestionScore ?? b.congestionPercent) - (congestionById.get(a.id)?.congestionScore ?? a.congestionPercent))[0];
  const attentionCount = pending ? 0 : routes.filter((route) => route.tone !== 'ok' || channelById.get(route.channelId)?.tone !== 'ok').length;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleEdges = graph.edges.filter(({ route, code }) => {
    const matchesFilter = filter === 'all' || (filter === 'attention' ? !pending && (route.tone !== 'ok' || channelById.get(route.channelId)?.tone !== 'ok') : route.role === filter);
    return matchesFilter && (!normalizedQuery || [code, route.label, name(route.originPortId), name(route.destinationPortId), channelById.get(route.channelId)?.label].join(' ').toLocaleLowerCase().includes(normalizedQuery));
  });
  const visibleRouteIds = new Set(visibleEdges.map((edge) => edge.route.id));
  const routeIsFocused = (route: RouteOverlay) => focusRoute ? route.id === focusRoute.id
    : focusPort ? route.originPortId === focusPort.id || route.destinationPortId === focusPort.id : true;
  const connectedRoutes = focusPort ? routes.filter((route) => route.originPortId === focusPort.id || route.destinationPortId === focusPort.id) : [];
  const relatedVessels = vessels.filter((vessel) => focusRoute ? vessel.flowId === focusRoute.id : focusPort ? connectedRoutes.some((route) => route.id === vessel.flowId) : false);
  const reset = () => { setFocus(null); setFilter('all'); setQuery(''); setShowVessels(true); setSceneResetKey((value) => value + 1); };

  return (
    <section ref={sectionRef} className={`port-network-map${immersive ? ' port-network-map--immersive' : ''}`} aria-label="港航科技态势与航线详情" role={immersive ? 'dialog' : undefined} aria-modal={immersive || undefined}>
      <header className="network-map-heading">
        <div><small>MARITIME DIGITAL TWIN · OPERATIONS</small><h3>{props.region} · 港航科技态势</h3><p>在空间态势中读清港口、航段与船流，把位置、状态与业务说明连在一起。</p></div>
        <span className="network-mode"><Activity size={13} />{pending ? '场景模板 · 等待遥测' : '公开校准模拟'}<small>{props.clock}</small></span>
      </header>
      <div className="network-map-summary">
        <span><b>{ports.length}</b> 个展示节点</span><span><b>{graph.edges.length}</b> 条场景航段</span><span className={attentionCount ? 'is-warning' : ''}><b>{pending ? '—' : attentionCount}</b> 条需关注航段</span>
        <span><Ship size={14} /><b>{vessels.length}</b> 艘{pending ? '模板' : '工程'}样船</span>
      </div>
      {props.eventLabel && <section className="network-event-strip event-impact-banner" aria-label="当前场景影响"><CircleAlert size={17} /><div><strong>当前场景：{props.eventLabel}</strong><span>{props.eventDescription ?? '场景状态已加载，港口、航段与样船指标随同一推演时钟更新。'}</span></div><em>影响 {props.affectedVessels} 艘样船</em></section>}
      <div className="network-map-toolbar">
        <div className="network-route-filters" aria-label="按航段类型筛选">
          {([['all', '全部'], ['main', '主干通道'], ['secondary', '港间接续'], ['traffic-separation', '分道通航'], ['attention', '需关注']] as const).map(([value, label]) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value)} type="button">{label}</button>)}
        </div>
        <div className="network-map-tools"><button aria-pressed={immersive} onClick={() => setImmersive((value) => !value)} type="button">{immersive ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{immersive ? '退出专注' : '专注大屏'}</button><button aria-pressed={showVessels} onClick={() => setShowVessels((value) => !value)} type="button"><Ship size={14} />样船{showVessels ? '已显示' : '已隐藏'}</button><button data-demo-action="network-reset-view" onClick={reset} type="button"><RotateCcw size={14} />重置视图</button><button onClick={props.onOpenLayers} type="button"><Layers size={14} />分析图层</button></div>
      </div>
      <div className="network-map-workbench">
        <div className="network-map-main" ref={diagramRef}>
          <nav className="network-presentation-picker" aria-label="科技态势与关系图切换">
            <button aria-pressed={presentation === 'terrain'} data-demo-action="network-terrain-open" onClick={() => setPresentation('terrain')} type="button"><Radar size={14} />科技态势</button>
            <button aria-pressed={presentation === 'network'} onClick={() => setPresentation('network')} type="button"><Share2 size={14} />港航关系</button>
            <small>{presentation === 'terrain' ? '夜景底图 · 空间态势 · 图层交互' : '配置连接 · 起讫方向 · 航段编号'}</small>
          </nav>
          {presentation === 'terrain' ? <PortHolographicScene
            key={sceneResetKey} ports={ports} routes={routes} vessels={vessels}
            congestion={props.congestion} delays={props.delays} affectedVesselIds={props.affectedVesselIds}
            backgroundAsset={props.backgroundAsset} clock={props.clock} eventLabel={props.eventLabel} pending={pending} focus={focus}
            visibleRouteIds={visibleRouteIds} showVessels={showVessels}
            onToggleVessels={() => setShowVessels((value) => !value)} onSelect={setFocus}
            onShowDetails={() => {
              if (immersive && window.innerWidth <= 1000) setImmersive(false);
              window.requestAnimationFrame(() => {
                const target = focus?.type === 'vessel' ? detailRef.current?.querySelector('.network-vessel-focus') : detailRef.current;
                target?.scrollIntoView({ block: 'start', inline: 'nearest' });
              });
            }}
          /> : <>
          <div className="network-diagram-caption"><span><Anchor size={14} />港口与航段关系示意</span><small>箭头表示场景起点 → 终点；R 编号对应下方航段清单</small></div>
          <div className="network-diagram" style={{ aspectRatio: `960 / ${graph.height}` }}>
            <svg viewBox={`0 0 960 ${graph.height}`} preserveAspectRatio="none" aria-label="场景航段连接与方向">
              <defs><pattern id={`${id}-grid`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#284452" strokeWidth=".7" /></pattern></defs>
              <rect width="960" height={graph.height} fill={`url(#${id}-grid)`} opacity=".36" />
              <text className="network-diagram-area" x="42" y="47">港口连接</text><text className="network-diagram-area" x="42" y={graph.height - 24}>关系示意 · 节点排布不代表实际航迹或航行距离</text>
              {graph.edges.map((edge) => {
                const selected = focusRoute?.id === edge.route.id;
                const muted = !visibleRouteIds.has(edge.route.id) || !routeIsFocused(edge.route);
                const angle = Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x) * 180 / Math.PI;
                return <g className={`network-edge network-edge--${edge.route.role}${selected ? ' is-selected' : ''}${muted ? ' is-muted' : ''}`} key={edge.route.id}>
                  <path className="network-edge-line" d={edge.path} />
                  <path className="network-edge-hit" aria-label={`查看航段 ${edge.code} ${edge.route.label}`} d={edge.path} onClick={() => selectAndReveal({ type: 'route', id: edge.route.id })} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectAndReveal({ type: 'route', id: edge.route.id }); } }} role="button" tabIndex={muted ? -1 : 0}><title>{`${name(edge.route.originPortId)} → ${name(edge.route.destinationPortId)} · ${status(edge.route)}`}</title></path>
                  <g className="network-edge-label" transform={`translate(${edge.middle.x} ${edge.middle.y})`}><rect x="-37" y="-16" width="74" height="32" rx="7" /><text textAnchor="middle" x="-9" y="5">{edge.code}</text><path className="network-edge-arrow" d="M-7 0 H7 M1 -6 L7 0 L1 6" transform={`translate(23 0) rotate(${angle})`} /></g>
                </g>;
              })}
              {showVessels && vessels.map((vessel, index) => {
                const edge = graph.edges.find((item) => item.route.id === vessel.flowId);
                if (!edge || !visibleRouteIds.has(vessel.flowId) || !routeIsFocused(edge.route)) return null;
                const point = pointOnNetworkEdge(edge, vessel.progressPercent / 100);
                return <g className="network-sample-vessel" key={vessel.id} transform={`translate(${point.x} ${point.y})`}><path d="M-7 -6 L9 0 L-7 6 Z" /><text x="11" y="-8">S{String(index + 1).padStart(2, '0')}</text><title>{`${vessel.name} · 延误 ${read(delayById.get(vessel.id)?.delayMinutes ?? 0, ' 分钟')}`}</title></g>;
              })}
            </svg>
            {graph.connectedPorts.map((port) => {
              const position = graph.positions.get(port.id)!;
              const metrics = congestionById.get(port.id);
              const selected = focusPort?.id === port.id || focusRoute?.originPortId === port.id || focusRoute?.destinationPortId === port.id;
              return <button aria-label={`查看港口 ${networkPortName(port)}`} aria-pressed={focusPort?.id === port.id} className={`network-port network-port--${port.tone}${selected ? ' is-selected' : ''}`} key={port.id} onClick={() => selectAndReveal({ type: 'port', id: port.id })} style={{ left: `${position.x / 9.6}%`, top: `${position.y / graph.height * 100}%` } as CSSProperties} type="button"><span><Anchor size={14} /><small>{networkCountryNames[port.country]}</small></span><strong>{networkPortName(port)}</strong><em>{pending ? '等待授权遥测' : `排队 ${metrics?.queueingVessels ?? port.queueVessels} 艘 · ${port.status}`}</em></button>;
            })}
          </div>
          </>}
          <div className="network-map-legend"><span className="is-main">主干通道</span><span className="is-secondary">港间接续</span><span className="is-tss">分道通航</span><small>港口状态见节点文字；点击连线或清单查看详情</small></div>
          {graph.observationPorts.length > 0 && <div className="network-observation-ports"><span>扩展观察节点<small>当前场景未绑定起讫航段</small></span>{graph.observationPorts.map((port) => <button key={port.id} aria-pressed={focusPort?.id === port.id} onClick={() => selectAndReveal({ type: 'port', id: port.id })} type="button"><Anchor size={14} /><strong>{networkPortName(port)}</strong><small>{networkCountryNames[port.country]}</small><ChevronRight size={13} /></button>)}</div>}
        </div>
        <aside className="network-map-detail" aria-label="所选港口或航段详情" aria-live="polite" ref={detailRef}>
          {!focusPort && !focusRoute && <><div className="network-detail-kicker"><ListFilter size={15} />先看这里</div><h4>这张图怎样读？</h4><p>夜景底图保留区域空间感；节点、航段和样船来自当前模拟场景。点击对象查看摘要，再展开详情；R 编号对应航段清单，也可切换关系图专看连接。</p><div className="network-reading-steps"><span><b>1</b>看起点和终点</span><span><b>2</b>选中航段看运行状态</span><span><b>3</b>需要时送入沙盘验证</span></div><h5>当前重点关注</h5>{pending ? <p>尚无授权运行遥测；不把模板值当作现场状态。</p> : <><button className="network-attention-card" onClick={() => peakPort && selectAndReveal({ type: 'port', id: peakPort.id })} disabled={!peakPort} type="button"><small>港口压力相对较高</small><strong>{peakPort ? networkPortName(peakPort) : '暂无节点'}</strong><span>排队 {read(peakPort ? congestionById.get(peakPort.id)?.queueingVessels ?? peakPort.queueVessels : 0, ' 艘')}<ChevronRight size={14} /></span></button>{worstRoute && worstRoute.delayMinutes > 0 ? <button className="network-attention-card" onClick={() => worstRoute && selectAndReveal({ type: 'route', id: worstRoute.id })} disabled={!worstRoute} type="button"><small>当前延误较长的航段</small><strong>{worstRoute ? `${name(worstRoute.originPortId)} → ${name(worstRoute.destinationPortId)}` : '暂无航段'}</strong><span>延误 {read(worstRoute?.delayMinutes ?? 0, ' 分钟')}<ChevronRight size={14} /></span></button> : <p>当前场景航段未出现正延误，仍可查看各航段流量和样船状态。</p>}</>}</>}
          {focusPort && <><div className="network-detail-kicker"><Anchor size={15} />港口节点</div><h4>{networkPortName(focusPort)}</h4><p>{focusPort.englishName} · {networkCountryNames[focusPort.country]}</p><dl className="network-detail-metrics"><div><dt>排队船舶</dt><dd>{read(congestionById.get(focusPort.id)?.queueingVessels ?? focusPort.queueVessels, ' 艘')}</dd></div><div><dt>预计等待</dt><dd>{read(congestionById.get(focusPort.id)?.expectedWaitingHours ?? focusPort.averageWaitingHours, ' 小时', 1)}</dd></div><div><dt>拥堵程度</dt><dd>{read(congestionById.get(focusPort.id)?.congestionScore ?? focusPort.congestionPercent, '%')}</dd></div><div><dt>泊位利用率</dt><dd>{read(focusPort.berthUtilizationPercent, '%')}</dd></div></dl><h5>关联场景航段 · {connectedRoutes.length} 条</h5>{connectedRoutes.length ? connectedRoutes.map((route) => <button className="network-related-link" key={route.id} onClick={() => selectAndReveal({ type: 'route', id: route.id })} type="button">{name(route.originPortId)} → {name(route.destinationPortId)}<ChevronRight size={14} /></button>) : <p>该节点仅用于扩展观察，当前场景没有配置关联起讫航段；不绘制推测连线。</p>}<button className="network-detail-primary" onClick={() => { setImmersive(false); props.onInspectPort(focusPort); }} type="button">查看港口韧性<ArrowRight size={14} /></button>{focusPort.id === 'belawan' && <a className="network-source-link" href="https://pelindo.co.id/port/pelabuhan-belawan" target="_blank" rel="noreferrer">Pelindo 官方港口名称与位置</a>}</>}
          {focusRoute && <><div className="network-detail-kicker"><span className={`network-route-code is-${focusRoute.role}`}>{focusEdge?.code}</span>{networkRoleNames[focusRoute.role]}</div><h4>{focusRoute.label}</h4><div className="network-endpoints"><span><small>起点</small><strong>{name(focusRoute.originPortId)}</strong></span><ArrowDown size={17} /><span><small>终点</small><strong>{name(focusRoute.destinationPortId)}</strong></span></div><p><b>{status(focusRoute)}</b> · {focusChannel?.label ?? '航道尚未绑定'}</p><dl className="network-detail-metrics"><div><dt>模拟流量</dt><dd>{read(focusRoute.vesselVolume, ' 艘/日')}</dd></div><div><dt>航段延误</dt><dd>{read(focusRoute.delayMinutes, ' 分钟')}</dd></div><div><dt>平均航速</dt><dd>{read(focusRoute.averageSpeedKnots, ' kn', 1)}</dd></div><div><dt>航道拥堵</dt><dd>{focusChannel ? read(focusChannel.congestionPercent, '%') : '未绑定'}</dd></div></dl><h5>这条航段表示什么</h5><p>{networkRoleNames[focusRoute.role]}：连接 {name(focusRoute.originPortId)} 与 {name(focusRoute.destinationPortId)}，使用{focusChannel?.label ?? '未绑定航道'}。方向和路径来自场景配置。</p><button className="network-detail-primary" disabled={pending || !vessels.some((vessel) => vessel.flowId === focusRoute.id)} onClick={() => { setImmersive(false); props.onValidateRoute(focusRoute.id); }} type="button">在沙盘中验证此航段<ArrowRight size={14} /></button></>}
          {(focusRoute || focusPort) && <><h5>关联样船 · {relatedVessels.length} 艘</h5><p className="network-sample-scope">模拟流量与工程样船数量是不同口径；样船延误另计气象、航速和风险分量。</p>{relatedVessels.length ? relatedVessels.map((vessel) => <button className={`network-vessel-row${focusVessel?.id === vessel.id ? ' is-selected' : ''}`} key={vessel.id} onClick={() => selectAndReveal({ type: 'vessel', id: vessel.id })} type="button"><Ship size={14} /><span><strong>{vessel.name}</strong><small>{read(vessel.speedKnots, ' kn', 1)} · 延误 {read(delayById.get(vessel.id)?.delayMinutes ?? 0, ' 分钟')}</small></span><ChevronRight size={12} /></button>) : <p>此处未配置代表样船；航段模拟流量与样船数量是不同口径。</p>}</>}
          {focusVessel && <div className="network-vessel-focus"><strong>{focusVessel.name}</strong><span>IMO {focusVessel.imo.replace(/^IMO\s*/i, '')} · 场景进度 {read(focusVessel.progressPercent, '%', 1)}</span><p>工程样船；名称与 IMO 为演示模板。</p>{delayById.get(focusVessel.id) && <p className="network-vessel-delay-breakdown">样船延误分量：拥堵 {read(delayById.get(focusVessel.id)!.congestionDelayMinutes, ' 分钟')}，气象 {read(delayById.get(focusVessel.id)!.weatherDelayMinutes, ' 分钟')}，航速 {read(delayById.get(focusVessel.id)!.speedDelayMinutes, ' 分钟')}，风险 {read(delayById.get(focusVessel.id)!.riskDelayMinutes, ' 分钟')}。当前主因：{delayById.get(focusVessel.id)!.dominantFactor}。</p>}<button className="network-detail-primary" disabled={pending} onClick={() => { setImmersive(false); props.onValidateVessel(focusVessel.id); }} type="button">选择此样船进行验证<ArrowRight size={14} /></button></div>}
          {focus && <button className="network-back-overview" onClick={() => { setFocus(null); window.requestAnimationFrame(() => diagramRef.current?.scrollIntoView({ block: 'start' })); }} type="button"><RotateCcw size={13} />返回港航关系图</button>}
        </aside>
      </div>
      <section className="network-route-directory" aria-label="场景航段清单">
        <header><div><h4>航段清单</h4><span>{visibleEdges.length} / {graph.edges.length} 条 · 编号与图中对应</span></div><label><ListFilter size={14} /><input aria-label="搜索航段或港口" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索港口、航道或 R 编号" value={query} /></label></header>
        <div className="network-route-directory__rows">{visibleEdges.map(({ route, code }) => <button aria-pressed={focusRoute?.id === route.id} className={`network-route-row${focusRoute?.id === route.id ? ' is-selected' : ''}`} data-network-route={route.id} key={route.id} onClick={() => selectAndReveal({ type: 'route', id: route.id })} type="button"><span className={`network-route-code is-${route.role}`}>{code}</span><span className="network-route-row__name"><strong>{name(route.originPortId)}<ArrowRight size={12} />{name(route.destinationPortId)}</strong><small>{route.label} · {networkRoleNames[route.role]}</small></span><span className={`network-route-status is-${route.tone}`}>{route.tone === 'ok' ? <Check size={12} /> : <CircleAlert size={12} />}{status(route)}</span><span><b>{read(route.vesselVolume)}</b><small>艘/日 · 模拟流量</small></span><span><b>{read(route.delayMinutes, ' 分钟')}</b><small>航段延误</small></span><ChevronRight size={14} /></button>)}</div>
        {visibleEdges.length === 0 && <div className="network-empty">没有匹配的航段。<button onClick={reset} type="button">清除筛选</button></div>}
      </section>
      <footer className="network-map-boundary"><CircleAlert size={14} /><p>科技态势采用卫星风格视觉底图，港口锚点与模拟航段仅作空间关系示意，非导航航迹；关系图用于读清配置连接。模拟流量、延误与样船均非现场 AIS 实测。地理定位请使用“卫星实时定位”并核对授权数据状态。{graph.omittedRoutes.length > 0 && ` ${graph.omittedRoutes.length} 条航段端点缺失，未绘制。`}</p></footer>
    </section>
  );
}
