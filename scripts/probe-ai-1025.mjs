#!/usr/bin/env vite-node
// probe-ai-1025.mjs — AI reports of 2026-10-24.
//  - 290o72523h2w0o0g: with one Elite left in the pool, Voice of Saruman would promote
//    ONE Regular — worse than mustering that Elite outright — so it is not chosen.
//  - 2w4n2f1y1y4o5j59: with one Regular left in the pool, the Voice places ONE.
//  - 214722232j396x52: no Elven Ring turned into an Eye when the Free Peoples can no
//    longer move the Fellowship this turn (revealed on the Mordor Track, it must hide
//    first, so it needs two Character-capable dice).
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const turn = (seed) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  return s;
};
const decide = (s) => chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(3));
const show = (a) => JSON.stringify(a).slice(0, 110);
const saruman = (s) => {
  for (const n of ['isengard', 'sauron', 'southrons']) s.nations[n].step = 0;
  s.characters.entered.push('saruman'); s.characters.inPlay['saruman'] = 'orthanc';
  s.dice.shadow = ['muster']; s.dice.fp = [];
};

console.log('\n=== Voice of Saruman by what it yields ===');
for (const seed of [1, 2, 3]) {
  const s = turn(seed); saruman(s);
  s.regions['orthanc'].units = { isengard: { regular: 4, elite: 1 } };
  s.reinforcements.isengard.elite = 1; s.reinforcements.isengard.regular = 0;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = decide(s);
  check(`seed ${seed}: one Elite in the pool — no one-Regular upgrade`, legal.some((x) => x.kind === 'sarumanMuster' && x.mode === 'upgrade') && !(a.kind === 'sarumanMuster' && a.mode === 'upgrade'), show(a));
}
for (const seed of [1, 2, 3]) {
  const s = turn(seed); saruman(s);
  s.reinforcements.isengard.regular = 1; s.reinforcements.isengard.elite = 2;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = decide(s);
  check(`seed ${seed}: one Regular in the pool — no one-unit Voice recruit`, legal.some((x) => x.kind === 'sarumanMuster' && x.mode === 'recruit') && !(a.kind === 'sarumanMuster' && a.mode === 'recruit'), show(a));
}

console.log('\n=== An Eye only while the Fellowship can still move ===');
for (const [fpDice, hidden, want, label] of [
  [['armyMuster'], true, false, 'hidden, no Character die left'],
  [['character'], false, false, 'revealed with one Character die (it must hide first)'],
  [['character', 'will'], false, true, 'revealed with two'],
]) {
  const s = turn(1);
  s.fellowship.mordor = 2; s.fellowship.hidden = hidden; s.fellowship.location = 'minas-morgul';
  s.dice.shadow = ['event']; s.dice.fp = fpDice;
  s.elvenRings = ['shadow', 'fp', 'fp'];
  s.flags.fpUsedElvenRingThisTurn = true;
  s.cards.shadow.hand = [];
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const offered = legal.some((x) => x.kind === 'useElvenRing' && x.to === 'eye');
  const a = decide(s);
  const eye = a.kind === 'useElvenRing' && a.to === 'eye';
  check(`${label}: ${want ? 'an Eye' : 'no Eye'}`, offered && eye === want, show(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
