import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const required = [
  'LICENSE', 'NOTICE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', '.env.example',
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SUPPORT.md', 'CITATION.cff',
  'docs/DATASET_CONTRACT.md', 'docs/RL_ARCHITECTURE.md', 'docs/PORT_CALL_INTEROPERABILITY.md',
  'docs/DEMO_GUIDE.md',
  'docs/ASSET_PROVENANCE.md', 'docs/schemas/port-call-event.schema.json', 'Dockerfile',
  'docs/MODEL_CARD.md', 'CHANGELOG.md', 'docs/assets/hero.svg',
  'docs/assets/sandbox-command-center.jpg', 'docs/assets/human-review-gate.jpg',
  'public/assets/backgrounds/malacca-operations-grid.svg', 'public/assets/xiaoyi-maritime-officer.svg',
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
if (packageJson.version !== '1.0.0') errors.push('package.json version 必须与 v1.0.0 发布保持一致');
if (packageJson.packageManager !== 'pnpm@11.9.0') errors.push('packageManager 必须固定为 pnpm@11.9.0');

try {
  JSON.parse(await readFile(path.join(root, 'docs/schemas/port-call-event.schema.json'), 'utf8'));
} catch (error) {
  errors.push(`港口事件 JSON Schema 无法解析：${error instanceof Error ? error.message : 'unknown error'}`);
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
  if (secretPatterns.some((pattern) => pattern.test(content))) errors.push(`疑似密钥：${file.relative}`);
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
].join('\n');
for (const legacyAsset of [
  'malacca_background_clean.png',
  'malacca_background_selected.png',
  'ui_reference_selected_clean.png',
  'xiaoyi-maritime-officer.png',
]) {
  if (applicationReferences.includes(legacyAsset)) errors.push(`应用仍引用未纳入发布的历史图片：${legacyAsset}`);
}

for (const error of errors) process.stderr.write(`ERROR ${error}\n`);
if (errors.length) process.exit(1);
process.stdout.write('Release gate passed.\n');
