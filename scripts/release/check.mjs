import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const errors = [];

try {
  execFileSync('python3', ['scripts/public_privacy_scan.py'], { cwd: root, stdio: 'inherit' });
} catch {
  errors.push('公开发布隐私扫描失败');
}
const required = [
  'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example',
  'pnpm-workspace.yaml',
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SUPPORT.md', 'CITATION.cff',
  'docs/DATASET_CONTRACT.md', 'docs/RL_ARCHITECTURE.md', 'docs/PORT_CALL_INTEROPERABILITY.md',
  'docs/OPERATIONAL_SIMULATOR_DATA_CARD.md', 'docs/TESTING.md', 'docs/LIVE_SATELLITE_MAP.md',
  'docs/DEMO_GUIDE.md', 'docs/PROJECT_METRICS.md',
  'docs/ASSET_PROVENANCE.md', 'docs/schemas/port-call-event.schema.json', 'Dockerfile',
  'docs/schemas/port-operations-telemetry.schema.json',
  'docs/MODEL_CARD.md', 'CHANGELOG.md', 'docs/assets/hero.svg',
  'docs/assets/sandbox-command-center.jpg', 'docs/assets/human-review-gate.jpg',
  'docs/assets/xiaoyi-multi-ui-linkage.jpg', 'docs/assets/rl-training-complete-evidence.jpg',
  'public/assets/backgrounds/malacca-operations-grid.svg', 'public/assets/xiaoyi-maritime-officer.svg',
  'public/assets/xiaoyi-ai-port-hero.png',
  'shared/rlObjectivePresets.ts', 'shared/rlOperationalCalibration.ts',
  'scripts/rl/runRLBaselineBenchmark.ts',
  'scripts/rl/verifyBenchmarkReport.ts',
  'reports/rl-benchmark-balanced-resilience-calibrated-v2.json',
  'reports/rl-benchmark-balanced-resilience-calibrated-v2.md',
  'reports/rl-benchmark-balanced-resilience.json',
  'reports/rl-benchmark-balanced-resilience.md',
  'shared/portOperationalContract.ts', 'server/portOperationalManifest.ts',
  'shared/portTelemetryContract.ts', 'server/operationalSimulator.ts',
  'server/realtimeAisGateway.ts', 'src/components/LiveSatelliteMap.tsx',
  'src/integrations/geospatialLiveAdapter.ts',
  'src/components/OperationalEvidenceCenter.tsx', 'src/integrations/operationsControlAdapter.ts',
  'scripts/operations/runOperationalAcceptance.ts',
  'scripts/operations/verifyOperationalAcceptance.ts',
  'reports/operational-closure-acceptance-v1.json',
  'reports/operational-closure-acceptance-v1.md',
  'config/port-profiles/shanghai-international-port.example.json',
  'docs/SHANGHAI_PORT_LANDING.md',
  'docs/schemas/terminal-operations-manifest.schema.json',
  'scripts/data/sync_infore_ais.mjs', 'scripts/rl/runPublicDatasetComparison.ts',
  'scripts/rl/verifyPublicDatasetComparison.ts',
  'reports/public-dataset-credibility-comparison.json',
  'reports/public-dataset-credibility-comparison.md',
  'public/assets/backgrounds/shanghai-operations-grid.svg',
];
const excluded = new Set(['.git', 'node_modules', 'dist', '.runtime', 'soft_copyright', 'output', 'tmp']);

for (const file of required) {
  try {
    if (!(await stat(path.join(root, file))).isFile()) errors.push(`缺少发布文件：${file}`);
  } catch {
    errors.push(`缺少发布文件：${file}`);
  }
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.private !== false) errors.push('package.json 必须明确 private=false');
if (packageJson.license !== 'Apache-2.0') errors.push('package.json license 必须是 Apache-2.0');
if (packageJson.version !== '1.1.0') errors.push('package.json version 必须与 v1.1.0 本地候选保持一致');
if (packageJson.packageManager !== 'pnpm@11.9.0') errors.push('packageManager 必须固定为 pnpm@11.9.0');
if (!packageJson.scripts?.['benchmark:rl'] || !packageJson.scripts?.['benchmark:rl:verify']) {
  errors.push('package.json 必须提供 RL 基准生成与证据验证命令');
}
const pnpmWorkspace = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
for (const safeOverride of ['brace-expansion: 5.0.9', 'nanoid: 3.3.18', 'postcss: 8.5.26']) {
  if (!pnpmWorkspace.includes(safeOverride)) errors.push(`pnpm 工作区缺少安全覆盖：${safeOverride}`);
}

