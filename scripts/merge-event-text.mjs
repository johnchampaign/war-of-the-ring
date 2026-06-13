#!/usr/bin/env node
// merge-event-text.mjs — Bake the per-deck event-card text (read from the card
// scans into tmp_event_text/*.json) into the committed assets/event-cards.json
// seed. The tmp_event_text/ files are the working transcription (gitignored);
// this merge is the "fold corrections into the seed" step. Re-runnable.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ec = JSON.parse(readFileSync(join(repoRoot, 'assets', 'event-cards.json'), 'utf8'));

const text = {};
for (const deck of ['fp-char', 'fp-str', 'sh-char', 'sh-str']) {
  Object.assign(text, JSON.parse(readFileSync(join(repoRoot, 'tmp_event_text', `${deck}.json`), 'utf8')));
}

let filled = 0;
const missing = [];
for (const c of ec.cards) {
  const t = text[c.id];
  if (!t) { missing.push(c.id); continue; }
  if (t.name && t.name !== c.name) c.nameOnCard = t.name; // keep skeleton name; note any diff
  c.precondition = t.precondition ?? null;
  c.eventText = t.eventText ?? '';
  if (t.discardCondition) c.discardCondition = t.discardCondition;
  if (t.collectorNote) c.collectorNote = t.collectorNote;
  c.combat = t.combat ?? null;
  // remove the empty skeleton placeholders now superseded
  delete c.text;
  filled++;
}

ec._meta.textSource = 'Read verbatim from the base-game card scans (crop_event_cards.py crops); merged by merge-event-text.mjs. eventText/precondition/discardCondition/combat are card-accurate.';
ec._meta.playableViaNote = 'playableVia (the upper-right play-via icon, i.e. which non-Event Action die can play the card) is NOT yet captured per-card — pending a focused corner-icon read. Any card is always playable with an Event/Palantir die regardless.';
ec._meta.filled = filled;
ec._meta.missingText = missing;

writeFileSync(join(repoRoot, 'assets', 'event-cards.json'), JSON.stringify(ec, null, 2) + '\n');
console.log(`Filled ${filled}/${ec.cards.length} cards`);
if (missing.length) console.log('  MISSING text for:', missing.join(', '));

// Sanity: every card must have non-empty eventText and a combat block.
const bad = ec.cards.filter((c) => !c.eventText || !c.combat || !c.combat.text);
if (bad.length) { console.error('INCOMPLETE:', bad.map((c) => c.id).join(', ')); process.exit(1); }
console.log('All cards have eventText + combat text.');
