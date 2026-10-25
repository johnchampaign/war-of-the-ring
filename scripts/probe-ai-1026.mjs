#!/usr/bin/env vite-node
// probe-ai-1026.mjs — Free Peoples AI reports of 2026-10-25.
//  - 115d3354331s686d: Lure of the Ring — the tempted Companion goes; no Corruption to keep him.
//  - 3v0c235u2k271235: no separation that wakes nobody (Merry and Pippin to an active Lórien).
//  - 0s2c4f454g1g2i6e: revealed, the figure stands where FEWER re-roll sources are.
//  - 0p4o6k63604e2m6s: the last unit never advances out of its own Stronghold after a win.
//  - 385r451t3j5q0j0f: a passive Nation's Army does not wander — home, if anywhere.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed = 1) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.shadow = []; return s;
};
const show = (a) => JSON.stringify(a).slice(0, 110);

console.log('\n=== Lure of the Ring ===');
{
  const s = fresh();
  s.pendingChoice = { owner: 'fp', kind: 'lureChoice', data: { companion: 'legolas', level: 2 } };
  const legal = [{ kind: 'lureChoice', mode: 'corruption' }, { kind: 'lureChoice', mode: 'eliminate' }];
  const a = chooseAction(s, 'fp', legal, new Rng(1));
  check('Legolas at Corruption 2: he goes, no Corruption paid', a.mode === 'eliminate', show(a));
}

console.log('\n=== No separation that wakes nobody ===');
for (const seed of [1, 2, 3]) {
  const s = fresh(seed);
  // Only the North is still passive, and its Cities lie far beyond any Companion's reach
  // from Lórien with no Progress banked.
  for (const n of ['dwarves', 'elves', 'gondor', 'rohan']) s.nations[n].active = true;
  s.fellowship.location = 'lorien'; s.fellowship.progress = 0;
  s.dice.fp = ['will'];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = chooseAction(s, 'fp', legal, new Rng(3));
  check(`seed ${seed}: no Companion separated`, legal.some((x) => x.kind === 'separateCompanion') && a.kind !== 'separateCompanion', show(a));
}

console.log('\n=== Revealed: the cleaner of two equal regions ===');
{
  const s = fresh();
  s.regions['north-ithilien'].nazgul = 1; s.regions['north-ithilien'].units = { sauron: { regular: 2, elite: 0 } };
  s.regions['south-ithilien'].nazgul = 1; s.regions['south-ithilien'].units = {};
  s.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  const legal = [{ kind: 'revealMove', target: 'north-ithilien' }, { kind: 'revealMove', target: 'south-ithilien' }];
  const a = chooseAction(s, 'fp', legal, new Rng(1));
  check('South Ithilien (Nazgûl) over North Ithilien (Nazgûl and an Army)', a.target === 'south-ithilien', show(a));
}

console.log('\n=== The last unit stays home after a win ===');
{
  const s = fresh();
  s.regions['rivendell'].units = { elves: { regular: 0, elite: 1 } }; s.regions['rivendell'].leaders = 1;
  s.pendingChoice = { owner: 'fp', kind: 'advanceChoice', data: { from: 'rivendell', to: 'trollshaws' } };
  const legal = [{ kind: 'advanceChoice', advance: true }, { kind: 'advanceChoice', advance: false }];
  const a = chooseAction(s, 'fp', legal, new Rng(1));
  check('one Elite left in Rivendell: no advance into the Trollshaws', a.advance === false, show(a));
}

console.log('\n=== A passive Nation\'s Army goes home, if anywhere ===');
for (const seed of [1, 2, 3]) {
  const s = fresh(seed);
  const FPN = ['dwarves', 'elves', 'gondor', 'north', 'rohan'];
  for (const [id, r] of Object.entries(s.regions)) if (id !== 'iron-hills') for (const n of FPN) delete r.units[n];
  s.regions['iron-hills'].units = { dwarves: { regular: 1, elite: 0 } };
  s.dice.fp = ['army'];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = chooseAction(s, 'fp', legal, new Rng(3));
  const wander = a.kind === 'moveArmy' && a.from === 'iron-hills' && a.to !== 'erebor';
  check(`seed ${seed}: the Iron Hills Army does not wander`, legal.some((x) => x.kind === 'moveArmy' && x.from === 'iron-hills') && !wander, show(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
