import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionStamp } from 'digital-boardgame-framework/vite';

// Non-secret production defaults belong in code (not build-time env), so a plain
// `npm run build && wrangler pages deploy` works regardless of who/where.
// `base` defaults to '/' (our canonical Cloudflare Pages serve path).
export default defineConfig(() => ({
  base: '/',
  plugins: [react(), versionStamp()],
  build: {
    target: 'es2022',
  },
}));
