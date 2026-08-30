import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { PORT_BUSINESS_ACTIONS, type BusinessActionId } from '../shared/portBusinessRlContract.ts';
import type { PortBusinessDynamicState } from './portBusinessControlPlane.ts';
import {
  PORT_BUSINESS_DATASET_REQUIRED_FIELDS,
  type PortBusinessRecord,
} from './portBusinessDataset.ts';
import {
  assessPortBusinessProposal,
  loadPortBusinessChampionStatus,
} from './portBusinessRlService.ts';
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readBody = async (request: IncomingMessage) => {
  if (!String(request.headers['content-type'] ?? '').includes('application/json')) {
    throw new Error('Content-Type 必须是 application/json');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1_024) throw new Error('港口业务动作评估输入超过 512 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as unknown;
};

const validateProposal = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.record) || !isRecord(value.state) ||
      typeof value.requestedActionId !== 'string') {
    throw new Error('请求必须包含 record、state 和 requestedActionId');
  }
  if (!PORT_BUSINESS_ACTIONS.some((action) => action.id === value.requestedActionId)) {
    throw new Error('requestedActionId 不在动作白名单');
  }
  for (const field of PORT_BUSINESS_DATASET_REQUIRED_FIELDS) {
    if (value.record[field] === undefined || value.record[field] === null) {
      throw new Error(`record 缺少 ${field}`);
    }
  }
  for (const field of [
    'queueVessels',
    'deferredBacklogVessels',
    'recoveryBacklogVessels',
    'yardOccupancy',
    'gateQueuePressure',
    'fairnessGap',
  ]) {
    if (!Number.isFinite(value.state[field])) throw new Error(`state.${field} 必须是有限数值`);
  }
  const previousActionId = value.state.previousActionId;
  if (typeof previousActionId !== 'string' ||
      !PORT_BUSINESS_ACTIONS.some((action) => action.id === previousActionId)) {
    throw new Error('state.previousActionId 不在动作白名单');
  }
  return {
    record: value.record as unknown as PortBusinessRecord,
    state: value.state as unknown as PortBusinessDynamicState,
    requestedActionId: value.requestedActionId as BusinessActionId,
  };
};

export const createPortBusinessRlMiddleware = () => {
  const token = validateRuntimeSecurityConfiguration(
    process.env.HOST || '127.0.0.1',
    process.env.PORT_API_TOKEN,
  ).token;
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!['/api/rl/business/status', '/api/rl/business/project'].includes(url.pathname)) return next();
    try {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        json(response, { status: 'error', message: '港口业务强化学习接口只允许同源浏览器或无 Origin 的服务端请求' }, 403);
        return;
      }
      if (token) {
        const authorization = request.headers.authorization ?? '';
        if (!authorization.startsWith('Bearer ') || !safeEqual(authorization.slice(7), token)) {
          json(response, { status: 'error', message: '需要有效的 Bearer 访问令牌' }, 401);
          return;
        }
      }
      if (url.pathname === '/api/rl/business/status') {
        if (request.method !== 'GET') {
          response.setHeader('Allow', 'GET');
          json(response, { status: 'error', message: 'Method not allowed' }, 405);
          return;
        }
        json(response, await loadPortBusinessChampionStatus());
        return;
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        json(response, { status: 'error', message: 'Method not allowed' }, 405);
        return;
      }
      json(response, assessPortBusinessProposal(validateProposal(await readBody(request))));
    } catch (error) {
      json(response, { status: 'error', message: error instanceof Error ? error.message : String(error) }, 422);
    }
  };
};

export const portBusinessRlPlugin = (): Plugin => ({
  name: 'malacca-port-business-rl-api',
  configureServer(server) { server.middlewares.use(createPortBusinessRlMiddleware()); },
  configurePreviewServer(server) { server.middlewares.use(createPortBusinessRlMiddleware()); },
});
