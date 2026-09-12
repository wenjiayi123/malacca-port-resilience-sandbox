import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  cancelNativeGodotValidation, createNativeGodotValidation, fetchNativeGodotAvailability,
  fetchNativeGodotValidation, isNativeGodotJob,
} from '../src/integrations/nativeGodotValidationAdapter.ts';
import type { GodotValidationRequest, GodotValidationResult } from '../src/types/sandbox.ts';

const request = JSON.parse(await readFile('docs/godot_validation_request.example.json', 'utf8')) as GodotValidationRequest;
const result = JSON.parse(await readFile('docs/godot_validation_result.example.json', 'utf8')) as GodotValidationResult;
const job = { id: 'native-1', requestId: request.requestId, vesselId: request.vesselId, status: 'completed', createdAt: request.createdAt, updatedAt: request.createdAt, windowOpen: true, result };

test('native endpoints submit the complete request once and encode only the owned job id', async (context) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(String(url).endsWith('/status') ? { available: true, mode: 'native', message: 'ready' } : job, { status: init?.body ? 202 : 200 });
  };
  assert.equal((await fetchNativeGodotAvailability(undefined, 'test-native-token')).available, true);
  assert.equal((await createNativeGodotValidation(request, undefined, 'test-native-token')).id, job.id);
  await fetchNativeGodotValidation('native/a', undefined, 'test-native-token');
  await cancelNativeGodotValidation('native/a', undefined, 'test-native-token');
  assert.deepEqual(calls.map((call) => call.url), ['/api/godot/native/status', '/api/godot/native/validations', '/api/godot/native/validations/native%2Fa', '/api/godot/native/validations/native%2Fa/cancel']);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), request);
  assert.equal(calls[1].init?.method, 'POST');
  assert.equal(calls[3].init?.method, 'POST');
  assert.ok(calls.every((call) => new Headers(call.init?.headers).get('Authorization') === 'Bearer test-native-token'));
  assert.ok(!String(calls[1].init?.body).includes('test-native-token'));
});

test('completed native jobs preserve genuine failed or degraded physics results and reject malformed results', () => {
  for (const status of ['passed', 'failed', 'degraded'] as const) {
    assert.equal(isNativeGodotJob({ ...job, result: { ...result, status, safePass: status === 'passed' } }), true);
  }
  for (const invalid of [
    { ...job, result: undefined }, { ...job, result: { ...result, requestId: 'other' } },
    { ...job, result: { ...result, vesselId: 'other' } }, { ...job, result: { ...result, status: 'running' } },
    { ...job, result: { ...result, averageSpeedKnots: '12' } }, { ...job, windowOpen: 'true' },
    { ...job, createdAt: 'bad-date' }, { ...job, status: 'unknown' },
  ]) assert.equal(isNativeGodotJob(invalid), false);
  assert.equal(isNativeGodotJob({ ...job, status: 'failed', result: undefined, error: 'Godot executable missing' }), true);
});

test('native adapter displays backend errors and rejects SPA fallback or unsupported status', async (context) => {
  const original = globalThis.fetch;
  context.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ error: 'LOCAL_GODOT_UNAVAILABLE' }, { status: 503 });
  await assert.rejects(createNativeGodotValidation(request), /HTTP 503.*LOCAL_GODOT_UNAVAILABLE/);
  globalThis.fetch = async () => new Response('<html>SPA fallback</html>');
  await assert.rejects(fetchNativeGodotAvailability(), /非 JSON/);
  globalThis.fetch = async () => Response.json({ available: true, mode: 'web', message: 'fallback' });
  await assert.rejects(fetchNativeGodotAvailability(), /不支持本地独立模拟器/);
  globalThis.fetch = async () => Response.json({ ...job, result: { ...result, safePass: 'yes' } });
  await assert.rejects(fetchNativeGodotValidation(job.id), /格式无效/);
});

test('native transport has a bounded eight-second timeout and preserves caller cancellation', async (context) => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  const delays: number[] = [];
  context.after(() => { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; });
  AbortSignal.timeout = (milliseconds) => { delays.push(milliseconds); return originalTimeout(15); };
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'));
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
  });
  const keepAlive = setTimeout(() => {}, 100);
  context.after(() => clearTimeout(keepAlive));
  await assert.rejects(fetchNativeGodotAvailability(), /8 秒内未响应/);
  const controller = new AbortController();
  const pending = fetchNativeGodotAvailability(controller.signal);
  controller.abort();
  await assert.rejects(pending, /已取消/);
  assert.deepEqual(delays, [8000, 8000]);
});
