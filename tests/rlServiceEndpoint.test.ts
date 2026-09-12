import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { resolveRlServiceEndpoint } from '../src/integrations/rlServiceEndpoint.ts';
import { cancelRlTrainingJob, createRlTrainingJob, evaluateRlTrainingJob, fetchRlTrainingJob } from '../src/integrations/rlBenchmarkAdapter.ts';
import { submitRlPolicyInference, type RlPolicyInferenceRequest, type RlPolicyInferenceResponse } from '../src/integrations/rlPolicyAdapter.ts';

const inferenceFixture = (requestId = 'request-test'): RlPolicyInferenceResponse => ({
  protocolVersion: 'rl-policy-inference.v2', requestId, generatedAt: '2026-09-12T00:00:00.000Z',
  model: { policyId: 'test-checkpoint', algorithm: 'q-learning', checkpoint: 'checkpoint-1', architecture: 'q-table', trainingEpisodes: 120, trainingSource: 'test-fixture', evaluationStatus: 'passed' },
  inputTensor: [{ id: 'queue', label: 'Queue', raw: 10, normalized: 0.1, unit: 'vessels' }],
  disturbance: { type: 'none', label: 'None', intensity: 0 }, eventContext: null,
  inference: { ensembleRuns: 1, latencyMs: 4, valueEstimate: 1, policyEntropy: 0.2, confidencePercent: 80, safetyShield: 'simulation-only' },
  admission: { status: 'abstain', normalizedEntropy: 0.2, blockers: ['test-only'],
    thresholds: { minimumConfidencePercent: 70, maximumNormalizedEntropy: 0.8, requireBusinessNonRegression: true },
    checks: { confidence: true, entropy: true, congestionNonRegression: true, delayNonRegression: true, carbonNonRegression: true, resilienceNonRegression: true } },
  actionDistribution: [{ id: 'hold', label: 'Hold', probability: 1, uncertainty: 0, detail: 'test' }],
  scenarioForecasts: [{ id: 'base', label: 'Base', probability: 1, congestionPercent: 10, delayMinutes: 5, carbonDeltaTons: 0, recoveryMinutes: 60 }],
  selectedAction: { id: 'hold', label: 'Hold', probability: 1, targetSpeedKnots: 10, diversionPercent: 0, arrivalShiftMinutes: 0, affectedScope: 'test', rationale: 'test', commandSummary: 'test', executionSteps: ['hold'] },
  comparison: { baseline: { congestionPercent: 10, delayMinutes: 5, carbonTons: 1, resilienceIndex: 90 },
    policy: { congestionPercent: 10, delayMinutes: 5, carbonTons: 1, resilienceIndex: 90 },
    improvement: { congestionPoints: 0, delayMinutes: 0, carbonTons: 0, resiliencePoints: 0 } },
});

test('RL service URLs preserve gateway prefixes, origin, query and encoded job IDs', () => {
  assert.equal(resolveRlServiceEndpoint('/api/rl/jobs/', 'inference'), '/api/rl/inference');
  assert.equal(resolveRlServiceEndpoint('https://trainer.example/gateway/api/rl/jobs?tenant=demo', 'jobs', 'job/1', 'evaluate'),
    'https://trainer.example/gateway/api/rl/jobs/job%2F1/evaluate?tenant=demo');
  assert.equal(resolveRlServiceEndpoint('/tenant/rl/jobs?tenant=demo', 'health'), '/tenant/rl/health?tenant=demo');
  for (const endpoint of ['javascript:alert(1)', '//trainer.example/api/rl/jobs', '/api/rl/start', 'https://trainer.example/start']) {
    assert.throws(() => resolveRlServiceEndpoint(endpoint), /训练地址/);
  }
});

test('create, poll, evaluate, cancel, health and inference all use the configured HTTP service', async (t) => {
  const observed: Array<{ method: string; url: string; authorization: string }> = [];
  const server = createServer(async (request, response) => {
    observed.push({ method: request.method ?? '', url: request.url ?? '', authorization: request.headers.authorization ?? '' });
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as { requestId?: string } : {};
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url?.includes('/inference') ? inferenceFixture(body.requestId)
      : { jobId: 'test-job', status: 'queued', progressPercent: 0, message: 'accepted' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const endpoint = `http://127.0.0.1:${address.port}/gateway/api/rl/jobs/?tenant=demo`;
  await createRlTrainingJob(endpoint, { algorithmId: 'q-learning' }, 'integration-test-token');
  await fetchRlTrainingJob('test-job', 'integration-test-token', undefined, endpoint);
  await evaluateRlTrainingJob('test-job', 'q-learning', 'closed-loop-replay', 'integration-test-token', undefined, endpoint);
  await cancelRlTrainingJob('test-job', 'integration-test-token', endpoint);
  await submitRlPolicyInference({ protocolVersion: 'rl-policy-inference.v2', requestId: 'request-test', jobId: 'test-job', algorithmId: 'q-learning' } as RlPolicyInferenceRequest,
    undefined, 'integration-test-token', endpoint);
  await fetch(resolveRlServiceEndpoint(endpoint, 'health'), { headers: { Authorization: 'Bearer integration-test-token' } });
  assert.deepEqual(observed.map(({ method, url }) => `${method} ${url}`), [
    'POST /gateway/api/rl/jobs?tenant=demo',
    'GET /gateway/api/rl/jobs/test-job?tenant=demo',
    'POST /gateway/api/rl/jobs/test-job/evaluate?tenant=demo',
    'DELETE /gateway/api/rl/jobs/test-job?tenant=demo',
    'POST /gateway/api/rl/inference?tenant=demo',
    'GET /gateway/api/rl/health?tenant=demo',
  ]);
  assert.ok(observed.every(({ authorization }) => authorization === 'Bearer integration-test-token'));
});

test('malformed inference numbers and nested UI records fail before rendering', async (t) => {
  const valid = inferenceFixture();
  const request = { requestId: 'request-test' } as RlPolicyInferenceRequest;
  let body: unknown = valid;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 200 }));
  assert.equal((await submitRlPolicyInference(request)).inference.latencyMs, 4);
  for (const invalid of [
    { ...valid, inference: {} },
    { ...valid, inference: { ...valid.inference, latencyMs: '4' } },
    { ...valid, inference: { ...valid.inference, confidencePercent: null } },
    { ...valid, scenarioForecasts: [{ ...valid.scenarioForecasts[0], carbonDeltaTons: {} }] },
    { ...valid, selectedAction: { ...valid.selectedAction, executionSteps: [{}] } },
    { ...valid, comparison: { ...valid.comparison, improvement: {} } },
    { ...valid, admission: { ...valid.admission, normalizedEntropy: '0.2' } },
    { ...valid, admission: { ...valid.admission, thresholds: {} } },
    { ...valid, inputTensor: [null] },
  ]) {
    body = invalid;
    await assert.rejects(submitRlPolicyInference(request), /返回协议无效/);
  }
});
