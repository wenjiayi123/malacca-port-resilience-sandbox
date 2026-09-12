import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import {
  GODOT_VALIDATION_BRIDGE_SCRIPT,
  godotWebContentSecurityPolicy,
  patchGodotWebHtml,
  patchGodotWebRuntime,
} from '../server/godotWebBridgePlugin.ts';

test('Godot response patches preserve export bytes and give only the required bootstrap and result reader access', () => {
  const original = 'const FS = fixtureFS; const GodotFS = {copy_to_fs: () => {}}; Module["copyToFS"]=GodotFS.copy_to_fs;';
  let readPath = '';
  const module: Record<string, (title?: string) => unknown> = {};
  vm.runInNewContext(patchGodotWebRuntime(original), {
    Module: module,
    fixtureFS: {
      readdir: () => ['.', '..', 'Test Export'],
      stat: () => ({ mode: 16384 }), isDir: () => true,
      readFile: (file: string) => { readPath = file; return '{"status":"passed"}'; },
    },
  });
  assert.equal(module.malaccaValidationDirectory('Test Export'), '/userfs/godot/app_userdata/Test Export');
  assert.equal(module.malaccaReadValidationResult(), '{"status":"passed"}');
  assert.equal(readPath, '/userfs/godot/app_userdata/Test Export/malacca_validation_result.json');
  assert.throws(() => patchGodotWebRuntime('incompatible engine'), /compatible virtual filesystem/);
  const inline = 'const engine = new Engine({});';
  const html = `<body><script src="index.js"></script><script>${inline}</script></body>`;
  const patched = patchGodotWebHtml(html);
  assert.ok(patched.includes('/godot-simulator/malacca-validation-bridge.js'));
  assert.equal(patched.replace('<script src="/godot-simulator/malacca-validation-bridge.js"></script>\n', ''), html);
  const csp = godotWebContentSecurityPolicy(patched);
  const scriptDirective = csp.split(';')[1];
  assert.ok(scriptDirective.includes(`'sha256-${createHash('sha256').update(inline).digest('base64')}'`));
  assert.ok(scriptDirective.includes("'wasm-unsafe-eval'"));
  assert.ok(!scriptDirective.includes("'unsafe-inline'"));
  assert.ok(!scriptDirective.includes("'unsafe-eval'"));
});

test('Godot file bridge rejects foreign frames and correlates terminal results without fabricating or replaying them', () => {
  const listeners = new Map<string, (event?: unknown) => void>();
  const messages: Array<{ type: string; payload: { status: string }; origin: string }> = [];
  const writes: Array<{ file: string; content: string }> = [];
  let tick: () => void = () => undefined;
  let result: string | null = null;
  let clears = 0;
  const parent = { postMessage: (message: { type: string; payload: { status: string } }, origin: string) => messages.push({ ...message, origin }) };
  const window = {
    location: { origin: 'http://localhost:5174' }, parent,
    addEventListener: (name: string, callback: (event?: unknown) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    setInterval: (callback: () => void) => { tick = callback; return 1; },
    clearInterval: () => undefined,
  };
  const engine = {
    rtenv: {
      malaccaValidationDirectory: () => '/userfs/godot/app_userdata/Test Export',
      malaccaReadValidationResult: () => result,
      malaccaClearValidationResult: () => { result = null; clears += 1; },
    },
    copyToFS: (file: string, buffer: ArrayBuffer) => writes.push({ file, content: new TextDecoder().decode(buffer) }),
  };
  const document = {
    createElement: () => ({ setAttribute: () => undefined, style: {}, dataset: {}, textContent: '' }),
    body: { appendChild: () => undefined },
  };
  vm.runInNewContext(GODOT_VALIDATION_BRIDGE_SCRIPT, { window, engine, document, TextEncoder, console });
  const payload = { requestId: 'current-request', vesselId: 'selected-vessel' };
  const data = { type: 'godot.validation.request', protocolVersion: 'godot-validation.v1', payload };
  listeners.get('message')?.({ origin: 'https://other.example', source: parent, data });
  listeners.get('message')?.({ origin: window.location.origin, source: {}, data });
  tick();
  assert.equal(writes.length, 0);
  result = JSON.stringify({ ...payload, status: 'passed' });
  listeners.get('message')?.({ origin: window.location.origin, source: parent, data });
  tick(); tick();
  assert.equal(clears, 1);
  assert.equal(messages.length, 0, 'persisted results from an earlier iframe must be cleared before submission');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, '/userfs/godot/app_userdata/Test Export/malacca_validation_request.json');
  assert.deepEqual(JSON.parse(writes[0].content), payload);
  result = JSON.stringify({ ...payload, status: 'running' });
  tick();
  result = JSON.stringify({ ...payload, requestId: 'previous-request', status: 'passed' });
  tick();
  assert.equal(messages.length, 0);
  result = JSON.stringify({ ...payload, status: 'passed', safePass: true, minClearanceMeters: 42 });
  tick(); tick();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'godot.validation.result');
  assert.equal(messages[0].origin, window.location.origin);
  assert.equal(JSON.stringify(messages[0].payload), result);
  listeners.get('pagehide')?.();
  assert.equal(listeners.has('message'), false);
});

test('Godot user directory discovery refuses ambiguous saved projects and accepts the matching export title', () => {
  const module: Record<string, (title?: string) => unknown> = {};
  let directories = ['First Export'];
  vm.runInNewContext(patchGodotWebRuntime('Module["copyToFS"]=GodotFS.copy_to_fs;'), {
    Module: module, GodotFS: { copy_to_fs: () => undefined },
    FS: {
      readdir: () => ['.', '..', ...directories],
      isDir: () => true,
      stat: (file: string) => {
        if (file === '/userfs/logs') throw new Error('Not present');
        return { mode: 16384 };
      },
    },
  });
  assert.equal(module.malaccaValidationDirectory('Current Export'), null, 'a persisted old export directory must not receive a request while the new app starts');
  directories = ['First Export', 'Current Export'];
  assert.equal(module.malaccaValidationDirectory('Unknown Export'), null);
  assert.equal(module.malaccaReadValidationResult(), null);
  assert.equal(module.malaccaValidationDirectory('Current Export'), '/userfs/godot/app_userdata/Current Export');
});
