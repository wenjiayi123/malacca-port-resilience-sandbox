import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DEPENDENCY_UPGRADE_V2_FILES, DEPENDENCY_UPGRADE_V2_REPORT, verifyDependencyUpgradeV2 } from './verifyOperationalReleaseV2.mjs';

const artifactRoot = 'reports/artifacts/dependency-security-upgrade-v2';
const baselineCommit = 'bacb580bda5295f0c3e3d87cd0549643c84969ad';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const priorPath = 'reports/dependency-security-upgrade-v1.json';
const priorBytes = await readFile(priorPath);
assert.equal(hash(priorBytes), hash(execFileSync('git', ['show', `${baselineCommit}:${priorPath}`])));
const prior = JSON.parse(priorBytes.toString());
await mkdir(artifactRoot, { recursive: true });
const priorEnvironment = {};
for (const file of ['package.json', 'pnpm-lock.yaml']) {
  const bytes = execFileSync('git', ['show', `${baselineCommit}:${file}`]);
  assert.equal(hash(bytes), prior.currentFiles[file]);
  const archive = `${artifactRoot}/${file}.snapshot`;
  await writeFile(archive, bytes);
  priorEnvironment[file] = { path: archive, sha256: hash(bytes) };
}
const audit = await readFile(process.env.DEPENDENCY_AUDIT_LOG || `${artifactRoot}/pnpm-audit.json`);
const auditPath = `${artifactRoot}/pnpm-audit.json`;
await writeFile(auditPath, audit);
const currentFiles = {};
for (const file of DEPENDENCY_UPGRADE_V2_FILES) currentFiles[file] = hash(await readFile(file));
const report = {
  schemaVersion: 'dependency-security-upgrade.v2', generatedAt: new Date().toISOString(),
  reason: 'Upgrade the minimum patched MapLibre release and bundle its ESM worker; preserve and compose all v1 dependency and operational evidence.',
  advisory: {
    id: 'GHSA-jrc7-96c5-q579', cve: 'CVE-2026-85061', severity: 'critical',
    affectedRange: '<=6.4.0', previousVersion: '5.24.0', patchedVersion: '6.4.1',
    url: 'https://github.com/advisories/GHSA-jrc7-96c5-q579',
    release: 'https://github.com/maplibre/maplibre-gl-js/releases/tag/v6.4.1',
    npmIntegrity: 'sha512-KzxQKtfBu/pSz1C+yW1hNS9eyj2h2lC7ufdAi6/SEt177n3oAfDfmUmslRfJdXY7ReAFBcnvwsqmiyoDhtA9GQ==',
  },
  previousExtension: { path: priorPath, sha256: hash(priorBytes) },
  priorEnvironment, currentFiles,
  audit: { path: auditPath, sha256: hash(audit), command: 'pnpm audit --audit-level=moderate --json' },
  productionAuthority: false,
};
await writeFile(DEPENDENCY_UPGRADE_V2_REPORT, `${JSON.stringify(report, null, 2)}\n`);
await verifyDependencyUpgradeV2();
console.log('DEPENDENCY_SECURITY_UPGRADE_V2:GENERATED:MAPLIBRE_6.4.1:ZERO_ADVISORIES');
