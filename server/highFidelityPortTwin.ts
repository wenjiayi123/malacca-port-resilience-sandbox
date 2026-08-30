import { createHash } from 'node:crypto';
import { canonicalJson } from './operatorIntegrationGateway.ts';

export const HIGH_FIDELITY_PROFILE_VERSION = 'coupled-port-twin-profile.v1' as const;

export interface TwinProvenanceRecord {
  sourceID: string;
  sha256: string;
  sourceType: 'HYDROGRAPHIC_SURVEY' | 'TIDE_GAUGE' | 'VESSEL_TRIAL' | 'EQUIPMENT_METER' | 'ENGINEERING_ASSUMPTION';
  measured: boolean;
  independentlyReviewed: boolean;
  acceptanceReference?: string;
}

export interface HighFidelityTwinProfile {
  profileVersion: typeof HIGH_FIDELITY_PROFILE_VERSION;
  profileID: string;
  siteID: string;
  evidenceLevel: 'ENGINEERING' | 'OPERATOR_CALIBRATED';
  coordinateReferenceSystem: string;
  verticalDatum: string;
  channel: {
    lengthNm: number;
    chartDepthM: number;
    minimumUnderKeelClearanceM: number;
    squatCoefficient: number;
    maximumSpeedKnots: number;
  };
  tide: { meanLevelM: number; amplitudeM: number; periodHours: number; phaseRadians: number };
  berths: Array<{ berthID: string; lengthM: number; depthM: number; maximumCranes: number }>;
  terminal: {
    craneMovesPerHour: number;
    cranePowerKw: number;
    auxiliaryPowerKw: number;
    availableCranes: number;
    yardCapacityTeu: number;
    initialYardInventoryTeu: number;
    gateOutTeuPerHour: number;
    gridCarbonKgPerKwh: number;
  };
  provenance: TwinProvenanceRecord[];
}

export interface TwinVesselCall {
  callID: string;
  vesselID: string;
  lengthM: number;
  draughtM: number;
  exchangeTeu: number;
  dischargeFraction: number;
  channelPositionNm: number;
  speedKnots: number;
  phase: 'INBOUND' | 'ANCHORAGE' | 'BERTHED' | 'OUTBOUND' | 'COMPLETED';
  berthID: string | null;
  remainingMoves: number;
}

export interface TwinControlInput {
  commandedSpeedsKnots?: Record<string, number>;
  requestedCranes?: Record<string, number>;
  currentAlongChannelKnots?: number;
  windSpeedMs?: number;
}

const STABLE_ID = /^[A-Za-z0-9._:-]{2,160}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const finite = (value: number, minimum: number, maximum: number) =>
  Number.isFinite(value) && value >= minimum && value <= maximum;
const round = (value: number, digits = 6) => Number(value.toFixed(digits));

