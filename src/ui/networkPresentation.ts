import type { PortNode, RouteOverlay } from '../types/sandbox';

export interface NetworkPoint { x: number; y: number }
export interface NetworkEdge {
  route: RouteOverlay;
  code: string;
  start: NetworkPoint;
  end: NetworkPoint;
  control: NetworkPoint;
  middle: NetworkPoint;
  path: string;
}

// This is a relationship diagram. Positions express connectivity, not chart coordinates.
const malaccaLayout: Record<string, NetworkPoint> = {
  penang: { x: 150, y: 135 },
  'port-klang': { x: 460, y: 135 },
  singapore: { x: 790, y: 300 },
  belawan: { x: 150, y: 470 },
  dumai: { x: 460, y: 470 },
  'tanjung-pelepas': { x: 790, y: 470 },
};

// Visual anchors match the retained stylized night-map asset, not navigational coordinates.
export const malaccaTerrainLayout: Record<string, { anchor: NetworkPoint; label: NetworkPoint }> = {
  penang: { anchor: { x: 300, y: 135 }, label: { x: 363, y: 91 } },
  'port-klang': { anchor: { x: 580, y: 315 }, label: { x: 575, y: 230 } },
  singapore: { anchor: { x: 763, y: 453 }, label: { x: 870, y: 455 } },
  'tanjung-pelepas': { anchor: { x: 715, y: 420 }, label: { x: 835, y: 323 } },
  batam: { anchor: { x: 827, y: 497 }, label: { x: 555, y: 550 } },
  dumai: { anchor: { x: 420, y: 377 }, label: { x: 343, y: 439 } },
  belawan: { anchor: { x: 210, y: 243 }, label: { x: 119, y: 306 } },
  kuantan: { anchor: { x: 667, y: 238 }, label: { x: 783, y: 173 } },
};

const malaccaTerrainControls: Record<string, NetworkPoint> = {
  'main-route-north': { x: 360, y: 325 },
  'main-route-south': { x: 490, y: 360 },
  'secondary-route-klang-singapore': { x: 610, y: 420 },
  'secondary-route-dumai': { x: 555, y: 465 },
};

export const networkCountryNames: Record<PortNode['country'], string> = {
  Malaysia: '马来西亚', Indonesia: '印度尼西亚', Singapore: '新加坡', China: '中国',
};
export const networkRoleNames: Record<RouteOverlay['role'], string> = {
  main: '主干通道', secondary: '港间接续', 'traffic-separation': '分道通航',
};
export const networkPortName = (port: PortNode) => port.id === 'belawan' ? 'Belawan 港' : port.name;

export function pointOnNetworkEdge(edge: Pick<NetworkEdge, 'start' | 'control' | 'end'>, progress: number): NetworkPoint {
  const t = Math.min(1, Math.max(0, progress));
  const a = (1 - t) ** 2;
  const b = 2 * t * (1 - t);
  return { x: a * edge.start.x + b * edge.control.x + t * t * edge.end.x,
    y: a * edge.start.y + b * edge.control.y + t * t * edge.end.y };
}

export function buildNetworkPresentation(ports: readonly PortNode[], routes: readonly RouteOverlay[]) {
  const knownIds = new Set(ports.map((port) => port.id));
  const connectedIds = new Set(routes.filter((route) => knownIds.has(route.originPortId) && knownIds.has(route.destinationPortId))
    .flatMap((route) => [route.originPortId, route.destinationPortId]));
  const connectedPorts = ports.filter((port) => connectedIds.has(port.id));
  const isMalacca = connectedPorts.length > 0 && connectedPorts.every((port) => port.id in malaccaLayout);
  const positions = new Map(connectedPorts.map((port, index) => [port.id, isMalacca ? malaccaLayout[port.id]
    : { x: 150 + index % 3 * 320, y: 125 + Math.floor(index / 3) * 170 }]));
  const edges: NetworkEdge[] = [];
  const omittedRoutes: RouteOverlay[] = [];
  routes.forEach((route, index) => {
    const start = positions.get(route.originPortId);
    const end = positions.get(route.destinationPortId);
    if (!start || !end) { omittedRoutes.push(route); return; }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy) || 1;
    const parallel = routes.filter((other) =>
      [other.originPortId, other.destinationPortId].every((id) => id === route.originPortId || id === route.destinationPortId));
    const lane = parallel.findIndex((other) => other.id === route.id);
    const direction = route.originPortId.localeCompare(route.destinationPortId) <= 0 ? 1 : -1;
    const bend = parallel.length > 1 ? (lane - (parallel.length - 1) / 2) * 80 * direction : route.role === 'main' ? 36 : 0;
    const control = { x: (start.x + end.x) / 2 - dy / length * bend, y: (start.y + end.y) / 2 + dx / length * bend };
    const edge = { route, code: `R${String(index + 1).padStart(2, '0')}`, start, end, control,
      path: `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}`, middle: { x: 0, y: 0 } };
    edge.middle = pointOnNetworkEdge(edge, .5);
    edges.push(edge);
  });
  return { connectedPorts, positions, edges, omittedRoutes, observationPorts: ports.filter((port) => !connectedIds.has(port.id)),
    height: isMalacca ? 600 : Math.max(600, Math.ceil(connectedPorts.length / 3) * 170 + 80) };
}

export function buildTerrainPresentation(ports: readonly PortNode[], routes: readonly RouteOverlay[]) {
  const graph = buildNetworkPresentation(ports, routes);
  const stylizedMalacca = ports.length > 0 && ports.every((port) => port.id in malaccaTerrainLayout);
  const positions = new Map(ports.map((port) => [port.id, stylizedMalacca ? malaccaTerrainLayout[port.id].anchor
    : { x: parseFloat(port.position.x) * 9.6, y: parseFloat(port.position.y) * 6.4 }]));
  const labels = new Map(ports.map((port) => [port.id, stylizedMalacca ? malaccaTerrainLayout[port.id].label
    : { x: Math.min(875, Math.max(85, positions.get(port.id)!.x)), y: Math.min(550, Math.max(90, positions.get(port.id)!.y - 45)) }]));
  const edges = graph.edges.map((edge) => {
    const start = positions.get(edge.route.originPortId)!;
    const end = positions.get(edge.route.destinationPortId)!;
    const parallels = graph.edges.filter((other) => [other.route.originPortId, other.route.destinationPortId].every((id) => id === edge.route.originPortId || id === edge.route.destinationPortId));
    const lane = parallels.findIndex((other) => other.route.id === edge.route.id);
    const direction = edge.route.originPortId.localeCompare(edge.route.destinationPortId) <= 0 ? 1 : -1;
    const bend = (lane - (parallels.length - 1) / 2) * 80 * direction;
    const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const control = parallels.length === 1 && stylizedMalacca && malaccaTerrainControls[edge.route.id]
      ? malaccaTerrainControls[edge.route.id] : { x: (start.x + end.x) / 2 - (end.y - start.y) / length * bend, y: (start.y + end.y) / 2 + (end.x - start.x) / length * bend };
    const projected = { ...edge, start, end, control, path: `M${start.x} ${start.y} Q${control.x} ${control.y} ${end.x} ${end.y}` };
    const middle = pointOnNetworkEdge(projected, .5);
    return { ...projected, middle, badge: stylizedMalacca && edge.route.id === 'traffic-separation-singapore' ? { x: 670, y: 543 } : middle };
  });
  return { ...graph, positions, labels, edges, height: 640, stylizedMalacca };
}
