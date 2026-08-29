import assert from 'node:assert/strict';
import test from 'node:test';
import { RegulatoryResilienceRuntime } from '../server/regulatoryResilienceRuntime.ts';
import {
  PRESERVED_OPERATIONAL_ACTION_IDS,
  REGULATORY_AUTHORITY_BOUNDARY,
  REGULATORY_OBSERVATION_CONTRACT,
  REGULATORY_SUPPLEMENT_ACTIONS,
} from '../shared/regulatoryResilienceContract.ts';

const baseSnapshot = (sequence: number) => ({
  sequence,
  event_time: new Date(Date.parse('2026-01-01T00:00:00Z') + sequence * 15 * 60_000).toISOString(),
  snapshot_hash: String(sequence).padStart(64, 'a'),
  kpis: { queue_vessels: 12, delay_minutes: 36, energy_kwh: 2_400, carbon_tons: 1.2 },
  operationalTelemetry: {
    terminal: {
      arrivals: { value: 8 },
      effective_service_capacity: { value: 6 },
    },
  },
});

test('regulatory supplement is additive and preserves the original five actions', () => {
  assert.deepEqual(PRESERVED_OPERATIONAL_ACTION_IDS, [
    'hold-plan',
    'eco-speed',
    'arrival-window',
    'port-diversion',
    'capacity-control',
  ]);
  assert.equal(REGULATORY_OBSERVATION_CONTRACT.length, 12);
  assert.equal(REGULATORY_SUPPLEMENT_ACTIONS.length, 9);
  assert.equal(REGULATORY_AUTHORITY_BOUNDARY.official_release_exogenous, true);
  assert.equal(REGULATORY_AUTHORITY_BOUNDARY.production_authority, false);
});

test('regulatory holds propagate statefully and repeated reads do not create phantom ticks', () => {
  const runtime = new RegulatoryResilienceRuntime();
  const baseline = runtime.snapshot(baseSnapshot(10));
  const repeated = runtime.snapshot(baseSnapshot(10));
  assert.deepEqual(repeated.state, baseline.state);
  assert.deepEqual(repeated.impact, baseline.impact);

  runtime.setScenario('maritime-inspection');
  const inspected = runtime.snapshot(baseSnapshot(10));
  assert.equal(inspected.scenario, 'maritime-inspection');
  assert.ok(inspected.impact.maritimeInspectedVessels > baseline.impact.maritimeInspectedVessels);
  assert.ok(inspected.state.maritimeHoldVessels > baseline.state.maritimeHoldVessels);
  assert.equal(inspected.authority.inspection_selection_exogenous, true);
  assert.equal(inspected.authority.official_release_exogenous, true);
  assert.equal(inspected.authority.dispatch_allowed, false);

  runtime.setScenario('baseline');
  const recovering = runtime.snapshot(baseSnapshot(11));
  assert.ok(recovering.impact.officialReleasedVessels >= 0);
  assert.ok(recovering.impact.processedRecoveryVessels >= 0);
  assert.equal(recovering.strategy.preservedOperationalActions.length, 5);
  assert.equal(recovering.strategy.status, 'qualified_offline');
  assert.equal(recovering.businessEvidence.regulatoryDelayReductionPercent, 0);
  assert.equal(recovering.businessEvidence.expectedSafetyViolationChange, 0);
});
