#!/usr/bin/env vite-node
// probe-triage-1002.mjs — two fixes from the 2026-10-02 report batch:
//
//  1. "Give it to Uss!" is a red Shadow Special tile that prints a 1 with a reveal
//     icon. It was treated as a STANDARD numbered tile, so Gollum ignored its reveal
//     and could then reveal on top of it for −1 damage. Almanac, Gollum: red Shadow
//     Special tiles with a reveal icon always reveal, and he may not reveal-to-reduce
//     on a tile that already revealed. Report osf97egfulfaixb3.
//  2. A Character refused a destination is told why in Character-move terms — a
//     Companion barred from his own besieged Stronghold used to get the muster hint
//     "There is an enemy Army in Helm's Deep". Report 5q0l1z724w6u2742.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { extraHunt } from '../src/engine/hunt.ts';
import { characterMoveBlockReason } from '../src/engine/charMove.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

{
  console.log('\n=== "Give it to Uss!" always reveals, even with Gollum as the Guide ===');
  const s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.fellowship.mordor = 2; s.fellowship.hidden = true; s.fellowship.corruption = 3;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  // Only the Uss tile left in the pool, so it is the one drawn (an empty pool would
  // reshuffle `drawn` back in — keep that empty too).
  s.hunt.pool = []; s.hunt.drawn = []; s.hunt.specialsInPool = ['sh-char-04'];
  extraHunt(s, { source: 'probe' });
  const draw = s.hunt.draws.at(-1);
  check('the drawn tile is "Give it to Uss!"', draw?.specialCard === 'Give it to Uss!' || draw?.special === 'shadow', JSON.stringify(draw));
  const legal = s.pendingChoice?.kind === 'huntDamage' ? wotrAdapter.legalActions(s, 'fp') : [];
  check('Gollum is NOT offered reveal-to-reduce on it',
    !legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal'), legal.map((a) => a.mode).join(','));
  check('the tile reveals the Fellowship', s.fellowship.hidden === false || s.pendingChoice?.kind === 'revealMove' || s.pendingChoice?.data?.reveal === true,
    `hidden=${s.fellowship.hidden} pending=${JSON.stringify(s.pendingChoice)}`);
  check('its 1 damage is taken as Corruption', s.fellowship.corruption === 4, String(s.fellowship.corruption));
}

{
  console.log('\n=== a standard numbered tile still lets Gollum ignore its reveal ===');
  let s = startGame(createGame({ seed: 32 }));
  s.phase = 'actionResolution';
  s.fellowship.location = 'rivendell'; s.fellowship.hidden = true;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: false, revealIcon: true, numbered: true } };
  const legal = wotrAdapter.legalActions(s, 'fp');
  check('reveal-to-reduce is still offered on a standard "1 + reveal" tile',
    legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal'));
}

{
  console.log('\n=== a Companion refused his besieged Stronghold is told why ===');
  const s = startGame(createGame({ seed: 33 }));
  s.regions['helms-deep'].siegeBox = { units: { rohan: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['helms-deep'].units = { isengard: { regular: 5, elite: 3 } };
  s.regions['helms-deep'].leaders = 0;
  s.regions['helms-deep'].besieged = true;
  s.regions['westemnet'].characters = ['legolas'];
  const why = characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'helms-deep');
  check('the reason names the siege, not an "enemy Army"', !!why && /under siege/.test(why) && !/enemy Army in/.test(why), why ?? 'null');
  const far = characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'grey-havens');
  check('an out-of-reach click says so', !!far && /out of reach/.test(far), far ?? 'null');
  check('a reachable, open region has no refusal', characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'eastemnet') === null);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
