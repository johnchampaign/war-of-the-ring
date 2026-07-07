#!/usr/bin/env node
// build-map.mjs — Build the CANONICAL map catalog `assets/map.json` by merging
// the reliable region NODE LIST (assets/regions.json, extracted from the TTS mod)
// with RULEBOOK-AUTHORITATIVE settlement/nation/VP/setup data hand-authored
// below from the rulebook (Ares WOTR 2E). The mod's gameplay fields are NOT
// trusted (see extract-regions.mjs _meta); this script overrides them entirely.
//
// AUTHORITY:
//   - Settlement types & nations: rulebook p.9-11, p.16-17 (Army Setup headings).
//   - Starting setup units: rulebook Army Setup, p.16-17.
//   - VP: City=1, Stronghold=2, Town/Fortification=0 (p.11, p.44).
//   - Nation reinforcement pools & political start: p.14 step 11, p.16-17, p.34.
//
// STILL PENDING (the map-reading pass, not in this file yet):
//   - nation membership of WILDERNESS regions (inside a nation's colored border
//     but with no settlement) — null here until transcribed from the map.
//   - adjacency — empty here; the rulebook map is the authority on borders.
//   - exact political-track step counts (only active/passive + start box here).
//
// Run: node scripts/build-map.mjs   (validates all keys against the node list)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const nodes = JSON.parse(
  readFileSync(join(repoRoot, 'assets', 'regions.json'), 'utf8'),
).regions;

// ---- Nations (p.14 step 11, p.16-17 reinforcements, p.34) ----
// political.active: Elves + all Shadow nations start Active; other FP Passive.
// political.startBox: rulebook p.14 step 11 grouping (1 = furthest from At War).
// Exact step counts to be verified against the board's Political Track.
const NATIONS = {
  dwarves:   { side: 'FreePeoples', reinforcements: { regular: 2, elite: 3, leader: 3 }, political: { active: false, startBox: 1 } },
  elves:     { side: 'FreePeoples', reinforcements: { regular: 2, elite: 4, leader: 0 }, political: { active: true,  startBox: 1 } },
  gondor:    { side: 'FreePeoples', reinforcements: { regular: 6, elite: 4, leader: 3 }, political: { active: false, startBox: 2 } },
  north:     { side: 'FreePeoples', reinforcements: { regular: 6, elite: 4, leader: 3 }, political: { active: false, startBox: 1 } },
  rohan:     { side: 'FreePeoples', reinforcements: { regular: 6, elite: 4, leader: 3 }, political: { active: false, startBox: 1 } },
  isengard:  { side: 'Shadow',      reinforcements: { regular: 6, elite: 5, leader: 0 }, political: { active: true,  startBox: 3 } },
  sauron:    { side: 'Shadow',      reinforcements: { regular: 8, elite: 4, nazgul: 4 }, political: { active: true,  startBox: 3 } },
  southrons: { side: 'Shadow',      reinforcements: { regular: 10, elite: 3, leader: 0 }, political: { active: true,  startBox: 2 } },
};

