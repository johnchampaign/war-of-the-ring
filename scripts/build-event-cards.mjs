#!/usr/bin/env node
// build-event-cards.mjs — Build the BASE-game event-card catalog skeleton from
// assets/asset-urls.json (metadata only; no art). Isolates exactly the 96 base
// cards (4 decks x 24) by excluding expansion-tagged cards, and emits id / name /
// side / deck / initiative / collector number / sheet+region (for the art-crop
// text pass). The `text`, `combat`, and `playableVia` fields are left EMPTY here
// and filled by the vision pass (crop_cards.py -> read each card).
//
// Run: node scripts/build-event-cards.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const data = JSON.parse(readFileSync(join(repoRoot, 'assets', 'asset-urls.json'), 'utf8'));

// Any of these tags => an expansion / alternate-art card, not a base event.
const EXPANSION = new Set([
  'LoME', 'TFoE', 'WoME', 'TToI', 'WotW', 'WHIGIIP', 'CoME', 'KoME', 'TBotF',
  'Alternate', 'Ents', 'Dunlendings',
  'Minion', 'Companion', 'Faction', 'Fellowship',
]);

const isBaseEvent = (c) =>
  c.type === 'Event' && !(c.tags || []).some((t) => EXPANSION.has(t));

const collector = (c) => {
  for (const t of c.tags || []) if (/^#\d+$/.test(t)) return Number(t.slice(1));
  return null;
};

const SIDE = { FreePeoples: 'fp', Shadow: 'sh' };
const DECK = { Character: 'char', Strategy: 'str' };

const base = data.cards.filter(isBaseEvent);
const cards = [];
const usedIds = new Map();
const notes = [];

for (const c of base) {
  const num = collector(c);
  let id = `${SIDE[c.side]}-${DECK[c.deck]}-${String(num ?? 0).padStart(2, '0')}`;
  if (usedIds.has(id)) {
    notes.push(`Duplicate collector number for ${id}: "${usedIds.get(id)}" and "${c.name}" — both kept with a/b suffix; verify the true numbering on the cards.`);
    id += 'b';
  }
  usedIds.set(id, c.name);
  cards.push({
    id,
    name: c.name,
    side: c.side,
    deck: c.deck,            // Character | Strategy
    collector: num,
    initiative: c.init,
    sheetId: c.sheetId,      // for the art-crop text pass
    region: c.region,
    playableVia: null,       // upper-right icon (Character/Army/Muster/Event) — PENDING vision
    text: '',                // event text — PENDING vision
    combat: '',              // combat-card half — PENDING vision
  });
}

cards.sort((a, b) => a.side.localeCompare(b.side) || a.deck.localeCompare(b.deck) || (a.collector - b.collector));

const out = {
  _meta: {
    generatedBy: 'scripts/build-event-cards.mjs',
    authority: 'Base 96 event cards isolated from asset-urls.json by excluding expansion tags. id/name/side/deck/initiative/collector are reliable; text/combat/playableVia are EMPTY pending the vision (crop_cards.py) pass.',
    counts: ['FreePeoples', 'Shadow'].flatMap((s) =>
      ['Character', 'Strategy'].map((d) => `${s}/${d}: ${cards.filter((c) => c.side === s && c.deck === d).length}`)),
    total: cards.length,
    notes,
  },
  cards,
};

writeFileSync(join(repoRoot, 'assets', 'event-cards.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote assets/event-cards.json — ${cards.length} base event cards`);
console.log('  ' + out._meta.counts.join(' | '));
if (notes.length) console.log('  notes:', notes.join(' '));
