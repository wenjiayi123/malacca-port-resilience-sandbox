import assert from 'node:assert/strict';
import test from 'node:test';
import { malaccaScenario } from '../src/data/malaccaScenario.ts';
import { shanghaiScenario } from '../src/data/shanghaiScenario.ts';
import {
  mergePortTelemetry,
  type PortTelemetrySnapshot,
} from '../src/integrations/portDataAdapter.ts';

const observedAt = '2026-07-25T08:00:00+08:00';

test('same-profile public evidence keeps the baseline Malacca topology', () => {
  const snapshot: PortTelemetrySnapshot = {
    protocolVersion: 'port-digital-twin.snapshot.v1',
    observedAt,
    source: 'public-evidence-test',
    scenario: {
      id: 'malacca-public-evidence-operational-scenario',
      name: '马六甲海峡公开数据实证推演场景',
    },
  };

  const merged = mergePortTelemetry(malaccaScenario, snapshot);

  assert.equal(merged.id, snapshot.scenario?.id);
  assert.equal(merged.ports.length, malaccaScenario.ports.length);
  assert.equal(merged.vesselMarkers.length, malaccaScenario.vesselMarkers.length);
});

test('same-profile runtime patches channels and routes without dropping topology', () => {
  const snapshot: PortTelemetrySnapshot = {
    protocolVersion: 'port-operations.telemetry.v1',
    observedAt,
    source: 'runtime-simulator-test',
    telemetry: {
      channels: [{ id: 'malacca-main', congestionPercent: 73, delayMinutes: 24 }],
      routeOverlays: [{ id: 'main-route-north', vesselVolume: 333, carbonEmissionTons: 777 }],
    },
  };

  const merged = mergePortTelemetry(malaccaScenario, snapshot);
  assert.equal(merged.channels.length, malaccaScenario.channels.length);
  assert.equal(merged.channels.find((item) => item.id === 'malacca-main')?.congestionPercent, 73);
  assert.equal(merged.routeOverlays.length, malaccaScenario.routeOverlays.length);
  assert.equal(merged.routeOverlays.find((item) => item.id === 'main-route-north')?.vesselVolume, 333);
  assert.equal(merged.routeOverlays.find((item) => item.id === 'main-route-north')?.carbonEmissionTons, 777);
});

test('explicit topology replacement supports a Shanghai snapshot with no live vessels', () => {
  const snapshot: PortTelemetrySnapshot = {
    protocolVersion: 'port-digital-twin.snapshot.v1',
    observedAt,
    source: 'operator-gateway-test',
    topologyMode: 'replace',
    scenario: shanghaiScenario,
  };

  const merged = mergePortTelemetry(malaccaScenario, snapshot);

  assert.equal(merged.profileId, 'shanghai-international-port');
  assert.equal(merged.ports.length, shanghaiScenario.ports.length);
  assert.equal(merged.vesselMarkers.length, 0);
  assert.equal(merged.channels.length, shanghaiScenario.channels.length);
});

test('topology replacement fails closed when port nodes are absent', () => {
  const snapshot: PortTelemetrySnapshot = {
    protocolVersion: 'port-digital-twin.snapshot.v1',
    observedAt,
    source: 'invalid-operator-gateway-test',
    topologyMode: 'replace',
    scenario: {
      id: 'empty-topology',
      name: 'Empty topology',
      profileId: 'shanghai-international-port',
    },
  };

  assert.throws(
    () => mergePortTelemetry(malaccaScenario, snapshot),
    /必须提供至少一个港口节点/,
  );
});