// ---- Settlement regions (rulebook-authoritative) ----
// [nation, settlement, {regular,elite,leader,nazgul} setup]  — setup omitted = none.
// settlement ∈ Town | City | Stronghold | Fortification.  VP derived below.
const S = (nation, settlement, setup) => ({ nation, settlement, setup: setup || null });
const SETTLEMENTS = {
  // Dwarves (p.16)
  'erebor':        S('dwarves',  'Stronghold',   { regular: 1, elite: 2, leader: 1 }),
  // Iron Hills is a TOWN (no VP symbol on the board). Was mis-typed 'City' — that
  // both handed the Shadow a phantom 1 VP (FP capturable total must be 20: 8
  // Strongholds ×2 + 4 Cities — Dale, Edoras, Pelargir, The Shire) and wrongly gave
  // its defender the City first-round fortification bonus. TTS board data agrees
  // (isTown: true).
  'iron-hills':    S('dwarves',  'Town',         { regular: 1 }),
  'ered-luin':     S('dwarves',  'Town',         { regular: 1 }),
  // Elves (p.16) — all four Elven settlements are Strongholds
  'grey-havens':   S('elves',    'Stronghold',   { regular: 1, elite: 1, leader: 1 }),
  'rivendell':     S('elves',    'Stronghold',   { elite: 2, leader: 1 }),
  'woodland-realm':S('elves',    'Stronghold',   { regular: 1, elite: 1, leader: 1 }),
  'lorien':        S('elves',    'Stronghold',   { regular: 1, elite: 2, leader: 1 }),
  // Gondor (p.16)
  'minas-tirith':  S('gondor',   'Stronghold',   { regular: 3, elite: 1, leader: 1 }),
  'dol-amroth':    S('gondor',   'Stronghold',   { regular: 3 }),
  'pelargir':      S('gondor',   'City',         { regular: 1 }),
  'osgiliath':     S('gondor',   'Fortification',{ regular: 2 }),
  'lossarnach':    S('gondor',   'Town'),
  'lamedon':       S('gondor',   'Town'),
  // The North (p.16)
  'dale':          S('north',    'City',         { regular: 1, leader: 1 }),
  'the-shire':     S('north',    'City',         { regular: 1 }),
  'bree':          S('north',    'Town',         { regular: 1 }),
  'carrock':       S('north',    'Town',         { regular: 1 }),
  // (North Downs: 1 Elite at setup but NO settlement — handled in NON_SETTLEMENT_SETUP)
  // Rohan (p.16)
  'edoras':        S('rohan',    'City',         { regular: 1, elite: 1 }),
  'helms-deep':    S('rohan',    'Stronghold',   { regular: 1 }),
  'fords-of-isen': S('rohan',    'Fortification',{ regular: 2, leader: 1 }),
  'folde':         S('rohan',    'Town'),
  'westemnet':     S('rohan',    'Town'),
  // Isengard (p.17)
  'orthanc':       S('isengard', 'Stronghold',   { regular: 4, elite: 1 }),
  'north-dunland': S('isengard', 'Town',         { regular: 1 }),
  'south-dunland': S('isengard', 'Town',         { regular: 1 }),
  // Sauron (p.17)
  'barad-dur':     S('sauron',   'Stronghold',   { regular: 4, elite: 1, nazgul: 1 }),
  'dol-guldur':    S('sauron',   'Stronghold',   { regular: 5, elite: 1, nazgul: 1 }),
  'minas-morgul':  S('sauron',   'Stronghold',   { regular: 5, nazgul: 1 }),
  'moria':         S('sauron',   'Stronghold',   { regular: 2 }),
  'mount-gundabad':S('sauron',   'Stronghold',   { regular: 2 }),
  'morannon':      S('sauron',   'Stronghold',   { regular: 5, nazgul: 1 }),
  'angmar':        S('sauron',   'City'),
  'nurn':          S('sauron',   'Town',         { regular: 2 }),
  // (Gorgoroth: 3 Regular at setup but NO settlement — in NON_SETTLEMENT_SETUP)
  // Southrons & Easterlings (p.17)
  'umbar':         S('southrons','Stronghold',   { regular: 3 }),
  'far-harad':     S('southrons','City',         { regular: 3, elite: 1 }),
  'near-harad':    S('southrons','Town',         { regular: 3, elite: 1 }),
  'north-rhun':    S('southrons','Town',         { regular: 2 }),
  'south-rhun':    S('southrons','Town',         { regular: 3, elite: 1 }),
};

// Regions that have STARTING UNITS but NO settlement (p.16-17).
const NON_SETTLEMENT_SETUP = {
  'north-downs': { nation: 'north',  setup: { elite: 1 } },          // p.16
  'gorgoroth':   { nation: 'sauron', setup: { regular: 3 } },        // p.17
};

// WILDERNESS nation membership (no settlement, but inside a nation's border on
// the map). Cross-checked: SirMartin/WarOfRingMap nation data agreed with the
// rulebook on ALL settlement regions (0 mismatches), so it's a trustworthy
// secondary source for the bordered-but-empty regions. Final confirmation vs the
// rulebook colored map (p.9) belongs to the calibration dev-tab. All other
// regions are FREE (no nation).
const WILDERNESS_NATION = {
  'anfalas': 'gondor', 'erech': 'gondor',
  'buckland': 'north', 'old-forest-road': 'north', 'rhosgobel': 'north',
  'eastemnet': 'rohan',
  'gap-of-rohan': 'isengard',
  'north-ered-luin': 'dwarves',
  'mount-gram': 'sauron', 'southern-mirkwood': 'sauron',
  'khand': 'southrons', 'east-rhun': 'southrons',
};

