import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { evaluateProductionRelease, type ProductionReleaseBundle } from './productionAuthorityGate.ts';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

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

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const trustBundle = (name: string) => {
  const raw = process.env[name];
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${name} 必须是 keyID 到 PEM 公钥的 JSON 对象`);
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => {
    if (typeof value !== 'string' || !value.includes('BEGIN PUBLIC KEY')) throw new Error(`${name}.${key} 不是 PEM 公钥`);
    return [key, value];
  }));
};

const readBody = async (request: IncomingMessage) => {
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) throw new Error('Content-Type 必须是 application/json');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('授权证据包超过 1 MiB');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  if (!record(value) || !record(value.decision) || !Array.isArray(value.approvals) ||
      !record(value.interlock) || !record(value.change)) {
    throw new Error('授权证据包必须包含 decision、approvals、interlock 和 change');
  }
  return value as unknown as ProductionReleaseBundle;
};

export const createProductionAuthorityMiddleware = () => {
  const token = validateRuntimeSecurityConfiguration(process.env.HOST || '127.0.0.1', process.env.PORT_API_TOKEN).token;
  const options = {
    identityTrustBundle: trustBundle('PORT_IDENTITY_TRUST_BUNDLE_JSON'),
    interlockTrustBundle: trustBundle('PORT_INTERLOCK_TRUST_BUNDLE_JSON'),
    audience: process.env.PORT_AUTHORITY_AUDIENCE || 'sandbox.production-authority-gate',
    acceptedSiteID: process.env.PORT_ACCEPTED_SITE_ID || 'pending.site',
    acceptedSiteReference: process.env.PORT_ACCEPTANCE_REFERENCE || 'PENDING-SITE-ACCEPTANCE',
  };
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/api/production-authority/evaluate') return next();
    try {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        json(response, { status: 'error', message: '生产授权评估只允许同源浏览器或无 Origin 的服务端请求' }, 403);
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
      json(response, evaluateProductionRelease(await readBody(request), options));
    } catch {
      json(response, { status: 'error', message: '生产授权证据包未通过校验' }, 422);
    }
  };
};

export const productionAuthorityPlugin = (): Plugin => ({
  name: 'malacca-production-authority-policy-api',
  configureServer(server) { server.middlewares.use(createProductionAuthorityMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createProductionAuthorityMiddleware()); },
});
