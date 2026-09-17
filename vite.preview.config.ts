import { defineConfig } from 'vite';

/** DEV ONLY: serves preview/*.html with a stubbed chrome API. Not part of the extension build. */
export default defineConfig({ server: { port: 5178 } });
