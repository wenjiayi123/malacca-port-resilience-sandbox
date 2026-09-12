import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

const runtimeHook = 'Module["copyToFS"]=GodotFS.copy_to_fs;';
const resultReader = `let malaccaUserDirectory = null;
Module["malaccaValidationDirectory"] = function(projectTitle) {
  if (malaccaUserDirectory) return malaccaUserDirectory;
  const base = "/userfs/godot/app_userdata";
  try {
    const names = FS.readdir(base).filter(name => name !== "." && name !== ".." && FS.isDir(FS.stat(base + "/" + name).mode));
    const selected = projectTitle ? names.includes(projectTitle) ? projectTitle : null : names.length === 1 ? names[0] : null;
    if (selected) malaccaUserDirectory = base + "/" + selected;
  } catch {}
  if (!malaccaUserDirectory) {
    try { if (FS.isDir(FS.stat("/userfs/logs").mode)) malaccaUserDirectory = "/userfs"; } catch {}
  }
  return malaccaUserDirectory;
};
Module["malaccaReadValidationResult"] = function() {
  if (!malaccaUserDirectory) return null;
  try { return FS.readFile(malaccaUserDirectory + "/malacca_validation_result.json", {encoding:"utf8"}); } catch { return null; }
};
Module["malaccaClearValidationResult"] = function() {
  if (!malaccaUserDirectory) return;
  try { FS.unlink(malaccaUserDirectory + "/malacca_validation_result.json"); } catch {}
};`;

export const patchGodotWebRuntime = (source: string) => {
  if (!source.includes(runtimeHook)) throw new Error('Godot export has no compatible virtual filesystem bridge');
  return source.replace(runtimeHook, `${runtimeHook}${resultReader}`);
};

export const GODOT_VALIDATION_BRIDGE_SCRIPT = `(() => {
  const origin = window.location.origin;
  const projectTitle = document.title;
  let pending = null;
  let submitted = '';
  let lastResult = '';
  let submittedAt = 0;
  let stopped = false;
  const status = document.createElement('div');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.id = 'malacca-validation-bridge-status';
  status.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:1000;padding:6px 10px;max-width:90%;border-radius:6px;background:rgba(5,20,30,.86);color:#d9f6ff;font:12px sans-serif;pointer-events:none';
  status.textContent = 'Godot 联动：等待验证请求';
  document.body.appendChild(status);
  const send = (type, payload) => window.parent.postMessage({
    source: 'malacca-godot-file-bridge', type, protocolVersion: 'godot-validation.v1', payload,
  }, origin);
  const receive = (event) => {
    if (event.origin !== origin || event.source !== window.parent || !event.data ||
        event.data.type !== 'godot.validation.request' || event.data.protocolVersion !== 'godot-validation.v1') return;
    const request = event.data.payload;
    if (!request || typeof request.requestId !== 'string' || typeof request.vesselId !== 'string') return;
    const encoded = JSON.stringify(request);
    if (encoded.length > 1000000) return;
    if (pending?.encoded === encoded) return;
    pending = { request, encoded };
    status.textContent = 'Godot 联动：等待仿真引擎就绪';
  };
  window.addEventListener('message', receive);
  const timer = window.setInterval(() => {
    if (stopped || !pending || typeof engine === 'undefined' || !engine.rtenv) return;
    if (typeof engine.rtenv.malaccaReadValidationResult !== 'function') return;
    try {
      const directory = engine.rtenv.malaccaValidationDirectory?.(projectTitle);
      if (!directory) {
        status.textContent = 'Godot 联动：等待场景存储目录就绪；无法确认目录时不会提交';
        return;
      }
      if (submitted !== pending.encoded) {
        engine.rtenv.malaccaClearValidationResult?.();
        const requestFile = directory + '/malacca_validation_request.json';
        engine.copyToFS(requestFile, new TextEncoder().encode(pending.encoded).buffer);
        submitted = pending.encoded;
        submittedAt = Date.now();
        lastResult = '';
        status.dataset.requestId = pending.request.requestId;
        status.dataset.requestFile = requestFile;
        status.textContent = 'Godot 联动：已提交请求，等待真实仿真结果';
      }
      const raw = engine.rtenv.malaccaReadValidationResult();
      if (!raw && Date.now() - submittedAt > 15000) status.textContent = 'Godot 联动：尚未收到场景结果，请检查导出版本与文件桥';
      if (!raw || raw === lastResult) return;
      const result = JSON.parse(raw);
      if (result.requestId !== pending.request.requestId || result.vesselId !== pending.request.vesselId) return;
      lastResult = raw;
      if (result.status === 'running') status.textContent = 'Godot 联动：真实仿真正在运行';
      if (['passed', 'degraded', 'failed'].includes(result.status)) {
        status.textContent = 'Godot 联动：真实仿真结果已回传（' + result.status + '）';
        send('godot.validation.result', result);
      }
    } catch (error) {
      console.warn('Godot validation file bridge:', error instanceof Error ? error.message : String(error));
    }
  }, 250);
  window.addEventListener('pagehide', () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener('message', receive);
  }, { once: true });
})();`;

export const patchGodotWebHtml = (source: string) => source.replace(
  '</body>',
  '<script src="/godot-simulator/malacca-validation-bridge.js"></script>\n</body>',
);

export const godotWebContentSecurityPolicy = (html: string) => {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  return `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`;
};

export const createGodotWebBridgeMiddleware = (exportDirectory: string) => async (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => {
  const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (/^\/godot-simulator\/[^/]+\.pck$/.test(route)) {
    response.setHeader('Content-Type', 'application/octet-stream');
    next();
    return;
  }
  const files: Record<string, string> = {
    '/godot-simulator/': 'index.html',
    '/godot-simulator/index.html': 'index.html',
    '/godot-simulator/index.js': 'index.js',
    '/godot-simulator/malacca-validation-bridge.js': 'bridge',
  };
  const file = files[route];
  if (!file || !['GET', 'HEAD'].includes(request.method ?? '')) { next(); return; }
  let source: string;
  try {
    source = file === 'bridge' ? GODOT_VALIDATION_BRIDGE_SCRIPT : await readFile(path.join(exportDirectory, file), 'utf8');
  } catch { next(); return; }
  try {
    const body = file === 'index.html' ? patchGodotWebHtml(source)
      : file === 'index.js' ? patchGodotWebRuntime(source) : source;
    response.statusCode = 200;
    response.setHeader('Content-Type', file === 'index.html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(body));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (file === 'index.html') response.setHeader('Content-Security-Policy', godotWebContentSecurityPolicy(body));
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.statusCode = 503;
    response.end(error instanceof Error ? error.message : 'Godot bridge unavailable');
  }
};

export const godotWebBridgePlugin = (): Plugin => ({
  name: 'malacca-godot-web-file-bridge',
  configureServer(server) {
    server.middlewares.use(createGodotWebBridgeMiddleware(path.resolve(server.config.publicDir, 'godot-simulator')));
  },
  configurePreviewServer(server) {
    server.middlewares.use(createGodotWebBridgeMiddleware(path.resolve(server.config.build.outDir, 'godot-simulator')));
  },
});
