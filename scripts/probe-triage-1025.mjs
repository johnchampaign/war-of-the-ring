#!/usr/bin/env vite-node
// probe-triage-1025.mjs — game-log wording batch (player reports 2x5b19454s6e0c69,
// 460k046t6o5f223t, 5h2q1r5r0c510k6q, 3s1e2r2i0a4c646r): the Political Track says
// "towards war" / "marches to war" with the step change, a Hunt roll reads like a
// Combat roll, and Challenge of the King logs each tile and each Eye it destroys —
// which, per the card, includes The Ring is Mine! (it used to go back into the pool).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { challengeOfTheKing, resolveHunt } from '../src/engine/hunt.ts';
import { advancePolitical } from '../src/engine/politics.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const idx = (pred) => STANDARD_TILE_LIST.map((t, i) => (pred(t) ? i : -1)).filter((i) => i >= 0);
const eyes = idx((t) => t.value === 'eye');
const nums = idx((t) => typeof t.value === 'number' && t.value > 0);
const fresh = () => { const s = startGame(createGame({ seed: 5 })); s.hunt.draws = []; return s; };
const msgs = (s, from) => s.log.slice(from).map((e) => e.msg);

console.log('\n=== Political Track wording ===');
{
  const s = fresh(); s.nations.dwarves.step = 2; s.nations.dwarves.active = true;
  let n = s.log.length; advancePolitical(s, 'dwarves');
  check('one step towards war', msgs(s, n).includes('The Dwarves advance one step towards war (2 → 1)') || msgs(s, n).includes('Dwarves advance one step towards war (2 → 1)'), msgs(s, n).join(' | '));
  s.nations.gondor.step = 1; s.nations.gondor.active = true;
  n = s.log.length; advancePolitical(s, 'gondor');
  check('marches to war', msgs(s, n).includes('Gondor marches to war (1 → 0)'), msgs(s, n).join(' | '));
}

console.log('\n=== Hunt roll reads like a Combat roll ===');
{
  const s = fresh(); s.hunt.box = 1; s.hunt.fpDiceInBox = 1;
  const n = s.log.length; resolveHunt(s);
  const line = msgs(s, n).find((m) => m.startsWith('Hunt roll'));
  check('faces then target', /^Hunt roll: \[\d\] on 5\+ → \d success(es)?$/.test(line ?? ''), line);
}

console.log('\n=== Challenge of the King: a line per tile, a line per Eye ===');
{
  const s = fresh(); s.hunt.pool = [eyes[0], nums[0], nums[1]]; s.hunt.specialsInPool = []; s.hunt.drawn = [];
  const n = s.log.length; challengeOfTheKing(s, 'Aragorn');
  const m = msgs(s, n);
  check('three draw lines', m.filter((x) => x.startsWith('Free Peoples draw')).length === 3, m.join(' | '));
  check('the Eye destroyed', m.includes('Aragorn destroys an Eye'), m.join(' | '));
  check('no rules explanation', !m.some((x) => /nothing removed|Hunt Pool/.test(x)), m.join(' | '));
}
{
  const s = fresh(); s.hunt.pool = [nums[0], nums[1]]; s.hunt.specialsInPool = ['sh-char-02']; s.hunt.drawn = [];
  const n = s.log.length; challengeOfTheKing(s, 'Aragorn');
  const m = msgs(s, n);
  check('The Ring is Mine! named apart from an Eye', m.includes('Aragorn destroys The Ring is Mine!'), m.join(' | '));
  check('...and it does not go back into the pool', !s.hunt.specialsInPool.includes('sh-char-02'), JSON.stringify(s.hunt.specialsInPool));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
