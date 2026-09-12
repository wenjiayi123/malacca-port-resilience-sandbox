import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { isGodotValidationResult } from '../src/integrations/godotValidationAdapter.ts';
import { formatCarbonDeltaTons } from '../src/ui/formatCarbonDelta.ts';

const source = ts.createSourceFile('App.tsx', await readFile('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['downloadClosureReport', 'handleImportGodotResult', 'applyGodotValidationResult', 'patchSandboxPhases', 'startNativeGodotValidation'];
const declarations: string[] = [];
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.initializer && names.includes(node.name.getText(source))) {
    declarations.push(`const ${node.name.getText(source)} = ${node.initializer.getText(source)};`);
  }
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) declarations.push(node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(declarations.length, names.length);
const compiled = ts.transpileModule(`globalThis.createHandlers = (generatedGodotRequest) => {${declarations.join('\n')}\nreturn {downloadClosureReport, handleImportGodotResult, applyGodotValidationResult, startNativeGodotValidation};};`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;
const exampleResult = JSON.parse(await readFile('docs/godot_validation_result.example.json', 'utf8')) as Record<string, unknown>;
interface RequestIdentity { requestId: string; vesselId: string; createdAt?: string }
interface Phase { id: string; status: string; summary: string; startedAt?: string; completedAt?: string; startedMinute?: number; completedMinute?: number }
interface Runtime { generatedGodotRequest: RequestIdentity | null; importedGodotResult: unknown; injectedEvents: unknown[]; phases: Phase[]; elapsedMinutes: number }
interface Handlers {
  downloadClosureReport: () => void;
  handleImportGodotResult: (file: { text(): Promise<string> } | null) => Promise<void>;
  applyGodotValidationResult: (result: unknown) => void;
  startNativeGodotValidation: () => Promise<void>;
}
const phaseIds = ['event-sensing', 'pressure-spread', 'vessel-dispatch', 'micro-validation', 'metric-feedback'];
const harness = (complete = false) => {
  let runtime: Runtime = {
    generatedGodotRequest: { requestId: String(exampleResult.requestId), vesselId: String(exampleResult.vesselId) },
    importedGodotResult: complete ? exampleResult : null, injectedEvents: [], elapsedMinutes: 30,
    phases: phaseIds.map((id) => ({ id, status: complete ? 'completed' : 'pending', summary: 'original', startedAt: '08:00', completedAt: complete ? '08:15' : undefined, startedMinute: 0, completedMinute: complete ? 15 : undefined })),
  };
  const downloads: Array<{ href: string; download: string }> = [];
  const blobs: Blob[] = [];
  const revocations: string[] = [];
  const timers: Array<() => void> = [];
  let feedback: { tone: string; message: string } | null = null;
  let inspector: { title: string; body: string } | null = null;
  let exportSequence = 0;
  const input = { value: 'C:\\fakepath\\result.json' };
  const context = vm.createContext({
    Blob, Error, isGodotValidationResult, formatCarbonDeltaTons,
    nativeGodot: { busy: false, start: async () => {} },
    setIsGodotSimulatorOpen: () => {}, setInspectorPanel: () => {}, setHasPreviewedGodotSimulator: () => {},
    URL: { createObjectURL: (blob: Blob) => { blobs.push(blob); return `blob:test-${blobs.length}`; }, revokeObjectURL: (url: string) => { revocations.push(url); } },
    document: { createElement: () => ({ href: '', download: '', click() { downloads.push({ href: this.href, download: this.download }); } }) },
    window: { setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; } },
    godotResultInputRef: { current: input }, godotResultReceiverRef: { current: () => {} },
    godotRequestRef: { current: runtime.generatedGodotRequest }, godotImportGenerationRef: { current: 0 },
    setGodotImportFeedback: (value: typeof feedback) => { feedback = value; },
    setSandboxRuntime: (updater: (value: Runtime) => Runtime) => { runtime = updater(runtime); },
    patchSandboxPhases: undefined,
    scenarioClockLabel: '09:30', scenarioClock: new Date('2026-09-12T01:30:00Z'), pendingPhaseStartLabel: '未开始',
    sandboxPhaseDefinitions: Object.fromEntries(phaseIds.map((id) => [id, { initialSummary: 'pending' }])),
    coreClosureJourney: [{ id: 'data', label: '数据', status: 'completed' }, { id: 'validation', label: '验证回写', status: complete ? 'completed' : 'pending' }],
    completedClosureStepCount: complete ? 2 : 1,
    scenario: { id: 'scenario-current', name: 'Current', currentTime: '2026-09-12T00:00:00Z', overview: { portCount: 2 }, weather: {} },
    portDataStatus: 'demo', publicEvidence: null, portDataObservedAt: null,
    injectedEvents: [{ id: 'event-current', message: 'current event' }], peakPortCongestion: { congestionScore: 70 },
    totalDelayMinutes: 12, peakVesselDelay: null, totalFuelTons: 1.2345, totalCarbonTons: 3.8442, totalBaselineCarbonTons: 4.0, totalCarbonChangePercent: -3.894,
    resilienceAssessment: { networkResilienceIndex: 90 }, aiDecisionRecommendation: {}, rankedGreenStrategies: [], bestGreenStrategy: null,
    rlPolicyInference: null, rlPolicyApplied: false, policyRecovery: { status: 'idle' }, rlBenchmark: null,
    rlTraining: { jobId: 'training-current', backend: { mode: 'http', endpoint: '/api/rl/jobs', authToken: 'test-private-credential' } },
    portBusinessEvidence: {}, importedGodotResult: runtime.importedGodotResult,
    phaseStatus: (id: string) => runtime.phases.find((phase) => phase.id === id)?.status ?? 'pending',
    setReportExportSequence: (updater: (value: number) => number) => { exportSequence = updater(exportSequence); },
    openInspectorPanel: (value: typeof inspector) => { inspector = value; },
  });
  vm.runInContext(compiled, context);
  const render = () => {
    const handlers = context.createHandlers(runtime.generatedGodotRequest) as Handlers;
    context.godotResultReceiverRef.current = handlers.applyGodotValidationResult;
    context.godotRequestRef.current = runtime.generatedGodotRequest;
    return handlers;
  };
  render();
  return {
    get actions() { return render(); }, get runtime() { return runtime; }, get feedback() { return feedback; },
    get inspector() { return inspector; }, get exportSequence() { return exportSequence; }, input, downloads, blobs, revocations,
    flushDownloadCleanup() { timers.splice(0).forEach((callback) => callback()); },
    changeRequest(value: RequestIdentity | null) { runtime = { ...runtime, generatedGodotRequest: value, importedGodotResult: null }; render(); },
  };
};

test('closure download records current evidence and marks missing workflow steps as a draft', async () => {
  const h = harness();
  h.actions.downloadClosureReport();
  const report = JSON.parse(await h.blobs[0].text());
  assert.equal(report.completionStatus, 'DRAFT_INCOMPLETE');
  assert.equal(report.scenario.id, 'scenario-current');
  assert.equal(report.events[0].id, 'event-current');
  assert.equal(report.closure.closureComplete, false);
  assert.deepEqual(report.closure.missingSteps, [{ id: 'validation', label: '验证回写', status: 'pending' }]);
  assert.equal(report.closure.resultSynced, false);
  assert.match(h.downloads[0].download, /draft-incomplete.*\.json$/);
  assert.equal(h.exportSequence, 1);
  assert.match(h.inspector?.body ?? '', /不可作为闭环完成证明/);
  assert.deepEqual(h.revocations, []);
  h.flushDownloadCleanup();
  assert.deepEqual(h.revocations, [h.downloads[0].href]);
});

test('a completed closure report remains complete and excludes API credentials', async () => {
  const h = harness(true);
  h.actions.downloadClosureReport();
  const text = await h.blobs[0].text();
  const report = JSON.parse(text);
  assert.equal(report.completionStatus, 'COMPLETE');
  assert.equal(report.closure.resultSynced, true);
  assert.equal(report.closure.missingSteps.length, 0);
  assert.equal(report.reinforcementLearning.training.jobId, 'training-current');
  assert.doesNotMatch(text, /test-private-credential/);
});

test('starting native physics clears a previous demo result before waiting for the real result', async () => {
  const h = harness(true);
  await h.actions.startNativeGodotValidation();
  assert.equal(h.runtime.importedGodotResult, null);
  const micro = h.runtime.phases.find((phase) => phase.id === 'micro-validation');
  assert.equal(micro?.status, 'running');
  assert.equal(micro?.startedAt, '09:30');
  assert.equal(micro?.completedAt, undefined);
  assert.equal(h.runtime.phases.find((phase) => phase.id === 'metric-feedback')?.status, 'pending');
  h.actions.applyGodotValidationResult(exampleResult);
  assert.equal(h.runtime.importedGodotResult, exampleResult);
  assert.equal(h.runtime.phases.find((phase) => phase.id === 'metric-feedback')?.status, 'completed');
});

test('invalid JSON and mismatched Godot results retain the existing accepted result and its completion time', async () => {
  const h = harness(true);
  for (const text of ['{invalid', JSON.stringify({ ...exampleResult, requestId: 'another-request' }), JSON.stringify({ ...exampleResult, estimatedTravelMinutes: 'bad' })]) {
    await h.actions.handleImportGodotResult({ text: async () => text });
    assert.equal(h.runtime.importedGodotResult, exampleResult);
    assert.equal(h.runtime.phases.find((phase) => phase.id === 'metric-feedback')?.completedAt, '08:15');
    assert.equal(h.feedback?.tone, 'danger');
    assert.equal(h.input.value, '');
  }
});

test('a file read that finishes after the current Godot request changes cannot restore its old result', async () => {
  const h = harness();
  let finishRead!: (value: string) => void;
  const pending = h.actions.handleImportGodotResult({ text: () => new Promise((resolve) => { finishRead = resolve; }) });
  h.changeRequest({ requestId: 'new-request', vesselId: 'new-vessel' });
  finishRead(JSON.stringify(exampleResult));
  await pending;
  assert.equal(h.runtime.generatedGodotRequest?.requestId, 'new-request');
  assert.equal(h.runtime.importedGodotResult, null);
  assert.equal(h.feedback?.tone, 'danger');
});

test('a valid matching Godot file updates all result phases and clears the file input', async () => {
  const h = harness();
  await h.actions.handleImportGodotResult({ text: async () => JSON.stringify(exampleResult) });
  assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.importedGodotResult)), exampleResult);
  assert.equal(h.runtime.phases.find((phase) => phase.id === 'metric-feedback')?.status, 'completed');
  assert.equal(h.feedback?.tone, 'ok');
  assert.equal(h.input.value, '');
  const dispatch = h.runtime.phases.find((phase) => phase.id === 'vessel-dispatch');
  assert.equal(dispatch?.startedAt, dispatch?.completedAt);
  assert.equal(dispatch?.startedMinute, dispatch?.completedMinute);
});

