import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

// The deployed policy verifies training, evaluation and serving source hashes.
// A valid checkout is insufficient if the runtime image omits those sources.
const docker = await readFile('Dockerfile', 'utf8');
const runtimeRoots = [...docker.matchAll(/^COPY --from=build \/app\/([^\s]+) \.\/\1$/gm)]
  .map((match) => match[1]);
const workflow = await readFile('.github/workflows/release.yml', 'utf8');
const archiveLine = workflow.split('\n').find((line) => line.includes('tar -czf'));
assert.ok(archiveLine, 'release archive command missing');
const archiveRoots = archiveLine.trim().split(/\s+/).slice(3);
assert.ok(docker.includes('COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./'),
  'container dependency installation must include pinned security overrides');
for (const root of ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'package.json']) {
  assert.ok(archiveRoots.includes(root), `release archive missing ${root}`);
}
const report = JSON.parse(await readFile('reports/core-operations-rl-champion-v2.json', 'utf8'));
const evidenceSources = Object.keys(report.upgrade.sourceFiles);
for (const file of [...evidenceSources, 'reports/core-operations-active.json']) {
  const root = file.split('/')[0];
  assert.ok(runtimeRoots.includes(root), `runtime image missing evidence source ${file}`);
  assert.ok(archiveRoots.includes(root), `release archive missing evidence source ${file}`);
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-core-runtime-'));
try {
  // Copy the actual Docker runtime source roots, excluding the built UI, which
  // does not participate in policy verification. No dependency tree is copied.
  for (const root of runtimeRoots.filter((root) => root !== 'dist')) {
    await cp(root, path.join(temporary, root), { recursive: true });
  }
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "import { loadActiveCoreModel } from './server/coreOperationsModelRegistry.ts'; " +
    "const model = await loadActiveCoreModel(); " +
    "if (model.selection !== 'active' || model.report.training.champion.seedPolicies[0].algorithmId !== 'factorized-fitted-policy-iteration') throw new Error('packaged model fell back'); " +
    "console.log(model.reference.sha256);"], {
    cwd: temporary,
    env: { ...process.env, CORE_OPERATIONS_CHAMPION_REPORT: '' },
    encoding: 'utf8',
  }).trim();
  const manifest = JSON.parse(await readFile('reports/core-operations-active.json', 'utf8'));
  assert.equal(output, manifest.active.sha256);
  console.log('CORE_RUNTIME_BUNDLE:PASS:ACTIVE_V2:SOURCE_HASHES_VERIFIED');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
