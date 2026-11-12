import assert from 'node:assert/strict';
import test from 'node:test';
import { malaccaScenario } from '../src/data/malaccaScenario.ts';
import { buildNetworkPresentation, buildTerrainPresentation, pointOnNetworkEdge } from '../src/ui/networkPresentation.ts';

test('network arrows connect the configured origin and destination, independently of legacy artwork', () => {
  for (const build of [buildNetworkPresentation, buildTerrainPresentation]) {
  const graph = build(malaccaScenario.ports, malaccaScenario.routeOverlays);
  assert.equal(graph.edges.length, 5);
  for (const edge of graph.edges) {
    assert.deepEqual(pointOnNetworkEdge(edge, 0), graph.positions.get(edge.route.originPortId));
    assert.deepEqual(pointOnNetworkEdge(edge, 1), graph.positions.get(edge.route.destinationPortId));
  }
  assert.equal(graph.edges[1].route.originPortId, 'singapore');
  assert.equal(graph.edges[1].route.destinationPortId, 'belawan');
  }
});

test('unconnected observation ports stay unconnected and missing endpoints never create guessed lines', () => {
  const brokenRoute = { ...malaccaScenario.routeOverlays[0], id: 'missing-port-route', destinationPortId: 'unknown-port' };
  const graph = buildNetworkPresentation(malaccaScenario.ports, [...malaccaScenario.routeOverlays, brokenRoute]);
  assert.deepEqual(graph.observationPorts.map((port) => port.id).sort(), ['batam', 'kuantan']);
  assert.deepEqual(graph.omittedRoutes.map((route) => route.id), ['missing-port-route']);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.positions.has('unknown-port'), false);
});

test('parallel and reverse routes occupy distinct lanes and sample progress is bounded', () => {
  const route = malaccaScenario.routeOverlays[0];
  const routes = [route, { ...route, id: 'parallel-route' },
    { ...route, id: 'reverse-route', originPortId: route.destinationPortId, destinationPortId: route.originPortId }];
  for (const build of [buildNetworkPresentation, buildTerrainPresentation]) {
  const graph = build(malaccaScenario.ports, routes);
  assert.equal(new Set(graph.edges.map((edge) => `${edge.middle.x},${edge.middle.y}`)).size, 3);
  assert.deepEqual(pointOnNetworkEdge(graph.edges[0], -1), graph.edges[0].start);
  assert.deepEqual(pointOnNetworkEdge(graph.edges[0], 4), graph.edges[0].end);
  }
});
