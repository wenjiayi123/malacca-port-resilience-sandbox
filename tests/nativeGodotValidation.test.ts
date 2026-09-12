import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as sendHttpRequest, type IncomingMessage } from 'node:http';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { NativeGodotValidationService, validateNativeGodotRequest } from '../server/nativeGodotValidation.ts';
import { createNativeGodotValidationMiddleware, isLocalNativeGodotRequest } from '../server/nativeGodotValidationPlugin.ts';

const requestFixture = async (requestId: string) => ({ ...JSON.parse(await readFile('scripts/demo/godot_web_coordinate_request.json', 'utf8')), requestId });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(context: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'malacca-native-test-'));
  const pack = path.join(root, 'public/godot-simulator');
  await mkdir(pack, { recursive: true });
  await mkdir(path.join(root, 'scripts/demo'), { recursive: true });
  await copyFile('scripts/demo/native_godot_validation_runner.gd', path.join(root, 'scripts/demo/native_godot_validation_runner.gd'));
  const bytes = Buffer.from('GDPC-isolated-unit-fixture');
  await writeFile(path.join(pack, 'index.pck'), bytes);
  await writeFile(path.join(pack, 'export-manifest.json'), JSON.stringify({ sourceIsolatedBeforeImport: true, source: { gitSha: 'fixture-source' }, coordinateValidation: { caseCount: 3, mappingInvariantChecks: 10 }, artifacts: { 'index.pck': { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } }));
  const engine = path.join(root, 'fixture-engine');
  await writeFile(engine, `#!/usr/bin/env python3
import json, os, pathlib, sys, time
if '--version' in sys.argv:
 print('4.7.1.fixture'); sys.exit(0)
assert '--headless' in sys.argv
def argument(name): return next(value.split('=',1)[1] for value in sys.argv if value.startswith(name+'='))
request_path=pathlib.Path(argument('--request'))
request=json.loads(request_path.read_text())
result=pathlib.Path(argument('--result'))
pathlib.Path(argument('--status')).write_text('{}')
(request_path.parent/'argv.json').write_text(json.dumps({'argv':sys.argv,'pid':os.getpid()}))
if 'hold' in request['requestId']:
 while True: time.sleep(.1)
response={'requestId':request['requestId'],'vesselId':request['vesselId'],'status':'passed','safePass':True,'estimatedTravelMinutes':1.1,'riskLevel':'low','recommendedSpeedKnots':11.2,'simulatedDurationSeconds':2.0,'reachedDestination':False,'averageSpeedKnots':11.5,'minClearanceMeters':228.8,'collisionCount':0,'groundingCount':0,'riskEventResolvedCount':0,'delayDeltaMinutes':-.01,'carbonDeltaTons':0,'summary':'Unit fixture result, not physical acceptance'}
if 'mismatch' in request['requestId']: response['requestId']='different-request'
result.write_text(json.dumps(response))
`);
  await chmod(engine, 0o755);
  const service = new NativeGodotValidationService({ projectRoot: root, enginePath: engine, runtimeDirectory: path.join(root, 'jobs'), headless: true, pollMs: 5 });
  context.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, service };
}
async function terminal(service: NativeGodotValidationService, id: string) {
  for (let i = 0; i < 200; i++) { const job = service.get(id)!; if (!['launching', 'running'].includes(job.status) && !job.windowOpen) return job; await delay(10); }
  throw new Error('Fixture job did not finish');
}

