#!/usr/bin/env node
// extract-geometry.mjs — Build assets/region-geometry.json: per-region POLYGON
// data in the FRAMEWORK's normalized polygon format (digital-boardgame-framework
// >= 0.9.0, docs/territory-polygons-design.md). The shared geo math
// (pole-of-inaccessibility, token layout) now lives in the framework; this script
// only produces the DATA (polygons in the reference image's pixel space). No
// bespoke geometry math here anymore — single source of truth is the framework.
//
// WHY (cross-project lesson, Rebellion + Axis & Allies): single-anchor token
// placement misleads players about which region a piece is in. The polygon lets
// the framework anchor a stack at the pole of inaccessibility and keep it inside
// the boundary. See docs/token-layout.md.
//
// SOURCE / TRUST: polygons bootstrapped from SirMartin/WarOfRingMap (clip-path
// polygons, % of that project's reference board image map_en.jpg, 1920x1324 —
// source not committed, no license; used as geometric facts). We convert the
// %-coordinates into PIXELS of that reference image so polygons and the rendered
// map share one coordinate system (the framework format contract). These must be
// affine-recalibrated if/when the UI renders a DIFFERENT board image; the audit
// overlay (src/devtabs/PolygonAudit.tsx) is the verification tool.
//
// Usage: node scripts/extract-geometry.mjs [path-to-regions_en.json]
//   default: ./tmp_regions_en.json (local, gitignored)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poleOfInaccessibilityWithClearance, toPolygon } from 'digital-boardgame-framework';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const srcPath = process.argv[2] || join(repoRoot, 'tmp_regions_en.json');

// Reference image these polygons were traced on (SirMartin map_en.jpg).
const IMAGE = { src: 'wotr-map.jpg', width: 1920, height: 1324 };

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

// "polygon(18% 21%, 20% 25%, ...)" -> [[x,y], ...] in PIXELS of the reference image.
function parsePolygonPx(path) {
  const m = path.match(/polygon\(([^)]*)\)/);
  if (!m) return null;
  const pts = m[1].split(',').map((pt) => {
    const [x, y] = pt.trim().split(/\s+/).map((v) => parseFloat(v) / 100);
    return [round(x * IMAGE.width), round(y * IMAGE.height)];
  });
  return pts.length >= 3 ? pts : null;
}
const round = (n) => Math.round(n * 100) / 100;

const nodes = JSON.parse(readFileSync(join(repoRoot, 'assets', 'regions.json'), 'utf8')).regions;
const nodeSet = new Set(Object.keys(nodes));

const territories = {};
const unmatched = [];
for (const nat of sm) for (const r of nat.regions) {
  const id = canon(r.name);
  if (!nodeSet.has(id)) { unmatched.push(`${r.name} -> ${id}`); continue; }
  const poly = parsePolygonPx(r.path);
  if (!poly) continue;
  territories[id] = { polygon: poly };
}

// --- sanity pass using the FRAMEWORK math (also proves it works in Node) ---
let minClearance = Infinity, worst = null;
let anchorsOutside = 0;
for (const [id, t] of Object.entries(territories)) {
  // One call: anchor + its inscribed-circle clearance (v0.9.1).
  const { clearance } = poleOfInaccessibilityWithClearance(toPolygon(t.polygon));
  if (clearance <= 0) anchorsOutside++;
  if (clearance < minClearance) { minClearance = clearance; worst = id; }
}

const missing = [...nodeSet].filter((id) => !territories[id]);
const out = {
  _meta: {
    generatedBy: 'scripts/extract-geometry.mjs',
    format: 'Framework normalized polygon format (digital-boardgame-framework >= 0.9.0). Coordinates are PIXELS in the reference image (image.width x image.height). Pass polygons through the {x,y} adapter (see src/data/geometry.ts) before calling the framework geo functions.',
    source: 'SirMartin/WarOfRingMap polygons (not committed; no license; geometric facts), %-coords scaled to reference image pixels.',
    geometryMath: 'Shared framework module (poleOfInaccessibility, layoutTokensInPolygon, ...). No bespoke geometry in this repo.',
    trust: 'FIRST PASS bootstrap — alignment verified by eye in the audit overlay (src/devtabs/PolygonAudit.tsx). Recalibrate if the UI board image differs from the reference.',
    territoryCount: Object.keys(territories).length,
    missingGeometry: missing,
    unmatchedSourceNames: unmatched,
    sanity: { anchorsOutsidePolygon: anchorsOutside, minAnchorClearancePx: round(minClearance), tightestRegion: worst },
  },
  image: IMAGE,
  territories,
};
writeFileSync(join(repoRoot, 'assets', 'region-geometry.json'), JSON.stringify(out, null, 2) + '\n');
console.log('Wrote assets/region-geometry.json (framework normalized format)');
console.log(`  geometry for ${Object.keys(territories).length}/${nodeSet.size} regions, image ${IMAGE.width}x${IMAGE.height}`);
console.log(`  framework sanity: ${anchorsOutside} anchors outside polygon; tightest clearance ${round(minClearance)}px (${worst})`);
if (missing.length) console.log('  MISSING geometry:', missing.join(', '));
if (unmatched.length) console.log('  unmatched source names:', unmatched.join(' | '));
