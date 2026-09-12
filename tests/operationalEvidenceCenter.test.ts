import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PortOperationsSimulator } from '../server/operationalSimulator.ts';

type Element = { type?: string; props?: Record<string, unknown> };
type Hook = { value?: unknown; dependencies?: unknown[]; cleanup?: () => void };
type Adapter = (...args: unknown[]) => unknown;

// Drive the actual component handlers and effects without a browser dependency.
// The parent audit separately verifies layout and native clicks in the browser.
const createHarness = async () => {
  const initialSnapshot = new PortOperationsSimulator({ seed: 12, startedAtMs: 0 }).snapshot(0);
  const adapters: Record<string, Adapter> = {
    fetchOperationsSnapshot: async () => initialSnapshot,
    fetchOperationalRecommendations: async () => ({ candidates: [], input_snapshot_hash: initialSnapshot.snapshot_hash }),
    fetchOperationalAudit: async () => ({ records: [], record_count: 0 }),
    fetchOperationalModels: async () => ({ models: [] }),
    fetchRegulatoryResilience: async () => null,
    fetchProductionReadiness: async () => null,
    fetchPortBusinessChampionStatus: async () => ({ champion: { admitted: true } }),
    fetchCoreOperationsChampionStatus: async () => ({ champion: { admitted: true }, contract: {} }),
  };
  const hooks: Hook[] = [];
  const timers = new Map<number, () => void>();
  const downloadCleanup: Array<() => void> = [];
  const downloads: Array<{ href: string; download: string }> = [];
  const blobs: Blob[] = [];
  const revokedUrls: string[] = [];
  const downloadState = { fail: false };
  let timerId = 0;
  let cursor = 0;
  let pendingEffects: Array<() => void> = [];
  const equal = (a?: unknown[], b?: unknown[]) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory: () => unknown, dependencies?: unknown[]) => {
    const index = cursor++;
    if (!hooks[index] || !equal(hooks[index].dependencies, dependencies)) {
      hooks[index] = { value: factory(), dependencies };
    }
    return hooks[index].value;
  };
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, (value: unknown) => {
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
      }];
    },
    useRef: (value: unknown) => memo(() => ({ current: value }), []),
    useMemo: memo,
    useCallback: (value: unknown, dependencies: unknown[]) => memo(() => value, dependencies),
    useEffect(effect: () => (() => void) | void, dependencies: unknown[]) {
      const index = cursor++;
      if (!hooks[index] || !equal(hooks[index].dependencies, dependencies)) {
        pendingEffects.push(() => {
          hooks[index]?.cleanup?.();
          hooks[index] = { dependencies, cleanup: effect() || undefined };
        });
      }
    },
  };
  const source = await readFile('src/components/OperationalEvidenceCenter.tsx', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports: { OperationalEvidenceCenter?: (props: unknown) => Element } = {};
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type: string, props: unknown) => ({ type, props }), jsxs: (type: string, props: unknown) => ({ type, props }) };
      return adapters;
    },
    AbortController, AbortSignal, Error, DOMException, Blob,
    URL: {
      createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:report-${blobs.length}`; },
      revokeObjectURL: (url: string) => { revokedUrls.push(url); },
    },
    document: { createElement: () => ({ href: '', download: '', click() {
      if (downloadState.fail) throw new Error('DOWNLOAD_BLOCKED');
      downloads.push({ href: this.href, download: this.download });
    } }) },
    window: {
      setTimeout: (callback: () => void, delay: number) => {
        if (delay === 1_000) downloadCleanup.push(callback);
        else timers.set(++timerId, callback);
        return timerId;
      },
      clearTimeout: (id: number) => timers.delete(id),
    },
  });
  let tree: Element;
  let evidence: Record<string, unknown> = {};
  const onBusinessEvidenceChange = (value: Record<string, unknown>) => { evidence = value; };
  const render = () => {
    cursor = 0;
    tree = exports.OperationalEvidenceCenter!({ onBusinessEvidenceChange });
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
    return tree;
  };
  const nodes = (value: unknown = tree): Element[] => {
    if (Array.isArray(value)) return value.flatMap((entry) => nodes(entry ?? null));
    if (!value || typeof value !== 'object') return [];
    const element = value as Element;
    return [element, ...nodes(element.props?.children ?? null)];
  };
  const content = (value: unknown = tree): string => {
    if (Array.isArray(value)) return value.map((entry) => content(entry ?? null)).join('');
    if (value && typeof value === 'object') return content((value as Element).props?.children ?? null);
    return value === null || value === undefined || typeof value === 'boolean' ? '' : String(value);
  };
  const settle = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    render();
  };
  const click = async (label: string) => {
    const button = nodes().find((node) => node.type === 'button' && content(node) === label);
    assert.ok(button, `missing button: ${label}`);
    assert.equal(Boolean(button.props?.disabled), false, `button disabled: ${label}`);
    (button.props?.onClick as () => void)();
    render();
    await settle();
  };
  const poll = async () => {
    const entry = timers.entries().next().value;
    assert.ok(entry, 'poll timer available');
    timers.delete(entry[0]);
    entry[1]();
    await settle();
  };
  render();
  await poll();
  return {
    adapters, render, nodes, content, settle, click, poll, initialSnapshot, evidence: () => evidence,
    downloads, blobs, revokedUrls, downloadState,
    cleanupDownloads: () => downloadCleanup.splice(0).forEach((cleanup) => cleanup()),
  };
};

test('evidence refresh exposes independent endpoint failures, labels retained telemetry and recovers', async () => {
  const ui = await createHarness();
  ui.adapters.fetchOperationsSnapshot = async () => { throw new Error('SNAPSHOT_OFFLINE'); };
  ui.adapters.fetchCoreOperationsChampionStatus = async () => { throw new Error('CORE_OFFLINE'); };
  await ui.poll();
  assert.match(ui.content(), /实时遥测读取失败：SNAPSHOT_OFFLINE/);
  assert.match(ui.content(), /全核心联合冠军读取失败：CORE_OFFLINE/);
  assert.match(ui.content(), /上次成功快照（刷新失败）/);
  await ui.click('策略闭环');
  const infer = ui.nodes().find((node) => node.type === 'button' && ui.content(node) === '生成十域联合计划');
  assert.equal(infer?.props?.disabled, true);
  assert.equal(ui.evidence().coreChampion, null);
  ui.adapters.fetchOperationsSnapshot = async () => ui.initialSnapshot;
  ui.adapters.fetchCoreOperationsChampionStatus = async () => ({ champion: { admitted: true }, contract: {} });
  await ui.poll();
  assert.doesNotMatch(ui.content(), /SNAPSHOT_OFFLINE|CORE_OFFLINE|上次成功快照/);
});

test('a superseded refresh cannot restore pre-action telemetry after a scenario injection', async () => {
  const ui = await createHarness();
  let finishOld: ((value: unknown) => void) | undefined;
  ui.adapters.fetchOperationsSnapshot = () => new Promise((resolve) => { finishOld = resolve; });
  await ui.poll();
  await ui.click('安全治理');
  const updated = { ...ui.initialSnapshot, sequence: 99, simulator: { ...ui.initialSnapshot.simulator, scenario: 'peak-arrivals' } };
  ui.adapters.injectOperationalScenario = async () => updated;
  ui.adapters.fetchOperationsSnapshot = async () => updated;
  await ui.click('到港高峰');
  assert.equal(ui.render().props?.['data-sequence'], 99);
  finishOld?.(ui.initialSnapshot);
  await ui.settle();
  assert.equal(ui.render().props?.['data-sequence'], 99);
  assert.match(ui.content(), /注入到港高峰已由后端确认/);
});

test('core lifecycle invalidates exported reports and prevents execution after execution or rollback', async () => {
  const ui = await createHarness();
  const proposal = {
    proposalId: 'core-test', inputEvidence: {}, activeDomains: [], domainAbstentions: [],
    inference: { heads: [] }, projectedBusinessValue: {}, admission: { status: 'admitted_for_simulation_approval', blockers: [] },
    approval: { status: 'pending_simulation_review' }, execution: { status: 'not_executed', receipt: null },
  };
  ui.adapters.inferCoreOperationsPolicy = async () => structuredClone(proposal);
  ui.adapters.fetchCoreOperationsDecisionReport = async () => ({ completionStatus: 'PENDING_SIMULATION_REVIEW', proposal });
  ui.adapters.approveCoreOperationsProposal = async () => ({ ...proposal, approval: { status: 'approved_for_sandbox' } });
  ui.adapters.executeCoreOperationsProposal = async () => ({ ...proposal, approval: { status: 'approved_for_sandbox' }, execution: { status: 'executed', receipt: null } });
  ui.adapters.rollbackCoreOperationsProposal = async () => ({ ...proposal, approval: { status: 'approved_for_sandbox' }, execution: { status: 'rolled_back', receipt: null } });
  await ui.click('策略闭环');
  await ui.click('生成十域联合计划');
  await ui.click('导出联合决策报告');
  assert.ok(ui.evidence().coreReport);
  await ui.click('模拟双岗审批（测试身份）');
  assert.equal(ui.evidence().coreReport, null);
  await ui.click('执行联合沙盘计划并取回执');
  let execute = ui.nodes().find((node) => node.type === 'button' && ui.content(node) === '执行联合沙盘计划并取回执');
  assert.equal(execute?.props?.disabled, true);
  await ui.click('回滚联合计划');
  execute = ui.nodes().find((node) => node.type === 'button' && ui.content(node) === '执行联合沙盘计划并取回执');
  assert.equal(execute?.props?.disabled, true);
});

test('a failed handoff regeneration cannot reuse the previous ready result', async () => {
  const ui = await createHarness();
  ui.adapters.fetchXiaoyiOperationalHandoff = async () => ({
    generated_at: '2026-09-12T00:00:00Z', correlation_id: 'handoff-1',
    xiaoyi_model: { status: 'not-configured' }, state_summary: 'old handoff', warnings: [],
    strategy: {}, shift_handoff: {}, evidence: { trace_ids: [] },
  });
  await ui.click('安全治理');
  await ui.click('基于当前后端快照生成');
  let button = ui.nodes().find((node) => node.props?.['data-xiaoyi-action'] === 'xiaoyi-operational-handoff');
  assert.equal(button?.props?.['data-xiaoyi-state'], 'ready');
  assert.equal(button?.props?.['data-xiaoyi-revision'], '2026-09-12T00:00:00Z:handoff-1');
  ui.adapters.fetchXiaoyiOperationalHandoff = async () => { throw new Error('HANDOFF_FAILED'); };
  await ui.click('重新基于最新快照生成');
  button = ui.nodes().find((node) => node.props?.['data-xiaoyi-action'] === 'xiaoyi-operational-handoff');
  assert.equal(button?.props?.['data-xiaoyi-state'], 'idle');
  assert.equal(button?.props?.['data-xiaoyi-revision'], '');
  assert.doesNotMatch(ui.content(), /old handoff/);
  assert.match(ui.content(), /HANDOFF_FAILED/);
});

test('operational adapters reject malformed successful responses and preserve server gate errors', async (context) => {
  const { fetchOperationsSnapshot } = await import('../src/integrations/operationsControlAdapter.ts');
  const { fetchPortBusinessChampionStatus } = await import('../src/integrations/portBusinessRlAdapter.ts');
  const { fetchCoreOperationsChampionStatus } = await import('../src/integrations/coreOperationsRlAdapter.ts');
  let response = new Response('<html>SPA fallback</html>', { status: 200 });
  context.mock.method(globalThis, 'fetch', async () => response.clone());
  for (const fetchEvidence of [fetchOperationsSnapshot, fetchPortBusinessChampionStatus, fetchCoreOperationsChampionStatus]) {
    response = new Response('<html>SPA fallback</html>', { status: 200 });
    await assert.rejects(fetchEvidence(), /后端返回非 JSON 响应/);
    response = Response.json(null);
    await assert.rejects(fetchEvidence(), /后端响应格式无效/);
    response = Response.json([]);
    await assert.rejects(fetchEvidence(), /后端响应格式无效/);
    response = Response.json({ message: 'DATA_QUALITY_GATE_BLOCKED' }, { status: 409 });
    await assert.rejects(fetchEvidence(), /DATA_QUALITY_GATE_BLOCKED/);
  }
});

const decisionReport = (kind: 'port-business' | 'core-operations') => ({
  protocolVersion: `${kind}-decision-report.v1`,
  generatedAt: '2026-09-12T00:00:00.000Z',
  completionStatus: 'PENDING_SIMULATION_REVIEW',
  auditHash: 'a'.repeat(64),
  proposal: {
    protocolVersion: `${kind}-runtime-decision.v1`, proposalId: 'proposal-current',
    inputEvidence: {}, activeDomains: [], domainAbstentions: [], inference: {
      heads: [], actionDistribution: [], selectedAction: { label: 'hold plan', probability: 1, voteShare: 1 },
      uncertainty: { normalizedEntropy: 0 },
    },
    projectedBusinessValue: {}, admission: { status: 'admitted_for_simulation_approval', blockers: [] },
    businessProjection: {
      ...Object.fromEntries(['queueVessels', 'meanWaitingHours', 'yardOccupancy', 'gateQueuePressure', 'carbonIntensity', 'fairnessGap']
        .map((field) => [field, { before: 1, after: 1 }])),
      throughputRetentionPercent: 100,
    },
    approval: { status: 'pending_simulation_review' },
    execution: { status: 'not_executed', dispatchAllowed: false, productionAuthority: false, receiptIssued: false, receipt: null },
    authority: { simulation_mode: true, live_data_verified: false, dispatch_allowed: false, production_authority: false },
  },
});

test('business and core report adapters bind proposal identity and reject malformed or contradictory completion evidence', async (context) => {
  const { fetchCoreOperationsDecisionReport } = await import('../src/integrations/coreOperationsRlAdapter.ts');
  const { fetchPortBusinessDecisionReport } = await import('../src/integrations/portBusinessRlAdapter.ts');
  let payload: unknown;
  const requests: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
  context.mock.method(globalThis, 'fetch', async (url: string, options?: RequestInit) => {
    requests.push({ url, signal: options?.signal });
    return Response.json(payload);
  });
  for (const [kind, fetchReport] of [
    ['core-operations', fetchCoreOperationsDecisionReport], ['port-business', fetchPortBusinessDecisionReport],
  ] as const) {
    const valid = decisionReport(kind);
    const stages = kind === 'core-operations'
      ? [['pending_simulation_review', 'not_executed', 'PENDING_SIMULATION_REVIEW'],
        ['approved_for_sandbox', 'not_executed', 'APPROVED_NOT_EXECUTED'],
        ['approved_for_sandbox', 'executed', 'EXECUTED_SIMULATION_ONLY'],
        ['approved_for_sandbox', 'rolled_back', 'ROLLED_BACK_SIMULATION_ONLY']]
      : [['pending_simulation_review', 'not_executed', 'PENDING_SIMULATION_REVIEW'],
        ['approved_for_sandbox', 'not_executed', 'APPROVED_SIMULATION_ONLY'],
        ['not_required', 'not_executed', 'NO_ACTION_APPROVAL_REQUIRED']];
    for (const [approval, execution, completion] of stages) {
      payload = { ...valid, completionStatus: completion, proposal: {
        ...valid.proposal, approval: { status: approval }, execution: { ...valid.proposal.execution, status: execution },
      } };
      assert.deepEqual(await fetchReport('proposal-current'), payload);
    }
    for (const invalid of [
      { ...valid, completionStatus: {} }, { ...valid, completionStatus: 'COMPLETE' },
      { ...valid, completionStatus: kind === 'core-operations' ? 'EXECUTED_SIMULATION_ONLY' : 'APPROVED_SIMULATION_ONLY' },
      { ...valid, generatedAt: 'not-a-date' }, { ...valid, auditHash: {} },
      { ...valid, protocolVersion: 'another-protocol' }, { ...valid, proposal: null },
      { ...valid, proposal: { ...valid.proposal, approval: { status: ['not_required'] } } },
      { ...valid, proposal: { ...valid.proposal, execution: { ...valid.proposal.execution, dispatchAllowed: true } } },
      { ...valid, proposal: { ...valid.proposal, authority: { ...valid.proposal.authority, production_authority: true } } },
    ]) {
      payload = invalid;
      await assert.rejects(fetchReport('proposal-current'), /决策报告格式或完成状态无效/);
    }
    payload = { ...valid, proposal: { ...valid.proposal, proposalId: 'proposal-old' } };
    await assert.rejects(fetchReport('proposal-current'), /与当前提案不匹配/);
  }
  assert.ok(requests.every((request) => request.signal instanceof AbortSignal));
  assert.ok(requests.every((request) => request.url.endsWith('/proposal-current/report')));
});

for (const kind of ['core-operations', 'port-business'] as const) {
test(`${kind} download publishes validated JSON only after a successful click and always releases its URL`, async (context) => {
  const { fetchCoreOperationsDecisionReport } = await import('../src/integrations/coreOperationsRlAdapter.ts');
  const { fetchPortBusinessDecisionReport } = await import('../src/integrations/portBusinessRlAdapter.ts');
  const report = decisionReport(kind);
  const core = kind === 'core-operations';
  const reportKey = core ? 'coreReport' : 'report';
  const downloadLabel = core ? '导出联合决策报告' : '导出全业务决策报告';
  let payload: unknown = report;
  context.mock.method(globalThis, 'fetch', async () => Response.json(payload));
  const ui = await createHarness();
  ui.adapters[core ? 'inferCoreOperationsPolicy' : 'inferCurrentPortBusinessPolicy'] = async () => report.proposal;
  ui.adapters[core ? 'fetchCoreOperationsDecisionReport' : 'fetchPortBusinessDecisionReport'] =
    (proposalId: unknown) => (core ? fetchCoreOperationsDecisionReport : fetchPortBusinessDecisionReport)(String(proposalId));
  await ui.click('策略闭环');
  await ui.click(core ? '生成十域联合计划' : '基于当前权威快照推理');
  await ui.click(downloadLabel);
  assert.deepEqual(JSON.parse(await ui.blobs[0].text()), report);
  assert.equal(ui.downloads[0].download, `${kind}-decision-pending_simulation_review-proposal-current.json`);
  assert.deepEqual(ui.evidence()[reportKey], report);
  assert.deepEqual(ui.revokedUrls, []);
  ui.cleanupDownloads();
  assert.deepEqual(ui.revokedUrls, ['blob:report-1']);

  payload = { ...report, proposal: { ...report.proposal, proposalId: 'proposal-old' } };
  await ui.click(downloadLabel);
  assert.equal(ui.evidence()[reportKey], null);
  assert.equal(ui.blobs.length, 1);
  assert.match(ui.content(), /与当前提案不匹配/);
  payload = { ...report, completionStatus: {} };
  await ui.click(downloadLabel);
  assert.equal(ui.evidence()[reportKey], null);
  assert.equal(ui.blobs.length, 1);
  assert.match(ui.content(), /格式或完成状态无效/);

  payload = report;
  ui.downloadState.fail = true;
  await ui.click(downloadLabel);
  assert.equal(ui.evidence()[reportKey], null);
  assert.equal(ui.downloads.length, 1);
  assert.match(ui.content(), /DOWNLOAD_BLOCKED/);
  ui.cleanupDownloads();
  assert.deepEqual(ui.revokedUrls, ['blob:report-1', 'blob:report-2']);
});
}
