#!/usr/bin/env vite-node
// probe-triage-1007b.mjs — fixes from the evening 2026-10-07 report batch:
//
//  - Plural Nations read as plurals in board hints: "The Elves are not At War — their
//    units…", "The Dwarves have no reinforcements left." (reports 674z4l1n0w1v1l24,
//    0w154y2h1j4c0b2w).
//  - Monsters Roused / Orcs Multiplying Again / A New Power is Rising need a figure they
//    can actually place (report 396x4h564l1y1h4c).
//  - Event-card choice buttons drop the "<card>: " prefix (report 2l4d2f146v333i3b).
//  - Getting rid of the opponent's table card says "Remove" (report 03102x0902160c4r).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import '../src/engine/handlers/index.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { musterBlockReason, moveBlockReason } from '../src/engine/armies.ts';
import { REGIONS, nationSubject, nationsArePlural } from '../src/engine/data.ts';
import { describeAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed) => startGame(createGame({ seed }));

console.log('\n=== Nation grammar ===');
check('The Elves', nationSubject('elves') === 'The Elves');
check('Gondor', nationSubject('gondor') === 'Gondor');
check('list', nationSubject(['rohan', 'dwarves']) === 'Rohan and the Dwarves', nationSubject(['rohan', 'dwarves']));
check('plurality', nationsArePlural(['elves']) && !nationsArePlural(['north']) && nationsArePlural(['rohan', 'north']));
{
  const s = fresh(3);
  s.nations.elves.step = 1; // not At War
  for (const r of Object.values(s.regions)) { if (r.units.elves) { r.units = {}; r.leaders = 0; } }
  // An Elven region next to another Nation's (and empty, so it is a plain move).
  const from = Object.keys(REGIONS).find((id) => REGIONS[id].nation === 'elves'
    && REGIONS[id].adjacency.some((a) => REGIONS[a]?.nation && REGIONS[a].nation !== 'elves'));
  const to = REGIONS[from].adjacency.find((a) => REGIONS[a]?.nation && REGIONS[a].nation !== 'elves');
  for (const id of [from, to]) { s.regions[id].units = {}; s.regions[id].leaders = 0; s.regions[id].nazgul = 0; s.regions[id].characters = []; }
  s.regions[from].units = { elves: { regular: 2, elite: 0 } };
  const m = moveBlockReason(s, from, to, 'fp') ?? '';
  check('move hint', m === "The Elves are not At War — their units cannot enter another Nation's borders.", m);
  s.nations.elves.step = 0;
  s.reinforcements.elves.regular = 0; s.reinforcements.elves.elite = 0;
  const r = musterBlockReason(s, 'lorien', 'fp') ?? '';
  check('reinforcements hint', r === 'The Elves have no reinforcements left.', r);
}

console.log('\n=== Shadow named-region recruits need a placeable figure ===');
{
  const s = fresh(5);
  for (const k of Object.keys(s.reinforcements.sauron)) s.reinforcements.sauron[k] = 0;
  check('Monsters Roused blocked on an empty Sauron pool', !getHandler('sh-str-22').canPlay(s, 'shadow'));
  check('Orcs Multiplying Again blocked on an empty Sauron pool', !getHandler('sh-str-20').canPlay(s, 'shadow'));
  s.reinforcements.sauron.elite = 1;
  check('Monsters Roused playable for the Trollshaws Elite alone', getHandler('sh-str-22').canPlay(s, 'shadow'));
  check('Orcs Multiplying Again still blocked (Regulars only)', !getHandler('sh-str-20').canPlay(s, 'shadow'));
  const t = fresh(6);
  check('Monsters Roused playable from the opening', getHandler('sh-str-22').canPlay(t, 'shadow'));
}

console.log('\n=== Button labels ===');
const rec = describeAction({ kind: 'eventTarget', card: 'sh-str-17', mode: 'recruit', region: 'north-rhun' });
check('no card-name prefix', !/Many Kings/.test(rec) && /^Recruit /.test(rec), rec);
check('Done', describeAction({ kind: 'eventTarget', card: 'sh-str-17', done: true }) === 'Done');
const den = describeAction({ kind: 'forceDiscardCard', cardId: 'sh-str-03', via: 'die' });
check('Remove Denethor\'s Folly', /^Remove "/.test(den), den);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
