import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { publicEvidencePlugin } from './server/publicEvidencePlugin.ts';

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'MAPTILER_API_KEY',
    'AISSTREAM_API_KEY',
    'AISSTREAM_WEBSOCKET_URL',
    'AIS_REST_ENDPOINT',
    'AIS_BEARER_TOKEN',
  ]) {
    if (process.env[key] === undefined && localEnvironment[key]) process.env[key] = localEnvironment[key];
  }
  return {
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
  };
});
