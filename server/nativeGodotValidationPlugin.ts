import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { NativeGodotHttpError, NativeGodotValidationService } from './nativeGodotValidation.ts';

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const localHost = new Set(['127.0.0.1', 'localhost', '[::1]']);
const json = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(value));
};
export function isLocalNativeGodotRequest(request: IncomingMessage) {
  if (!loopback.has(request.socket.remoteAddress ?? '')) return false;
  try {
    const host = new URL(`http://${request.headers.host}`);
    if (!localHost.has(host.hostname) || host.username || host.password) return false;
    if (request.headers.origin && new URL(request.headers.origin).origin !== host.origin) return false;
    if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site']))) return false;
    return true;
  } catch { return false; }
}
export const createNativeGodotValidationMiddleware = (service = new NativeGodotValidationService()) => async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
  const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  if (!route.startsWith('/api/godot/native/')) { next(); return; }
  const token = process.env.PORT_API_TOKEN?.trim();
  if (token) {
    const supplied = Buffer.from(String(request.headers.authorization ?? ''));
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(response, { error: '本地模拟器访问令牌无效' }, 401); return; }
  }
  if (!isLocalNativeGodotRequest(request)) { json(response, { error: '独立模拟器仅允许本机同源访问' }, 403); return; }
  try {
    if (route === '/api/godot/native/status' && request.method === 'GET') { json(response, await service.availability()); return; }
    if (route === '/api/godot/native/validations' && request.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/iu.test(String(request.headers['content-type'] ?? ''))) throw new NativeGodotHttpError(415, '请求必须使用 application/json');
      if (Number(request.headers['content-length'] ?? 0) > 65_536) throw new NativeGodotHttpError(413, '验证请求超过 64 KiB');
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 65_536) throw new NativeGodotHttpError(413, '验证请求超过 64 KiB'); chunks.push(Buffer.from(chunk)); }
      json(response, await service.start(JSON.parse(Buffer.concat(chunks).toString('utf8'))), 202); return;
    }
    const match = route.match(/^\/api\/godot\/native\/validations\/([a-f0-9-]{36})(\/cancel)?$/u);
    if (match && ((request.method === 'GET' && !match[2]) || (request.method === 'POST' && match[2]))) {
      const job = match[2] ? await service.cancel(match[1]) : service.get(match[1]);
      json(response, job ?? { error: '验证任务不存在' }, job ? 200 : 404); return;
    }
    json(response, { error: '独立模拟器接口不存在或方法不支持' }, 404);
  } catch (error) { json(response, { error: error instanceof Error ? error.message : '独立模拟器请求失败' }, error instanceof NativeGodotHttpError ? error.statusCode : 400); }
};
export const nativeGodotValidationPlugin = (): Plugin => {
  const service = new NativeGodotValidationService();
  return { name: 'malacca-native-godot-validation', configureServer(server) { server.middlewares.use(createNativeGodotValidationMiddleware(service)); server.httpServer?.once('close', () => { void service.dispose().catch(() => undefined); }); }, configurePreviewServer(server) { server.middlewares.use(createNativeGodotValidationMiddleware(service)); server.httpServer.once('close', () => { void service.dispose().catch(() => undefined); }); } };
};
