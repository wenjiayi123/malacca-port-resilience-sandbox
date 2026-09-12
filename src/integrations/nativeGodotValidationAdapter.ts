import { isGodotValidationResult } from './godotValidationAdapter.ts';
import type { GodotValidationRequest, GodotValidationResult } from '../types/sandbox';

export interface NativeGodotAvailability {
  available: boolean;
  mode: 'native';
  engineVersion?: string;
  sourceGitSha?: string;
  message: string;
  activeJobId?: string;
}
export type NativeGodotJobStatus = 'launching' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface NativeGodotJob {
  id: string;
  requestId: string;
  vesselId: string;
  status: NativeGodotJobStatus;
  createdAt: string;
  updatedAt: string;
  windowOpen: boolean;
  result?: GodotValidationResult;
  error?: string;
}
const base = '/api/godot/native';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value));

async function requestJson(endpoint: string, init: RequestInit, signal?: AbortSignal, authToken = ''): Promise<unknown> {
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000);
  const headers = new Headers(init.headers);
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`);
  let response: Response;
  try {
    response = await fetch(endpoint, { ...init, headers, cache: 'no-store', signal: boundedSignal });
    const body = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch {
      throw new Error(`独立模拟器接口返回了非 JSON 内容（HTTP ${response.status}）；请通过支持本地 Godot 的服务打开页面。`);
    }
    if (!response.ok) {
      const detail = record(parsed) && (text(parsed.error) ? parsed.error : text(parsed.message) ? parsed.message : '');
      throw new Error(`独立模拟器请求失败（HTTP ${response.status}）${detail ? `：${detail}` : '，请检查本地 Godot 服务。'}`);
    }
    return parsed;
  } catch (error) {
    if (boundedSignal.aborted) throw new Error(signal?.aborted ? '独立模拟器请求已取消。' : '独立模拟器接口 8 秒内未响应，请检查本地服务后重试。', { cause: error });
    if (error instanceof TypeError) throw new Error('独立模拟器接口不可达，请确认当前页面连接了本地 Godot 服务；不会自动切换到 Web 模拟器。', { cause: error });
    throw error instanceof Error ? error : new Error('独立模拟器接口不可达；不会自动切换到 Web 模拟器。');
  }
}

export function isNativeGodotJob(value: unknown): value is NativeGodotJob {
  if (!record(value) || !text(value.id) || !text(value.requestId) || !text(value.vesselId) ||
      !['launching', 'running', 'completed', 'failed', 'cancelled'].includes(String(value.status)) ||
      !date(value.createdAt) || !date(value.updatedAt) || typeof value.windowOpen !== 'boolean' ||
      (value.error !== undefined && typeof value.error !== 'string')) return false;
  if (value.status === 'completed' && !isGodotValidationResult(value.result)) return false;
  return value.result === undefined || (isGodotValidationResult(value.result) &&
    value.result.requestId === value.requestId && value.result.vesselId === value.vesselId);
}

async function jobRequest(endpoint: string, init: RequestInit, signal?: AbortSignal, authToken = ''): Promise<NativeGodotJob> {
  const value = await requestJson(endpoint, init, signal, authToken);
  if (!isNativeGodotJob(value)) throw new Error('独立模拟器返回的任务或验证结果格式无效，未写入当前闭环。');
  return value;
}
export async function fetchNativeGodotAvailability(signal?: AbortSignal, authToken = ''): Promise<NativeGodotAvailability> {
  const value = await requestJson(`${base}/status`, {}, signal, authToken);
  if (!record(value) || typeof value.available !== 'boolean' || value.mode !== 'native' || typeof value.message !== 'string' ||
      ['engineVersion', 'sourceGitSha', 'activeJobId'].some((key) => value[key] !== undefined && !text(value[key]))) {
    throw new Error('当前服务不支持本地独立模拟器，或状态接口格式无效；不会自动切换到 Web 模拟器。');
  }
  return value as unknown as NativeGodotAvailability;
}
export const createNativeGodotValidation = (request: GodotValidationRequest, signal?: AbortSignal, authToken = '') =>
  jobRequest(`${base}/validations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }, signal, authToken);
export const fetchNativeGodotValidation = (id: string, signal?: AbortSignal, authToken = '') =>
  jobRequest(`${base}/validations/${encodeURIComponent(id)}`, {}, signal, authToken);
export const cancelNativeGodotValidation = (id: string, signal?: AbortSignal, authToken = '') =>
  jobRequest(`${base}/validations/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, signal, authToken);
