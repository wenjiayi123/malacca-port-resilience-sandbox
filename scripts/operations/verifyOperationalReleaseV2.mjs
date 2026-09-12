import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEPENDENCY_UPGRADE_V2_REPORT = 'reports/dependency-security-upgrade-v2.json';
export const DEPENDENCY_UPGRADE_V2_FILES = [
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'src/components/LiveSatelliteMap.tsx',
  'scripts/operations/verifyOperationalReleaseV2.mjs',
  'scripts/operations/buildDependencySecurityUpgradeV2.mjs',
  'tests/dependencySecurityUpgradeV2.test.ts',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function verifyDependencyUpgradeV2(root = process.cwd()) {
  const read = (file) => readFile(path.join(root, file));
  const extension = JSON.parse((await read(DEPENDENCY_UPGRADE_V2_REPORT)).toString());
  assert.equal(extension.schemaVersion, 'dependency-security-upgrade.v2');
  assert.equal(extension.productionAuthority, false);
  assert.equal(extension.advisory.id, 'GHSA-jrc7-96c5-q579');
  assert.equal(extension.advisory.patchedVersion, '6.4.1');
  assert.equal(extension.previousExtension.path, 'reports/dependency-security-upgrade-v1.json');
  const priorBytes = await read(extension.previousExtension.path);
  assert.equal(hash(priorBytes), extension.previousExtension.sha256, 'previous dependency evidence changed');
  const prior = JSON.parse(priorBytes.toString());
  assert.equal(prior.schemaVersion, 'dependency-security-upgrade.v1');
  assert.equal(prior.productionAuthority, false);
  assert.equal(hash(await read('reports/operational-closure-acceptance-v2.json')), prior.archivedReportSha256);
  assert.deepEqual(Object.keys(extension.currentFiles).sort(), [...DEPENDENCY_UPGRADE_V2_FILES].sort());
  for (const [file, digest] of Object.entries(extension.currentFiles)) {
    assert.equal(hash(await read(file)), digest, `current dependency extension changed: ${file}`);
  }
  assert.deepEqual(Object.keys(extension.priorEnvironment).sort(), ['package.json', 'pnpm-lock.yaml']);
  const priorEnvironment = {};
  for (const [file, entry] of Object.entries(extension.priorEnvironment)) {
    assert.equal(entry.path, `reports/artifacts/dependency-security-upgrade-v2/${file}.snapshot`);
    priorEnvironment[file] = await read(entry.path);
    assert.equal(hash(priorEnvironment[file]), entry.sha256);
    assert.equal(entry.sha256, prior.currentFiles[file], `v1 environment is not preserved: ${file}`);
  }
  for (const file of ['pnpm-workspace.yaml', 'scripts/operations/verifyOperationalRelease.mjs']) {
    assert.equal(hash(await read(file)), prior.currentFiles[file], `v1 verifier or overrides changed: ${file}`);
  }
  const expectedPackage = JSON.parse(priorEnvironment['package.json'].toString());
  expectedPackage.dependencies['maplibre-gl'] = '6.4.1';
  expectedPackage.scripts['benchmark:core-operations:verify'] = 'node scripts/operations/verifyOperationalReleaseV2.mjs --core';
  expectedPackage.scripts['acceptance:operations:verify'] = 'node scripts/operations/verifyOperationalReleaseV2.mjs';
  assert.deepEqual(JSON.parse((await read('package.json')).toString()), expectedPackage, 'dependency change exceeds MapLibre and the versioned verifier entrypoints');
  const lock = (await read('pnpm-lock.yaml')).toString();
  assert.match(lock, /maplibre-gl:\s+specifier: 6\.4\.1\s+version: 6\.4\.1/);
  assert.ok(lock.includes(`maplibre-gl@6.4.1:\n    resolution: {integrity: ${extension.advisory.npmIntegrity}}`));
  const auditBytes = await read(extension.audit.path);
  assert.equal(hash(auditBytes), extension.audit.sha256);
  assert.equal(extension.audit.command, 'pnpm audit --audit-level=moderate --json');
  const audit = JSON.parse(auditBytes.toString());
  assert.deepEqual(audit.advisories, {});
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) assert.equal(audit.metadata.vulnerabilities[severity], 0);
  return { extension, priorEnvironment };
}

async function main() {
  const { priorEnvironment } = await verifyDependencyUpgradeV2();
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'malacca-dependency-v2-'));
  try {
    for (const directory of ['server', 'shared', 'scripts', 'src', 'reports', 'data', 'tests', 'docs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      await cp(directory, path.join(temporary, directory), { recursive: true });
    }
    for (const [file, bytes] of Object.entries(priorEnvironment)) await writeFile(path.join(temporary, file), bytes);
    // Compose with the unchanged v1 verifier and its original environment.
    // Current code/build/audit remains mandatory in the outer release gate.
    execFileSync(process.execPath, ['scripts/operations/verifyOperationalRelease.mjs', ...process.argv.slice(2)], {
      cwd: temporary, stdio: 'inherit',
    });
    console.log('DEPENDENCY_SECURITY_UPGRADE_V2:PASS:MAPLIBRE_6.4.1:IMMUTABLE_V1_HISTORY');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
