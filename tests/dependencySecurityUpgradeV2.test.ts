import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEPENDENCY_UPGRADE_V2_REPORT, verifyDependencyUpgradeV2 } from '../scripts/operations/verifyOperationalReleaseV2.mjs';

test('the MapLibre security extension preserves v1 evidence and rejects downgraded or unrelated dependency edits', async (context) => {
  const { extension } = await verifyDependencyUpgradeV2();
  assert.equal(extension.advisory.patchedVersion, '6.4.1');
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'maplibre-security-evidence-'));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  for (const entry of ['reports', 'scripts', 'src', 'tests', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    await cp(entry, path.join(temporary, entry), { recursive: true });
  }
  const packagePath = path.join(temporary, 'package.json');
  const original = await readFile(packagePath);
  const oldReport = await readFile(path.join(temporary, DEPENDENCY_UPGRADE_V2_REPORT));
  for (const change of [
    (value: { dependencies: Record<string, string> }) => { value.dependencies['maplibre-gl'] = '6.4.0'; },
    (value: { dependencies: Record<string, string> }) => { value.dependencies.react = '18.0.0'; },
  ]) {
    const pkg = JSON.parse(original.toString());
    change(pkg);
    const bytes = Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`);
    await writeFile(packagePath, bytes);
    await assert.rejects(verifyDependencyUpgradeV2(temporary), /current dependency extension changed/);
    // Editing the declared digest still cannot broaden the reviewed package scope.
    const report = JSON.parse(oldReport.toString());
    report.currentFiles['package.json'] = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(temporary, DEPENDENCY_UPGRADE_V2_REPORT), JSON.stringify(report));
    await assert.rejects(verifyDependencyUpgradeV2(temporary), /dependency change exceeds/);
    await writeFile(path.join(temporary, DEPENDENCY_UPGRADE_V2_REPORT), oldReport);
  }
  await writeFile(packagePath, original);
  await writeFile(path.join(temporary, extension.previousExtension.path), '{}');
  await assert.rejects(verifyDependencyUpgradeV2(temporary), /previous dependency evidence changed/);
});
