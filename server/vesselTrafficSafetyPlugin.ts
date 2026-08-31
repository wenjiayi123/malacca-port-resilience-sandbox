import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';
import { assessVesselTraffic, type VesselTrackObservation } from './vesselTrafficSafety.ts';

const json = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const readBody = async (request: IncomingMessage) => {
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) throw new Error('Content-Type 必须是 application/json');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4 * 1_048_576) throw new Error('船舶交通态势输入超过 4 MiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { observations?: VesselTrackObservation[] };
};

export const createVesselTrafficSafetyMiddleware = () => {
  const token = validateRuntimeSecurityConfiguration(process.env.HOST || '127.0.0.1', process.env.PORT_API_TOKEN).token;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/api/vessel-traffic/assess') return next();
    try {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        json(response, { status: 'error', message: '船舶交通评估只允许同源浏览器或无 Origin 的服务端请求' }, 403);
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        json(response, { status: 'error', message: 'Method not allowed' }, 405);
        return;
      }
      if (token) {
        const authorization = request.headers.authorization ?? '';
        if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), token)) {
          json(response, { status: 'error', message: '需要有效的 Bearer 访问令牌' }, 401);
          return;
        }
      }
      const input = await readBody(request);
      if (!Array.isArray(input.observations)) {
        json(response, { status: 'error', message: 'observations 必须是数组' }, 422);
        return;
      }
      json(response, assessVesselTraffic(input.observations));
    } catch {
      json(response, { status: 'error', message: '船舶交通态势输入未通过校验' }, 422);
    }
  };
};

export const vesselTrafficSafetyPlugin = (): Plugin => ({
  name: 'malacca-vessel-traffic-safety-api',
  configureServer(server) { server.middlewares.use(createVesselTrafficSafetyMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createVesselTrafficSafetyMiddleware()); },
});
