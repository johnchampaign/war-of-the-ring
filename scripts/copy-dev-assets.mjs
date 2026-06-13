// Copies the gitignored runtime art catalog (public/dev-assets/) into place for a
// local build, if it exists. No art is committed to the repo, so on CI / a fresh
// clone this is a deliberate no-op — the app ships placeholders and fetches art
// client-side on first run. Present only so the build pipeline is uniform whether
// or not a developer has hydrated dev-assets locally.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, 'public', 'dev-assets');

if (!existsSync(src)) {
  console.log('[copy-dev-assets] no public/dev-assets/ — shipping placeholders (expected).');
} else {
  console.log('[copy-dev-assets] public/dev-assets/ present; Vite will serve it from /dev-assets.');
}
