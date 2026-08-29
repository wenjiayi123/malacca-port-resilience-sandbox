import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PRESERVED_OPERATIONAL_ACTION_IDS,
  REGULATORY_AUTHORITY_BOUNDARY,
  REGULATORY_OBSERVATION_CONTRACT,
  REGULATORY_OFFICIAL_SOURCES,
  REGULATORY_RESILIENCE_CONTRACT_VERSION,
  type RegulatoryScenarioId,
} from '../shared/regulatoryResilienceContract.ts';

interface BaseOperationsSnapshot {
  sequence: number;
  event_time: string;
  snapshot_hash: string;
  kpis: Record<string, number>;
  operationalTelemetry: {
    terminal: {
      arrivals: { value: number | null };
      effective_service_capacity: { value: number | null };
    };
  };
}

interface RegulatoryRuntimeState {
  maritimeHoldVessels: number;
  customsHoldVessels: number;
  releasedRecoveryVessels: number;
  cumulativeRegulatoryDelayMinutes: number;
  cumulativeIncrementalEnergyKwh: number;
  cumulativeIncrementalCarbonKg: number;
  cumulativeIncrementalCostMyr: number;
}

interface RegulatoryReport {
  status: string;
  selectedSeed: number;
  protocol: { seeds: number[]; episodesPerSeed: number; observationCount: number; supplementalActionCount: number };
  finalTest: {
    delta: Record<string, number>;
    costReductionCi95: { lower95Percent: number; upper95Percent: number; pairedRows: number };
  };
  evidenceSha256: string;
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const deterministicUnit = (sequence: number, salt: string) => {
  const digest = createHash('sha256').update(`${sequence}:${salt}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
};

const loadReport = () => JSON.parse(readFileSync(
  path.resolve('reports/regulatory-resilience-v2.json'),
  'utf8',
)) as RegulatoryReport;

const scenarioParameters = (scenario: RegulatoryScenarioId, sequence: number) => {
  const jitter = deterministicUnit(sequence, scenario);
  if (scenario === 'maritime-inspection') return {
    maritimeInspectionRatio: 0.24 + jitter * 0.12,
    customsInspectionRatio: 0.02 + jitter * 0.02,
    maritimeReleaseRatio: 0.12 + jitter * 0.1,
    customsReleaseRatio: 0.36 + jitter * 0.14,
    documentReadinessRatio: 0.78,
    resourceAvailableRatio: 0.64,
    expectedHoldHours: 30 + jitter * 24,
  };
  if (scenario === 'customs-document-hold') return {
    maritimeInspectionRatio: 0.018 + jitter * 0.014,
    customsInspectionRatio: 0.3 + jitter * 0.12,
    maritimeReleaseRatio: 0.38 + jitter * 0.14,
    customsReleaseRatio: 0.1 + jitter * 0.09,
    documentReadinessRatio: 0.54,
    resourceAvailableRatio: 0.62,
    expectedHoldHours: 38 + jitter * 34,
  };
  if (scenario === 'dual-inspection-recovery') return {
    maritimeInspectionRatio: 0.2 + jitter * 0.1,
    customsInspectionRatio: 0.25 + jitter * 0.11,
    maritimeReleaseRatio: 0.16 + jitter * 0.1,
    customsReleaseRatio: 0.14 + jitter * 0.09,
    documentReadinessRatio: 0.66,
    resourceAvailableRatio: 0.56,
    expectedHoldHours: 44 + jitter * 40,
  };
  return {
    maritimeInspectionRatio: 0.012 + jitter * 0.012,
    customsInspectionRatio: 0.018 + jitter * 0.016,
    maritimeReleaseRatio: 0.42 + jitter * 0.2,
    customsReleaseRatio: 0.34 + jitter * 0.18,
    documentReadinessRatio: 0.9,
    resourceAvailableRatio: 0.86,
    expectedHoldHours: 8 + jitter * 18,
  };
};

export class RegulatoryResilienceRuntime {
  private scenario: RegulatoryScenarioId = 'baseline';
  private lastSequence = -1;
  private scenarioDirty = true;
  private readonly report = loadReport();
  private state: RegulatoryRuntimeState = {
    maritimeHoldVessels: 0,
    customsHoldVessels: 0,
    releasedRecoveryVessels: 0,
    cumulativeRegulatoryDelayMinutes: 0,
    cumulativeIncrementalEnergyKwh: 0,
    cumulativeIncrementalCarbonKg: 0,
    cumulativeIncrementalCostMyr: 0,
  };
  private latestImpact = {
    regulatoryDelayMinutes: 0,
    incrementalEnergyKwh: 0,
    incrementalCarbonKg: 0,
    incrementalCostMyr: 0,
    processedRecoveryVessels: 0,
    maritimeInspectedVessels: 0,
    customsInspectedVessels: 0,
    officialReleasedVessels: 0,
  };

  setScenario(scenario: RegulatoryScenarioId) {
    this.scenario = scenario;
    this.scenarioDirty = true;
  }

  private step(sequence: number, arrivals: number, capacity: number) {
    const parameters = scenarioParameters(this.scenario, sequence);
    const maritimeInspectedVessels = arrivals * parameters.maritimeInspectionRatio;
    const customsInspectedVessels = arrivals * parameters.customsInspectionRatio;
    const maritimeBeforeRelease = this.state.maritimeHoldVessels + maritimeInspectedVessels;
    const customsBeforeRelease = this.state.customsHoldVessels + customsInspectedVessels;
    const maritimeReleased = maritimeBeforeRelease * parameters.maritimeReleaseRatio;
    const customsReleased = customsBeforeRelease * parameters.customsReleaseRatio;
    this.state.maritimeHoldVessels = Math.max(0, maritimeBeforeRelease - maritimeReleased);
    this.state.customsHoldVessels = Math.max(0, customsBeforeRelease - customsReleased);
    const releasedBeforeRecovery = this.state.releasedRecoveryVessels + maritimeReleased + customsReleased;

    // Offline-qualified v2 selects readiness=0.5/recovery=0.6. This supplement
    // never alters inspection or release; it only consumes already released work.
    const readinessRatio = 0.5;
    const recoveryPriorityRatio = 0.6;
    const processedRecoveryVessels = Math.min(
      releasedBeforeRecovery,
      capacity * 0.18 * parameters.resourceAvailableRatio * recoveryPriorityRatio,
    );
    this.state.releasedRecoveryVessels = Math.max(0, releasedBeforeRecovery - processedRecoveryVessels);
    const totalBacklog = this.state.maritimeHoldVessels
      + this.state.customsHoldVessels
      + this.state.releasedRecoveryVessels;
    const regulatoryDelayMinutes = totalBacklog / Math.max(0.5, capacity) * 15;
    const incrementalEnergyKwh = (this.state.maritimeHoldVessels + this.state.customsHoldVessels) * 1.45
      + capacity * readinessRatio * 3.8
      + processedRecoveryVessels * 8.2;
    const carbonFactorKgKwh = 0.54 + deterministicUnit(sequence, 'carbon') * 0.08;
    const electricityPriceMyrKwh = 0.38 + deterministicUnit(sequence, 'price') * 0.2;
    const incrementalCarbonKg = incrementalEnergyKwh * carbonFactorKgKwh;
    const incrementalCostMyr = incrementalEnergyKwh * electricityPriceMyrKwh + regulatoryDelayMinutes * 0.8;
    this.state.cumulativeRegulatoryDelayMinutes += regulatoryDelayMinutes;
    this.state.cumulativeIncrementalEnergyKwh += incrementalEnergyKwh;
    this.state.cumulativeIncrementalCarbonKg += incrementalCarbonKg;
    this.state.cumulativeIncrementalCostMyr += incrementalCostMyr;
    this.latestImpact = {
      regulatoryDelayMinutes,
      incrementalEnergyKwh,
      incrementalCarbonKg,
      incrementalCostMyr,
      processedRecoveryVessels,
      maritimeInspectedVessels,
      customsInspectedVessels,
      officialReleasedVessels: maritimeReleased + customsReleased,
    };
    return parameters;
  }

  snapshot(base: BaseOperationsSnapshot) {
    const arrivals = Number(base.operationalTelemetry.terminal.arrivals.value ?? 0);
    const capacity = Number(base.operationalTelemetry.terminal.effective_service_capacity.value ?? 1);
    let parameters = scenarioParameters(this.scenario, base.sequence);
    const shouldForceCurrent = this.scenarioDirty || this.lastSequence < 0;
    if (shouldForceCurrent) {
      parameters = this.step(base.sequence, arrivals, capacity);
    } else if (base.sequence > this.lastSequence) {
      const boundedStart = Math.max(this.lastSequence + 1, base.sequence - 191);
      for (let sequence = boundedStart; sequence <= base.sequence; sequence += 1) {
        parameters = this.step(sequence, arrivals, capacity);
      }
    }
    this.lastSequence = base.sequence;
    this.scenarioDirty = false;
    const state = Object.fromEntries(Object.entries(this.state).map(([key, value]) => [key, round(value)]));
    const impact = Object.fromEntries(Object.entries(this.latestImpact).map(([key, value]) => [key, round(value)]));
    const responseCore = {
      protocolVersion: REGULATORY_RESILIENCE_CONTRACT_VERSION,
      sequence: base.sequence,
      eventTime: base.event_time,
      scenario: this.scenario,
      inputSnapshotHash: base.snapshot_hash,
      authority: REGULATORY_AUTHORITY_BOUNDARY,
      observationContract: REGULATORY_OBSERVATION_CONTRACT,
      state,
      exogenousSignals: {
        maritimeInspectionRatio: round(parameters.maritimeInspectionRatio, 4),
        customsInspectionRatio: round(parameters.customsInspectionRatio, 4),
        maritimeReleaseRatio: round(parameters.maritimeReleaseRatio, 4),
        customsReleaseRatio: round(parameters.customsReleaseRatio, 4),
        documentReadinessRatio: round(parameters.documentReadinessRatio, 4),
        inspectionResourceAvailableRatio: round(parameters.resourceAvailableRatio, 4),
        expectedHoldHours: round(parameters.expectedHoldHours, 2),
      },
      impact,
      strategy: {
        id: 'regulatory-incremental-q-with-dominance-projection-v2',
        status: this.report.status,
        inspectionReadinessRatio: 0.5,
        postReleaseRecoveryPriorityRatio: 0.6,
        preservedOperationalActions: PRESERVED_OPERATIONAL_ACTION_IDS,
        selectedSeed: this.report.selectedSeed,
        training: {
          seeds: this.report.protocol.seeds,
          episodesPerSeed: this.report.protocol.episodesPerSeed,
          rendering: false,
        },
      },
      businessEvidence: {
        ...this.report.finalTest.delta,
        costReductionCi95: this.report.finalTest.costReductionCi95,
        evidenceSha256: this.report.evidenceSha256,
        blockedCandidateArtifact: 'reports/regulatory-resilience-v1.json',
        qualifiedCandidateArtifact: 'reports/regulatory-resilience-v2.json',
        scope: 'offline predeclared regulatory stress scenario; not field KPI',
      },
      sources: REGULATORY_OFFICIAL_SOURCES,
      lineage: {
        scenarioFields: 'engineering_derived',
        inspectionTelemetryMeasured: false,
        reportArtifact: 'reports/regulatory-resilience-v2.json',
      },
    };
    return {
      ...responseCore,
      responseHash: hash(responseCore),
      generatedAt: new Date().toISOString(),
    };
  }
}

export const REGULATORY_SCENARIOS: RegulatoryScenarioId[] = [
  'baseline',
  'maritime-inspection',
  'customs-document-hold',
  'dual-inspection-recovery',
];

export type { RegulatoryScenarioId };
