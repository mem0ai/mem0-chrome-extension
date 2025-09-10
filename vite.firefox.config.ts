import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';

import manifest from './manifest.firefox';

export default defineConfig({
  plugins: [
    crx({
      manifest,
      browser: 'firefox',
      contentScripts: { injectCss: true },
    }),
  ],
  build: {
    outDir: 'dist/firefox',
    emptyOutDir: true,
  },
});
