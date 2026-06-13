#!/usr/bin/env node
// audit-layout.mjs — Headless, CI-able invariant check on token layout, using the
// framework's auditLayout (digital-boardgame-framework >= 0.9.1). Turns the old
// "0 bleed across 210 runs" eyeball result into an ENFORCED invariant: fails
// (non-zero exit) if any token would be placed outside its region, or any
// region's anchor falls outside its polygon. Run in `npm test` / CI.
//
// Checks two loads per region: each region's SETUP piece count, and a 12-token
// STRESS count (so shrinking + the stacked-pile fallback are exercised on the
// smallest regions). Stacked piles are fine (a pile, not a bleed); only true
// containment failures fail the build.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditLayout, toPolygon } from 'digital-boardgame-framework';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const geo = JSON.parse(readFileSync(join(repoRoot, 'assets', 'region-geometry.json'), 'utf8'));
const map = JSON.parse(readFileSync(join(repoRoot, 'assets', 'map.json'), 'utf8')).regions;

const TOKEN_RADIUS = 14;        // matches the audit overlay default
const STRESS_COUNT = 12;        // larger than any real on-board stack

const setupCount = (id) => {
  const s = map[id]?.setup;
  return s ? (s.regular ?? 0) + (s.elite ?? 0) + (s.leader ?? 0) + (s.nazgul ?? 0) : 0;
};

const entriesFor = (count) =>
  Object.entries(geo.territories).map(([id, t]) => ({
    id,
    polygon: toPolygon(t.polygon),
    count: typeof count === 'function' ? count(id) : count,
  }));

const passes = [
  { label: 'setup counts', entries: entriesFor((id) => Math.max(1, setupCount(id))) },
  { label: `stress ${STRESS_COUNT}`, entries: entriesFor(STRESS_COUNT) },
];

let failed = false;
for (const { label, entries } of passes) {
  const r = auditLayout(entries, { tokenRadius: TOKEN_RADIUS });
  const ok = r.tokenBleed === 0 && r.anchorsOutside.length === 0;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${label}: ${r.regions} regions, ` +
    `bleed=${r.tokenBleed}, anchorsOutside=${r.anchorsOutside.length}, ` +
    `stacked=${r.stackedPiles.length}, minClearance=${r.minClearance.toFixed(1)}px (${r.tightestRegion})`,
  );
  if (!ok) {
    failed = true;
    if (r.anchorsOutside.length) console.error('  anchors outside polygon:', r.anchorsOutside.join(', '));
  }
}

if (failed) {
  console.error('\nLayout audit FAILED — a token would bleed out of its region or an anchor fell outside. Check assets/region-geometry.json.');
  process.exit(1);
}
console.log('\nLayout audit OK — every token stays inside its region.');
