#!/usr/bin/env node
// extract-adjacency.mjs — Build the region ADJACENCY GRAPH (assets/adjacency.json)
// by mining the explicit neighbour edges from the Golehm/war-of-the-ring AI bot's
// map source (Java). Region adjacency is uncopyrightable factual game data (which
// physical board regions border which); we extract the FACTS and re-express them
// in our own format. The source file is NOT committed (no license), exactly like
// the TTS mod — pass its path in.
//
// PROVENANCE / TRUST: FIRST PASS. Bootstrapped from one community source and
// reconciled to our 105-region node set (exact match). To be cross-verified
// against the rulebook map (authority on borders — esp. impassable black borders)
// via a hover/click calibration dev-tab once the UI exists. Until then, treat as
// provisional but usable for the headless engine.
//
// Usage: node scripts/extract-adjacency.mjs [path-to-Golehm-Map.java]
//   default: ./tmp_Map.java (a local working copy, gitignored)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const srcPath = process.argv[2] || join(repoRoot, 'tmp_Map.java');

let java;
try { java = readFileSync(srcPath, 'utf8'); }
catch {
  console.error(`Could not read Golehm Map.java at:\n  ${srcPath}\n` +
    `Fetch it (uncommitted, no license) e.g.:\n` +
    `  gh api repos/Golehm/war-of-the-ring/contents/src/main/java/map/Map.java --jq .content | base64 -d > tmp_Map.java`);
  process.exit(1);
}

const slug = (name) => name.toLowerCase()
  .replace(/~/g, '-').replace(/'/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Source-side spelling fixes (the Golehm file's own typo) -> our canonical slug.
const ALIAS = { 'old-forrest': 'old-forest' };
const canon = (name) => ALIAS[slug(name)] || slug(name);

// var -> display name; then var.getNeighbourRegions().add(var2)
const decls = {};
for (const m of java.matchAll(/Region\s+(\w+)\s*=\s*new Region\("([^"]+)"\)/g)) decls[m[1]] = m[2];
const directed = [...java.matchAll(/(\w+)\.getNeighbourRegions\(\)\.add\((\w+)\)/g)]
  .map((m) => [decls[m[1]], decls[m[2]]]);

// Validate against our canonical node set.
const nodes = JSON.parse(readFileSync(join(repoRoot, 'assets', 'regions.json'), 'utf8')).regions;
const nodeSet = new Set(Object.keys(nodes));

const undirected = new Set();
const onlyOneWay = [];
const seenDir = new Set();
const errors = [];
for (const [a, b] of directed) {
  if (!a || !b) { errors.push(`Unresolved var in edge: ${a} <-> ${b}`); continue; }
  const ca = canon(a), cb = canon(b);
  if (!nodeSet.has(ca)) errors.push(`Edge endpoint not a known region: "${a}" -> ${ca}`);
  if (!nodeSet.has(cb)) errors.push(`Edge endpoint not a known region: "${b}" -> ${cb}`);
  if (ca === cb) continue;
  seenDir.add(`${ca}>${cb}`);
  undirected.add([ca, cb].sort().join('|'));
}
// Symmetry report (board adjacency is mutual; we take the union, but flag gaps).
for (const key of undirected) {
  const [a, b] = key.split('|');
  if (!seenDir.has(`${a}>${b}`) || !seenDir.has(`${b}>${a}`)) onlyOneWay.push(key);
}
if (errors.length) { console.error('ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }

// byRegion adjacency lists + degree.
const byRegion = {};
for (const id of nodeSet) byRegion[id] = [];
for (const key of undirected) {
  const [a, b] = key.split('|');
  byRegion[a].push(b); byRegion[b].push(a);
}
for (const id of nodeSet) byRegion[id].sort();

const isolated = [...nodeSet].filter((id) => byRegion[id].length === 0);
const degrees = Object.values(byRegion).map((l) => l.length);

const out = {
  _meta: {
    generatedBy: 'scripts/extract-adjacency.mjs',
    source: 'Golehm/war-of-the-ring AI bot map (Java) — factual adjacency, re-expressed. Source file not committed (no license).',
    trust: 'FIRST PASS — reconciled to our 105-region node set (exact match). Cross-verify vs the rulebook map (impassable borders) via the calibration dev-tab before treating as final.',
    regionCount: nodeSet.size,
    edgeCount: undirected.size,
    avgDegree: Math.round((degrees.reduce((a, b) => a + b, 0) / degrees.length) * 100) / 100,
    minDegree: Math.min(...degrees),
    maxDegree: Math.max(...degrees),
    isolatedRegions: isolated,
    edgesListedOnlyOneDirectionInSource: onlyOneWay.sort(),
  },
  edges: [...undirected].map((k) => k.split('|')).sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
  byRegion,
};

writeFileSync(join(repoRoot, 'assets', 'adjacency.json'), JSON.stringify(out, null, 2) + '\n');
console.log('Wrote assets/adjacency.json');
console.log(`  ${out._meta.regionCount} regions, ${out._meta.edgeCount} edges, avg degree ${out._meta.avgDegree} (min ${out._meta.minDegree}, max ${out._meta.maxDegree})`);
if (isolated.length) console.log('  WARNING isolated regions:', isolated.join(', '));
if (onlyOneWay.length) console.log(`  note: ${onlyOneWay.length} edges listed one-directionally in source (taken as undirected)`);
