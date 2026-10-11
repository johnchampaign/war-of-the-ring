#!/usr/bin/env vite-node
// probe-triage-1011.mjs — player report 4t142j4z4p205c20: the Shadow AI played Cruel
// Weather and blew the Fellowship from Hollin into Moria, toward Mordor, when Fords of
// Bruinen / Trollshaws / South Downs were farther away. The pick must land on an
// adjacent region as far from the Mordor entrances as any on offer.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { MORDOR_ENTRANCES } from '../src/engine/fellowship.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// Breadth-first region distance over the map's adjacency.
const dist = (a, b) => {
  const seen = new Map([[a, 0]]); const q = [a];
  while (q.length) { const r = q.shift(); if (r === b) return seen.get(r); for (const n of REGIONS[r].adjacency) if (!seen.has(n)) { seen.set(n, seen.get(r) + 1); q.push(n); } }
  return 99;
};
const away = (r) => Math.min(...MORDOR_ENTRANCES.map((e) => dist(r, e)));

console.log('\n=== Cruel Weather blows the Fellowship away from Mordor ===');
for (const loc of ['hollin', 'rivendell', 'fangorn', 'old-ford']) {
  if (!REGIONS[loc]) { check(`${loc} exists`, false); continue; }
  const s0 = startGame(createGame({ seed: 11 }));
  s0.phase = 'actionResolution'; s0.currentPlayer = 'shadow'; s0.pendingChoice = null;
  s0.dice.shadow = ['event']; s0.dice.fp = [];
  s0.fellowship.location = loc; s0.fellowship.progress = 2;
  s0.cards.shadow.hand = ['sh-char-10'];
  const p = wotrAdapter.legalActions(s0, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-10');
  if (!p) { check(`Cruel Weather playable from ${loc}`, false); continue; }
  const s = wotrAdapter.applyAction(s0, { ...p, die: 'event' }, 'shadow');
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const options = legal.filter((a) => a.kind === 'eventTarget' && a.region).map((a) => a.region);
  const pick = chooseAction(s, 'shadow', legal, new Rng(3));
  const best = Math.max(...options.map(away));
  check(`from ${loc}: picked ${pick.region}`, pick.kind === 'eventTarget' && away(pick.region) === best,
    `options ${options.map((r) => `${r}:${away(r)}`).join(' ')}`);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
