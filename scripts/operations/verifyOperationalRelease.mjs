import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const extension = JSON.parse(await readFile('reports/dependency-security-upgrade-v1.json', 'utf8'));
assert.equal(extension.schemaVersion, 'dependency-security-upgrade.v1');
assert.equal(extension.productionAuthority, false);
const reportPath = 'reports/operational-closure-acceptance-v2.json';
const reportBytes = await readFile(reportPath);
assert.equal(hash(reportBytes), extension.archivedReportSha256, 'historical acceptance report changed');
const report = JSON.parse(reportBytes.toString());
assert.deepEqual(Object.keys(extension.archivedEnvironment).sort(), ['package.json', 'pnpm-lock.yaml']);
assert.deepEqual(Object.keys(extension.currentFiles).sort(), [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'scripts/operations/verifyOperationalRelease.mjs',
].sort());
for (const [file, digest] of Object.entries(extension.currentFiles)) {
  assert.equal(hash(await readFile(file)), digest, `current dependency extension changed: ${file}`);
}
const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-archived-acceptance-'));
try {
  for (const root of ['server', 'shared', 'scripts', 'src', 'reports', 'data', 'tests', 'docs', 'package.json', 'pnpm-lock.yaml']) {
    await cp(root, path.join(temporary, root), { recursive: true });
  }
  for (const [file, evidence] of Object.entries(extension.archivedEnvironment)) {
    assert.equal(evidence.path, `reports/artifacts/dependency-security-upgrade-v1/${file}.snapshot`);
    const bytes = await readFile(evidence.path);
    assert.equal(hash(bytes), evidence.sha256, `archived environment changed: ${file}`);
    assert.equal(evidence.sha256, report.sourceFingerprint.files[file]);
    await writeFile(path.join(temporary, file), bytes);
  }
  // The archived verifier sees its original dependency manifests. Its complete
  // KPI, authority, receipt, audit and RL-source lineage checks run unchanged.
  // No dependencies are installed in this tree. Current dependency execution
  // is verified separately by pnpm check and security:audit in release:check.
  const verifier = process.argv.includes('--core')
    ? 'scripts/rl/verifyCoreOperationsChampion.ts'
    : 'scripts/operations/verifyOperationalAcceptance.ts';
  execFileSync(process.execPath, ['--experimental-strip-types', verifier], {
    cwd: temporary, stdio: 'inherit',
  });
  console.log('OPERATIONAL_ENVIRONMENT_EXTENSION:PASS:ARCHIVED_MANIFESTS:CURRENT_HASHES_VERIFIED');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