test('native validation uses fixed owned paths, validates the exact PCK, and collects a result even when the child exits immediately', async (context) => {
  const { root, service } = await fixture(context);
  assert.equal((await service.availability()).available, true);
  const request = { ...await requestFixture('normal'), engine: '/untrusted/engine', resultPath: '/untrusted/result' };
  const started = await service.start(request);
  const completed = await terminal(service, started.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.result?.requestId, 'normal');
  const directory = path.join(root, 'jobs', (await readdir(path.join(root, 'jobs')))[0]);
  const saved = JSON.parse(await readFile(path.join(directory, 'request.json'), 'utf8'));
  assert.equal(saved.engine, undefined); assert.equal(saved.resultPath, undefined);
  const invocation = JSON.parse(await readFile(path.join(directory, 'argv.json'), 'utf8'));
  assert.equal(invocation.argv.some((argument: string) => argument.includes('/untrusted/')), false);
  assert.ok(invocation.argv.includes(path.join(root, 'public/godot-simulator/index.pck')));
  assert.ok(invocation.argv.includes(path.join(root, 'scripts/demo/native_godot_validation_runner.gd')));
  assert.ok(invocation.argv.includes(`--request=${path.join(directory, 'request.json')}`));
  await writeFile(path.join(root, 'public/godot-simulator/index.pck'), 'tampered package');
  assert.equal((await service.availability()).available, false);
  await assert.rejects(service.start(await requestFixture('after-tamper')), /导出|PCK/);
});

test('native busy, cancellation, mismatch, and service disposal cannot cross jobs or leave an owned process running', async (context) => {
  const { service } = await fixture(context);
  const holding = await service.start(await requestFixture('hold-first'));
  await delay(60);
  await assert.rejects(service.start(await requestFixture('duplicate')), /正在运行/);
  const cancelled = await service.cancel(holding.id);
  assert.equal(cancelled?.status, 'cancelled'); assert.equal(cancelled?.windowOpen, false);
  const second = await service.start(await requestFixture('hold-second'));
  await delay(60);
  await service.cancel(holding.id);
  assert.equal(service.get(second.id)?.windowOpen, true);
  await service.cancel(second.id);
  const mismatch = await service.start(await requestFixture('mismatch'));
  assert.equal((await terminal(service, mismatch.id)).status, 'failed');
  const starting = service.start(await requestFixture('hold-dispose'));
  await service.dispose();
  await assert.rejects(starting, /已关闭/);
  await assert.rejects(service.start(await requestFixture('after-dispose')), /已关闭/);
});

test('native API blocks external and rebinding requests and bounds JSON input before starting a process', async (context) => {
  const { service } = await fixture(context);
  const middleware = createNativeGodotValidationMiddleware(service);
  const server = createServer((request, response) => { void middleware(request, response, () => { response.statusCode = 404; response.end(); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const endpoint = base + '/api/godot/native/validations';
  assert.equal((await fetch(base + '/api/godot/native/status')).status, 200);
  for (const headers of [{ origin: 'https://untrusted.invalid' }, { origin: `https://127.0.0.1:${address.port}` }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })).status, 403, JSON.stringify(headers));
  }
  const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
    const request = sendHttpRequest(endpoint, { method: 'POST', headers: { host: 'untrusted.invalid', 'content-type': 'application/json' } }, (response) => { response.resume(); response.once('end', () => resolve(response.statusCode)); });
    request.once('error', reject); request.end('{}');
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(65_537) })).status, 413);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
  const nativeRequest = { headers: { host: '127.0.0.1' }, socket: { remoteAddress: '10.0.0.4' } } as unknown as IncomingMessage;
  assert.equal(isLocalNativeGodotRequest(nativeRequest), false);
  const payload = await requestFixture('api-normal');
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(payload) });
  assert.equal(response.status, 202); const job = await response.json();
  assert.equal((await terminal(service, job.id)).status, 'completed');
  assert.equal((await fetch(endpoint + '/' + job.id)).status, 200);
  assert.equal((await fetch(endpoint + '/' + job.id + '/cancel', { method: 'POST', headers: { origin: base } })).status, 200);
  assert.throws(() => validateNativeGodotRequest({ ...payload, progressPercent: 101 }), /进度/);
  assert.throws(() => validateNativeGodotRequest({ ...payload, riskEvents: Array(33).fill(payload.riskEvents[0]) }), /数量/);
});
