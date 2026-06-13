#!/usr/bin/env node
// adjacency-diff.mjs — Cross-check two independent datasets: the engine's region
// adjacency (assets/adjacency.json, from the Golehm source) vs adjacency DERIVED
// from the region polygons (assets/region-geometry.json) via the framework's
// adjacencyFromPolygons. Disagreements flag a likely error in ONE of the two
// sources (a mis-traced polygon, or a wrong/missing engine edge). Reports only —
// never auto-"fixes" either dataset.
//
// Polygons are hand-traced (SirMartin), so neighbouring boundaries rarely touch
// exactly; a pixel tolerance is required. We sweep a few tolerances and report
// the diff at the one that best matches, plus the residual disagreements.
//
// Usage: node scripts/adjacency-diff.mjs [tolerancePx]

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjacencyFromPolygons, diffAdjacency, toPolygon } from 'digital-boardgame-framework';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(join(repoRoot, 'assets', 'region-geometry.json'), 'utf8'));
const adj = JSON.parse(readFileSync(join(repoRoot, 'assets', 'adjacency.json'), 'utf8'));

const polys = {};
for (const [id, t] of Object.entries(geo.territories)) polys[id] = toPolygon(t.polygon);
const engineEdges = adj.edges.map(([a, b]) => [a, b]);

const sweep = process.argv[2] ? [Number(process.argv[2])] : [6, 10, 14, 20, 28, 40];
console.log(`engine edges: ${engineEdges.length}, regions with polygons: ${Object.keys(polys).length}\n`);
console.log('tol(px)  polyEdges  shared  polyOnly  engineOnly');
let best = null;
for (const tol of sweep) {
  const polyEdges = adjacencyFromPolygons(polys, tol);
  const d = diffAdjacency(polyEdges, engineEdges);
  console.log(
    `${String(tol).padStart(5)}    ${String(polyEdges.length).padStart(7)}  ${String(d.shared.length).padStart(6)}  ` +
    `${String(d.onlyA.length).padStart(8)}  ${String(d.onlyB.length).padStart(9)}`,
  );
  const disagreements = d.onlyA.length + d.onlyB.length;
  if (!best || disagreements < best.disagreements) best = { tol, d, disagreements };
}

console.log(`\nBest match at tolerance ${best.tol}px (${best.disagreements} disagreements):`);
console.log(`\n  polygon-adjacent but NOT in engine data (${best.d.onlyA.length}) — possible polygon over-touch or a MISSING engine edge:`);
for (const [a, b] of best.d.onlyA) console.log(`    ${a} — ${b}`);
console.log(`\n  engine-adjacent but polygons DON'T touch (${best.d.onlyB.length}) — possible mis-traced polygon or a spurious engine edge:`);
for (const [a, b] of best.d.onlyB) console.log(`    ${a} — ${b}`);
console.log('\nNote: a residual diff is expected (rough traced polygons; map gaps at rivers/seas). Investigate the named pairs by eye in the audit overlay; do not auto-edit either source.');
