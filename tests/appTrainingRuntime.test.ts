import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { getRlObjectivePreset } from '../shared/rlObjectivePresets.ts';
import { resolveRlServiceEndpoint } from '../src/integrations/rlServiceEndpoint.ts';

const handlerNames = [
  'invalidateRlPolicyTestRequests', 'cancelDetachedRlTrainingJob', 'invalidateRlBackendCheck',
  'invalidateRlTrainingRequests', 'startRlTraining', 'resetRlTraining', 'startRlPolicyTest',
  'resetRlPolicyTest', 'selectRlAlgorithm', 'selectRlTrainingObjective', 'selectRlTrainingBaseline',
  'selectRlPolicyTestCase', 'testRlBackendConnection', 'setRlBackendMode', 'updateRlBackendField',
  'disconnectRlBackend',
] as const;
type HandlerName = typeof handlerNames[number];
type Handlers = Record<HandlerName, (...args: string[]) => unknown>;
const source = ts.createSourceFile('App.tsx', await readFile('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map<string, string>();
let replayEffect = '';
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.initializer && handlerNames.includes(node.name.getText(source) as HandlerName)) {
    declarations.set(node.name.getText(source), `const ${node.name.getText(source)} = ${node.initializer.getText(source)};`);
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' &&
    node.arguments[0]?.getText(source).includes('rlPolicyEvaluation.trace.length')) {
    replayEffect = node.arguments[0].getText(source);
  }
  ts.forEachChild(node, visit);
};
visit(source);
assert.equal(declarations.size, handlerNames.length, 'tests must execute every requested handler from the real App source');
test('the default reproducible seed fits the actual rendered input range', () => {
  const controls = source.statements.find((statement) => ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some((declaration) => declaration.name.getText(source) === 'rlRolloutParameterControls'));
  assert.ok(controls && ts.isVariableStatement(controls));
  const initializer = controls.declarationList.declarations[0].initializer;
  assert.ok(initializer);
  const actualControls = vm.runInNewContext(initializer.getText(source)) as Array<{ key: string; min: number; max: number }>;
  const seed = actualControls.find((control) => control.key === 'seed');
  assert.ok(seed && seed.min <= 240520 && seed.max >= 240520);
  assert.equal(seed.max, 2_147_483_647);
});
assert.ok(replayEffect, 'policy replay test must execute the actual App effect');
const script = ts.transpileModule(`globalThis.createHandlers = (rlTraining) => {\n${[...declarations.values()].join('\n')}\nreturn {${handlerNames.join(',')}};\n};\nglobalThis.createReplayEffect = (rlTraining, rlPolicyEvaluation) => (${replayEffect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2023 } }).outputText;

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}
const deferred = (): Deferred => {
  let resolve!: Deferred['resolve'];
  let reject!: Deferred['reject'];
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const initialPolicyTest = () => ({
  selectedCaseId: 'closed-loop-replay', status: 'locked', progressPercent: 0,
  startedAt: null, completedAt: null, logCursor: 0,
});
const initialTraining = () => ({
  status: 'idle', jobId: null as string | null, selectedAlgorithmId: 'q-learning', selectedBaselineId: 'mpc',
  selectedObjectiveId: 'balanced-resilience', activeSettingId: 'network-snapshot', progressPercent: 0,
  currentStageId: 'snapshot-build', startedAt: null, startedAtEpochMs: null, completedAt: null,
  episodeCursor: 0, trainingRequest: null as unknown,
  parameters: { wallClockHours: 1, learningRate: 0.12 },
  policyTest: initialPolicyTest(),
  backend: { mode: 'http', endpoint: '/api/rl/jobs', authToken: '', websocketUrl: 'ws://localhost/jobs',
    projectName: 'sandbox', status: 'disconnected', lastMessage: 'initial' },
});
type Training = ReturnType<typeof initialTraining>;
type Sandbox = { rlTraining: Training };
const queuedJob = (jobId = 'job-old') => ({ jobId, status: 'queued', progressPercent: 1, message: 'accepted' });
const evaluation = (overrides: Record<string, unknown> = {}) => ({
  jobId: 'job-complete', algorithmId: 'q-learning', testCaseId: 'closed-loop-replay',
  trace: [{ step: 0 }, { step: 1 }], ...overrides,
});

const harness = (state: Partial<Training> = {}) => {
  let sandbox: Sandbox = { rlTraining: { ...initialTraining(), ...state } };
  const outputs = { trainingJob: null as unknown, evaluation: null as unknown, benchmark: null as unknown, message: '' };
  const creates: Deferred[] = [];
  const evaluates: Array<Deferred & { signal?: AbortSignal }> = [];
  const handshakes: Array<Deferred & { signal?: AbortSignal }> = [];
  const cancellations: string[] = [];
  const cancellationEndpoints: string[] = [];
  let cancelFailure: Error | null = null;
  const timers = new Map<number, { callback: () => void; duration: number }>();
  let nextTimer = 0;
  const sockets: EventTarget[] = [];
  const replayTicks: Array<() => void> = [];
  const context = vm.createContext({
    AbortController, URL, Error, getRlObjectivePreset, resolveRlServiceEndpoint,
    window: {
      location: { origin: 'http://localhost:5173' },
      setTimeout: (callback: () => void, duration: number) => { const id = ++nextTimer; timers.set(id, { callback, duration }); return id; },
      clearTimeout: (id: number) => timers.delete(id),
      setInterval: (callback: () => void) => { replayTicks.push(callback); return replayTicks.length; },
      clearInterval: () => {},
    },
    WebSocket: class extends EventTarget {
      constructor() { super(); sockets.push(this); }
      close() { this.dispatchEvent(new Event('close')); }
    },
    rlTrainingRequestGenerationRef: { current: 0 }, rlTrainingSubmissionRef: { current: null },
    rlPolicyTestRequestGenerationRef: { current: 0 }, rlPolicyTestControllerRef: { current: null },
    rlBackendCheckGenerationRef: { current: 0 }, rlBackendCheckControllerRef: { current: null },
    xiaoyiAdviceRequestIdRef: { current: 0 }, xiaoyiApplyFeedbackTimerRef: { current: null },
    policyReplayClockRef: { current: '08:00' },
    setSandboxRuntime: (updater: Sandbox | ((current: Sandbox) => Sandbox)) => { sandbox = typeof updater === 'function' ? updater(sandbox) : updater; },
    setRlTrainingJob: (job: unknown) => { outputs.trainingJob = job; },
    setRlPolicyEvaluation: (result: unknown) => { outputs.evaluation = result; },
    setRlBenchmark: (result: unknown) => { outputs.benchmark = result; },
    setRlBenchmarkMessage: (message: string) => { outputs.message = message; },
    setRlTrainingWindowState: () => {}, setXiaoyiRlAdvice: () => {}, setXiaoyiAdviceObjectiveId: () => {},
    setXiaoyiApplyFeedback: () => {}, setXiaoyiAdvisorStatus: () => {}, setXiaoyiAdvisorScope: () => {},
    createInitialRlPolicyTestState: initialPolicyTest, createInitialRlTrainingState: initialTraining,
    buildRlTrainingRequestContract: (training: Training) => ({ algorithmId: training.selectedAlgorithmId, objectiveId: training.selectedObjectiveId }),
    scenarioClockLabel: '08:00',
    rlAlgorithmOptions: [{ id: 'q-learning', label: 'Q-Learning', defaultBackendMode: 'http' }, { id: 'sarsa', label: 'SARSA', defaultBackendMode: 'http' }],
    rlTrainingObjectives: [{ id: 'balanced-resilience', label: '均衡' }, { id: 'min-carbon', label: '低碳' }],
    rlBackendModeDefaults: { http: { endpoint: '/api/rl/jobs', websocketUrl: 'ws://localhost/jobs' }, websocket: { endpoint: '', websocketUrl: 'ws://localhost/new' } },
    rlBackendModeLabel: { http: 'HTTP', websocket: 'WebSocket', 'ray-service': 'Ray' },
    createRlTrainingJob: () => { const request = deferred(); creates.push(request); return request.promise; },
    evaluateRlTrainingJob: (_jobId: string, _algorithmId: string, _caseId: string, _token: string, signal?: AbortSignal) => {
      const request = { ...deferred(), signal }; evaluates.push(request); return request.promise;
    },
    cancelRlTrainingJob: (jobId: string, _authToken: string, endpoint: string) => {
      cancellations.push(jobId); cancellationEndpoints.push(endpoint);
      return cancelFailure ? Promise.reject(cancelFailure) : Promise.resolve(queuedJob(jobId));
    },
    fetch: (_url: URL, init: RequestInit) => { const request = { ...deferred(), signal: init.signal ?? undefined }; handshakes.push(request); return request.promise; },
  });
  vm.runInContext(script, context);
  return {
    get state() { return sandbox.rlTraining; }, outputs, creates, evaluates, handshakes, cancellations, cancellationEndpoints, sockets,
    get actions() { return context.createHandlers(sandbox.rlTraining) as Handlers; },
    startReplay() { context.createReplayEffect(sandbox.rlTraining, outputs.evaluation); return replayTicks.at(-1)!; },
    setClock(value: string) { context.policyReplayClockRef.current = value; },
    timeout(duration: number) { for (const timer of timers.values()) if (timer.duration === duration) timer.callback(); },
    failCancellation(error: Error) { cancelFailure = error; },
  };
};
const completeTraining = { status: 'completed', jobId: 'job-complete', progressPercent: 100, policyTest: { ...initialPolicyTest(), status: 'idle' } };

test('rapid duplicate training clicks create only one backend job', async () => {
  const h = harness();
  const actions = h.actions;
  const first = actions.startRlTraining();
  await actions.startRlTraining();
  assert.equal(h.creates.length, 1);
  h.creates[0].resolve(queuedJob('job-current'));
  await first;
  assert.equal(h.state.jobId, 'job-current');
  assert.equal(h.state.status, 'queued');
});

for (const [handler, value] of [
  ['resetRlTraining', ''], ['selectRlAlgorithm', 'sarsa'], ['selectRlTrainingObjective', 'min-carbon'], ['selectRlTrainingBaseline', 'sarsa'],
] as const) {
  test(`${handler} prevents a late created job from reattaching and cancels the detached backend run`, async () => {
    const h = harness();
    const pending = h.actions.startRlTraining();
    h.actions[handler](value);
    h.creates[0].resolve(queuedJob());
    await pending;
    assert.equal(h.state.status, 'idle');
    assert.equal(h.state.jobId, null);
    assert.equal(h.outputs.trainingJob, null);
    assert.deepEqual(h.cancellations, ['job-old']);
    if (handler === 'selectRlAlgorithm') assert.equal(h.state.selectedAlgorithmId, 'sarsa');
    if (handler === 'selectRlTrainingObjective') assert.equal(h.state.selectedObjectiveId, 'min-carbon');
  });
}

test('a late failure from a reset submission cannot mark the new training failed', async () => {
  const h = harness();
  const oldRun = h.actions.startRlTraining();
  h.actions.resetRlTraining();
  const newRun = h.actions.startRlTraining();
  h.creates[0].reject(new Error('old service failure'));
  await oldRun;
  assert.equal(h.state.status, 'queued');
  h.creates[1].resolve(queuedJob('job-new'));
  await newRun;
  assert.equal(h.state.jobId, 'job-new');
});

test('changing service while submitting cancels a late job at its original endpoint', async () => {
  const h = harness();
  const pending = h.actions.startRlTraining();
  h.actions.updateRlBackendField('endpoint', 'https://new-trainer.example/gateway/jobs');
  h.creates[0].resolve(queuedJob('old-service-job'));
  await pending;
  assert.equal(h.state.jobId, null);
  assert.equal(h.state.status, 'idle');
  assert.equal(h.state.backend.endpoint, 'https://new-trainer.example/gateway/jobs');
  assert.deepEqual(h.cancellationEndpoints, ['/api/rl/jobs']);
});

test('reset reports a failed backend cancellation without an unhandled rejection', async () => {
  const h = harness({ status: 'running', jobId: 'job-running' });
  h.failCancellation(new Error('connection closed'));
  h.actions.resetRlTraining();
  await Promise.resolve();
  assert.equal(h.state.status, 'idle');
  assert.match(h.outputs.message, /job-running.*取消未获确认.*connection closed/);
});

test('policy testing rejects repeated clicks until the first evaluation finishes', async () => {
  const h = harness(completeTraining);
  const actions = h.actions;
  const pending = actions.startRlPolicyTest();
  await actions.startRlPolicyTest();
  assert.equal(h.evaluates.length, 1);
  h.evaluates[0].resolve(evaluation());
  await pending;
  assert.deepEqual(h.outputs.evaluation, evaluation());
});

test('resetting a pending policy test aborts the request and discards its late result', async () => {
  const h = harness(completeTraining);
  const pending = h.actions.startRlPolicyTest();
  h.actions.resetRlPolicyTest();
  assert.equal(h.evaluates[0].signal?.aborted, true);
  h.evaluates[0].resolve(evaluation());
  await pending;
  assert.equal(h.outputs.evaluation, null);
  assert.equal(h.state.policyTest.status, 'idle');
});

test('changing the policy test case keeps a late old evaluation away from the new replay', async () => {
  const h = harness(completeTraining);
  const oldTest = h.actions.startRlPolicyTest();
  h.actions.selectRlPolicyTestCase('peak-congestion-stress');
  const newTest = h.actions.startRlPolicyTest();
  h.evaluates[0].resolve(evaluation());
  await oldTest;
  assert.equal(h.outputs.evaluation, null);
  assert.equal(h.state.policyTest.status, 'running');
  h.evaluates[1].resolve(evaluation({ testCaseId: 'peak-congestion-stress' }));
  await newTest;
  assert.equal((h.outputs.evaluation as { testCaseId: string }).testCaseId, 'peak-congestion-stress');
});

test('changing training objective detaches a completed checkpoint and invalidates an in-flight test', async () => {
  const h = harness(completeTraining);
  const pending = h.actions.startRlPolicyTest();
  h.actions.selectRlTrainingObjective('min-carbon');
  h.evaluates[0].reject(new Error('late evaluation failure'));
  await pending;
  assert.equal(h.state.status, 'idle');
  assert.equal(h.state.jobId, null);
  assert.equal(h.state.policyTest.status, 'locked');
  assert.equal(h.outputs.evaluation, null);
});

test('policy responses for another job fail visibly instead of presenting unrelated metrics', async () => {
  const h = harness(completeTraining);
  const pending = h.actions.startRlPolicyTest();
  h.evaluates[0].resolve(evaluation({ jobId: 'another-job' }));
  await pending;
  assert.equal(h.outputs.evaluation, null);
  assert.equal(h.state.policyTest.status, 'failed');
  assert.match(h.state.backend.lastMessage, /不一致/);
});

test('a queued timer from an earlier policy replay cannot advance a reset and restarted test', async () => {
  const h = harness(completeTraining);
  const first = h.actions.startRlPolicyTest();
  h.evaluates[0].resolve(evaluation());
  await first;
  const oldTick = h.startReplay();
  oldTick();
  assert.equal(h.state.policyTest.progressPercent, 50);
  h.actions.resetRlPolicyTest();
  const second = h.actions.startRlPolicyTest();
  oldTick();
  assert.equal(h.state.policyTest.progressPercent, 0);
  h.evaluates[1].resolve(evaluation());
  await second;
  const newTick = h.startReplay();
  newTick();
  assert.equal(h.state.policyTest.progressPercent, 50);
  oldTick();
  assert.equal(h.state.policyTest.progressPercent, 50);
  h.setClock('09:30');
  newTick();
  assert.equal(h.state.policyTest.completedAt, '09:30');
});

test('an evaluation that resolves after the timeout is still rejected', async () => {
  const h = harness(completeTraining);
  const pending = h.actions.startRlPolicyTest();
  h.timeout(15_000);
  h.evaluates[0].resolve(evaluation());
  await pending;
  assert.equal(h.state.policyTest.status, 'failed');
  assert.equal(h.outputs.evaluation, null);
  assert.match(h.state.backend.lastMessage, /超时/);
});

for (const [handler, args] of [
  ['disconnectRlBackend', []], ['setRlBackendMode', ['websocket']], ['updateRlBackendField', ['endpoint', '/api/new/jobs']],
] as const) {
  test(`${handler} prevents an obsolete HTTP handshake from reconnecting the backend`, async () => {
    const h = harness();
    const pending = h.actions.testRlBackendConnection();
    h.actions[handler](...args);
    const expectedMessage = h.state.backend.lastMessage;
    assert.equal(h.handshakes[0].signal?.aborted, true);
    h.handshakes[0].resolve({ ok: true });
    await pending;
    assert.equal(h.state.backend.status, 'disconnected');
    assert.equal(h.state.backend.lastMessage, expectedMessage);
  });
}

test('a stale backend error cannot overwrite a newer successful handshake', async () => {
  const h = harness();
  const first = h.actions.testRlBackendConnection();
  const second = h.actions.testRlBackendConnection();
  h.handshakes[1].resolve({ ok: true });
  await second;
  h.handshakes[0].reject(new Error('obsolete failure'));
  await first;
  assert.equal(h.state.backend.status, 'connected');
  assert.match(h.state.backend.lastMessage, /真实握手成功/);
});

test('disconnecting cancels a pending WebSocket handshake and settles the request', async () => {
  const h = harness();
  h.actions.setRlBackendMode('websocket');
  const pending = h.actions.testRlBackendConnection();
  h.actions.disconnectRlBackend();
  await pending;
  h.sockets[0].dispatchEvent(new Event('open'));
  assert.equal(h.state.backend.status, 'disconnected');
});
