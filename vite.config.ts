import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';

// CONTENT-SECURITY-POLICY (v0.224.0, audit F3 — item 6 of Electron's own security checklist).
// The packaged app loads dist/index.html from file://, where a response header cannot carry
// the policy, so it goes into the page as a <meta> tag — and only into the BUILT page: the dev
// server's React preamble is an inline script the policy would (rightly) refuse. Every source
// here is a host the request meter already knows (lib/netMeter); anything else is refused and
// logged (main.tsx listens for securitypolicyviolation). `file:` is spelled out beside 'self'
// because a file:// document's 'self' is not guaranteed to match its own folder in Chromium.
const CSP = [
  "default-src 'self' file:",
  // 'wasm-unsafe-eval' permits WebAssembly compilation ONLY (the vendored fit engine also runs on the
  // main thread as the worker's fallback); JS eval stays refused — protobuf decoding is static code
  "script-src 'self' file: 'wasm-unsafe-eval'",
  // React's style={{…}} attributes are inline styles; there is no inline <style> block in the app
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: blob: https://images.evetech.net",
  "font-src 'self' file: data:",
  "worker-src 'self' file: blob:",
  "connect-src 'self' file: https://esi.evetech.net https://login.eveonline.com https://images.evetech.net https://market.fuzzwork.co.uk https://www.fuzzwork.co.uk https://zkillboard.com https://ntfy.sh https://*.ntfy.sh",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
const csp = (): Plugin => ({
  name: 'eve-conductor-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [react(), csp()],
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
    // v0.234.0 (audit F8): the overlay window has its own page and bundle — see src/overlay.tsx
    rollupOptions: { input: { main: 'index.html', overlay: 'overlay.html' } },
    chunkSizeWarningLimit: 1500, // the bundled type database is intentionally large
  },
});