const VP = { City: 1, Stronghold: 2, Town: 0, Fortification: 0 };

// ---- Adjacency (from scripts/extract-adjacency.mjs) ----
let adjacency = {};
try {
  adjacency = JSON.parse(readFileSync(join(repoRoot, 'assets', 'adjacency.json'), 'utf8')).byRegion;
} catch {
  console.warn('WARN: assets/adjacency.json not found — run extract-adjacency.mjs. Adjacency will be empty.');
}

// ---- Validate keys ----
const errors = [];
for (const k of [...Object.keys(SETTLEMENTS), ...Object.keys(NON_SETTLEMENT_SETUP), ...Object.keys(WILDERNESS_NATION)]) {
  if (!nodes[k]) errors.push(`Unknown region id in authored data: ${k}`);
}
for (const k of Object.keys(WILDERNESS_NATION)) {
  if (SETTLEMENTS[k] || NON_SETTLEMENT_SETUP[k]) errors.push(`WILDERNESS_NATION conflicts with settlement nation: ${k}`);
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

// ---- Merge ----
const regions = {};
for (const [id, node] of Object.entries(nodes)) {
  const s = SETTLEMENTS[id];
  const ns = NON_SETTLEMENT_SETUP[id];
  regions[id] = {
    name: node.name,
    nation: s ? s.nation : ns ? ns.nation : (WILDERNESS_NATION[id] || null),
    settlement: s ? s.settlement : null,
    vp: s ? VP[s.settlement] : 0,
    setup: s ? s.setup : ns ? ns.setup : null,
    adjacency: adjacency[id] || [],
  };
}

const out = {
  _meta: {
    generatedBy: 'scripts/build-map.mjs',
    authority: 'Rulebook (Ares WOTR 2E) is authoritative for settlement/nation/VP/setup; the TTS mod gameplay fields are NOT used. Adjacency is bootstrapped from a community source (see provenance) and reconciled to this 105-region set; wilderness nation membership is cross-checked (0 mismatches on settlement regions).',
    provenance: {
      settlementsAndSetup: 'rulebook p.9-11, p.16-17 (hand-authored here)',
      adjacency: 'assets/adjacency.json — Golehm/war-of-the-ring AI map (factual edges), FIRST PASS pending rulebook spot-verify via calibration tab',
      wildernessNation: 'SirMartin/WarOfRingMap nation data, cross-checked vs rulebook settlement nations (0 conflicts)',
    },
    pending: [
      'Final verification of ADJACENCY and WILDERNESS nation membership vs the rulebook map (impassable borders, p.9 colored borders) — via a hover/click calibration dev-tab once the UI exists.',
      'Exact political-track step counts (only active/passive + start box captured).',
    ],
    counts: {
      regions: Object.keys(regions).length,
      strongholds: Object.values(regions).filter((r) => r.settlement === 'Stronghold').length,
      cities: Object.values(regions).filter((r) => r.settlement === 'City').length,
      towns: Object.values(regions).filter((r) => r.settlement === 'Town').length,
      fortifications: Object.values(regions).filter((r) => r.settlement === 'Fortification').length,
    },
  },
  nations: NATIONS,
  regions,
};

writeFileSync(join(repoRoot, 'assets', 'map.json'), JSON.stringify(out, null, 2) + '\n');
console.log('Wrote assets/map.json');
console.log('  counts:', JSON.stringify(out._meta.counts));
// Setup unit totals sanity check vs rulebook component limits.
const tot = { regular: 0, elite: 0, leader: 0, nazgul: 0 };
for (const r of Object.values(regions)) for (const k in (r.setup || {})) tot[k] += r.setup[k];
console.log('  on-board setup units (excl. reinforcements):', JSON.stringify(tot));
