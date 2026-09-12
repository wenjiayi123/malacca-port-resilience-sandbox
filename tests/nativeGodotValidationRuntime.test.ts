import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NativeGodotValidationController } from '../src/hooks/useNativeGodotValidation.ts';
import type { NativeGodotJob } from '../src/integrations/nativeGodotValidationAdapter.ts';
import type { GodotValidationRequest, GodotValidationResult } from '../src/types/sandbox.ts';

const fixture = JSON.parse(await readFile('docs/godot_validation_request.example.json', 'utf8')) as GodotValidationRequest;
const result = JSON.parse(await readFile('docs/godot_validation_result.example.json', 'utf8')) as GodotValidationResult;
const job = (patch: Partial<NativeGodotJob> = {}): NativeGodotJob => ({ id: 'native-owned', requestId: fixture.requestId, vesselId: fixture.vesselId, status: 'running', createdAt: fixture.createdAt, updatedAt: fixture.createdAt, windowOpen: true, ...patch });
const flush = async () => { for (let count = 0; count < 8; count++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const harness = () => {
  let request: GodotValidationRequest | null = { ...fixture };
  const results: GodotValidationResult[] = [];
  const cancelled: string[] = [];
  let creates = 0;
  let token = '';
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock = {
    setTimeout: ((callback: () => void, milliseconds = 0) => { const id = ++timerId; timers.set(id, { at: now + milliseconds, callback }); return id; }) as unknown as typeof setTimeout,
    clearTimeout: ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout,
  };
  const transport = {
    availability: async () => ({ available: true, mode: 'native' as const, message: 'ready', activeJobId: 'somebody-else' }),
    create: async (request: GodotValidationRequest) => { void request; creates++; return job(); },
    read: async (id: string, signal?: AbortSignal) => { void id; void signal; return job(); },
    cancel: async (id: string) => { cancelled.push(id); return job({ id, status: 'cancelled', windowOpen: false }); },
  };
  const controller = new NativeGodotValidationController(() => request, (value) => results.push(value), transport, clock, () => token);
  controller.subscribe(() => {});
  return {
    controller, transport, cancelled, results,
    get creates() { return creates; },
    setToken(value: string) { token = value; },
    changeRequest(value: GodotValidationRequest | null, synchronize = true) { request = value; if (synchronize) controller.syncRequest(); },
    async advance(milliseconds: number) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
      }
      now = end; await flush();
    },
  };
};

test('native controller prevents double POST, polls once a second and awaits one genuine terminal result', async () => {
  const h = harness();
  let finished = false;
  const pending = h.controller.start().then(() => { finished = true; });
  void h.controller.start();
  await flush();
  assert.equal(h.creates, 1); assert.equal(finished, false); assert.equal(h.controller.state.busy, true);
  h.transport.read = async () => job({ status: 'completed', result });
  await h.advance(999); assert.equal(h.results.length, 0);
  await h.advance(1); await pending;
  assert.equal(h.results.length, 1); assert.equal(finished, true); assert.equal(h.controller.state.busy, false);
  assert.equal(h.controller.state.job?.windowOpen, true); assert.deepEqual(h.cancelled, []);
  await h.advance(10_000); assert.equal(h.results.length, 1);
});

test('native physics failure is completed evidence while launch failure is an infrastructure error', async () => {
  const h = harness();
  h.transport.create = async () => job({ status: 'completed', result: { ...result, status: 'failed', safePass: false } });
  await h.controller.start();
  assert.equal(h.results[0].status, 'failed'); assert.equal(h.controller.state.error, '');
  h.transport.create = async () => job({ status: 'failed', error: 'Cannot execute Godot' });
  await h.controller.start();
  assert.equal(h.results.length, 1); assert.match(h.controller.state.error, /Cannot execute Godot/);
});

