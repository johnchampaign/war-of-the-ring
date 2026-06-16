import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

// Non-secret production defaults belong in code (not build-time env), so a plain
// `npm run build && wrangler pages deploy` works regardless of who/where.
// `base` defaults to '/' (our canonical Cloudflare Pages serve path).
export default defineConfig(() => ({
  base: '/',
  // Bind all interfaces (IPv4 + IPv6) so the browser reaches the dev server whether
  // `localhost` resolves to 127.0.0.1 or ::1. Default (localhost) bound IPv6-only on
  // this Windows setup, so Chrome's IPv4 `localhost` got ERR_CONNECTION_REFUSED and
  // fell back to a stale service-worker cache.
  server: { host: true },
  plugins: [react(), versionStamp()],
  // dedupe React so the framework's useGame hook doesn't hit two React copies
  // (integration-guide gotcha).
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    target: 'es2022',
  },
}));
