import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  HIGH_FIDELITY_PROFILE_VERSION,
  HighFidelityPortTwin,
  validateHighFidelityTwinProfile,
  type HighFidelityTwinProfile,
  type TwinVesselCall,
} from '../server/highFidelityPortTwin.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const profile: HighFidelityTwinProfile = {
  profileVersion: HIGH_FIDELITY_PROFILE_VERSION,
  profileID: 'engineering.coupled.twin.v1',
  siteID: 'sandbox.malacca',
  evidenceLevel: 'ENGINEERING',
  coordinateReferenceSystem: 'WGS84 engineering channel axis',
  verticalDatum: 'engineering chart datum',
  channel: {
    lengthNm: 20,
    chartDepthM: 16,
    minimumUnderKeelClearanceM: 1,
    squatCoefficient: 0.08,
    maximumSpeedKnots: 12,
  },
  tide: { meanLevelM: 0, amplitudeM: 0, periodHours: 12.42, phaseRadians: 0 },
  berths: [
    { berthID: 'berth.01', lengthM: 420, depthM: 17, maximumCranes: 4 },
    { berthID: 'berth.02', lengthM: 280, depthM: 14, maximumCranes: 3 },
  ],
  terminal: {
    craneMovesPerHour: 30,
    cranePowerKw: 900,
    auxiliaryPowerKw: 1200,
    availableCranes: 6,
    yardCapacityTeu: 100000,
    initialYardInventoryTeu: 50000,
    gateOutTeuPerHour: 20,
    gridCarbonKgPerKwh: 0.65,
  },
  provenance: [{
    sourceID: 'engineering.assumptions.v1',
    sha256: hash('engineering assumptions'),
    sourceType: 'ENGINEERING_ASSUMPTION',
    measured: false,
    independentlyReviewed: false,
  }],
};

const call = (id: string, position = 0.01): TwinVesselCall => ({
  callID: id,
  vesselID: `vessel.${id}`,
  lengthM: 300,
  draughtM: 12,
  exchangeTeu: 120,
  dischargeFraction: 0.6,
  channelPositionNm: position,
  speedKnots: 8,
  phase: 'INBOUND',
  berthID: null,
  remainingMoves: 120,
});

test('engineering profile is structurally usable but cannot claim operator calibration', () => {
  const readiness = validateHighFidelityTwinProfile(profile);
  assert.equal(readiness.structurallyValid, true);
  assert.equal(readiness.operatorCalibrated, false);
  assert.ok(readiness.blockers.includes('operator_calibration_not_declared'));
  assert.ok(readiness.missingAcceptedEvidence.includes('HYDROGRAPHIC_SURVEY'));
});

test('coupled twin preserves berth exclusivity, yard mass balance and energy accounting', () => {
  const twin = new HighFidelityPortTwin(profile, [call('call.01'), call('call.02')], '2026-08-30T08:00:00.000Z');
  const snapshot = twin.step(300, {
    requestedCranes: { 'call.01': 4, 'call.02': 4 },
    commandedSpeedsKnots: { 'call.01': 4, 'call.02': 4 },
  });
  assert.equal(snapshot.invariants.uniqueBerthOccupancy, true);
  assert.equal(snapshot.invariants.yardMassBalancePassed, true);
  assert.equal(snapshot.invariants.nonNegativeInventory, true);
  assert.equal(snapshot.invariants.capacityRespected, true);
  assert.ok(snapshot.energy.intervalEnergyKwh > 0);
  assert.equal(snapshot.authority.dispatchAllowed, false);
  const berthIDs = snapshot.calls.filter((item) => item.phase === 'BERTHED').map((item) => item.berthID);
  assert.equal(new Set(berthIDs).size, berthIDs.length);
});

test('under-keel-clearance gate stops unsafe channel movement', () => {
  const shallowProfile = structuredClone(profile);
  shallowProfile.channel.chartDepthM = 12.5;
  const deepCall = call('call.deep', 5);
  deepCall.draughtM = 12;
  const twin = new HighFidelityPortTwin(shallowProfile, [deepCall], '2026-08-30T08:00:00.000Z');
  const snapshot = twin.step(60, { commandedSpeedsKnots: { 'call.deep': 10 } });
  assert.equal(snapshot.navigationEvents[0].permitted, false);
  assert.equal(snapshot.navigationEvents[0].blockedReason, 'UNDER_KEEL_CLEARANCE');
  assert.equal(snapshot.calls[0].channelPositionNm, 5);
});

test('same profile, initial state and controls produce the same deterministic snapshot digest', () => {
  const left = new HighFidelityPortTwin(profile, [call('call.01', 5)], '2026-08-30T08:00:00.000Z');
  const right = new HighFidelityPortTwin(profile, [call('call.01', 5)], '2026-08-30T08:00:00.000Z');
  assert.equal(left.step(60).snapshotSha256, right.step(60).snapshotSha256);
});
