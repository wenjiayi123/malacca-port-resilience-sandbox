import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assessOperatorSourceManifest,
  parseOperatorSourceManifest,
} from '../server/operatorSourceManifest.ts';
import { FIXTURE_NOW, fixtureManifest } from '../scripts/integration/operatorDataFixture.ts';

test('checked-in operator source template parses but remains fail-closed', () => {
  const value = JSON.parse(readFileSync('config/port-profiles/operator-data-source.example.json', 'utf8'));
  const readiness = assessOperatorSourceManifest(parseOperatorSourceManifest(value), FIXTURE_NOW);
  assert.equal(readiness.authorizationReady, false);
  assert.ok(readiness.blockers.includes('operator_authorization_not_declared'));
  assert.ok(readiness.blockers.includes('site_placeholders_present'));
  assert.equal(readiness.missingAdapters.length, 0);
});

test('fully reviewed test manifest reaches only the operator authorization gate', () => {
  const readiness = assessOperatorSourceManifest(fixtureManifest, FIXTURE_NOW);
  assert.equal(readiness.authorizationReady, true);
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.missingAdapters.length, 0);
});

test('manifest rejects duplicate adapters and writable purposes', () => {
  const duplicate = structuredClone(fixtureManifest) as unknown as Record<string, unknown>;
  duplicate.adapters = [
    ...(duplicate.adapters as unknown[]),
    structuredClone((duplicate.adapters as unknown[])[0]),
  ];
  assert.throws(() => parseOperatorSourceManifest(duplicate), /不得包含重复/);

  const writable = structuredClone(fixtureManifest) as unknown as Record<string, unknown>;
  (writable.authorization as Record<string, unknown>).permittedPurpose = 'dispatch';
  assert.throws(() => parseOperatorSourceManifest(writable), /read-only-shadow/);
});