test('missing or unavailable native support never submits or silently falls back to Web', async () => {
  const h = harness();
  h.changeRequest(null);
  await h.controller.start(); assert.match(h.controller.state.error, /先生成/);
  h.changeRequest(fixture);
  h.transport.availability = async () => ({ available: false, mode: 'native', message: 'Godot unavailable', activeJobId: 'somebody-else' });
  await h.controller.start();
  assert.equal(h.creates, 0); assert.match(h.controller.state.error, /Godot unavailable/); assert.deepEqual(h.cancelled, []);
});

test('request switch cancels only the owned active job, rejects late results even before effect synchronization', async () => {
  const h = harness();
  const pendingRead = deferred<NativeGodotJob>();
  h.transport.read = async () => pendingRead.promise;
  const pending = h.controller.start(); await flush(); await h.advance(1000);
  h.changeRequest({ ...fixture, requestId: 'next-request' }, false);
  pendingRead.resolve(job({ status: 'completed', result })); await flush();
  assert.equal(h.results.length, 0);
  h.controller.syncRequest(); await pending; await flush();
  assert.ok(h.cancelled.length >= 1); assert.ok(h.cancelled.every((id) => id === 'native-owned'));
  assert.equal(h.controller.state.job, null);
});

test('late creation after reset is closed, including an already-completed window, and never imported', async () => {
  for (const terminal of [false, true]) {
    const h = harness();
    const creation = deferred<NativeGodotJob>();
    h.transport.create = async () => creation.promise;
    const pending = h.controller.start(); await flush();
    h.changeRequest(null);
    creation.resolve(job(terminal ? { status: 'completed', result } : {}));
    await pending; await flush();
    assert.deepEqual(h.cancelled, ['native-owned']); assert.deepEqual(h.results, []); assert.equal(h.controller.state.job, null);
  }
});

test('unmount cancels an owned running job but preserves a completed visible window', async () => {
  const running = harness();
  const pending = running.controller.start(); await flush(); running.controller.dispose(); await pending; await flush();
  assert.deepEqual(running.cancelled, ['native-owned']);
  const done = harness(); done.transport.create = async () => job({ status: 'completed', result });
  await done.controller.start(); done.controller.dispose(); await flush();
  assert.deepEqual(done.cancelled, []);
});

test('closing a completed window retains its completed result without a second callback', async () => {
  const h = harness(); h.transport.create = async () => job({ status: 'completed', result });
  await h.controller.start(); await h.controller.cancel();
  assert.equal(h.controller.state.job?.status, 'completed'); assert.equal(h.controller.state.job?.result, result);
  assert.equal(h.controller.state.job?.windowOpen, false); assert.equal(h.results.length, 1);
});

test('a late cancel acknowledgement cannot restore an old job after the request changes', async () => {
  const h = harness(); h.transport.create = async () => job({ status: 'completed', result });
  await h.controller.start();
  const closing = deferred<NativeGodotJob>(); h.transport.cancel = async () => closing.promise;
  const pending = h.controller.cancel(); assert.equal(h.controller.state.busy, true);
  h.changeRequest({ ...fixture, requestId: 'new' }); assert.equal(h.controller.state.busy, true);
  closing.resolve(job({ status: 'completed', result, windowOpen: false })); await pending;
  assert.equal(h.controller.state.job, null);
  assert.equal(h.controller.state.busy, false);
});

test('native wait stops at 120 seconds and rejects results arriving after the deadline', async () => {
  const h = harness(); const read = deferred<NativeGodotJob>(); h.transport.read = async () => read.promise;
  const pending = h.controller.start(); await flush(); await h.advance(120_000); await pending;
  assert.equal(h.controller.state.busy, false); assert.match(h.controller.state.error, /120 秒/);
  assert.deepEqual(h.cancelled, ['native-owned']);
  read.resolve(job({ status: 'completed', result })); await flush(); assert.equal(h.results.length, 0);
});