const dockerfile = await readFile(path.join(root, 'Dockerfile'), 'utf8');
if (!dockerfile.includes('COPY --from=build /app/shared ./shared')) {
  errors.push('Docker runtime 缺少 shared/，服务器端目标函数模块将无法加载');
}

try {
  JSON.parse(await readFile(path.join(root, 'docs/schemas/port-call-event.schema.json'), 'utf8'));
} catch (error) {
  errors.push(`港口事件 JSON Schema 无法解析：${error instanceof Error ? error.message : 'unknown error'}`);
}
try {
  JSON.parse(await readFile(path.join(root, 'docs/schemas/terminal-operations-manifest.schema.json'), 'utf8'));
} catch (error) {
  errors.push(`码头运行清单 JSON Schema 无法解析：${error instanceof Error ? error.message : 'unknown error'}`);
}
try {
  JSON.parse(await readFile(path.join(root, 'docs/schemas/port-operations-telemetry.schema.json'), 'utf8'));
} catch (error) {
  errors.push(`实时运行遥测 JSON Schema 无法解析：${error instanceof Error ? error.message : 'unknown error'}`);
}

const candidateFiles = [];
const walk = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || (directory === root && entry.name === 'public' && false)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute);
    if (relative.startsWith(`public${path.sep}godot-simulator${path.sep}`) && entry.name !== 'README.md') continue;
    if (entry.isDirectory()) await walk(absolute);
    else if (entry.isFile()) candidateFiles.push({ absolute, relative });
  }
};
await walk(root);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
];
for (const file of candidateFiles) {
  const fileStat = await stat(file.absolute);
  if (fileStat.size > 90 * 1024 * 1024) errors.push(`候选发布文件超过 90 MiB：${file.relative}`);
  if (fileStat.size > 2 * 1024 * 1024) continue;
  const content = await readFile(file.absolute, 'utf8').catch(() => '');
  if (file.relative !== 'scripts/public_privacy_scan.py'
      && secretPatterns.some((pattern) => pattern.test(content))) {
    errors.push(`疑似密钥：${file.relative}`);
  }
}

for (const workflow of (await readdir(path.join(root, '.github/workflows'))).filter((file) => file.endsWith('.yml'))) {
  const content = await readFile(path.join(root, '.github/workflows', workflow), 'utf8');
  for (const match of content.matchAll(/uses:\s*[^\s@]+@([^\s#]+)/g)) {
    if (!/^[a-f0-9]{40}$/.test(match[1])) errors.push(`${workflow} 的 Action 未固定到完整提交 SHA：${match[0]}`);
  }
}

const applicationReferences = [
  await readFile(path.join(root, 'src/styles/tokens.css'), 'utf8'),
  await readFile(path.join(root, 'src/styles/global.css'), 'utf8'),
  await readFile(path.join(root, 'src/App.tsx'), 'utf8'),
  await readFile(path.join(root, 'src/components/OperationalEvidenceCenter.tsx'), 'utf8'),
  await readFile(path.join(root, 'src/data/malaccaScenario.ts'), 'utf8'),
].join('\n');
if (
  !applicationReferences.includes('等待接入港口 · 仿真回退')
  || !applicationReferences.includes('公开数据校准实时模拟')
  || !applicationReferences.includes('模型真实推理输出')
  || !applicationReferences.includes('待切换现场数据源')
) {
  errors.push('系统缺少实时模拟、真实推理或待切换现场源的显式状态');
}
for (const legacyAsset of [
  'malacca_background_clean.png',
  'malacca_background_selected.png',
  'ui_reference_selected_clean.png',
  'xiaoyi-maritime-officer.svg',
  'xiaoyi-maritime-officer.png',
]) {
  if (applicationReferences.includes(legacyAsset)) errors.push(`应用仍引用已停用的历史图片：${legacyAsset}`);
}
if (!applicationReferences.includes('/assets/xiaoyi-ai-port-hero.png')) {
  errors.push('应用没有引用小懿 AI 原版港航形象');
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Project integrity check passed.\n');
