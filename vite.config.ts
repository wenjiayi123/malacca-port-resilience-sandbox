import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { publicEvidencePlugin } from './server/publicEvidencePlugin.ts';
import { operatorIntegrationPlugin } from './server/operatorIntegrationPlugin.ts';
import { portCommunityPlugin } from './server/portCommunityPlugin.ts';
import { vesselTrafficSafetyPlugin } from './server/vesselTrafficSafetyPlugin.ts';
import { productionAuthorityPlugin } from './server/productionAuthorityPlugin.ts';
import { portBusinessRlPlugin } from './server/portBusinessRlPlugin.ts';

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), '');
  for (const key of [
    'MAPTILER_API_KEY',
    'AISSTREAM_API_KEY',
    'AISSTREAM_WEBSOCKET_URL',
    'AIS_REST_ENDPOINT',
    'AIS_BEARER_TOKEN',
    'PORT_OPERATOR_SOURCE_MANIFEST_PATH',
    'PORT_OPERATOR_SIGNING_KEYS_JSON',
    'PORT_OPERATOR_INTEGRATION_STATE_FILE',
    'OPERATOR_INGEST_RATE_LIMIT_PER_MINUTE',
    'PORT_COMMUNITY_LOCAL_PARTY_ID',
    'PORT_COMMUNITY_LOCAL_ROLE',
    'PORT_COMMUNITY_PARTNERS_JSON',
    'PORT_IDENTITY_TRUST_BUNDLE_JSON',
    'PORT_INTERLOCK_TRUST_BUNDLE_JSON',
    'PORT_AUTHORITY_AUDIENCE',
    'PORT_ACCEPTED_SITE_ID',
    'PORT_ACCEPTANCE_REFERENCE',
  ]) {
    if (process.env[key] === undefined && localEnvironment[key]) process.env[key] = localEnvironment[key];
  }
  return {
    plugins: [
      react(),
      portBusinessRlPlugin(),
      productionAuthorityPlugin(),
      vesselTrafficSafetyPlugin(),
      portCommunityPlugin(),
      operatorIntegrationPlugin(),
      publicEvidencePlugin(),
    ],
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
