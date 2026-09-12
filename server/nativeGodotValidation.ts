import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isGodotValidationResult } from '../src/integrations/godotValidationAdapter.ts';
import type { GodotValidationRequest, GodotValidationResult } from '../src/types/sandbox.ts';

const runFile = promisify(execFile);
const publicError = (error: unknown) => error instanceof Error && /^[本当验航风调创模速独]/u.test(error.message) ? error.message : '本机模拟器不可用，请检查 Godot 安装及最新完整导出';
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && ![...value].some((character) => character.charCodeAt(0) < 32);
const number = (value: unknown, minimum: number, maximum: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

export function validateNativeGodotRequest(value: unknown): GodotValidationRequest {
  if (!record(value)) throw new Error('验证请求必须是 JSON 对象');
  for (const key of ['requestId', 'vesselId', 'vesselName', 'imo', 'category', 'routeId', 'channelId']) {
    if (!text(value[key], 200)) throw new Error(`验证请求缺少有效 ${key}`);
  }
  if (!text(value.createdAt, 64) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('createdAt 必须是有效时间');
  for (const key of ['origin', 'destination']) {
    const endpoint = value[key];
    if (!record(endpoint) || !text(endpoint.portId, 200) || !text(endpoint.portName, 200) || !record(endpoint.geo) ||
      !number(endpoint.geo.lat, -90, 90) || !number(endpoint.geo.lon, -180, 180)) throw new Error(`${key} 必须包含有效港口及经纬度`);
  }
  if (!record(value.speedProfile) || !['initialKnots', 'targetKnots', 'minSafeKnots', 'maxSafeKnots'].every((key) => number((value.speedProfile as Record<string, unknown>)[key], 0, 100)) ||
    Number(value.speedProfile.minSafeKnots) > Number(value.speedProfile.maxSafeKnots)) throw new Error('speedProfile 无效');
  if (!number(value.headingDeg, -360, 360) || !number(value.progressPercent, 0, 100)) throw new Error('航向或航段进度无效');
  if (!Array.isArray(value.riskEvents) || value.riskEvents.length > 32) throw new Error('风险事件数量超过限制');
  for (const risk of value.riskEvents) {
    if (!record(risk) || !['id', 'label', 'affectedArea', 'recommendedAction'].every((key) => text(risk[key])) ||
      !['channel-closure', 'extreme-weather', 'collision-risk', 'port-paralysis', 'energy-control', 'manual-event'].includes(String(risk.type)) ||
      !['ok', 'warning', 'danger'].includes(String(risk.severity)) ||
      !number(risk.startMinute, 0, 10_000_000) || !number(risk.expectedDurationMinutes, 0, 10_000_000)) throw new Error('风险事件字段无效');
  }
  if (!Array.isArray(value.dispatchStrategyIds) || value.dispatchStrategyIds.length > 64 || !value.dispatchStrategyIds.every((id) => text(id, 200))) throw new Error('调度策略列表无效');
  // Only known data fields cross into the process; caller-provided paths and executable options are discarded.
  return Object.fromEntries(['requestId', 'vesselId', 'vesselName', 'imo', 'category', 'routeId', 'channelId', 'origin', 'destination', 'speedProfile', 'headingDeg', 'progressPercent', 'riskEvents', 'dispatchStrategyIds', 'createdAt'].map((key) => [key, structuredClone(value[key])])) as unknown as GodotValidationRequest;
}

export interface NativeGodotJob {
  id: string; requestId: string; vesselId: string;
  status: 'launching' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string; updatedAt: string; windowOpen: boolean; sourceGitSha: string; pckSha256: string;
  result?: GodotValidationResult; error?: string;
}
interface OwnedJob { public: NativeGodotJob; child?: ChildProcess; directory: string; timer?: NodeJS.Timeout; polling: Promise<void> | null; startedAt: number; leaseTimer?: NodeJS.Timeout; stopping?: Promise<void>; }
export interface NativeGodotOptions {
  projectRoot?: string; enginePath?: string; exportDirectory?: string; runtimeDirectory?: string;
  /** Tests only: never accepted from HTTP or enabled from a browser-supplied request. */
  headless?: boolean; timeoutMs?: number; pollMs?: number;
}

export class NativeGodotValidationService {
  private readonly options: NativeGodotOptions;
  private readonly jobs = new Map<string, OwnedJob>();
  private readonly root: string;
  private starting = false;
  private disposed = false;
  private verifiedSignature = '';
  private engineVersion = '';
  constructor(options: NativeGodotOptions = {}) { this.options = options; this.root = path.resolve(options.projectRoot ?? process.cwd()); }
  private async configuration() {
    const candidates = [this.options.enginePath ?? process.env.GODOT_BIN, '/Applications/Godot.app/Contents/MacOS/Godot', ...String(process.env.PATH ?? '').split(path.delimiter).flatMap((directory) => [path.join(directory, 'godot4'), path.join(directory, 'godot')])].filter((value): value is string => Boolean(value));
    const engine = await (async () => { for (const candidate of candidates) { try { if (path.isAbsolute(candidate)) { await access(candidate, constants.X_OK); return candidate; } } catch { /* try next installed engine */ } } return ''; })();
    if (!engine) throw new Error('本机未找到 Godot；请配置 GODOT_BIN');
    const directory = path.resolve(this.options.exportDirectory ?? path.join(this.root, 'public/godot-simulator'));
    const pack = path.join(directory, 'index.pck');
    const runner = path.join(this.root, 'scripts/demo/native_godot_validation_runner.gd');
    const [packStat, engineStat, runnerStat, raw] = await Promise.all([stat(pack), stat(engine), stat(runner), readFile(path.join(directory, 'export-manifest.json'), 'utf8')]);
    const manifest = JSON.parse(raw);
    if (!packStat.isFile() || !runnerStat.isFile() || !manifest.sourceIsolatedBeforeImport || manifest.coordinateValidation?.caseCount !== 3 ||
      manifest.coordinateValidation?.mappingInvariantChecks < 10 || manifest.artifacts?.['index.pck']?.bytes !== packStat.size ||
      !/^[a-f0-9]{64}$/u.test(manifest.artifacts?.['index.pck']?.sha256 ?? '')) throw new Error('当前 Godot 导出未通过坐标兼容验收，请重新导出');
    const signature = `${engine}:${engineStat.mtimeMs}:${pack}:${packStat.mtimeMs}:${packStat.size}:${raw}`;
    if (signature !== this.verifiedSignature) {
      const version = (await runFile(engine, ['--version'], { timeout: 5_000, maxBuffer: 4096 })).stdout.trim();
      if (!version.startsWith('4.7.1.')) throw new Error('本地验证要求与导出匹配的 Godot 4.7.1');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(pack)) hash.update(chunk);
      if (hash.digest('hex') !== manifest.artifacts['index.pck'].sha256) throw new Error('Godot PCK 与已验收清单不一致');
      this.engineVersion = version;
      this.verifiedSignature = signature;
    }
    return { engine, pack, runner, sourceGitSha: manifest.source.gitSha as string, pckSha256: manifest.artifacts['index.pck'].sha256 as string };
  }
  async availability() {
    try {
      const config = await this.configuration();
      return { available: true, mode: 'native' as const, engineVersion: this.engineVersion, sourceGitSha: config.sourceGitSha, message: '本机独立模拟器可用，数据直接传入已验收的最新场景', activeJobId: [...this.jobs.values()].find((job) => job.public.windowOpen)?.public.id };
    } catch (error) { return { available: false, mode: 'native' as const, message: publicError(error) }; }
  }
  async start(value: unknown): Promise<NativeGodotJob> {
    if (this.disposed) throw new NativeGodotHttpError(503, '独立模拟器服务已关闭');
    const request = validateNativeGodotRequest(value);
    if (this.starting || [...this.jobs.values()].some((job) => ['launching', 'running'].includes(job.public.status))) throw new NativeGodotHttpError(409, '已有独立模拟器验证正在运行');
    this.starting = true;
    try {
      const config = await this.configuration();
      for (const job of this.jobs.values()) if (job.public.windowOpen) await this.stop(job);
      const runtime = path.resolve(this.options.runtimeDirectory ?? path.join(os.tmpdir(), 'malacca-native-godot'));
      await mkdir(runtime, { recursive: true, mode: 0o700 });
      const directory = await mkdtemp(path.join(runtime, 'validation-'));
      const id = randomUUID();
      const now = new Date().toISOString();
      const job: OwnedJob = { public: { id, requestId: request.requestId, vesselId: request.vesselId, status: 'launching', createdAt: now, updatedAt: now, windowOpen: false, sourceGitSha: config.sourceGitSha, pckSha256: config.pckSha256 }, directory, polling: null, startedAt: Date.now() };
      await writeFile(path.join(directory, 'request.json'), JSON.stringify(request), { mode: 0o600 });
      await writeFile(path.join(directory, 'lease'), String(Date.now()), { mode: 0o600 });
      const args = [...(this.options.headless ? ['--headless'] : ['--windowed', '--resolution', '1280x720', '--max-fps', '60']), '--main-pack', config.pack, '--script', config.runner, '--log-file', path.join(directory, 'engine.log'), '--', `--request=${path.join(directory, 'request.json')}`, `--result=${path.join(directory, 'result.json')}`, `--status=${path.join(directory, 'status.json')}`, `--lease=${path.join(directory, 'lease')}`];
      if (this.disposed) throw new NativeGodotHttpError(503, '独立模拟器服务已关闭');
      const child = spawn(config.engine, args, { cwd: directory, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      job.child = child;
      job.leaseTimer = setInterval(() => { void writeFile(path.join(directory, 'lease'), String(Date.now()), { mode: 0o600 }).catch(() => undefined); }, 1000);
      job.leaseTimer.unref();
      this.jobs.set(id, job);
      // Continuously drain both pipes. Retain only a small diagnostic tail in memory.
      let diagnostic = '';
      const capture = (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-16_384); };
      child.stdout?.on('data', capture); child.stderr?.on('data', capture);
      child.once('spawn', () => { job.public.windowOpen = true; job.public.updatedAt = new Date().toISOString(); });
      child.once('error', (error) => this.fail(job, publicError(error)));
      child.once('exit', () => {
        job.public.windowOpen = false;
        clearInterval(job.leaseTimer);
        void this.poll(job).then(() => this.poll(job)).finally(() => {
          if (['launching', 'running'].includes(job.public.status)) this.fail(job, '独立模拟器已关闭，未收到完整验证结果');
          void writeFile(path.join(directory, 'process-output.log'), diagnostic, { mode: 0o600 }).catch(() => undefined);
        });
      });
      job.timer = setInterval(() => { void this.poll(job); }, this.options.pollMs ?? 150);
      job.timer.unref();
      // Completed metadata stays available without unbounded memory growth.
      for (const [oldId, oldJob] of this.jobs) { if (this.jobs.size <= 100) break; if (!oldJob.public.windowOpen && !['launching', 'running'].includes(oldJob.public.status)) this.jobs.delete(oldId); }
      return structuredClone(job.public);
    } catch (error) { if (error instanceof NativeGodotHttpError) throw error; throw new NativeGodotHttpError(503, publicError(error)); }
    finally { this.starting = false; }
  }
  private poll(job: OwnedJob): Promise<void> {
    if (job.polling) return job.polling;
    const pending = this.readJob(job).catch((error) => this.fail(job, publicError(error))).finally(() => { job.polling = null; });
    job.polling = pending;
    return pending;
  }
  private async readJob(job: OwnedJob) {
    if (!['launching', 'running'].includes(job.public.status)) return;
    {
      try {
        const metadata = await stat(path.join(job.directory, 'result.json'));
        if (metadata.size > 1_048_576) { this.fail(job, '模拟器回执超过大小限制'); return; }
        const value: unknown = JSON.parse(await readFile(path.join(job.directory, 'result.json'), 'utf8'));
        if (!['launching', 'running'].includes(job.public.status)) return;
        if (record(value) && value.status !== 'running') {
          if (!isGodotValidationResult(value) || value.requestId !== job.public.requestId || value.vesselId !== job.public.vesselId) { this.fail(job, '模拟器回执字段或请求标识不匹配'); return; }
          job.public.result = value; job.public.status = 'completed'; job.public.updatedAt = new Date().toISOString();
          clearInterval(job.timer);
          await this.persist(job);
          return;
        }
      } catch { /* No result yet, or the engine is atomically replacing it. */ }
      try { if ((await stat(path.join(job.directory, 'status.json'))).isFile() && job.public.status === 'launching') { job.public.status = 'running'; job.public.updatedAt = new Date().toISOString(); } } catch { /* engine still loading */ }
      if (Date.now() - job.startedAt > (this.options.timeoutMs ?? 90_000)) this.fail(job, '独立模拟器验证超时，已关闭本次进程');
    }
  }
  private async persist(job: OwnedJob) { await writeFile(path.join(job.directory, 'job.json'), JSON.stringify(job.public, null, 2), { mode: 0o600 }); }
  private fail(job: OwnedJob, message: string) {
    if (!['launching', 'running'].includes(job.public.status)) return;
    job.public.status = 'failed'; job.public.error = message; job.public.updatedAt = new Date().toISOString();
    void this.stop(job).finally(() => this.persist(job)).catch(() => undefined);
  }
  private stop(job: OwnedJob): Promise<void> {
    if (job.stopping) return job.stopping;
    clearInterval(job.timer); clearInterval(job.leaseTimer);
    const child = job.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) { job.public.windowOpen = false; return Promise.resolve(); }
    job.stopping = new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(force); clearTimeout(limit); job.public.windowOpen = false; resolve(); };
      child.once('exit', done);
      const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000);
      const limit = setTimeout(() => { child.off('exit', done); reject(new Error('独立模拟器进程尚未确认退出')); }, 5000);
      child.kill('SIGTERM');
    });
    return job.stopping;
  }
  get(id: string) { const job = this.jobs.get(id); return job ? structuredClone(job.public) : undefined; }
  async cancel(id: string) {
    const job = this.jobs.get(id); if (!job) return undefined;
    if (['launching', 'running'].includes(job.public.status)) job.public.status = 'cancelled';
    job.public.updatedAt = new Date().toISOString(); await this.stop(job); await this.persist(job);
    return structuredClone(job.public);
  }
  async dispose() { this.disposed = true; await Promise.all([...this.jobs.values()].map((job) => this.cancel(job.public.id))); }
}
export class NativeGodotHttpError extends Error { statusCode: number; constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; } }
