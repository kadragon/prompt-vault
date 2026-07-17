import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

// @crxjs/vite-plugin generates the MV3 manifest and bundles the TypeScript
// content script declared in manifest.config.ts. Output goes to dist/, which is
// the directory to Load unpacked in chrome://extensions.
export default defineConfig({
  plugins: [crx({ manifest })],
});
