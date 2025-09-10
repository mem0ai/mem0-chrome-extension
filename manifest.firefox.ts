import { defineManifest } from '@crxjs/vite-plugin';

import ManifestConfig from './manifest.chrome';

// @ts-expect-error: Firefox manifest adds fields not present in CRX TS types
export default defineManifest(() => ({
  ...ManifestConfig,
  browser_specific_settings: {
    gecko: {
      id: 'openmemory@mem0.ai',
      strict_min_version: '128.0',
    },
  },
  background: {
    scripts: ['src/background.ts'],
    type: 'module',
    persistent: false,
  },
}));
