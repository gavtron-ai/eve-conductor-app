import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // ESF dogma data ships as protobuf binaries loaded at runtime
  assetsInclude: ['**/*.pb2'],
  // The dogma engine runs in a Web Worker (see lib/dogmaWorker.ts). Vite's
  // default worker format is 'iife', which CANNOT code-split — the build fails
  // outright the moment anything reachable from the worker uses a dynamic
  // import. Setting 'es' up front means that never becomes a surprise.
  worker: { format: 'es' },
  base: './', // relative asset paths so Electron can load dist/index.html from file://
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500, // the bundled type database is intentionally large
  },
});
