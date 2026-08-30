import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createOperatorIntegrationMiddleware } from './operatorIntegrationPlugin.ts';
import { createPortCommunityMiddleware } from './portCommunityPlugin.ts';
import { createVesselTrafficSafetyMiddleware } from './vesselTrafficSafetyPlugin.ts';
import { createProductionAuthorityMiddleware } from './productionAuthorityPlugin.ts';
import { createPortBusinessRlMiddleware } from './portBusinessRlPlugin.ts';
import { createPublicEvidenceMiddleware } from './publicEvidencePlugin.ts';
import { ensureRlTrainingJobsRestored } from './rlTrainingJobs.ts';
import { validateRuntimeSecurityConfiguration } from './runtimeSecurity.ts';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const distributionDirectory = path.resolve(process.env.STATIC_DIR || 'dist');

if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT 必须是 1 到 65535 的整数');
const runtimeSecurity = validateRuntimeSecurityConfiguration(host, process.env.PORT_API_TOKEN);

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

const log = (level: 'info' | 'error', event: string, fields: Record<string, unknown> = {}) => {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields })}\n`);
};

const setStaticSecurityHeaders = (response: ServerResponse) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.maptiler.com; font-src 'self' data:; connect-src 'self' https://api.maptiler.com; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  );
};

const staticResponse = async (request: IncomingMessage, response: ServerResponse) => {
  if (!['GET', 'HEAD'].includes(request.method ?? '')) {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const decodedPath = decodeURIComponent(url.pathname);
  const candidate = path.resolve(distributionDirectory, `.${decodedPath}`);
  if (candidate !== distributionDirectory && !candidate.startsWith(`${distributionDirectory}${path.sep}`)) {
    response.statusCode = 400;
    response.end('Bad Request');
    return;
  }
  let filePath = candidate;
  try {
    if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    if (path.extname(decodedPath)) {
      response.statusCode = 404;
      response.end('Not Found');
      return;
    }
    filePath = path.join(distributionDirectory, 'index.html');
  }
  try {
    const body = await readFile(filePath);
    setStaticSecurityHeaders(response);
    response.statusCode = 200;
    response.setHeader('Content-Type', mimeTypes[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream');
    response.setHeader('Cache-Control', filePath.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache');
    response.setHeader('Content-Length', String(body.length));
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.statusCode = 404;
    response.end('Not Found');
  }
};

await stat(path.join(distributionDirectory, 'index.html'));
await ensureRlTrainingJobsRestored();
const operatorIntegrationMiddleware = createOperatorIntegrationMiddleware();
const portCommunityMiddleware = createPortCommunityMiddleware();
const vesselTrafficSafetyMiddleware = createVesselTrafficSafetyMiddleware();
const productionAuthorityMiddleware = createProductionAuthorityMiddleware();
const portBusinessRlMiddleware = createPortBusinessRlMiddleware();
const apiMiddleware = createPublicEvidenceMiddleware();
const server = createServer(async (request, response) => {
  const startedAt = performance.now();
  try {
    await portBusinessRlMiddleware(request, response, () => undefined);
    if (!response.writableEnded) await productionAuthorityMiddleware(request, response, () => undefined);
    if (!response.writableEnded) await vesselTrafficSafetyMiddleware(request, response, () => undefined);
    if (!response.writableEnded) await portCommunityMiddleware(request, response, () => undefined);
    if (!response.writableEnded) await operatorIntegrationMiddleware(request, response, () => undefined);
    if (!response.writableEnded) await apiMiddleware(request, response, () => undefined);
    if (!response.writableEnded && new URL(request.url ?? '/', 'http://127.0.0.1').pathname.startsWith('/api/')) {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ status: 'error', message: 'API route not found' }));
    }
    if (!response.writableEnded) await staticResponse(request, response);
    log('info', 'http_request', {
      method: request.method,
      path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      status: response.statusCode,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      requestId: response.getHeader('X-Request-Id'),
    });
  } catch (error) {
    if (!response.headersSent) response.statusCode = 500;
    if (!response.writableEnded) response.end('Internal Server Error');
    log('error', 'http_request_failed', {
      method: request.method,
      path: request.url,
      message: error instanceof Error ? error.message : 'unknown error',
    });
  }
});

server.listen(port, host, () => log('info', 'server_started', {
  host,
  port,
  staticDirectory: distributionDirectory,
  authentication: runtimeSecurity.token ? 'bearer-enabled' : 'local-only-no-token',
}));

const shutdown = (signal: string) => {
  log('info', 'server_shutdown', { signal });
  server.close((error) => {
    if (error) log('error', 'server_shutdown_failed', { message: error.message });
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
