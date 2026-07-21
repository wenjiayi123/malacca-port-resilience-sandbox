import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { publicEvidencePlugin } from './server/publicEvidencePlugin.ts';

export default defineConfig({
  plugins: [react(), publicEvidencePlugin()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
