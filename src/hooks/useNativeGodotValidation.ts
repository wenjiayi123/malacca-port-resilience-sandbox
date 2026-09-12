import { useEffect, useLayoutEffect, useState } from 'react';
import {
  cancelNativeGodotValidation, createNativeGodotValidation, fetchNativeGodotAvailability,
  fetchNativeGodotValidation, isNativeGodotJob,
  type NativeGodotAvailability, type NativeGodotJob,
} from '../integrations/nativeGodotValidationAdapter.ts';
import type { GodotValidationRequest, GodotValidationResult } from '../types/sandbox';

export interface NativeGodotState {
  availability: NativeGodotAvailability | null;
  job: NativeGodotJob | null;
  busy: boolean;
  message: string;
  error: string;
}
interface Transport {
  availability: typeof fetchNativeGodotAvailability;
  create: typeof createNativeGodotValidation;
  read: typeof fetchNativeGodotValidation;
  cancel: typeof cancelNativeGodotValidation;
}
interface Run {
  request: GodotValidationRequest;
  authToken: string;
  job: NativeGodotJob | null;
  controller: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  poll?: ReturnType<typeof setTimeout>;
  settled: Promise<void>;
  finish: () => void;
  resultDelivered?: boolean;
  windowReadFailures?: number;
}
const completedMessage = (windowOpen: boolean) => windowOpen ? '独立验证已完成；窗口保持打开。' : '独立窗口已关闭，已有验证结果已保留。';
const active = (job: NativeGodotJob | null) => job?.status === 'launching' || job?.status === 'running';
const identity = (request: GodotValidationRequest | null) => request ? `${request.requestId}\u0000${request.vesselId}` : '';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '独立模拟器运行失败，请检查本地服务。';

/** Owns only jobs started by this controller; status discovery never adopts another job. */
export class NativeGodotValidationController {
  state: NativeGodotState = { availability: null, job: null, busy: false, message: '', error: '' };
  private listeners = new Set<(state: NativeGodotState) => void>();
  private run: Run | null = null;
  private disposed = false;
  private availabilityGeneration = 0;
  private requestIdentity = '';
  private closing = false;
  private getRequest: () => GodotValidationRequest | null;
  private onResult: (result: GodotValidationResult) => void;
  private transport: Transport;
  private clock: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;
  private getAuthToken: () => string;
  private jobTokens = new Map<string, string>();
  constructor(
    getRequest: () => GodotValidationRequest | null,
    onResult: (result: GodotValidationResult) => void,
    transport: Transport = { availability: fetchNativeGodotAvailability, create: createNativeGodotValidation, read: fetchNativeGodotValidation, cancel: cancelNativeGodotValidation },
    clock: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis,
    getAuthToken: () => string = () => '',
  ) {
    this.getRequest = getRequest; this.onResult = onResult; this.transport = transport;
    this.clock = clock; this.getAuthToken = getAuthToken;
    this.requestIdentity = identity(getRequest());
  }