test('a superseded slow Godot file cannot replace the newer accepted file or its feedback', async () => {
  const h = harness();
  let finishOld!: (value: string) => void;
  const oldRead = h.actions.handleImportGodotResult({ text: () => new Promise((resolve) => { finishOld = resolve; }) });
  const newerResult = { ...exampleResult, summary: 'newer accepted result', carbonDeltaTons: -1.2 };
  await h.actions.handleImportGodotResult({ text: async () => JSON.stringify(newerResult) });
  finishOld('{invalid old file');
  await oldRead;
  assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.importedGodotResult)), newerResult);
  assert.equal(h.feedback?.tone, 'ok');
});

test('a simulator clock reset rejects a result issued against the former timeline', () => {
  const h = harness();
  h.changeRequest({ requestId: String(exampleResult.requestId), vesselId: String(exampleResult.vesselId), createdAt: '2026-09-13T00:00:00Z' });
  h.actions.applyGodotValidationResult(exampleResult);
  assert.equal(h.runtime.importedGodotResult, null);
  assert.ok(h.runtime.phases.every((phase) => phase.status === 'pending'));
  assert.match(h.feedback?.message ?? '', /数据时标已回退/);
});

test('Godot completion does not claim that an unrun checkpoint inference is complete', () => {
  let expression = '';
  const locate = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some((property) =>
      ts.isPropertyAssignment(property) && property.name.getText(source) === 'id' &&
      property.initializer.getText(source) === "'ai-dispatch'")) {
      const status = node.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'status');
      if (status && ts.isPropertyAssignment(status)) expression = status.initializer.getText(source);
    }
    ts.forEachChild(node, locate);
  };
  locate(source);
  assert.ok(expression);
  const context = { rlPolicyApplied: false, rlPolicyInference: null as unknown, rlInferenceStatus: 'idle', phaseStatus: () => 'completed' };
  assert.equal(vm.runInNewContext(expression, context), 'pending');
  context.rlInferenceStatus = 'running';
  assert.equal(vm.runInNewContext(expression, context), 'running');
  context.rlPolicyInference = { admission: { status: 'rejected' } };
  context.rlInferenceStatus = 'completed';
  assert.equal(vm.runInNewContext(expression, context), 'completed');
});