export const validateHighFidelityTwinProfile = (profile: HighFidelityTwinProfile) => {
  const blockers: string[] = [];
  if (profile.profileVersion !== HIGH_FIDELITY_PROFILE_VERSION) blockers.push('profile_version_invalid');
  if (!STABLE_ID.test(profile.profileID) || !STABLE_ID.test(profile.siteID)) blockers.push('profile_identity_invalid');
  if (!profile.coordinateReferenceSystem.trim() || !profile.verticalDatum.trim()) blockers.push('spatial_reference_missing');
  if (!finite(profile.channel.lengthNm, 0.1, 500) || !finite(profile.channel.chartDepthM, 1, 100) ||
      !finite(profile.channel.minimumUnderKeelClearanceM, 0.1, 10) || !finite(profile.channel.squatCoefficient, 0, 1) ||
      !finite(profile.channel.maximumSpeedKnots, 0.5, 40)) blockers.push('channel_parameters_invalid');
  if (!finite(profile.tide.amplitudeM, 0, 15) || !finite(profile.tide.periodHours, 1, 48)) blockers.push('tide_parameters_invalid');
  if (!profile.berths.length || new Set(profile.berths.map((berth) => berth.berthID)).size !== profile.berths.length) {
    blockers.push('berth_configuration_invalid');
  }
  profile.berths.forEach((berth) => {
    if (!STABLE_ID.test(berth.berthID) || !finite(berth.lengthM, 20, 600) || !finite(berth.depthM, 1, 100) ||
        !Number.isInteger(berth.maximumCranes) || berth.maximumCranes < 1) blockers.push(`berth_invalid:${berth.berthID}`);
  });
  const terminal = profile.terminal;
  if (!finite(terminal.craneMovesPerHour, 1, 100) || !finite(terminal.cranePowerKw, 1, 10_000) ||
      !finite(terminal.auxiliaryPowerKw, 0, 100_000) || !Number.isInteger(terminal.availableCranes) || terminal.availableCranes < 1 ||
      !finite(terminal.yardCapacityTeu, 1, 10_000_000) || !finite(terminal.initialYardInventoryTeu, 0, terminal.yardCapacityTeu) ||
      !finite(terminal.gateOutTeuPerHour, 0, 100_000) || !finite(terminal.gridCarbonKgPerKwh, 0, 10)) {
    blockers.push('terminal_parameters_invalid');
  }
  if (!profile.provenance.length) blockers.push('provenance_missing');
  profile.provenance.forEach((source) => {
    if (!STABLE_ID.test(source.sourceID) || !SHA256.test(source.sha256)) blockers.push(`provenance_invalid:${source.sourceID}`);
  });
  const requiredMeasuredTypes: TwinProvenanceRecord['sourceType'][] = [
    'HYDROGRAPHIC_SURVEY', 'TIDE_GAUGE', 'VESSEL_TRIAL', 'EQUIPMENT_METER',
  ];
  const acceptedTypes = new Set(profile.provenance
    .filter((source) => source.measured && source.independentlyReviewed && source.acceptanceReference)
    .map((source) => source.sourceType));
  const missingAcceptedEvidence = requiredMeasuredTypes.filter((type) => !acceptedTypes.has(type));
  if (profile.evidenceLevel !== 'OPERATOR_CALIBRATED') blockers.push('operator_calibration_not_declared');
  if (missingAcceptedEvidence.length) blockers.push(`accepted_measurement_missing:${missingAcceptedEvidence.join(',')}`);
  return {
    structurallyValid: !blockers.some((blocker) => blocker.includes('invalid') || blocker.endsWith('_missing')),
    operatorCalibrated: blockers.length === 0,
    blockers: [...new Set(blockers)],
    missingAcceptedEvidence,
  };
};

const validateCall = (call: TwinVesselCall, profile: HighFidelityTwinProfile) => {
  if (!STABLE_ID.test(call.callID) || !STABLE_ID.test(call.vesselID)) throw new Error('call_identity_invalid');
  if (!finite(call.lengthM, 10, 500) || !finite(call.draughtM, 0.5, 30) || !finite(call.exchangeTeu, 0, 50_000)) {
    throw new Error('call_dimensions_invalid');
  }
  if (!finite(call.dischargeFraction, 0, 1) || !finite(call.channelPositionNm, 0, profile.channel.lengthNm) ||
      !finite(call.speedKnots, 0, 50) || !finite(call.remainingMoves, 0, call.exchangeTeu)) throw new Error('call_state_invalid');
};

export class HighFidelityPortTwin {
  readonly profile: HighFidelityTwinProfile;
  readonly calibrationReadiness: ReturnType<typeof validateHighFidelityTwinProfile>;
  private sequence = 0;
  private simulationTime: Date;
  private calls: TwinVesselCall[];
  private yardInventoryTeu: number;
  private cumulativeEnergyKwh = 0;
  private cumulativeCarbonKg = 0;
  private cumulativeGateOutTeu = 0;
  private cumulativeDischargedTeu = 0;
  private cumulativeLoadedTeu = 0;

