#!/usr/bin/env vite-node
// probe-triage-1014c.mjs — player reports 11153d5u314b0h27, 2l302f3d2s3x0i2x,
// 5e0u6l4h341n6g5q: "roused" blurred activation with being At War. Every activation now
// pops ONE "A Nation is Activated" notice from activateNation (an attack included, which
// used to be silent); There and Back Again no longer adds its own log line or a "roused
// to war" popup.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { onArmyAttacked } from '../src/engine/politics.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => startGame(createGame({ seed: 11 }));
const fresh = (s, n0) => (s.notices ?? []).slice(n0);

console.log('\n=== There and Back Again activates, it does not rouse to war ===');
{
  const s = board();
  s.fellowship.companions = [];
  s.characters.inPlay.gimli = 'erebor'; s.regions['erebor'].characters.push('gimli');
  const n0 = (s.notices ?? []).length, l0 = s.log.length;
  getHandler('fp-char-17').finalize(s, 'fp', []);
  const ns = fresh(s, n0);
  check('one activation notice per newly activated Nation', ns.length === 2, JSON.stringify(ns));
  check('titled "A Nation is Activated"', ns.every((n) => n.title === 'A Nation is Activated'));
  check('worded as activation', ns.some((n) => n.msg === 'There and Back Again activates the Dwarves.') && ns.some((n) => n.msg === 'There and Back Again activates the North.'), ns.map((n) => n.msg).join(' | '));
  check('nothing says "war"', ns.every((n) => !/\bwar\b/i.test(n.msg)));
  check('no card-level "rouses" log line', !s.log.slice(l0).some((e) => /rouses/.test(e.msg)));
}

console.log('\n=== an attack that activates a Nation pops the same notice ===');
{
  const s = board();
  s.nations.elves.active = false;
  const n0 = (s.notices ?? []).length;
  onArmyAttacked(s, 'elves', 'lorien');
  const ns = fresh(s, n0);
  check('one notice', ns.length === 1 && ns[0].title === 'A Nation is Activated' && ns[0].msg === 'The Elves are activated.', JSON.stringify(ns));
  onArmyAttacked(s, 'elves', 'lorien');
  check('an already-active Nation pops nothing', fresh(s, n0).length === 1);
}

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall ok');