test('two validation requests in the same simulation tick cannot accept one another results', () => {
  const match = source.text.match(/requestId:\s*(`malacca-validation-.*?`),/);
  assert.ok(match);
  const context = { requestStamp: '20260912093000', selectedValidationVessel: { id: String(exampleResult.vesselId) }, crypto: webcrypto };
  const first = vm.runInNewContext(match[1], context);
  const second = vm.runInNewContext(match[1], context);
  assert.notEqual(first, second);
  const h = harness();
  h.changeRequest({ requestId: second, vesselId: String(exampleResult.vesselId) });
  h.actions.applyGodotValidationResult({ ...exampleResult, requestId: first });
  assert.equal(h.runtime.importedGodotResult, null);
  assert.equal(h.feedback?.tone, 'danger');
});

test('reset uses the loaded scenario clock immediately without waiting for a telemetry poll', () => {
  const required = ['createInitialSandboxPhases', 'createInitialSandboxRuntime', 'resetSimulation', 'formatScenarioDateTime', 'padTime'];
  const extracted: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && required.includes(node.name.getText(source))) {
      extracted.push(`const ${node.name.getText(source)} = ${node.initializer.getText(source)};`);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  assert.equal(extracted.length, required.length);
  let reset: Runtime | undefined;
  const context: Record<string, unknown> = {
    defaultPortScenario: { currentTime: '2024-05-20 14:30:45' },
    baseScenarioTime: new Date(2026, 8, 12, 18, 0, 0),
    sandboxPhaseDefinitions: Object.fromEntries(phaseIds.map((id) => [id, { initialSummary: 'pending' }])),
    pendingPhaseStartLabel: '待启动', defaultRlPolicyRecoveryMinutes: 30,
    restoreRlTrainingState: () => ({}),
    setSandboxRuntime: (runtime: Runtime) => { reset = runtime; },
  };
  for (const name of ['invalidateRlTrainingRequests', 'setRlTrainingJob', 'setRlPolicyEvaluation', 'setRlInferenceRunId', 'setIsRlPolicyApplyConfirmationOpen', 'setIsGodotSimulatorOpen', 'setHasPreviewedGodotSimulator', 'setIsEventInjectionPanelOpen', 'setIsRlDecisionPanelOpen', 'setRlInferenceStatus', 'setRlInferenceProgress', 'setRlPolicyInference', 'setRlPolicyApplied', 'setRlDisturbance', 'setOpenMapOverlays']) context[name] = () => {};
  vm.runInNewContext(ts.transpileModule(`${extracted.join('\n')}\nresetSimulation();`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText, context);
  assert.equal(reset?.phases[0].startedAt, '2026-09-12 18:00:00');
  assert.equal(reset?.elapsedMinutes, 0);
  assert.equal(reset?.generatedGodotRequest, null);
});
