import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import {
  PORT_COMMUNITY_MESSAGE_TYPES,
  PORT_COMMUNITY_PARTY_ROLES,
  PortCommunityGateway,
  type AuthorizedCommunityPartner,
  type PortCommunityMessageType,
  type PortCommunityPartyRole,
} from './portCommunityGateway.ts';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

const MAX_BODY_BYTES = 2 * 1_048_576;
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const json = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

const body = async (request: IncomingMessage) => {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('Content-Type 必须是 application/json'), { statusCode: 415 });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('港口社区消息超过 2 MiB 上限'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
};

const loadPartners = (): AuthorizedCommunityPartner[] => {
  if (!process.env.PORT_COMMUNITY_PARTNERS_JSON) return [];
  const value = JSON.parse(process.env.PORT_COMMUNITY_PARTNERS_JSON) as unknown;
  if (!Array.isArray(value)) throw new Error('PORT_COMMUNITY_PARTNERS_JSON 必须是数组');
  return value.map((candidate, index) => {
    if (!record(candidate)) throw new Error(`PORT_COMMUNITY_PARTNERS_JSON[${index}] 必须是对象`);
    const role = String(candidate.role ?? '') as PortCommunityPartyRole;
    if (!PORT_COMMUNITY_PARTY_ROLES.includes(role)) throw new Error(`伙伴 ${index} 角色无效`);
    const allowedMessageTypes = Array.isArray(candidate.allowedMessageTypes)
      ? candidate.allowedMessageTypes.map(String) as PortCommunityMessageType[]
      : [];
    if (!allowedMessageTypes.length || allowedMessageTypes.some((type) => !PORT_COMMUNITY_MESSAGE_TYPES.includes(type))) {
      throw new Error(`伙伴 ${index} 消息类型无效`);
    }
    if (typeof candidate.partyID !== 'string' || typeof candidate.signingKey !== 'string' || candidate.signingKey.length < 32) {
      throw new Error(`伙伴 ${index} 标识或签名密钥无效`);
    }
    return { partyID: candidate.partyID, role, signingKey: candidate.signingKey, allowedMessageTypes };
  });
};

export const createPortCommunityMiddleware = () => {
  const localRole = String(process.env.PORT_COMMUNITY_LOCAL_ROLE || 'PORT_COMMUNITY_SYSTEM') as PortCommunityPartyRole;
  if (!PORT_COMMUNITY_PARTY_ROLES.includes(localRole)) throw new Error('PORT_COMMUNITY_LOCAL_ROLE 无效');
  const gateway = new PortCommunityGateway({
    localParty: { partyID: process.env.PORT_COMMUNITY_LOCAL_PARTY_ID || 'sandbox.local.pcs', role: localRole },
    partners: loadPartners(),
  });
  const configuredToken = validateRuntimeSecurityConfiguration(
    process.env.HOST || '127.0.0.1',
    process.env.PORT_API_TOKEN,
  ).token;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/port-community')) return next();
    response.setHeader('X-Request-Id', randomUUID());
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        throw Object.assign(new Error('港口社区接入只允许同源浏览器或无 Origin 的服务端请求'), { statusCode: 403 });
      }
      if (configuredToken) {
        const authorization = request.headers.authorization ?? '';
        if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), configuredToken)) {
          throw Object.assign(new Error('需要有效的 Bearer 访问令牌'), { statusCode: 401 });
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/port-community/status') {
        json(response, gateway.status());
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/port-community/messages') {
        const result = gateway.ingest(await body(request));
        json(response, result, result.accepted ? 202 : 422);
        return;
      }
      json(response, { status: 'error', message: 'Port community route not found' }, 404);
    } catch (error) {
      const code = typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      response.statusCode = code;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({
        status: 'error',
        message: code >= 500 ? '港口社区内部处理失败' : '港口社区请求未通过校验',
      }));
    }
  };
};

export const portCommunityPlugin = (): Plugin => ({
  name: 'malacca-port-community-api',
  configureServer(server) { server.middlewares.use(createPortCommunityMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createPortCommunityMiddleware()); },
});
