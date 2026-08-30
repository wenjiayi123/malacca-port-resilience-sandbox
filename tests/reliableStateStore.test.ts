import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DurableStateStore,
  FileFencedLease,
  assessReliabilityReadiness,
} from '../server/reliableStateStore.ts';

test('durable store atomically versions state and verifies its hash journal', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'durable-state-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DurableStateStore<{ value: number }>({ directory, storeID: 'test.store' });
  const first = store.commit({ value: 1 }, 0);
  const second = store.commit({ value: 2 }, first.generation);
  assert.equal(second.generation, 2);
  assert.equal(second.previousStateSha256, first.envelopeSha256);
  assert.deepEqual(store.load().envelope?.payload, { value: 2 });
  assert.equal(store.verifyJournal().verified, true);
  assert.equal(store.verifyJournal().recordCount, 2);
  assert.throws(() => store.commit({ value: 3 }, 1), /state_generation_conflict/);
});

test('corrupt primary state fails over to the independently checksummed previous generation', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'durable-recovery-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const store = new DurableStateStore<{ marker: string }>({ directory, storeID: 'recovery.store' });
  store.commit({ marker: 'first' }, 0);
  store.commit({ marker: 'second' }, 1);
  await writeFile(store.primaryFile, '{"corrupt":true}\n', 'utf8');
  const loaded = store.load();
  assert.equal(loaded.found, true);
  assert.equal(loaded.source, 'previous');
  assert.equal(loaded.envelope?.payload.marker, 'first');
  assert.ok(loaded.recoveryErrors.some((error) => error.startsWith('primary:')));
  const recovery = store.disasterRecoveryCheck();
  assert.equal(recovery.stateRecoverable, true);
  assert.equal(recovery.recoveredFrom, 'previous');
  assert.equal(recovery.journalVerified, true);
  assert.equal(recovery.rawRestorePayloadReleased, false);
});

test('fencing numbers stop a stale leader from writing after lease turnover', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fenced-lease-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  let now = new Date('2026-08-30T08:00:00.000Z');
  const lease = new FileFencedLease(directory, () => now);
  const first = lease.acquire('node.primary', 5);
  assert.equal(lease.assertCurrent(first), true);
  assert.throws(() => lease.acquire('node.secondary', 5), /leader_lease_held/);
  now = new Date('2026-08-30T08:00:06.000Z');
  const second = lease.acquire('node.secondary', 5);
  assert.ok(second.fencingNumber > first.fencingNumber);
  assert.throws(() => lease.assertCurrent(first), /stale_fencing_token/);
  assert.equal(lease.assertCurrent(second), true);
});

test('reliability readiness separates local software controls from observed site SLO evidence', () => {
  const result = assessReliabilityReadiness({
    replicaCount: 1,
    backupAgeMinutes: 5,
    restoreDrillAgeDays: 10,
    restoreDrillPassed: true,
    journalVerified: true,
    alertRouteTested: true,
    runbookReviewed: true,
    observedAvailabilityDays: 0,
    observedAvailabilityPercent: 0,
  });
  assert.equal(result.softwareControlsReady, true);
  assert.equal(result.siteReliabilityAccepted, false);
  assert.ok(result.blockers.includes('redundant_replica_missing'));
  assert.ok(result.blockers.includes('availability_slo_not_evidenced'));
  assert.equal(result.authority.productionAuthority, false);
});
