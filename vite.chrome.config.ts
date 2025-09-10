import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';

import manifest from './manifest.chrome';

export default defineConfig({
  plugins: [
    crx({
      manifest,
      browser: 'chrome',
      contentScripts: { injectCss: true },
    }),
  ],
  build: {
    outDir: 'dist/chrome',
    emptyOutDir: true,
  },
});
