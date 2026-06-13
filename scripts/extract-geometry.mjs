#!/usr/bin/env node
// extract-geometry.mjs — Build assets/region-geometry.json: per-region POLYGON
// plus derived layout anchors, for polygon-aware token placement in the UI.
//
// WHY (cross-project lesson, Rebellion + Axis & Allies): with only a single
// anchor point per region, stacks of tokens get laid out in ways that mislead
// players about which region a token is in. The region POLYGON lets the UI:
//   - anchor a stack at the POLE OF INACCESSIBILITY (centre of the largest
//     inscribed circle) — the most "inside" point, robust for concave regions;
//   - size/pack the stack using the clearance RADIUS so tokens never spill over
//     a border into a neighbouring region.
//
// SOURCE / TRUST: polygons bootstrapped from SirMartin/WarOfRingMap (clip-path
// polygons, % of that project's reference board image — source not committed,
// no license; used as geometric facts). Coordinates are NORMALISED 0..1 in that
// reference image's space and MUST be recalibrated (affine fit) to whatever board
// image the UI actually renders, via the calibration dev-tab. Useful now for the
// relative layout/packing logic and as the seed the calibration tab edits.
//
// Usage: node scripts/extract-geometry.mjs [path-to-regions_en.json]
//   default: ./tmp_regions_en.json (local, gitignored)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const srcPath = process.argv[2] || join(repoRoot, 'tmp_regions_en.json');

let sm;
try { sm = JSON.parse(readFileSync(srcPath, 'utf8')); }
catch {
  console.error(`Could not read SirMartin regions_en.json at:\n  ${srcPath}\n` +
    `Fetch it (uncommitted, no license) e.g.:\n` +
    `  gh api repos/SirMartin/WarOfRingMap/contents/regions_en.json --jq .content | base64 -d > tmp_regions_en.json`);
  process.exit(1);
}

const slug = (name) => name.toLowerCase()
  .replace(/~/g, '-').replace(/'/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// SirMartin spelling quirks -> our canonical slug.
const ALIAS = {
  'osgilath': 'osgiliath',
  'barad-d-r': 'barad-dur', 'north-rh-n': 'north-rhun',
  'south-rh-n': 'south-rhun', 'east-rh-n': 'east-rhun',
  'l-rien': 'lorien',
  'bosque-de-dr-adan': 'druadan-forest', 'dr-waith-iaur': 'druwaith-iaur',
};
const canon = (name) => { const s = slug(name); return ALIAS[s] || s; };

// --- geometry helpers (coords in 0..1) ---
function parsePolygon(path) {
  // "polygon(18% 21%, 20% 25%, ...)" -> [[0.18,0.21], ...]
  const m = path.match(/polygon\(([^)]*)\)/);
  if (!m) return null;
  return m[1].split(',').map((pt) => {
    const [x, y] = pt.trim().split(/\s+/).map((v) => parseFloat(v) / 100);
    return [x, y];
  });
}
const area = (p) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a) / 2;
};
const centroid = (p) => {
  let x = 0, y = 0, a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += f; x += (p[j][0] + p[i][0]) * f; y += (p[j][1] + p[i][1]) * f;
  }
  a *= 3;
  return a ? [x / a, y / a] : p[0];
};
const bbox = (p) => {
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
function pointInPolygon([x, y], p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function segDist([x, y], [x1, y1], [x2, y2]) {
  let dx = x2 - x1, dy = y2 - y1;
  if (dx || dy) {
    const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x1 = x2; y1 = y2; } else if (t > 0) { x1 += dx * t; y1 += dy * t; }
  }
  dx = x - x1; dy = y - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
// signed dist: + inside, - outside (magnitude = distance to nearest edge)
function signedDist(pt, p) {
  let d = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, segDist(pt, p[i], p[j]));
  return (pointInPolygon(pt, p) ? 1 : -1) * d;
}
// Pole of inaccessibility (Mapbox polylabel, single-ring), returns {point, radius}.
function poleOfInaccessibility(p, precision = 0.002) {
  const [minX, minY, maxX, maxY] = bbox(p);
  const w = maxX - minX, h = maxY - minY;
  const cell = Math.min(w, h);
  if (cell === 0) return { point: [minX, minY], radius: 0 };
  const half = cell / 2;
  const mk = (x, y, hh) => { const d = signedDist([x, y], p); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  const queue = [];
  for (let x = minX; x < maxX; x += cell) for (let y = minY; y < maxY; y += cell) queue.push(mk(x + half, y + half, half));
  let best = mk(...centroid(p), 0);
  // also try bbox centre
  const bc = mk(minX + w / 2, minY + h / 2, 0);
  if (bc.d > best.d) best = bc;
  while (queue.length) {
    queue.sort((a, b) => b.max - a.max);
    const c = queue.shift();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.h / 2;
    queue.push(mk(c.x - hh, c.y - hh, hh), mk(c.x + hh, c.y - hh, hh),
               mk(c.x - hh, c.y + hh, hh), mk(c.x + hh, c.y + hh, hh));
  }
  return { point: [round(best.x), round(best.y)], radius: round(Math.max(0, best.d)) };
}
const round = (n) => Math.round(n * 1e4) / 1e4;

// --- build ---
const nodes = JSON.parse(readFileSync(join(repoRoot, 'assets', 'regions.json'), 'utf8')).regions;
const nodeSet = new Set(Object.keys(nodes));

const out = {};
const unmatched = [];
for (const nat of sm) for (const r of nat.regions) {
  const id = canon(r.name);
  if (!nodeSet.has(id)) { unmatched.push(`${r.name} -> ${id}`); continue; }
  const poly = parsePolygon(r.path);
  if (!poly || poly.length < 3) continue;
  const poi = poleOfInaccessibility(poly);
  out[id] = {
    polygon: poly.map(([x, y]) => [round(x), round(y)]),
    bbox: bbox(poly).map(round),
    area: round(area(poly)),
    centroid: centroid(poly).map(round),
    anchor: poi.point,        // pole of inaccessibility — primary stack anchor
    anchorRadius: poi.radius,  // clearance: max stack radius before spilling over a border
  };
}

const missing = [...nodeSet].filter((id) => !out[id]);
const result = {
  _meta: {
    generatedBy: 'scripts/extract-geometry.mjs',
    source: 'SirMartin/WarOfRingMap polygons (not committed; no license; geometric facts).',
    coordinateSpace: 'NORMALISED 0..1 in SirMartin reference board image. Recalibrate (affine) to the UI board image via the calibration dev-tab before pixel use.',
    use: 'Polygon-aware token layout: anchor stacks at `anchor` (pole of inaccessibility); size/pack using `anchorRadius` so tokens stay inside the region. Avoids the single-anchor token-placement confusion seen in Rebellion and Axis & Allies.',
    trust: 'FIRST PASS bootstrap — geometry + alignment verified/edited in the calibration dev-tab.',
    regionsWithGeometry: Object.keys(out).length,
    regionsMissingGeometry: missing,
    unmatchedSourceNames: unmatched,
  },
  regions: out,
};
writeFileSync(join(repoRoot, 'assets', 'region-geometry.json'), JSON.stringify(result, null, 2) + '\n');
console.log('Wrote assets/region-geometry.json');
console.log(`  geometry for ${Object.keys(out).length}/${nodeSet.size} regions`);
if (missing.length) console.log('  MISSING geometry:', missing.join(', '));
if (unmatched.length) console.log('  unmatched source names:', unmatched.join(' | '));
