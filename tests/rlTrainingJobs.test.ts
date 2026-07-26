import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

test('completed checkpoints carry integrity metadata and restore in a fresh process', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(os.tmpdir(), 'malacca-rl-checkpoints-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  process.env.RL_ARTIFACT_DIR = artifactDirectory;
  const jobs = await import('../server/rlTrainingJobs.ts');
  const created = jobs.createRlTrainingJob({
    protocolVersion: 'rl-training-job.v1',
    trainingParameters: { maxEpisodes: 120, seed: 240_520, learningRate: 0.12, discountGamma: 0.97 },
  });
  let completed = jobs.getRlTrainingJob(created.jobId);
  for (let attempt = 0; attempt < 200 && completed?.status !== 'completed'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed = jobs.getRlTrainingJob(created.jobId);
  }
  assert.equal(completed?.status, 'completed');
  const payload = JSON.parse(await readFile(path.join(artifactDirectory, `${created.jobId}.json`), 'utf8')) as {
    engineVersion: string;
    calibrationId: string;
    integrity: { algorithm: string; digest: string };
    benchmark: { selectionSplit: string };
    policies: Array<{ kind?: string; qA?: Array<[number, number[]]> }>;
    [key: string]: unknown;
  };
  const { integrity, ...core } = payload;
  assert.equal(integrity.algorithm, 'sha256');
  assert.equal(payload.engineVersion, 'dataset-calibrated-port-control.v4');
  assert.equal(payload.calibrationId, 'public-aggregate-conservative-v2');
  assert.equal(integrity.digest, createHash('sha256').update(JSON.stringify(core)).digest('hex'));
  assert.equal(payload.benchmark.selectionSplit, 'validation');
  assert.equal(payload.policies.length, 5);

  const moduleUrl = pathToFileURL(path.resolve('server/rlTrainingJobs.ts')).href;
  const childCode = [
    "const jobs = await import(process.argv[1]);",
    "await jobs.ensureRlTrainingJobsRestored();",
    "const restored = jobs.getRlTrainingJob(process.argv[2]);",
    "process.stdout.write(JSON.stringify({status:restored?.status,restoredFromCheckpoint:restored?.restoredFromCheckpoint,selectionSplit:restored?.result?.selectionSplit,rejectedCheckpoints:jobs.getRlServiceStatus().rejectedCheckpoints}));",
  ].join('');
  const restoreInChild = () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '-e', childCode, moduleUrl, created.jobId], {
      cwd: process.cwd(),
      env: { ...process.env, RL_ARTIFACT_DIR: artifactDirectory },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  assert.deepEqual(JSON.parse(await restoreInChild()), {
    status: 'completed',
    restoredFromCheckpoint: true,
    selectionSplit: 'validation',
    rejectedCheckpoints: 0,
  });
  const qPolicy = payload.policies.find((policy) => policy.kind === 'q-table' && policy.qA?.length);
  assert.ok(qPolicy?.qA?.[0]?.[1]?.length);
  qPolicy.qA[0][1][0] += 0.001;
  await writeFile(path.join(artifactDirectory, `${created.jobId}.json`), JSON.stringify(payload), 'utf8');
  assert.deepEqual(JSON.parse(await restoreInChild()), { rejectedCheckpoints: 1 });
});
