import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RealtimeAisGateway,
  parseAisStreamMessage,
} from '../server/realtimeAisGateway.ts';

const livePosition = {
  MessageType: 'PositionReport',
  MetaData: {
    MMSI: 563123456,
    ShipName: 'MALACCA TEST@@@',
    latitude: 2.32,
    longitude: 101.84,
    time_utc: '2026-08-14T01:30:00.000Z',
  },
  Message: {
    PositionReport: {
      UserID: 563123456,
      Latitude: 2.32,
      Longitude: 101.84,
      Sog: 12.4,
      Cog: 96.2,
      TrueHeading: 94,
      NavigationalStatus: 0,
      PositionAccuracy: true,
      Raim: false,
    },
  },
};

test('AISStream parser preserves real coordinates, time, identity and quality flags', () => {
  const vessel = parseAisStreamMessage(livePosition, Date.parse('2026-08-14T01:30:02.000Z'));
  assert.ok(vessel);
  assert.equal(vessel.mmsi, '563123456');
  assert.equal(vessel.name, 'MALACCA TEST');
  assert.equal(vessel.latitude, 2.32);
  assert.equal(vessel.longitude, 101.84);
  assert.equal(vessel.speedKnots, 12.4);
  assert.equal(vessel.headingDeg, 94);
  assert.equal(vessel.positionAccuracy, true);
  assert.equal(vessel.observedAt, '2026-08-14T01:30:00.000Z');
  assert.equal(vessel.source, 'aisstream-authorized-live');
});

test('AISStream parser rejects positions outside the configured Malacca region', () => {
  const outside = structuredClone(livePosition);
  outside.Message.PositionReport.Latitude = 38.9;
  outside.Message.PositionReport.Longitude = -77;
  outside.MetaData.latitude = 38.9;
  outside.MetaData.longitude = -77;
  assert.equal(parseAisStreamMessage(outside), null);
});

test('AISStream parser labels a missing provider event time instead of inventing verified time', () => {
  const missingTime = structuredClone(livePosition);
  delete (missingTime.MetaData as Partial<typeof missingTime.MetaData>).time_utc;
  const vessel = parseAisStreamMessage(missingTime, Date.parse('2026-08-14T01:30:02.000Z'));
  assert.ok(vessel);
  assert.equal(vessel.timestampQuality, 'receive-time-fallback');
});

test('live AIS gateway fails closed when disconnected or cached positions become stale', () => {
  let now = Date.parse('2026-08-14T01:30:02.000Z');
  const gateway = new RealtimeAisGateway({
    apiKey: 'test-secret-never-returned',
    autoStart: false,
    staleAfterMs: 300_000,
    now: () => now,
  });
  gateway.ingestForTest(livePosition, now);
  const disconnected = gateway.snapshot();
  assert.equal(disconnected.freshVesselCount, 1);
  assert.equal(disconnected.connectionState, 'stopped');
  assert.equal(disconnected.liveDataVerified, false);
  assert.equal(JSON.stringify(disconnected).includes('test-secret-never-returned'), false);

  now += 300_001;
  const stale = gateway.snapshot();
  assert.equal(stale.freshVesselCount, 0);
  assert.equal(stale.liveDataVerified, false);
});

test('live AIS gateway verifies fresh positions only after the backend websocket is connected', () => {
  class FakeWebSocket extends EventTarget {
    readonly sent: string[] = [];

    send(value: string) {
      this.sent.push(value);
    }

    close() {
      this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test-complete' }));
    }
  }

  const now = Date.parse('2026-08-14T01:30:02.000Z');
  const socket = new FakeWebSocket();
  const gateway = new RealtimeAisGateway({
    apiKey: 'server-side-test-key',
    autoStart: true,
    now: () => now,
    websocketFactory: () => socket as unknown as WebSocket,
  });
  socket.dispatchEvent(new Event('open'));
  gateway.ingestForTest(livePosition, now);
  const snapshot = gateway.snapshot();
  assert.equal(snapshot.connectionState, 'connected');
  assert.equal(snapshot.liveDataVerified, true);
  assert.equal(snapshot.freshVesselCount, 1);
  assert.equal(socket.sent.length, 1);
  const subscription = JSON.parse(socket.sent[0]) as Record<string, unknown>;
  assert.equal(subscription.APIKey, 'server-side-test-key');
  assert.deepEqual(subscription.FilterMessageTypes, [
    'PositionReport',
    'StandardClassBPositionReport',
    'ExtendedClassBPositionReport',
  ]);
  assert.equal(JSON.stringify(snapshot).includes('server-side-test-key'), false);
  gateway.stop();
});