test('wrong job identity and malformed native results never reach the App callback', async () => {
  for (const value of [job({ requestId: 'wrong' }), job({ vesselId: 'wrong' }), job({ status: 'completed', result: { ...result, requestId: 'wrong' } })]) {
    const h = harness(); h.transport.create = async () => value;
    await h.controller.start(); assert.equal(h.results.length, 0); assert.match(h.controller.state.error, /不匹配/);
    assert.deepEqual(h.cancelled, []);
  }
});

test('a foreign job returned by polling is rejected and only the owned job is cancelled', async () => {
  const h = harness(); h.transport.read = async () => job({ id: 'foreign-job' });
  const pending = h.controller.start(); await flush(); await h.advance(1000); await pending;
  assert.equal(h.results.length, 0); assert.match(h.controller.state.error, /不匹配/);
  assert.deepEqual(h.cancelled, ['native-owned']);
});

test('poll failure cancels only this run and gives an actionable error', async () => {
  const h = harness(); h.transport.read = async () => { throw new Error('HTTP 503 local runtime stopped'); };
  const pending = h.controller.start(); await flush(); await h.advance(1000); await pending;
  assert.equal(h.controller.state.busy, false); assert.match(h.controller.state.error, /HTTP 503/);
  assert.deepEqual(h.cancelled, ['native-owned']); assert.equal(h.results.length, 0);
});

test('a token change does not replace the credential needed to poll and close an owned job', async () => {
  const h = harness(); const calls: Array<{ operation: string; token?: string }> = [];
  h.setToken('token-at-start');
  h.transport.availability = async (...args: Parameters<typeof import('../src/integrations/nativeGodotValidationAdapter.ts').fetchNativeGodotAvailability>) => {
    calls.push({ operation: 'availability', token: args[1] });
    return { available: true, mode: 'native', message: 'ready', activeJobId: 'other' };
  };
  h.transport.create = async (...args: Parameters<typeof import('../src/integrations/nativeGodotValidationAdapter.ts').createNativeGodotValidation>) => { calls.push({ operation: 'create', token: args[2] }); return job(); };
  h.transport.read = async (...args: Parameters<typeof import('../src/integrations/nativeGodotValidationAdapter.ts').fetchNativeGodotValidation>) => { calls.push({ operation: 'read', token: args[2] }); return job(); };
  h.transport.cancel = async (...args: Parameters<typeof import('../src/integrations/nativeGodotValidationAdapter.ts').cancelNativeGodotValidation>) => { calls.push({ operation: 'cancel', token: args[2] }); return job({ status: 'cancelled', windowOpen: false }); };
  const pending = h.controller.start(); await flush();
  h.setToken('replacement-token'); await h.controller.refreshAvailability(); await h.advance(1000); await h.controller.cancel(); await pending;
  assert.deepEqual(calls, [
    { operation: 'availability', token: 'token-at-start' }, { operation: 'create', token: 'token-at-start' },
    { operation: 'availability', token: 'replacement-token' }, { operation: 'read', token: 'token-at-start' },
    { operation: 'cancel', token: 'token-at-start' },
  ]);
});

test('a completed job already closed reports the real window state and needs no monitor', async () => {
  const h = harness(); let reads = 0;
  h.transport.create = async () => job({ status: 'completed', result, windowOpen: false });
  h.transport.read = async () => { reads++; return job({ status: 'completed', result }); };
  await h.controller.start(); await h.advance(60_000);
  assert.match(h.controller.state.message, /窗口已关闭/);
  assert.equal(h.controller.state.job?.windowOpen, false);
  assert.equal(h.controller.state.busy, false); assert.equal(h.results.length, 1); assert.equal(reads, 0);
});

test('completed window monitoring notices the native X button without re-importing or changing settled evidence', async () => {
  const h = harness(); let reads = 0;
  h.transport.create = async () => job({ status: 'completed', result });
  h.transport.read = async () => { reads++; return job({ status: 'completed', result: { ...result, averageSpeedKnots: 99 }, windowOpen: false }); };
  await h.controller.start();
  await h.advance(4999); assert.equal(reads, 0); assert.equal(h.controller.state.busy, false);
  await h.advance(1);
  assert.equal(reads, 1); assert.equal(h.controller.state.job?.windowOpen, false);
  assert.match(h.controller.state.message, /窗口已关闭/);
  assert.equal(h.controller.state.job?.result, result); assert.equal(h.results.length, 1);
  await h.advance(60_000); assert.equal(reads, 1); assert.deepEqual(h.cancelled, []);
});