  constructor(profile: HighFidelityTwinProfile, calls: TwinVesselCall[], startTime: string) {
    this.profile = structuredClone(profile);
    this.calibrationReadiness = validateHighFidelityTwinProfile(profile);
    if (!this.calibrationReadiness.structurallyValid) throw new Error(`profile_invalid:${this.calibrationReadiness.blockers.join(',')}`);
    if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(startTime) || Number.isNaN(Date.parse(startTime))) throw new Error('start_time_invalid');
    calls.forEach((call) => validateCall(call, profile));
    if (new Set(calls.map((call) => call.callID)).size !== calls.length) throw new Error('duplicate_call_id');
    this.calls = structuredClone(calls);
    this.simulationTime = new Date(startTime);
    this.yardInventoryTeu = profile.terminal.initialYardInventoryTeu;
  }

  private tideLevelM(time: Date) {
    const hours = time.getTime() / 3_600_000;
    return this.profile.tide.meanLevelM + this.profile.tide.amplitudeM *
      Math.sin(2 * Math.PI * hours / this.profile.tide.periodHours + this.profile.tide.phaseRadians);
  }

  step(deltaSeconds: number, control: TwinControlInput = {}) {
    if (!finite(deltaSeconds, 1, 300)) throw new Error('delta_seconds_must_be_1_to_300');
    const intervalHours = deltaSeconds / 3_600;
    const eventTime = new Date(this.simulationTime.getTime() + deltaSeconds * 1_000);
    const tideLevelM = this.tideLevelM(eventTime);
    const currentKnots = Math.max(-5, Math.min(5, control.currentAlongChannelKnots ?? 0));
    const windSpeedMs = Math.max(0, Math.min(80, control.windSpeedMs ?? 0));
    const navigationEvents: Array<Record<string, unknown>> = [];

    for (const call of this.calls) {
      if (call.phase !== 'INBOUND' && call.phase !== 'OUTBOUND') continue;
      const command = Math.max(0, Math.min(
        this.profile.channel.maximumSpeedKnots,
        control.commandedSpeedsKnots?.[call.callID] ?? call.speedKnots,
      ));
      const squatM = this.profile.channel.squatCoefficient * command ** 2 / Math.max(1, this.profile.channel.chartDepthM);
      const availableDepthM = this.profile.channel.chartDepthM + tideLevelM;
      const underKeelClearanceM = availableDepthM - call.draughtM - squatM;
      const weatherLimit = Math.max(0, this.profile.channel.maximumSpeedKnots * (1 - Math.max(0, windSpeedMs - 20) / 80));
      const permitted = underKeelClearanceM >= this.profile.channel.minimumUnderKeelClearanceM;
      const speedThroughWater = permitted ? Math.min(command, weatherLimit) : 0;
      call.speedKnots = round(Math.max(0, speedThroughWater + currentKnots), 4);
      const travelNm = call.speedKnots * intervalHours;
      call.channelPositionNm = round(call.phase === 'INBOUND'
        ? Math.max(0, call.channelPositionNm - travelNm)
        : Math.min(this.profile.channel.lengthNm, call.channelPositionNm + travelNm), 6);
      navigationEvents.push({
        callID: call.callID,
        underKeelClearanceM: round(underKeelClearanceM, 4),
        squatM: round(squatM, 4),
        permitted,
        blockedReason: permitted ? null : 'UNDER_KEEL_CLEARANCE',
      });
      if (call.phase === 'OUTBOUND' && call.channelPositionNm >= this.profile.channel.lengthNm) call.phase = 'COMPLETED';
    }

    const occupiedBerths = new Set(this.calls.filter((call) => call.phase === 'BERTHED').map((call) => call.berthID));
    const waiting = this.calls.filter((call) =>
      (call.phase === 'INBOUND' || call.phase === 'ANCHORAGE') && call.channelPositionNm <= 0.05)
      .sort((left, right) => left.callID.localeCompare(right.callID));
    for (const call of waiting) {
      const berth = this.profile.berths.find((candidate) => !occupiedBerths.has(candidate.berthID) &&
        candidate.lengthM >= call.lengthM * 1.1 && candidate.depthM + tideLevelM - call.draughtM >= this.profile.channel.minimumUnderKeelClearanceM);
      if (berth) {
        call.phase = 'BERTHED';
        call.berthID = berth.berthID;
        call.speedKnots = 0;
        occupiedBerths.add(berth.berthID);
      } else {
        call.phase = 'ANCHORAGE';
        call.speedKnots = 0;
      }
    }

    let cranesRemaining = this.profile.terminal.availableCranes;
    let intervalMoves = 0;
    let intervalDischarged = 0;
    let intervalLoaded = 0;
    const berthAssignments: Array<Record<string, unknown>> = [];
    for (const call of this.calls.filter((candidate) => candidate.phase === 'BERTHED')
      .sort((left, right) => left.callID.localeCompare(right.callID))) {
      const berth = this.profile.berths.find((candidate) => candidate.berthID === call.berthID)!;
      const requested = Math.max(1, Math.floor(control.requestedCranes?.[call.callID] ?? berth.maximumCranes));
      const cranes = Math.min(requested, berth.maximumCranes, cranesRemaining);
      cranesRemaining -= cranes;
      const moves = Math.min(call.remainingMoves, cranes * this.profile.terminal.craneMovesPerHour * intervalHours);
      call.remainingMoves = round(call.remainingMoves - moves, 6);
      intervalMoves += moves;
      intervalDischarged += moves * call.dischargeFraction;
      intervalLoaded += moves * (1 - call.dischargeFraction);
      berthAssignments.push({ callID: call.callID, berthID: berth.berthID, cranes, moves: round(moves, 4) });
      if (call.remainingMoves <= 1e-6) {
        call.phase = 'OUTBOUND';
        call.berthID = null;
      }
    }

    const gateOutPotential = this.profile.terminal.gateOutTeuPerHour * intervalHours;
    const availableForGateOut = Math.max(0, this.yardInventoryTeu + intervalDischarged - intervalLoaded);
    const gateOut = Math.min(gateOutPotential, availableForGateOut);
    const nextInventory = this.yardInventoryTeu + intervalDischarged - intervalLoaded - gateOut;
    if (nextInventory > this.profile.terminal.yardCapacityTeu + 1e-6) throw new Error('YARD_CAPACITY_BREACH');
    if (nextInventory < -1e-6) throw new Error('YARD_INVENTORY_NEGATIVE');
    this.yardInventoryTeu = round(nextInventory, 6);
    this.cumulativeDischargedTeu += intervalDischarged;
    this.cumulativeLoadedTeu += intervalLoaded;
    this.cumulativeGateOutTeu += gateOut;
    const activeCranes = this.profile.terminal.availableCranes - cranesRemaining;
    const intervalEnergyKwh = (this.profile.terminal.auxiliaryPowerKw + activeCranes * this.profile.terminal.cranePowerKw) * intervalHours;
    const intervalCarbonKg = intervalEnergyKwh * this.profile.terminal.gridCarbonKgPerKwh;
    this.cumulativeEnergyKwh += intervalEnergyKwh;
    this.cumulativeCarbonKg += intervalCarbonKg;
    this.sequence += 1;
    this.simulationTime = eventTime;
    const finalOccupiedBerths = this.calls.filter((call) => call.phase === 'BERTHED').map((call) => call.berthID);
    const massBalanceExpected = this.profile.terminal.initialYardInventoryTeu + this.cumulativeDischargedTeu -
      this.cumulativeLoadedTeu - this.cumulativeGateOutTeu;
    const massBalanceErrorTeu = this.yardInventoryTeu - massBalanceExpected;
    const snapshotCore = {
      protocolVersion: 'coupled-port-twin-snapshot.v1',
      sequence: this.sequence,
      eventTime: eventTime.toISOString(),
      profileID: this.profile.profileID,
      tideLevelM: round(tideLevelM, 4),
      calls: structuredClone(this.calls),
      navigationEvents,
      berthAssignments,
      terminal: {
        intervalMoves: round(intervalMoves, 4),
        intervalDischargedTeu: round(intervalDischarged, 4),
        intervalLoadedTeu: round(intervalLoaded, 4),
        intervalGateOutTeu: round(gateOut, 4),
        yardInventoryTeu: this.yardInventoryTeu,
        yardOccupancyPercent: round(this.yardInventoryTeu / this.profile.terminal.yardCapacityTeu * 100, 3),
        activeCranes,
      },
      energy: {
        intervalEnergyKwh: round(intervalEnergyKwh, 4),
        intervalCarbonKg: round(intervalCarbonKg, 4),
        cumulativeEnergyKwh: round(this.cumulativeEnergyKwh, 4),
        cumulativeCarbonKg: round(this.cumulativeCarbonKg, 4),
      },
      invariants: {
        uniqueBerthOccupancy: new Set(finalOccupiedBerths).size === finalOccupiedBerths.length,
        yardMassBalanceErrorTeu: round(massBalanceErrorTeu, 9),
        yardMassBalancePassed: Math.abs(massBalanceErrorTeu) <= 1e-6,
        nonNegativeInventory: this.yardInventoryTeu >= 0,
        capacityRespected: this.yardInventoryTeu <= this.profile.terminal.yardCapacityTeu,
      },
      fidelity: {
        calibrationReadiness: this.calibrationReadiness,
        hilConnected: false,
        fieldAcceptanceCompleted: false,
        limitations: [
          'one-dimensional channel kinematics rather than full hydrodynamic CFD',
          'deterministic crane-rate discrete-event abstraction',
          'yard represented by aggregate TEU conservation rather than container-level topology',
        ],
      },
      authority: { simulationMode: true, dispatchAllowed: false, productionAuthority: false },
    };
    return {
      ...snapshotCore,
      snapshotSha256: createHash('sha256').update(canonicalJson(snapshotCore)).digest('hex'),
    };
  }
}
