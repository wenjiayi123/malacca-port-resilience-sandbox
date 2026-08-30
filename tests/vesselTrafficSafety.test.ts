import assert from 'node:assert/strict';
import test from 'node:test';
import { assessVesselTraffic, type VesselTrackObservation } from '../server/vesselTrafficSafety.ts';

const NOW = new Date('2026-08-30T08:00:00.000Z');
const observation = (
  sourceID: string,
  sourceType: VesselTrackObservation['sourceType'],
  mmsi: string,
  longitude: number,
  course: number,
  offset = 0,
): VesselTrackObservation => ({
  sourceID,
  sourceType,
  trackID: `${sourceID}.${mmsi}`,
  MMSI: mmsi,
  observedAt: NOW.toISOString(),
  latitude: 1.25 + offset,
  longitude: longitude + offset,
  speedOverGroundKnots: 10,
  courseOverGroundDegrees: course,
  horizontalAccuracyMeters: sourceType === 'RADAR' ? 20 : 40,
});

test('multi-source fusion detects a head-on critical encounter and keeps action advisory-only', () => {
  const result = assessVesselTraffic([
    observation('ais.primary', 'AIS', '563123456', 103.80, 90),
    observation('radar.primary', 'RADAR', '563123456', 103.80, 90, 0.00002),
    observation('ais.primary', 'AIS', '563654321', 103.90, 270),
    observation('radar.primary', 'RADAR', '563654321', 103.90, 270, -0.00002),
  ], NOW);
  assert.equal(result.tracks.length, 2);
  assert.equal(result.encounters[0].risk, 'CRITICAL');
  assert.ok((result.encounters[0].tcpaMinutes ?? 0) > 0);
  assert.equal(result.encounters[0].automaticManeuverAllowed, false);
  assert.equal(result.safetyBoundary.productionAuthority, false);
});

test('single-source pairs are labelled insufficient information instead of authoritative collision advice', () => {
  const result = assessVesselTraffic([
    observation('ais.primary', 'AIS', '563123456', 103.80, 90),
    observation('ais.primary', 'AIS', '563654321', 103.90, 270),
  ], NOW);
  assert.equal(result.encounters[0].risk, 'INSUFFICIENT_DATA');
  assert.equal(result.encounters[0].informationSufficient, false);
  assert.equal(result.criticalEncounterCount, 0);
});

test('conflicting and stale sensor data fail closed', () => {
  const stale = observation('ais.primary', 'AIS', '563999999', 103.8, 90);
  stale.observedAt = '2026-08-30T07:00:00.000Z';
  const result = assessVesselTraffic([
    observation('ais.primary', 'AIS', '563123456', 103.80, 90),
    observation('radar.primary', 'RADAR', '563123456', 104.80, 90),
    stale,
  ], NOW);
  assert.equal(result.tracks[0].quality, 'SOURCE_CONFLICT');
  assert.ok(result.tracks[0].conflicts.length > 0);
  assert.ok(result.rejectedObservations[0].errors.includes('observation_stale'));
});