test('window-monitor errors preserve completed results, recover when possible, and stop after three failures', async () => {
  const recover = harness();
  recover.transport.create = async () => job({ status: 'completed', result });
  recover.transport.read = async () => { throw new Error('status endpoint unavailable'); };
  await recover.controller.start(); await recover.advance(5000);
  assert.equal(recover.controller.state.job?.status, 'completed'); assert.equal(recover.controller.state.job?.result, result);
  assert.equal(recover.controller.state.busy, false); assert.equal(recover.results.length, 1);
  assert.match(recover.controller.state.message, /验证结果已保留/);
  recover.transport.read = async () => job({ status: 'completed', result, windowOpen: false });
  await recover.advance(5000);
  assert.equal(recover.controller.state.error, ''); assert.equal(recover.controller.state.job?.windowOpen, false);
  assert.deepEqual(recover.cancelled, []);

  const stop = harness(); let reads = 0;
  stop.transport.create = async () => job({ status: 'completed', result });
  stop.transport.read = async () => { reads++; throw new Error('status endpoint unavailable'); };
  await stop.controller.start(); await stop.advance(15_000);
  assert.equal(reads, 3); assert.match(stop.controller.state.message, /监测已停止/);
  await stop.advance(30 * 60_000); assert.equal(reads, 3);
  assert.equal(stop.controller.state.job?.result, result); assert.equal(stop.results.length, 1); assert.deepEqual(stop.cancelled, []);
});

test('completed window monitoring has a 30-minute deadline and ignores a late response after it', async () => {
  const h = harness(); const read = deferred<NativeGodotJob>(); let reads = 0;
  h.transport.create = async () => job({ status: 'completed', result });
  h.transport.read = async () => { reads++; return read.promise; };
  await h.controller.start(); await h.advance(30 * 60_000);
  assert.equal(reads, 1); assert.match(h.controller.state.message, /监测已结束/);
  read.resolve(job({ status: 'completed', result, windowOpen: false })); await flush();
  assert.equal(h.controller.state.job?.windowOpen, true); assert.match(h.controller.state.message, /监测已结束/);
  await h.advance(60_000); assert.equal(reads, 1); assert.equal(h.results.length, 1); assert.equal(h.controller.state.busy, false);
});

test('cancel, request switch, restart, and dispose abort completed-window monitoring without stale updates', async () => {
  for (const operation of ['cancel', 'switch', 'restart', 'dispose']) {
    const h = harness(); const read = deferred<NativeGodotJob>(); let reads = 0;
    h.transport.create = async () => job({ status: 'completed', result });
    h.transport.read = async () => { reads++; return read.promise; };
    await h.controller.start(); await h.advance(5000);
    if (operation === 'cancel') await h.controller.cancel();
    if (operation === 'switch') h.changeRequest({ ...fixture, requestId: 'new-request' });
    if (operation === 'restart') {
      h.transport.create = async () => job({ id: 'next-owned', status: 'completed', result, windowOpen: false });
      await h.controller.start();
    }
    if (operation === 'dispose') h.controller.dispose();
    const stateBeforeLateRead = h.controller.state;
    read.resolve(job({ status: 'completed', result, windowOpen: false })); await flush(); await h.advance(60_000);
    assert.equal(h.controller.state, stateBeforeLateRead, operation);
    assert.equal(reads, 1, operation);
    assert.equal(h.results.length, operation === 'restart' ? 2 : 1, operation);
    assert.deepEqual(h.cancelled, operation === 'cancel' ? ['native-owned'] : [], operation);
  }
});
