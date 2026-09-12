import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { checkGodotWebExport, isGodotValidationResult } from '../src/integrations/godotValidationAdapter.ts';

const exportUrl = 'https://example.test/godot-simulator/index.html';
const config = { executable: 'index', fileSizes: { 'index.wasm': 128, 'index.pck': 256 } };
const exportHtml = (value: unknown = config) => `<!doctype html><script>const GODOT_CONFIG = ${JSON.stringify(value, null, 2)};\nconst engine = new Engine(GODOT_CONFIG);</script>`;
const artifacts: Record<string, Record<string, string>> = {
  js: { 'content-type': 'application/javascript', 'content-length': '64' },
  wasm: { 'content-type': 'application/wasm', 'content-length': '128' },
  pck: { 'content-type': 'application/octet-stream', 'content-length': '256' },
};

const validResult = JSON.parse(await readFile('docs/godot_validation_result.example.json', 'utf8')) as Record<string, unknown>;

test('Godot result validation accepts completed safe, degraded and failed outcomes with signed deltas', () => {
  assert.equal(isGodotValidationResult(validResult), true);
  assert.equal(isGodotValidationResult({ ...validResult, status: 'degraded', safePass: true, delayDeltaMinutes: -20, carbonDeltaTons: -1.4 }), true);
  assert.equal(isGodotValidationResult({ ...validResult, status: 'failed', safePass: false, collisionCount: 1, minClearanceMeters: -2 }), true);
});

test('Godot result validation rejects unfinished, malformed and internally inconsistent results', () => {
  for (const patch of [
    { requestId: 123 }, { vesselId: {} }, { summary: true }, { summary: '   ' },
    { status: 'pending' }, { status: 'running' }, { status: 'unknown' },
    { estimatedTravelMinutes: -1 }, { recommendedSpeedKnots: -1 }, { simulatedDurationSeconds: -1 },
    { averageSpeedKnots: '3' }, { minClearanceMeters: Infinity }, { carbonDeltaTons: NaN },
    { collisionCount: -1 }, { groundingCount: 0.5 }, { riskEventResolvedCount: Number.MAX_SAFE_INTEGER + 1 },
    { safePass: 'true' }, { reachedDestination: 1 }, { riskLevel: 'normal' },
    { status: 'passed', safePass: false }, { status: 'failed', safePass: true },
    { collisionCount: 1 }, { groundingCount: 1 },
    { loadedScene: null }, { loadedScene: [] }, { loadedScene: { routePointCount: -1, riskZoneCount: 0, temporaryObstacleCount: 0 } },
  ]) {
    assert.equal(isGodotValidationResult({ ...validResult, ...patch }), false, `accepted invalid result patch: ${JSON.stringify(patch)}`);
  }
  for (const value of [null, [], 42, 'result']) assert.equal(isGodotValidationResult(value), false);
});

test('Godot availability rejects an HTTP 200 SPA fallback without issuing asset requests', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response('<html><div id="root"></div><script src="/src/main.tsx"></script></html>'));
  assert.equal(await checkGodotWebExport(exportUrl), false);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('Godot availability checks a complete multiline export and all three declared core resources', async (context) => {
  const requested: Array<{ url: string; method: string | undefined }> = [];
  context.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    requested.push({ url, method: init?.method });
    const extension = url.split('.').at(-1)!;
    return new Response(extension === 'html' ? exportHtml() : null, { headers: artifacts[extension] });
  });
  assert.equal(await checkGodotWebExport(exportUrl), true);
  assert.deepEqual(requested, [
    { url: exportUrl, method: undefined },
    ...['js', 'wasm', 'pck'].map((extension) => ({ url: `https://example.test/godot-simulator/index.${extension}`, method: 'HEAD' })),
  ]);
});

test('Godot availability rejects missing, HTML fallback, empty and truncated artifact responses', async (context) => {
  let brokenAsset = 'wasm';
  let brokenResponse = new Response(null, { status: 404 });
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    const extension = url.split('.').at(-1)!;
    if (extension === 'html') return new Response(exportHtml());
    return extension === brokenAsset ? brokenResponse.clone() : new Response(null, { headers: artifacts[extension] });
  });
  for (const [extension, response] of [
    ['wasm', new Response(null, { status: 404 })],
    ['pck', new Response(null, { headers: { 'Content-Type': 'Text/HTML; charset=utf-8', 'Content-Length': '256' } })],
    ['js', new Response(null, { headers: { 'Content-Type': 'application/javascript', 'Content-Length': '0' } })],
    ['wasm', new Response(null, { headers: { 'Content-Type': 'application/wasm', 'Content-Length': '127' } })],
    ['pck', new Response(null, { headers: { 'Content-Length': '256' } })],
  ] as const) {
    brokenAsset = extension;
    brokenResponse = response;
    assert.equal(await checkGodotWebExport(exportUrl), false, `invalid ${extension} artifact was accepted`);
  }
});

test('Godot availability permits correctly typed compressed assets and rejects invalid export configurations', async (context) => {
  let html = exportHtml();
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    const extension = url.split('.').at(-1)!;
    if (extension === 'html') return new Response(html);
    return new Response(null, { headers: { ...artifacts[extension], 'content-length': '32', 'content-encoding': 'gzip' } });
  });
  assert.equal(await checkGodotWebExport(exportUrl), true);
  for (const value of [null, { executable: '../outside', fileSizes: config.fileSizes }, { executable: 'index' },
    { ...config, fileSizes: { 'index.wasm': 0, 'index.pck': 256 } }, { ...config, fileSizes: { 'index.wasm': '128', 'index.pck': 256 } }]) {
    html = exportHtml(value);
    assert.equal(await checkGodotWebExport(exportUrl), false);
  }
});

test('Godot availability bounds a real stalled HTTP request and preserves caller cancellation', async (context) => {
  const server = createServer(() => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/index.html`;
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const requestedTimeouts: number[] = [];
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    requestedTimeouts.push(milliseconds);
    return timeout(25);
  });
  await assert.rejects(checkGodotWebExport(url), { name: 'TimeoutError' });
  assert.deepEqual(requestedTimeouts, [8000]);
  const caller = new AbortController();
  caller.abort(new DOMException('closed Godot view', 'AbortError'));
  await assert.rejects(checkGodotWebExport(url, caller.signal), { name: 'AbortError', message: 'closed Godot view' });
});
