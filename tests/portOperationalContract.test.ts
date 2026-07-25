import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessPortOperationalReadiness,
  PORT_OPERATIONAL_ACTIONS,
  PORT_OPERATIONAL_FIELDS,
  PORT_OPERATIONAL_OBSERVATIONS,
} from '../shared/portOperationalContract.ts';

test('terminal operations contract fails closed when Shanghai operational evidence is incomplete', () => {
  const readiness = assessPortOperationalReadiness([
    'port_id',
    'terminal_id',
    'timestamp',
    'arrivals',
    'gross_tonnage',
    'effective_service_capacity',
  ]);
  assert.equal(readiness.trainingReady, false);
  assert.ok(readiness.missingTrainingFields.includes('yard_occupancy_percent'));
  assert.equal(readiness.actions.find((action) => action.id === 'capacity-control')?.enabled, false);
  assert.equal(readiness.objectives.find((objective) => objective.id === 'weather-robustness')?.enabled, false);
});

test('complete terminal operations fields enable every shared algorithm action and objective', () => {
  const readiness = assessPortOperationalReadiness(
    PORT_OPERATIONAL_FIELDS.map((definition) => definition.field),
  );
  assert.equal(readiness.trainingReady, true);
  assert.equal(readiness.missingTrainingFields.length, 0);
  assert.ok(readiness.actions.every((action) => action.enabled));
  assert.ok(readiness.objectives.every((objective) => objective.enabled));
  assert.equal(readiness.actions.length, PORT_OPERATIONAL_ACTIONS.length);
  assert.ok(PORT_OPERATIONAL_OBSERVATIONS.includes('navigation_window_state'));
  assert.ok(PORT_OPERATIONAL_OBSERVATIONS.includes('yard_occupancy_percent'));
});
