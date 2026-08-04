#!/usr/bin/env vite-node
// probe-mordor-final-step.mjs — the 2026-08-04 player-report batch:
//
//   the step onto the LAST space of the Mordor Track draws its Hunt tile first,
//   and that tile's damage is the Free Peoples player's choice to assign — so the
//   game must not be decided while that prompt is still open (report: "reaching
//   the last step of the Cracks of Doom should still show the hunt damage
//   resolution dialog"). It isn't cosmetic: Corruption 12 is Victory condition 1
//   and the Ring's destruction only condition 2 (p.44), so a final tile that takes
//   the Ring-bearers to 12 hands the game to the SHADOW.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// A plain numbered "2" tile: no Stop, no Reveal, so the draw is pure damage.
const TILE_2 = STANDARD_TILE_LIST.findIndex((t) => t.value === 2 && !t.stop && !t.reveal);

/** The Ring-bearers one step short of the Crack of Doom, an FP Character die in
 *  hand, and a Hunt Pool holding only the "2" tile. One Companion is left so the
 *  damage is a real choice (a prompt), not an automatic Corruption hit. */
function atStepFour(corruption) {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice = { fp: ['character'], shadow: [] };
  state.usedDice = { fp: [], shadow: [] };
  Object.assign(state.fellowship, {
    location: 'morannon', mordor: 4, hidden: true, progress: 0,
    corruption, companions: ['strider'], guide: 'strider',
  });
  Object.assign(state.hunt, { pool: [TILE_2], drawn: [], specialsInPool: [], specialsDrawn: [], box: 0, fpDiceInBox: 0 });
  return state;
}
const step = (state) => wotrAdapter.applyAction(state, { kind: 'moveFellowship' }, 'fp');
const takeAsCorruption = (state) => wotrAdapter.applyAction(state, { kind: 'huntDamage', mode: 'corruption' }, 'fp');

// --- the prompt survives the last step -------------------------------------------
{
  console.log('\n=== the last Mordor step still asks the FP to assign the Hunt damage ===');
  check('the pool holds a plain "2" tile', TILE_2 >= 0);
  const moved = step(atStepFour(2));
  check('the Ring-bearers are on the last step', moved.fellowship.mordor === 5);
  check('the Hunt-damage prompt is open', moved.pendingChoice?.kind === 'huntDamage', JSON.stringify(moved.pendingChoice));
  check('the game is NOT over yet', !moved.winner && moved.phase !== 'gameOver', moved.winReason ?? moved.phase);

  const done = takeAsCorruption(moved);
  check('once the damage is taken, the Free Peoples win', done.winner === 'fp', done.winReason ?? '');
  check('the damage landed on the track', done.fellowship.corruption === 4, String(done.fellowship.corruption));
}

// --- damage that reaches 12 wins it for the Shadow instead ------------------------
{
  console.log('\n=== a final tile that corrupts the Ring-bearers to 12 wins for the Shadow ===');
  const moved = step(atStepFour(10));
  check('the game is NOT over while the prompt is open', !moved.winner, moved.winReason ?? '');
  const done = takeAsCorruption(moved);
  check('Corruption reached 12', done.fellowship.corruption === 12, String(done.fellowship.corruption));
  check('the SHADOW wins (condition 1 outranks condition 2)', done.winner === 'shadow', done.winReason ?? '');
}

// --- a Companion casualty can still save the Ring ----------------------------------
{
  console.log('\n=== sacrificing the Guide on the last step keeps the win ===');
  const moved = step(atStepFour(10));
  // Strider is Level 3, so eliminating him absorbs the whole 2 damage.
  const done = wotrAdapter.applyAction(moved, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('Corruption stayed below 12', done.fellowship.corruption < 12, String(done.fellowship.corruption));
  check('the Free Peoples win', done.winner === 'fp', done.winReason ?? '');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
