import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildXiaoyiRlAdvisorResponse, parseXiaoyiRlExternalDecision } from '../server/xiaoyiRlAdvisor.ts';
import { getRlObjectivePreset } from '../shared/rlObjectivePresets.ts';
import { requestXiaoyiRlAdvice } from '../src/integrations/xiaoyiRlAdvisorAdapter.ts';

interface ActionStep {
  target: string;
  label: string;
  skipWhenVerified?: boolean;
  verification: { mode: string; attribute: string; expected?: string[]; requireRevisionChange?: boolean; timeoutMs?: number };
}
interface Action { id: string; label: string; steps: ActionStep[] }
interface RunReference { current: { id: number; cancelled: boolean } }
interface Runtime {
  xiaoyiActions: Record<string, Action>;
  resolveXiaoyiAction: (command: string) => Action | null;
  waitForTarget: (target: string, runId: number, currentRun: RunReference) => Promise<unknown>;
  verifyStepResult: (step: ActionStep, initialValue: string | null, runId: number, currentRun: RunReference, initialRevision?: string | null) => Promise<string>;
}

const sourceText = await readFile('src/components/XiaoyiSystemAssistant.tsx', 'utf8');
const source = ts.createSourceFile('XiaoyiSystemAssistant.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Set(['moduleStep', 'startSimulationStep', 'linkedDemoStep', 'xiaoyiActions', 'normalize', 'resolveXiaoyiAction', 'delay', 'assertActiveRun', 'waitForTarget', 'readVerificationAttribute', 'verifyStepResult']);
const selected = source.statements.filter((statement) => {
  if (ts.isFunctionDeclaration(statement)) return statement.name && declarations.has(statement.name.text);
  return ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) => declarations.has(declaration.name.getText(source)));
}).map((statement) => statement.getText(source)).join('\n');
const compiled = ts.transpileModule(`${selected}\nglobalThis.runtime = { xiaoyiActions, resolveXiaoyiAction, waitForTarget, verifyStepResult };`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
const loadRuntime = (query: () => unknown = () => null, tick: () => void = () => {}) => {
  const context = vm.createContext({
    document: { querySelector: query },
    window: { setTimeout: (callback: () => void) => { tick(); queueMicrotask(callback); } },
  });
  vm.runInContext(compiled, context);
  return context.runtime as Runtime;
};

test('all 24 visible Xiaoyi action labels resolve to their registered action', () => {
  const runtime = loadRuntime();
  const actions = Object.values(runtime.xiaoyiActions);
  assert.equal(actions.length, 24);
  for (const action of actions) assert.equal(runtime.resolveXiaoyiAction(action.label)?.id, action.id, action.label);
  for (const command of ['导出沙盘推演报告', '下载港口拥堵报告']) {
    assert.equal(runtime.resolveXiaoyiAction(command)?.id, 'export-report');
  }
  assert.equal(runtime.resolveXiaoyiAction('运行最终测试集回放')?.id, 'rl-policy-test');
  assert.equal(runtime.resolveXiaoyiAction('生成小懿运行交班')?.id, 'operations-handoff');
  assert.equal(runtime.resolveXiaoyiAction('无法识别的任务'), null);
});

test('opening settings and event injection declares idempotent state verification', () => {
  const { xiaoyiActions } = loadRuntime();
  assert.equal(xiaoyiActions.settings.steps[0].skipWhenVerified, true);
  assert.equal(xiaoyiActions['inject-event'].steps[1].skipWhenVerified, true);
});

test('a cancelled Xiaoyi operation never locates another action target', async () => {
  let queries = 0;
  const runtime = loadRuntime(() => { queries += 1; return {}; });
  await assert.rejects(runtime.waitForTarget('module-sandbox', 1, { current: { id: 1, cancelled: true } }), /人工已停止/);
  assert.equal(queries, 0);
});

test('fresh advice verification rejects old ready and waits for the new response revision', async () => {
  let polls = 0;
  let ticks = 0;
  const element = { dataset: { xiaoyiState: 'ready', xiaoyiRevision: 'previous-response' } };
  const runtime = loadRuntime(() => { polls += 1; return element; }, () => {
    ticks += 1;
    if (ticks === 3) element.dataset.xiaoyiRevision = 'new-response';
  });
  const step = runtime.xiaoyiActions['rl-configure'].steps[2];
  const result = await runtime.verifyStepResult(step, 'ready', 1, { current: { id: 1, cancelled: false } }, 'previous-response');
  assert.ok(polls >= 3, 'old ready must not count as this request finishing');
  assert.match(result, /ready/);
});

test('backend failure stops verification with visible error details', async () => {
  const runtime = loadRuntime(() => ({ dataset: { xiaoyiState: 'failed', xiaoyiError: '训练服务连接失败' } }));
  const step = runtime.xiaoyiActions['rl-configure'].steps[2];
  await assert.rejects(runtime.verifyStepResult(step, 'idle', 1, { current: { id: 1, cancelled: false } }), /训练服务连接失败/);
});

test('cancellation interrupts pending backend verification before success is reported', async () => {
  const currentRun = { current: { id: 1, cancelled: false } };
  const runtime = loadRuntime(() => ({ dataset: { xiaoyiState: 'ready', xiaoyiRevision: 'new' } }), () => { currentRun.current.cancelled = true; });
  await assert.rejects(runtime.verifyStepResult(runtime.xiaoyiActions['rl-configure'].steps[2], 'idle', 1, currentRun), /人工已停止/);
});

test('all advisor profiles return all six reward components and reset throughput for the selected objective', () => {
  for (const objectiveId of ['balanced-resilience', 'min-delay', 'min-carbon', 'max-throughput', 'safety-first', 'weather-robustness']) {
    const response = buildXiaoyiRlAdvisorResponse({ objectiveId });
    assert.equal(Object.keys(response.recommendation.parameters).filter((key) => key.startsWith('reward')).length, 6);
    assert.equal(response.recommendation.parameters.rewardThroughput, getRlObjectivePreset(objectiveId).weights.throughput);
  }
});

test('external advisor rejects invalid parameters and retains valid throughput advice', () => {
  const decision = parseXiaoyiRlExternalDecision(JSON.stringify({ recommendation: { algorithmId: 'sarsa', parameters: {
    learningRate: -1, maxEpisodes: -50, discountGamma: 20, wallClockHours: 999, rewardSafety: -9,
    rewardThroughput: 0.4, tuningTrials: 4, seed: 42,
  } } }));
  assert.deepEqual(decision?.parameters, { rewardThroughput: 0.4, tuningTrials: 4, seed: 42 });
});

test('external validation feedback recommendations map to the actual training setting ID', () => {
  for (const settingId of ['micro-validation', 'validation-feedback']) {
    const decision = parseXiaoyiRlExternalDecision(JSON.stringify({ settingId }));
    assert.equal(decision?.settingId, 'micro-validation');
    const response = buildXiaoyiRlAdvisorResponse({}, { connected: true, decision });
    assert.equal(response.recommendation.settingId, 'micro-validation');
  }
  assert.equal(parseXiaoyiRlExternalDecision(JSON.stringify({ policyTestCaseId: 'peak-congestion-stress' }))?.policyTestCaseId, 'peak-congestion-stress');
  assert.equal(parseXiaoyiRlExternalDecision(JSON.stringify({ operatorSummary: '没有配置建议' })), undefined);
});

const payload = { objectiveId: 'min-carbon', objectiveLabel: '低碳', requestedCard: 'all', scenario: {} };

test('advisor adapter binds valid response to scope and uses a bounded cancellable signal', async (t) => {
  const response = buildXiaoyiRlAdvisorResponse(payload);
  let capturedSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    capturedSignal = init.signal;
    return new Response(JSON.stringify(response), { status: 200 });
  });
  const result = await requestXiaoyiRlAdvice(payload);
  assert.equal(result.recommendation.algorithmId, 'expected-sarsa');
  assert.ok(capturedSignal instanceof AbortSignal);
});

test('malformed advisor responses are rejected before the training UI consumes them', async (t) => {
  const valid = buildXiaoyiRlAdvisorResponse(payload);
  let body: unknown;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 200 }));
  const { rewardThroughput: _removed, ...incompleteParameters } = valid.recommendation.parameters;
  void _removed;
  for (const invalid of [null, { protocolVersion: valid.protocolVersion, recommendation: {} },
    { ...valid, requestedCard: 'algorithm' }, { ...valid, reasons: null },
    { ...valid, recommendation: { ...valid.recommendation, parameters: incompleteParameters } },
    { ...valid, recommendation: { ...valid.recommendation, algorithmId: 'unknown' } },
  ]) {
    body = invalid;
    await assert.rejects(requestXiaoyiRlAdvice(payload), /返回协议无效/);
  }
});
