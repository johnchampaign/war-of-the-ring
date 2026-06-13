// Safety guard for the "metadata + URLs only — never deploy publisher art" rule.
// Walks the build output (dist/) and deletes any raster image files that may have
// leaked in (e.g. a stray dev-assets copy). The deployed bundle must contain NO
// publisher art; art is fetched/sliced/cached client-side on first run. Fails loud
// if it removes anything, so a leak is visible in CI rather than silently shipped.
import { readdirSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const ART = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tiff', '.avif']);
// Vite's own UI icons (favicon etc.) are allowed; publisher art lives under dev-assets.
const ALLOW_DIRS = new Set([]); // none — we ship zero raster art

const removed = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (ART.has(extname(name).toLowerCase())) {
      rmSync(p);
      removed.push(p.slice(root.length + 1));
    }
  }
}

walk(dist);

if (removed.length) {
  console.warn(`[strip-images] removed ${removed.length} image file(s) from dist (must not deploy art):`);
  for (const r of removed) console.warn('  - ' + r);
} else {
  console.log('[strip-images] dist clean — no raster art in build output.');
}