  subscribe = (listener: (state: NativeGodotState) => void) => {
    this.disposed = false;
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  };
  updateInputs = (request: GodotValidationRequest | null, onResult: (result: GodotValidationResult) => void, authToken: string) => {
    this.getRequest = () => request;
    this.onResult = onResult;
    this.getAuthToken = () => authToken;
    this.syncRequest();
  };
  private publish(patch: Partial<NativeGodotState>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
  private current(run: Run) { return !this.disposed && this.run === run && identity(this.getRequest()) === identity(run.request); }
  private stopTimers(run: Run) {
    if (run.deadline !== undefined) this.clock.clearTimeout(run.deadline);
    if (run.poll !== undefined) this.clock.clearTimeout(run.poll);
    run.deadline = undefined; run.poll = undefined;
    run.controller.abort();
  }
  private async closeDetached(job: NativeGodotJob | null, closeCompletedWindow = false) {
    if (!active(job) && !(closeCompletedWindow && job?.windowOpen)) return;
    try { await this.transport.cancel(job!.id, undefined, this.jobTokens.get(job!.id) ?? ''); } catch (error) {
      this.publish({ error: `此前独立模拟器任务 ${job!.id} 的关闭未获确认：${errorMessage(error)}` });
    }
  }
  syncRequest = () => {
    const next = identity(this.getRequest());
    if (next === this.requestIdentity) return;
    this.requestIdentity = next;
    const run = this.run;
    this.run = null;
    if (run) { this.stopTimers(run); run.finish(); void this.closeDetached(run.job); }
    this.publish({ job: null, busy: this.closing, message: '', error: '' });
  };
  dispose = () => {
    this.disposed = true;
    this.availabilityGeneration += 1;
    const run = this.run;
    this.run = null;
    if (run) { this.stopTimers(run); run.finish(); void this.closeDetached(run.job); }
    this.listeners.clear();
  };
  refreshAvailability = async () => {
    const generation = ++this.availabilityGeneration;
    try {
      const availability = await this.transport.availability(undefined, this.getAuthToken());
      if (this.disposed || generation !== this.availabilityGeneration) return;
      this.publish({ availability, ...(this.run ? {} : { message: availability.message, error: availability.available ? '' : availability.message }) });
    } catch (error) {
      if (this.disposed || generation !== this.availabilityGeneration) return;
      this.publish({ availability: null, error: errorMessage(error) });
    }
  };
  private receive(run: Run, job: NativeGodotJob) {
    if (!isNativeGodotJob(job) || job.requestId !== run.request.requestId || job.vesselId !== run.request.vesselId ||
        (run.job && run.job.id !== job.id)) throw new Error('独立模拟器任务与当前请求或船舶不匹配，结果已拒绝。');
    this.jobTokens.set(job.id, run.authToken);
    if (!this.current(run)) { void this.closeDetached(job, true); return; }
    run.job = job;
    this.publish({ job });
    if (active(job)) {
      this.publish({ message: job.status === 'launching' ? '正在启动独立模拟器…' : '独立模拟器正在验证，等待真实结果回写…' });
      run.poll = this.clock.setTimeout(() => { void this.poll(run); }, 1000);
      return;
    }
    this.stopTimers(run);
    this.publish({ busy: false, message: job.status === 'completed' ? completedMessage(job.windowOpen) : job.status === 'cancelled' ? '独立模拟器已停止。' : '独立模拟器启动或运行失败。', error: job.status === 'failed' ? job.error || '独立模拟器未返回验证结果。' : '' });
    run.finish();
    if (job.status === 'completed' && !run.resultDelivered) {
      run.resultDelivered = true;
      this.onResult(job.result!);
      this.watchCompletedWindow(run);
    }
  }
  private watchCompletedWindow(run: Run) {
    if (!this.current(run) || !run.job?.windowOpen) return;
    run.controller = new AbortController();
    run.windowReadFailures = 0;
    // Keep the completed evidence settled while observing only this owned window.
    // Reads retain the adapter's eight-second timeout and never overlap.
    run.deadline = this.clock.setTimeout(() => {
      if (!this.current(run)) return;
      this.stopTimers(run);
      this.publish({ message: '窗口状态监测已结束，验证结果已保留；可手动关闭独立窗口。' });
    }, 30 * 60_000);
    run.poll = this.clock.setTimeout(() => { void this.pollCompletedWindow(run); }, 5000);
  }
  private async pollCompletedWindow(run: Run) {
    if (!this.current(run) || !run.resultDelivered || !run.job?.windowOpen || run.controller.signal.aborted) return;
    try {
      const observed = await this.transport.read(run.job.id, run.controller.signal, run.authToken);
      if (!this.current(run) || run.controller.signal.aborted) return;
      if (!isNativeGodotJob(observed) || observed.id !== run.job.id || observed.requestId !== run.request.requestId ||
        observed.vesselId !== run.request.vesselId || observed.status !== 'completed') throw new Error('独立窗口状态与已完成的任务不匹配。');
      run.windowReadFailures = 0;
      // The original terminal result is immutable; monitoring never re-imports it.
      run.job = { ...run.job, windowOpen: observed.windowOpen, updatedAt: observed.updatedAt };
      this.publish({ job: run.job, message: completedMessage(observed.windowOpen), error: '' });
      if (!observed.windowOpen) { this.stopTimers(run); return; }
    } catch (error) {
      if (!this.current(run) || run.controller.signal.aborted) return;
      run.windowReadFailures = (run.windowReadFailures ?? 0) + 1;
      this.publish({ message: '验证结果已保留；暂时无法确认独立窗口状态。', error: `窗口状态同步失败：${errorMessage(error)}` });
      if (run.windowReadFailures >= 3) {
        this.stopTimers(run);
        this.publish({ message: '窗口状态监测已停止，验证结果已保留；可手动关闭独立窗口。' });
        return;
      }
    }
    run.poll = this.clock.setTimeout(() => { void this.pollCompletedWindow(run); }, 5000);
  }
  private async poll(run: Run) {
    if (!this.current(run)) return;
    try { this.receive(run, await this.transport.read(run.job!.id, run.controller.signal, run.authToken)); }
    catch (error) { this.fail(run, errorMessage(error)); }
  }
  private fail(run: Run, message: string) {
    if (!this.current(run)) return;
    this.stopTimers(run);
    this.run = null;
    run.finish();
    this.publish({ busy: false, error: message, message: '本次独立验证未完成。' });
    void this.closeDetached(run.job);
  }
  start = async () => {
    this.syncRequest();
    if (this.disposed || this.state.busy || this.closing) return;
    const request = this.getRequest();
    if (!request) { this.publish({ error: '请先生成当前船舶的验证请求。' }); return; }
    const previous = this.run;
    if (previous) { this.stopTimers(previous); previous.finish(); }
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    const run: Run = { request, authToken: this.getAuthToken(), job: null, controller: new AbortController(), settled, finish };
    this.run = run;
    this.publish({ busy: true, job: null, error: '', message: '正在检查本地独立模拟器…' });
    run.deadline = this.clock.setTimeout(() => this.fail(run, '独立模拟器等待超过 120 秒，已停止本次验证；请检查本地窗口后重试。'), 120_000);
    try {
      const availability = await this.transport.availability(run.controller.signal, run.authToken);
      if (!this.current(run)) return;
      this.publish({ availability });
      if (!availability.available) throw new Error(availability.message || '当前环境不支持独立模拟器；不会自动切换到 Web 模拟器。');
      // A create response may arrive after reset/unmount. Do not abort this bounded
      // request: retaining its returned job ID lets us close the job we created.
      const job = await this.transport.create(request, undefined, run.authToken);
      this.receive(run, job);
    } catch (error) { this.fail(run, errorMessage(error)); }
    await run.settled;
  };
  cancel = async () => {
    if (this.closing || this.disposed) return;
    this.closing = true;
    const run = this.run;
    const previous = run?.job ?? this.state.job;
    const cancelledIdentity = identity(this.getRequest());
    this.run = null;
    if (run) { this.stopTimers(run); run.finish(); }
    this.publish({ busy: true, message: '正在关闭本任务的独立模拟器…', error: '' });
    try {
      if (previous) {
        const closed = await this.transport.cancel(previous.id, undefined, this.jobTokens.get(previous.id) ?? '');
        if (closed.id !== previous.id || closed.requestId !== previous.requestId || closed.vesselId !== previous.vesselId) throw new Error('关闭响应与本任务不匹配。');
        if (identity(this.getRequest()) === cancelledIdentity) this.publish({
          job: { ...closed, status: previous.status === 'completed' ? 'completed' : closed.status, result: closed.result ?? previous.result },
          message: closed.windowOpen ? '独立窗口尚未确认关闭，请重试关闭。' : previous.result ? '独立窗口已关闭，已有验证结果已保留。' : '本次独立验证已取消，未生成验证结果。',
        });
      } else this.publish({ message: '启动已取消；若创建响应迟到，将自动关闭本次任务。' });
    } catch (error) { this.publish({ error: `关闭独立窗口失败：${errorMessage(error)}` }); }
    finally { this.closing = false; this.publish({ busy: false }); }
  };
}

export function useNativeGodotValidation(request: GodotValidationRequest | null, onResult: (result: GodotValidationResult) => void, authToken = '') {
  const [controller] = useState(() => new NativeGodotValidationController(() => null, () => {}));
  const [state, setState] = useState(controller.state);
  // Synchronize before browser events or promise callbacks can observe a newly
  // committed request; abandoned React renders cannot retarget an active run.
  useLayoutEffect(() => { controller.updateInputs(request, onResult, authToken); }, [controller, request, onResult, authToken]);
  useEffect(() => { const unsubscribe = controller.subscribe(setState); return () => { unsubscribe(); controller.dispose(); }; }, [controller]);
  useEffect(() => { void controller.refreshAvailability(); }, [controller, authToken]);
  return { ...state, start: controller.start, cancel: controller.cancel, refreshAvailability: controller.refreshAvailability };
}
