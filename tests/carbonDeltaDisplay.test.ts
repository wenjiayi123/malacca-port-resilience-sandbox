import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCarbonDeltaTons } from '../src/ui/formatCarbonDelta.ts';

test('native carbon displays retain small signed deltas, normalize rounded zero and keep ordinary precision', () => {
  assert.equal(formatCarbonDeltaTons(-0.0002), '-0.0002');
  assert.equal(formatCarbonDeltaTons(0.0002), '0.0002');
  assert.equal(formatCarbonDeltaTons(0.0002, true), '+0.0002');
  assert.equal(formatCarbonDeltaTons(-0.00004), '0.0');
  assert.equal(formatCarbonDeltaTons(0.00004, true), '0.0');
  assert.equal(formatCarbonDeltaTons(-0), '0.0');
  assert.equal(formatCarbonDeltaTons(-0.012), '-0.012');
  assert.equal(formatCarbonDeltaTons(-1.24), '-1.2');
  assert.equal(formatCarbonDeltaTons(1.24, true), '+1.2');
  assert.equal(formatCarbonDeltaTons(2), '2.0');
});
