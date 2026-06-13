#!/usr/bin/env node
// dump-asset-urls.mjs — Parse the community Tabletop Simulator mod for
// War of the Ring 2E and emit METADATA ONLY (no images) describing where each
// card lives on the publisher/community-hosted Steam CDN sprite sheets.
//
// Output: assets/asset-urls.json
//   { generatedFrom, sheets: { <deckId>: { url, w, h } },
//     cards: [ { id, name, type, deck, side, init, sheetId, col, row, region } ] }
//   region = [x, y, w, h] as fractions of the sheet (for createImageBitmap crop).
//
// We commit ONLY this JSON (URLs + grid coords). We never download, store, or
// redistribute the art itself — the client fetches it from the Steam CDN on
// first run. See README + docs/derived-assets.md.
//
// The mod's per-card `Description` field is structured, machine-readable
// metadata (e.g. "Card;Event;Strategy;FreePeoples;Init:3;#") — we mine it
// directly rather than OCRing card faces (framework playbook, decisions.md
// "check for a machine-readable companion source" lesson).
//
// Usage:
//   node scripts/dump-asset-urls.mjs [path-to-mod.json]
// Default path is the local TTS Workshop install.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const DEFAULT_MOD = join(
  homedir(),
  'Documents', 'My Games', 'Tabletop Simulator', 'Mods', 'Workshop',
  '1831369203.json',
);

const modPath = process.argv[2] || DEFAULT_MOD;

let raw;
try {
  raw = readFileSync(modPath, 'utf8');
} catch (e) {
  console.error(`Could not read TTS mod at:\n  ${modPath}\n` +
    `Pass the path explicitly: node scripts/dump-asset-urls.mjs <mod.json>\n` +
    `(This file is the local TTS install and is intentionally NOT committed.)`);
  process.exit(1);
}
const mod = JSON.parse(raw);

// Walk every card object in the save tree.
function* walkCards(o) {
  if (Array.isArray(o)) {
    for (const v of o) yield* walkCards(v);
  } else if (o && typeof o === 'object') {
    if ((o.Name === 'Card' || o.Name === 'CardCustom') && 'CardID' in o) yield o;
    for (const v of Object.values(o)) yield* walkCards(v);
  }
}

// Parse the structured Description tag string into fields.
// e.g. "Card;Event;Strategy;FreePeoples;Init:3;#"
function parseDesc(desc) {
  const out = { type: null, deck: null, side: null, init: null, tags: [] };
  if (!desc) return out;
  for (const part of desc.split(';').map((s) => s.trim()).filter(Boolean)) {
    if (part === '#' || part === 'Card') continue;
    if (/^Init:/i.test(part)) { out.init = Number(part.split(':')[1]) || null; continue; }
    if (part === 'FreePeoples' || part === 'Shadow') { out.side = part; continue; }
    if (part === 'Strategy' || part === 'Character') { out.deck = part; continue; }
    if (part === 'Event' || part === 'Combat' || part === 'Hunt') { out.type = part; continue; }
    out.tags.push(part);
  }
  return out;
}

const sheets = {};   // deckId -> { url, w, h }
const cards = [];
const seen = new Set();

for (const c of walkCards(mod)) {
  const cd = c.CustomDeck || {};
  const deckId = Object.keys(cd)[0];
  if (!deckId) continue;
  const deck = cd[deckId];
  const url = deck.FaceURL;
  if (!url) continue;
  const w = deck.NumWidth || 1;
  const h = deck.NumHeight || 1;
  sheets[deckId] = { url, w, h };

  const idx = c.CardID % 100;     // position on the sheet
  const col = idx % w;
  const row = Math.floor(idx / w);
  const region = [col / w, row / h, 1 / w, 1 / h];

  const d = parseDesc(c.Description);
  const name = (c.Nickname || '').trim();
  // De-dupe: a card can appear multiple times (deck instances). Key on sheet+slot.
  const key = `${deckId}:${idx}`;
  if (seen.has(key)) continue;
  seen.add(key);

  cards.push({
    id: key,
    name,
    type: d.type,
    deck: d.deck,
    side: d.side,
    init: d.init,
    tags: d.tags.length ? d.tags : undefined,
    sheetId: deckId,
    col,
    row,
    region: region.map((n) => Math.round(n * 1e6) / 1e6),
  });
}

cards.sort((a, b) =>
  (a.side || '').localeCompare(b.side || '') ||
  (a.deck || '').localeCompare(b.deck || '') ||
  a.name.localeCompare(b.name));

const out = {
  generatedFrom: 'TTS Workshop mod "War of the Ring 2E (Scripted by DevKev)" (id 1831369203)',
  note: 'METADATA ONLY. URLs point at publicly-hosted Steam CDN art; no images are stored in this repo. Includes base game + expansion cards — filter by the authored base-game catalogs.',
  generatedBy: 'scripts/dump-asset-urls.mjs',
  sheetCount: Object.keys(sheets).length,
  cardCount: cards.length,
  sheets,
  cards,
};

mkdirSync(join(repoRoot, 'assets'), { recursive: true });
const outPath = join(repoRoot, 'assets', 'asset-urls.json');
writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');

// Quick stdout summary.
const bySide = {};
for (const c of cards) {
  const k = `${c.side || '?'} / ${c.deck || '?'} ${c.type || ''}`.trim();
  bySide[k] = (bySide[k] || 0) + 1;
}
console.log(`Wrote ${outPath}`);
console.log(`  ${Object.keys(sheets).length} sheets, ${cards.length} unique cards`);
for (const [k, n] of Object.entries(bySide).sort()) console.log(`  ${String(n).padStart(4)}  ${k}`);
