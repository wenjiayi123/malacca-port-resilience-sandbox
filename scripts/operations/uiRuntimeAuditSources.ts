import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Audit coverage must remain the same in a clean clone and a dirty worktree.
export async function currentUiRuntimeAuditSources(): Promise<string[]> {
  const files = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'Dockerfile', 'vite.config.ts',
    'tsconfig.app.json', 'tsconfig.node.json', 'tsconfig.json', 'eslint.config.js'];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|css|sh|py|gd|json)$/.test(entry.name)) files.push(file);
    }
  };
  for (const directory of ['src', 'server', 'shared', 'scripts', 'tests']) await visit(directory);
  return files.sort();
}
