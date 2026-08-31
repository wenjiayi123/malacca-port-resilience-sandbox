import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { OperatorIntegrationGateway } from './operatorIntegrationGateway.ts';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

const MAX_BODY_BYTES = 4 * 1_048_576;
const RATE_WINDOW_MS = 60_000;

const jsonResponse = (response: ServerResponse, value: unknown, status = 200) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const readJsonBody = async (request: IncomingMessage) => {
  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('Content-Type 必须是 application/json'), { statusCode: 415 });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('现场快照超过 4 MiB 上限'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
  } catch {
    throw Object.assign(new Error('请求体不是有效 JSON'), { statusCode: 400 });
  }
};

export const createOperatorIntegrationMiddleware = () => {
  const gateway = new OperatorIntegrationGateway();
  const configuredToken = validateRuntimeSecurityConfiguration(
    process.env.HOST || '127.0.0.1',
    process.env.PORT_API_TOKEN,
  ).token;
  const rateBuckets = new Map<string, { resetAt: number; count: number }>();
  const writeLimit = Number(process.env.OPERATOR_INGEST_RATE_LIMIT_PER_MINUTE || 600);
  if (!Number.isInteger(writeLimit) || writeLimit < 1 || writeLimit > 100_000) {
    throw new Error('OPERATOR_INGEST_RATE_LIMIT_PER_MINUTE 必须是 1 到 100000 的整数');
  }
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/operator-integration')) {
      next();
      return;
    }
    const requestIdHeader = request.headers['x-request-id'];
    const requestId = typeof requestIdHeader === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(requestIdHeader)
      ? requestIdHeader
      : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        throw Object.assign(new Error('现场接入接口只接受同源浏览器请求或无 Origin 的服务端请求'), { statusCode: 403 });
      }
      if (configuredToken) {
        const authorization = request.headers.authorization ?? '';
        if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), configuredToken)) {
          throw Object.assign(new Error('需要有效的 Bearer 访问令牌'), { statusCode: 401 });
        }
      }
      if (request.method === 'POST') {
        const key = request.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const previous = rateBuckets.get(key);
        const bucket = !previous || previous.resetAt <= now
          ? { resetAt: now + RATE_WINDOW_MS, count: 0 }
          : previous;
        bucket.count += 1;
        rateBuckets.set(key, bucket);
        response.setHeader('X-RateLimit-Limit', String(writeLimit));
        response.setHeader('X-RateLimit-Remaining', String(Math.max(0, writeLimit - bucket.count)));
        if (bucket.count > writeLimit) {
          response.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1_000)));
          throw Object.assign(new Error('现场快照写入过于频繁'), { statusCode: 429 });
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/operator-integration/contract') {
        jsonResponse(response, OperatorIntegrationGateway.contract());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/operator-integration/status') {
        jsonResponse(response, gateway.status());
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/operator-integration/shadow-snapshot') {
        const snapshot = gateway.shadowSnapshot();
        jsonResponse(response, snapshot, snapshot.protocolVersion === 'operator-shadow-blocked.v1' ? 409 : 200);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/operator-integration/snapshots') {
        const result = gateway.ingest(await readJsonBody(request));
        jsonResponse(response, result, result.accepted ? 202 : 422);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/operator-integration/openapi.json') {
        jsonResponse(response, {
          openapi: '3.1.0',
          info: { title: 'Read-only Operator Data Integration API', version: '1.0.0' },
          paths: {
            '/api/operator-integration/contract': { get: { summary: '读取签名快照和六源数据合同' } },
            '/api/operator-integration/status': { get: { summary: '读取授权、六源、新鲜度、顺序和影子就绪状态' } },
            '/api/operator-integration/snapshots': { post: { summary: '接收 operator-snapshot.v1 HMAC 签名快照' } },
            '/api/operator-integration/shadow-snapshot': { get: { summary: '原子读取只读影子 terminal-operations.v2 快照' } },
          },
          components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
          security: [{ bearerAuth: [] }],
        });
        return;
      }
      jsonResponse(response, { status: 'error', message: 'Operator integration route not found', requestId }, 404);
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
      if (statusCode >= 500) {
        console.error(JSON.stringify({ event: 'operator_integration_error', requestId, errorType: error instanceof Error ? error.name : 'unknown' }));
      }
      jsonResponse(response, {
        status: 'error',
        message: statusCode >= 500 ? '现场接入内部处理失败' : '现场接入请求未通过校验',
        requestId,
      }, statusCode);
    }
  };
};

export const operatorIntegrationPlugin = (): Plugin => ({
  name: 'malacca-operator-data-integration-api',
  configureServer(server) {
    server.middlewares.use(createOperatorIntegrationMiddleware());
  },
  configurePreviewServer(server) {
    server.middlewares.use(createOperatorIntegrationMiddleware());
  },
});
