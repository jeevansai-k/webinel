import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const src = resolve(import.meta.dirname, 'src');

/**
 * Builds the extension pages and the background service worker.
 * The content script is built separately (vite.content.config.ts) because
 * content scripts cannot be ES modules.
 */
export default defineConfig({
  root: src,
  publicDir: resolve(import.meta.dirname, 'public'),
  base: './',
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(src, 'popup/index.html'),
        warning: resolve(src, 'warning/Warning.html'),
        background: resolve(src, 'background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
