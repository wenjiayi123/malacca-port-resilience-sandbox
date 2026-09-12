import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('production HTTP serves map resources and completes the isolated operational button contract', { timeout: 20_000 }, async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-http-contract-'));
  await writeFile(path.join(temporary, 'index.html'), '<!doctype html><title>HTTP contract fixture</title>');
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--experimental-strip-types', 'server/productionServer.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port), PORT_API_TOKEN: '', STATIC_DIR: temporary,
      RL_ARTIFACT_DIR: path.join(temporary, 'rl-jobs'),
      PORT_OPERATION_AUDIT_FILE: path.join(temporary, 'audit.jsonl'),
      XIAOYI_AI_ENDPOINT: '', MAPTILER_API_KEY: '', AISSTREAM_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  context.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      await closed;
    }
    await rm(temporary, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`HTTP server did not start: ${logs}`)), 10_000);
    const inspect = () => {
      if (logs.includes('"event":"server_started"')) {
        clearTimeout(deadline);
        resolve();
      }
    };
    child.stdout.on('data', inspect);
    child.once('error', (error) => { clearTimeout(deadline); reject(error); });
    child.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`HTTP server exited ${code}: ${logs}`)); });
    inspect();
  });
  const base = `http://127.0.0.1:${port}`;
  const root = await fetch(base);
  assert.equal(root.status, 200);
  const policy = new Map(root.headers.get('content-security-policy')?.split(';').map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
  for (const origin of ['https://tiles.openfreemap.org', 'https://tiles.maps.eox.at', 'https://tiles.mapterhorn.com', 'https://api.maptiler.com']) {
    assert.ok(policy.get('connect-src')?.includes(origin), `${origin} map requests must be allowed`);
    assert.ok(policy.get('img-src')?.includes(origin), `${origin} map imagery must be allowed`);
  }
  assert.deepEqual(policy.get('script-src'), ["'self'"]);
  assert.ok(!policy.get('connect-src')?.some((source) => source === '*' || source === 'https:'));
  assert.equal((await fetch(`${base}/godot-simulator/index.html`)).status, 404);
  const godotDirectory = path.join(temporary, 'godot-simulator');
  const godotHtml = '<body><script src="index.js"></script><script>const engine = new Engine({});</script></body>';
  const godotRuntime = 'Module["copyToFS"]=GodotFS.copy_to_fs;';
  await mkdir(godotDirectory);
  await writeFile(path.join(godotDirectory, 'index.html'), godotHtml);
  await writeFile(path.join(godotDirectory, 'index.js'), godotRuntime);
  await writeFile(path.join(godotDirectory, 'index.pck'), 'isolated-fixture');
  const godotPage = await fetch(`${base}/godot-simulator/index.html`);
  assert.match(await godotPage.text(), /malacca-validation-bridge\.js/);
  assert.match(godotPage.headers.get('content-security-policy') ?? '', /'wasm-unsafe-eval'.*'sha256-/);
  assert.match(await (await fetch(`${base}/godot-simulator/index.js`)).text(), /malaccaReadValidationResult/);
  const packageResponse = await fetch(`${base}/godot-simulator/index.pck`, { method: 'HEAD' });
  assert.equal(packageResponse.status, 200);
  assert.equal(packageResponse.headers.get('content-type'), 'application/octet-stream');
  assert.equal(await readFile(path.join(godotDirectory, 'index.html'), 'utf8'), godotHtml);
  assert.equal(await readFile(path.join(godotDirectory, 'index.js'), 'utf8'), godotRuntime);
  const largeAsset = await open(path.join(temporary, 'large.pck'), 'w');
  await largeAsset.truncate(256 * 1024 * 1024);
  await largeAsset.close();
  const residentKib = () => Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
  const memoryBeforeHead = residentKib();
  const largeHead = await fetch(`${base}/large.pck`, { method: 'HEAD' });
  assert.equal(largeHead.headers.get('content-length'), String(256 * 1024 * 1024));
  assert.equal((await largeHead.arrayBuffer()).byteLength, 0);
  assert.ok(residentKib() - memoryBeforeHead < 64 * 1024, 'HEAD must not allocate the complete 256 MiB package');
  const largeStream = await fetch(`${base}/large.pck`);
  const reader = largeStream.body?.getReader();
  assert.ok(reader);
  const firstChunk = await reader.read();
  assert.ok(firstChunk.value?.length);
  assert.ok(firstChunk.value.length < 256 * 1024 * 1024);
  await reader.cancel();
  assert.equal((await fetch(`${base}/missing.pck`)).status, 404);

  const request = async (route: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const response = await fetch(`${base}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return { response, data };
  };
  const snapshot = await request('/api/operations/snapshot');
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.data.authority.production_authority, false);
  for (const scenario of ['peak-arrivals', 'channel-closure', 'equipment-failure', 'extreme-weather', 'channel-congestion', 'yard-saturation', 'data-loss', 'normal']) {
    const injected = await request('/api/operations/scenarios', { scenario });
    assert.equal(injected.response.status, 200, scenario);
    assert.equal(injected.data.simulator.scenario, scenario);
    if (scenario === 'data-loss') {
      assert.equal((await request('/api/operations/recommendations')).response.status, 409);
    }
  }
  assert.equal((await request('/api/operations/scenarios', { scenario: 'unknown' })).response.status, 422);
  const recommendation = await request('/api/operations/recommendations');
  assert.equal(recommendation.response.status, 200);
  assert.equal(recommendation.data.candidates.length, 5);
  const created = await request('/api/operations/decisions', { controller_id: 'port-sop' });
  assert.equal(created.response.status, 201);
  const decisionRoute = `/api/operations/decisions/${created.data.decision_id}`;
  assert.equal((await request(`${decisionRoute}/execute`, {}, { 'Idempotency-Key': 'http-test-execute' })).response.status, 409);
  const approved = await request(`${decisionRoute}/approve`, { approvers: [
    { approver_id: 'http-test-operator', role: 'operator' },
    { approver_id: 'http-test-safety', role: 'safety_officer' },
  ] }, { 'X-Operator-Role': 'operator,safety_officer' });
  assert.equal(approved.data.status, 'approved');
  const executed = await request(`${decisionRoute}/execute`, {}, { 'Idempotency-Key': 'http-test-execute' });
  assert.equal(executed.data.decision.status, 'executed');
  assert.equal((await request(`${decisionRoute}/execute`, {}, { 'Idempotency-Key': 'http-test-execute' })).data.idempotent_replay, true);
  assert.equal((await request(`${decisionRoute}/rollback`, { reason: 'isolated-http-contract-test' })).data.status, 'rolled_back');
  assert.equal((await request('/api/operations/audit')).data.verified, true);
  await request('/api/operations/simulator/control', { action: 'stop' });
  assert.equal((await request('/api/operations/recommendations')).response.status, 409);
  await request('/api/operations/simulator/control', { action: 'start' });
  assert.equal((await request('/api/operations/recommendations')).response.status, 200);
});
