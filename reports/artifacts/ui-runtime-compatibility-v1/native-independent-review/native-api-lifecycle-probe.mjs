// Consolidated from the executed inline review snippets; paths are parameterized.
// Run from the repository root. The fixture executable must be a harmless true command.
import { isLocalNativeGodotRequest, createNativeGodotValidationMiddleware } from '../../../../server/nativeGodotValidationPlugin.ts';
import { NativeGodotValidationService, validateNativeGodotRequest } from '../../../../server/nativeGodotValidation.ts';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
const output = process.env.NATIVE_REVIEW_DIR;
const fixtureEngine = process.env.NATIVE_REVIEW_FIXTURE_ENGINE;
if (!output || !fixtureEngine) throw new Error('Set NATIVE_REVIEW_DIR and NATIVE_REVIEW_FIXTURE_ENGINE');
const fixture = JSON.parse(await readFile('scripts/demo/godot_web_coordinate_request.json', 'utf8'));
const cases = [
  ['same-origin-ip', '127.0.0.1', '127.0.0.1:4186', 'http://127.0.0.1:4186', 'same-origin', true],
  ['remote-socket', '10.0.0.2', '127.0.0.1:4186', 'http://127.0.0.1:4186', 'same-origin', false],
  ['dns-rebinding', '127.0.0.1', 'attacker.example:4186', 'http://attacker.example:4186', 'same-origin', false],
  ['foreign-origin', '127.0.0.1', '127.0.0.1:4186', 'http://attacker.example', 'cross-site', false],
  ['mismatched-port', '127.0.0.1', '127.0.0.1:4186', 'http://127.0.0.1:5174', 'same-site', false],
  ['null-origin', '127.0.0.1', '127.0.0.1:4186', 'null', 'same-origin', false],
  ['spoofed-host-credentials', '127.0.0.1', 'attacker@localhost:4186', null, null, false],
  ['loopback-ipv6', '::1', '[::1]:4186', 'http://[::1]:4186', 'same-origin', true],
  ['cli-loopback', '127.0.0.1', '127.0.0.1:4186', null, null, true],
];
const results = cases.map(([name, remoteAddress, host, origin, site, expected]) => {
  const actual = isLocalNativeGodotRequest({ socket: { remoteAddress }, headers: { host, ...(origin ? { origin } : {}), ...(site ? { 'sec-fetch-site': site } : {}) } });
  return { name, pass: actual === expected };
});
const sanitized = validateNativeGodotRequest({ ...fixture, enginePath: 'IGNORED_ENGINE_PATH', script: '--arbitrary', result: 'IGNORED_RESULT_PATH', endpoint: 'https://attacker.invalid' });
results.push({ name: 'caller-executable-path-url-discarded', pass: ['enginePath', 'script', 'result', 'endpoint'].every(key => !(key in sanitized)) });
for (const [name, changed] of [
  ['invalid-latitude', { origin: { ...fixture.origin, geo: { lat: 91, lon: 0 } } }],
  ['invalid-speed', { speedProfile: { ...fixture.speedProfile, maxSafeKnots: Infinity } }],
  ['invalid-progress', { progressPercent: -1 }],
]) {
  let rejected = false;
  try { validateNativeGodotRequest({ ...fixture, ...changed }); } catch { rejected = true; }
  results.push({ name, pass: rejected });
}
process.env.PORT_API_TOKEN = '  fixture-native-review-token-0123456789  ';
for (const [name, authorization, host, expected] of [
  ['bearer-missing', undefined, '127.0.0.1:4186', 401],
  ['bearer-wrong', 'Bearer wrong', '127.0.0.1:4186', 401],
  ['bearer-trimmed', 'Bearer fixture-native-review-token-0123456789', '127.0.0.1:4186', 200],
  ['bearer-does-not-bypass-host', 'Bearer fixture-native-review-token-0123456789', 'attacker.example:4186', 403],
]) {
  const request = { url: '/api/godot/native/status', method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: { host, ...(authorization ? { authorization } : {}) } };
  const response = { setHeader() {}, end() {}, statusCode: 0 };
  await createNativeGodotValidationMiddleware({ availability: async () => ({ available: true }) })(request, response, () => {});
  results.push({ name, pass: response.statusCode === expected });
}
delete process.env.PORT_API_TOKEN;
// Same real-file setup used for the captured before/after cancellation race.
const cancelDirectory = path.join(output, 'cancel-race');
await mkdir(cancelDirectory, { recursive: true });
const handle = await open(path.join(cancelDirectory, 'result.json'), 'w');
await handle.truncate(1048577); await handle.close();
const service = new NativeGodotValidationService();
const id = '9b194698-f6e1-45e2-974f-6b54571cb4dc';
const owned = { public: { id, requestId: 'race', vesselId: 'probe', status: 'running', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), windowOpen: false, sourceGitSha: 'test', pckSha256: 'test' }, directory: cancelDirectory, polling: null, startedAt: Date.now() };
service.jobs.set(id, owned);
const pendingPoll = service.poll(owned);
const cancelled = await service.cancel(id); await pendingPoll;
const cancelResult = { trigger: 'cancel while result stat is pending, with oversized result file', cancelReturned: cancelled.status, afterPendingPoll: service.get(id).status, expected: 'cancelled', pass: service.get(id).status === 'cancelled' };
await writeFile(path.join(output, 'cancel-race-after-fix.json'), JSON.stringify(cancelResult, null, 2));
results.push({ name: 'cancelled-status-survives-pending-stat', pass: cancelResult.pass });
await service.dispose();
const late = new NativeGodotValidationService({ runtimeDirectory: path.join(output, 'dispose-race') });
let release;
const config = new Promise(resolve => { release = resolve; });
late.configuration = () => config;
const starting = late.start(fixture); await Promise.resolve(); await late.dispose();
release({ engine: fixtureEngine, pack: path.join(output, 'unused-review.pck'), runner: path.join(output, 'unused-review.gd'), sourceGitSha: 'test', pckSha256: 'test' });
let rejected = false, returnedStatus = null;
try { returnedStatus = (await starting).status; } catch { rejected = true; }
const disposeResult = { trigger: 'dispose while start is waiting for configuration; harmless true fixture executable', rejectedAfterDispose: rejected, returnedStatus, registeredJobs: late.jobs.size, pass: rejected && late.jobs.size === 0 };
await writeFile(path.join(output, 'dispose-race-after-fix.json'), JSON.stringify(disposeResult, null, 2));
results.push({ name: 'dispose-prevents-late-process-start', pass: disposeResult.pass });
await late.dispose();
const receipt = { scope: 'Independent native API and lifecycle review; no visible Godot window launched', count: results.length, passed: results.filter(value => value.pass).length, cases: results };
await writeFile(path.join(output, 'final-review.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ count: receipt.count, passed: receipt.passed, failed: results.filter(value => !value.pass) }));
