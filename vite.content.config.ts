import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Content scripts must be classic scripts, so this entry is bundled as a single IIFE. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: resolve(import.meta.dirname, 'src/content/index.ts'),
      name: 'WebinelContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
