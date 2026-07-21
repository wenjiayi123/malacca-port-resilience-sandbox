import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePortCallEvent } from '../server/portCallContract.ts';

const validEvent = {
  protocolVersion: 'port-call-event.v1',
  portCallID: 'PC-SGSIN-20260721-001',
  vesselVisitReference: 'VISIT-001',
  UNLocationCode: 'SGSIN',
  vessel: { IMO: '9319466', MMSI: '563123456', name: 'Open Port Test' },
  portCallServiceTypeCode: 'BERTH',
  eventTypeCode: 'ARRIVAL',
  eventClassifierCode: 'ACT',
  eventDateTime: '2026-07-21T08:30:00+08:00',
  facility: { facilityTypeCode: 'BERTH', facilityCode: 'B01', facilityName: 'Berth 01' },
  source: { system: 'tos-test-adapter', recordID: 'TOS-001', observedAt: '2026-07-21T08:31:00+08:00' },
  quality: { status: 'VERIFIED', confidence: 0.98 },
};

test('port call contract normalizes a valid DCSA-aligned event subset', () => {
  const result = validatePortCallEvent(validEvent);
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.equal(result.event.protocolVersion, 'port-call-event.v1');
    assert.equal(result.event.UNLocationCode, 'SGSIN');
    assert.equal(result.event.eventClassifierCode, 'ACT');
  }
});

test('port call contract rejects ambiguous timestamps and invalid vessel identifiers', () => {
  const result = validatePortCallEvent({
    ...validEvent,
    eventDateTime: '2026-07-21T08:30:00',
    vessel: { IMO: '123', MMSI: 'bad' },
    quality: { status: 'VERIFIED', confidence: 1.4 },
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((error) => error.includes('时区')));
    assert.ok(result.errors.some((error) => error.includes('7 位')));
    assert.ok(result.errors.some((error) => error.includes('0 到 1')));
  }
});
