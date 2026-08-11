#!/usr/bin/env vite-node
// audit-preconditions.mjs — does every card's `canPlay` actually ENFORCE the condition
// printed on it? Five missing/incorrect gates reached players one report at a time
// (The Last Battle, Palantir of Orthanc, Denethor's Folly, The Red Arrow, A New Power
// is Rising), so this checks the whole deck mechanically instead of waiting for the
// sixth.
//
// Two passes:
//  1. STRUCTURAL — every card printing a condition has a canPlay at all (live
//     registry, not a regex over the source: helper-built handlers defeat regexes).
//  2. BEHAVIOURAL — build a deliberately permissive board where everything is legal,
//     then VIOLATE one printed condition and assert canPlay goes false. A card that
//     still says "playable" with its own condition broken is a definite bug. (Only
//     one-directional: canPlay===false is never reported, so there are no false
//     alarms from a card being unplayable for some unrelated reason.)
import '../src/adapter/wotrAdapter.ts';           // side-effect: registers every handler
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import eventCards from '../assets/event-cards.json';

const NO_CONDITION = /^play (on the table|this card)\.?$/i;
const CHARS = { saruman: /saruman is in play/i, 'witch-king': /witch-?king is in play/i,
  'mouth-of-sauron': /mouth of sauron is in play/i, aragorn: /aragorn is in play/i,
  'gandalf-white': /gandalf the white is in play/i };
const NATIONS = { southrons: /southrons? (?:&|and) easterlings?/i, isengard: /isengard/i,
  sauron: /sauron/i, rohan: /rohan/i, gondor: /gondor/i, elves: /elves/i,
  dwarves: /dwarves/i, north: /north\b/i };

/** A board where as much as possible is legal, so canPlay===true is the norm. */
function permissive() {
  const s = startGame(createGame({ seed: 11 }));
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  for (const id of ['saruman', 'witch-king', 'mouth-of-sauron', 'aragorn', 'gandalf-white']) {
    if (!s.characters.entered.includes(id)) s.characters.entered.push(id);
  }
  s.characters.inPlay['saruman'] = 'orthanc';
  s.characters.inPlay['witch-king'] = 'barad-dur';
  s.characters.inPlay['mouth-of-sauron'] = 'barad-dur';
  s.characters.inPlay['aragorn'] = 'minas-tirith';
  s.characters.inPlay['gandalf-white'] = 'fangorn';
  s.regions['minas-tirith'].characters = ['aragorn'];
  s.regions['fangorn'].characters = ['gandalf-white'];
  s.fellowship.hidden = false;          // "if the Fellowship is revealed"
  s.fellowship.progress = 3;            // "on step 1 or higher"
  s.fellowship.corruption = 3;
  for (const p of Object.values(s.reinforcements)) { p.regular = 10; p.elite = 10; if ('leader' in p) p.leader = 10; if ('nazgul' in p) p.nazgul = 5; }
  return s;
}

const findings = [];
const structural = [];
let tested = 0;

for (const c of eventCards.cards) {
  const pre = (c.precondition ?? '').trim();
  if (!pre || NO_CONDITION.test(pre)) continue;
  const h = getHandler(c.id);
  if (!h) continue;                     // unimplemented: never offered
  if (!h.canPlay) { structural.push(`${c.id} ${c.name} — no canPlay at all: "${pre}"`); continue; }
  const side = c.id.startsWith('fp-') ? 'fp' : 'shadow';

  // Build the list of single-condition violations this card's text supports.
  const breaks = [];
  for (const [id, re] of Object.entries(CHARS)) {
    if (re.test(pre)) breaks.push([`${id} not in play`, (s) => {
      s.characters.entered = s.characters.entered.filter((x) => x !== id);
      delete s.characters.inPlay[id];
      for (const r of Object.values(s.regions)) r.characters = r.characters.filter((x) => x !== id);
    }]);
  }
  if (/all shadow nations are "?at war"?/i.test(pre)) {
    breaks.push(['a Shadow Nation not At War', (s) => { s.nations.isengard.step = 3; }]);
  } else if (/"?at war"?/i.test(pre)) {
    for (const [n, re] of Object.entries(NATIONS)) if (re.test(pre)) breaks.push([`${n} not At War`, (s) => { s.nations[n].step = 3; }]);
  }
  if (/nation is active/i.test(pre)) {
    for (const [n, re] of Object.entries(NATIONS)) if (re.test(pre)) breaks.push([`${n} inactive`, (s) => { s.nations[n].active = false; s.nations[n].step = 3; }]);
  }
  if (/fellowship is revealed/i.test(pre)) breaks.push(['Fellowship hidden', (s) => { s.fellowship.hidden = true; }]);
  if (/step 1 or higher/i.test(pre)) breaks.push(['Progress 0', (s) => { s.fellowship.progress = 0; }]);

  for (const [label, violate] of breaks) {
    const s = permissive();
    if (!canPlayCard(s, c.id, side)) continue;   // not playable on the baseline — nothing to prove
    tested++;
    violate(s);
    if (canPlayCard(s, c.id, side)) findings.push(`${c.id} ${c.name}\n      printed: "${pre}"\n      still playable with: ${label}`);
  }
}

console.log(`\nStructural: ${structural.length} card(s) print a condition with no canPlay`);
for (const l of structural) console.log('  ' + l);
console.log(`\nBehavioural: ${tested} violation(s) exercised across the deck`);
if (findings.length) { console.log(`  ${findings.length} CARD(S) IGNORE THEIR OWN CONDITION:`); for (const f of findings) console.log('  ' + f); }
else console.log('  every exercised condition is enforced');
process.exit(structural.length + findings.length ? 1 : 0);
