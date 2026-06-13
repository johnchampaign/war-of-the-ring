#!/usr/bin/env node
// extract-regions.mjs — Build the region-catalog SKELETON for the map graph by
// mining the scripted TTS mod's Lua `Regions` table (a machine-readable
// companion source — framework playbook, decisions.md lesson 2: prefer this
// over OCRing the board).
//
// Output: assets/regions.json
//   { _meta, regions: { <id>: { name, nation, settlement, vp, side, control,
//                               starting: {regular,elite,leader}, adjacency: [] } } }
//
// PROVENANCE & TRUST (framework lesson 7 — "DO NOT use in logic until verified"):
//   - nation / settlement / vp / side / control come from the mod and are a
//     STARTING POINT, not ground truth. The mod has known errors (see _meta).
//   - `starting` (unit setup) is mod-sourced and UNVERIFIED — the RULEBOOK
//     (p.16-17) is the authority and disagrees in places (e.g. Rivendell).
//   - `adjacency` is intentionally EMPTY here. The rulebook map is the authority
//     on borders; adjacency is transcribed/verified in a separate focused pass.
//
// Usage: node scripts/extract-regions.mjs [path-to-mod.json]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const DEFAULT_MOD = join(
  homedir(), 'Documents', 'My Games', 'Tabletop Simulator', 'Mods', 'Workshop',
  '1831369203.json',
);
const modPath = process.argv[2] || DEFAULT_MOD;

let mod;
try {
  mod = JSON.parse(readFileSync(modPath, 'utf8'));
} catch {
  console.error(`Could not read TTS mod at:\n  ${modPath}\n` +
    `Pass the path explicitly. (The mod file is local-only, not committed.)`);
  process.exit(1);
}
const lua = mod.LuaScript || '';

// Pseudo-regions in the Lua that are NOT map regions (boxes / track steps).
const EXCLUDE = [
  /Reinforcements$/,
  /^Army [123] (Free Peoples|Shadow)$/,
  /^Fellowship Box$/,
  / Stronghold$/,            // "Rivendell Stronghold" etc. are siege BOXES
  /^Shadow Stronghold \d$/,  // generic Shadow siege BOXES (end in a digit)
  /^Mount Doom [1-5]$/,      // Mordor track steps
  /^Crack of Doom$/,
];

// Mod region-name typos -> correct names (confirmed vs the rulebook / Golehm AI
// map cross-check). Applied before slugging so ids and names are canonical.
const NAME_FIX = {
  'Buchland': 'Buckland',
  'Minbiriath': 'Minhiriath',
  'South Andium Vale': 'South Anduin Vale',
  'Southern Murkwood': 'Southern Mirkwood',
};

// slugify a region name into a stable id.
const slug = (name) => name
  .toLowerCase()
  .replace(/~/g, '-')           // Barad~Dur -> barad-dur
  .replace(/'/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const rx = /Regions\["([^"]+)"\]=\{([^{}]*Detected=\{[^}]*\}[^{}]*Starting=\{[^}]*\})\}/g;
const NATION_FIX = { Southron: 'Southrons', North: 'The North' }; // display-normalize

const regions = {};
let m;
let total = 0;
for (; (m = rx.exec(lua)); ) {
  const rawName = m[1];
  const body = m[2];
  total++;
  if (EXCLUDE.some((re) => re.test(rawName))) continue;
  const name = NAME_FIX[rawName] || rawName;

  const str = (k) => (body.match(new RegExp(`${k}="([^"]*)"`)) || [, ''])[1];
  const num = (k) => Number((body.match(new RegExp(`${k}=(\\d+)`)) || [, 0])[1]);
  const start = body.match(/Starting=\{R=(\d+),E=(\d+),L=(\d+)\}/);

  const nationRaw = str('Nation');
  regions[slug(name)] = {
    name,
    nation: nationRaw ? (NATION_FIX[nationRaw] || nationRaw) : null,
    settlement: str('Settlement') || null,   // Town | City | Stronghold | Fortification
    vp: num('Points'),
    side: str('Side') || null,               // initial controlling SIDE
    control: str('Control') || null,
    starting: start
      ? { regular: +start[1], elite: +start[2], leader: +start[3] }
      : { regular: 0, elite: 0, leader: 0 },
    adjacency: [],                           // FILLED IN A SEPARATE VERIFIED PASS
  };
}

const out = {
  _meta: {
    generatedBy: 'scripts/extract-regions.mjs',
    source: 'TTS Workshop mod "War of the Ring 2E (Scripted by DevKev)" (1831369203), LuaScript Regions table',
    trust: 'NODE LIST ONLY is reliable. The region NAMES/ids are trustworthy; the gameplay fields (nation/settlement/vp/side/control/starting) are an UNRELIABLE mod author table (or snapshot) and MUST be re-derived from the rulebook before any engine use.',
    knownIssues: [
      'Gameplay fields are NOT canonical. The Lua has MULTIPLE inconsistent Regions tables (likely per-scenario); no single table matches the rulebook (e.g. one has Erebor=Dwarves/Dale=City correct but Rivendell=3 Elite wrong; another has Rivendell=2 Elite correct but Erebor=Sauron/Dale=Fortification wrong). This extractor takes last-match-wins, so nation/side/control/starting here are arbitrary among those tables — re-derive ALL of them from the rulebook.',
      'Mod `Settlement` has errors: e.g. "Dale" tagged Fortification, but rulebook p.10 says the ONLY fortifications are Osgiliath and Fords of Isen.',
      'Mod `starting` units disagree with rulebook p.16-17 (e.g. Rivendell mod=3 Elite vs rulebook=2 Elite). Rulebook is authority for setup.',
      'AUTHORITATIVE re-derivation plan: nation membership from the colored map (p.9); settlement type from p.10-11; VP from p.11/44; starting units from the Army Setup diagram (p.16-17).',
      'adjacency is empty: to be transcribed from the rulebook map (authority on borders) in a focused, tool-verified pass.',
      'Region SET still needs confirming as exactly the base-game board (expansions add cards/figures, not regions, but confirm).',
    ],
    regionCount: Object.keys(regions).length,
    rawEntriesScanned: total,
  },
  regions,
};

mkdirSync(join(repoRoot, 'assets'), { recursive: true });
const outPath = join(repoRoot, 'assets', 'regions.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

// Summary
const bySettlement = {};
const byNation = {};
for (const r of Object.values(regions)) {
  if (r.settlement) bySettlement[r.settlement] = (bySettlement[r.settlement] || 0) + 1;
  byNation[r.nation || '(none)'] = (byNation[r.nation || '(none)'] || 0) + 1;
}
console.log(`Wrote ${outPath}`);
console.log(`  ${Object.keys(regions).length} map regions (from ${total} raw entries)`);
console.log('  settlements:', JSON.stringify(bySettlement));
console.log('  by nation:', JSON.stringify(byNation));
