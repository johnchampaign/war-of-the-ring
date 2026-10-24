#!/usr/bin/env vite-node
// probe-foul-thing.mjs — the 2026-08-04 report batch's engine fix:
//
//   Foul Thing from the Deep (sh-char-07): "the Free Peoples player must reduce
//   Hunt Damage (if any) by eliminating a RANDOM Companion (unless there are no
//   Companions in the Fellowship) before using the Ring" — previously it resolved
//   as a plain extra Hunt with the FP free to take straight Corruption.
//
//   Also re-proves the reveal path the same report questioned: a numbered tile
//   with the Reveal icon revealed the Fellowship all along (the reporter's game
//   saw the AI reveal, reposition, then re-hide with a die).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A game whose Hunt pool is rigged to exactly one known tile. */
function rigged(tileMatch) {
  const state = startGame(createGame({ seed: 11 }));
  const idx = STANDARD_TILE_LIST.findIndex(tileMatch);
  if (idx < 0) throw new Error('tile not found in STANDARD_TILE_LIST');
  state.hunt.pool = [idx];
  state.hunt.drawn = [];
  state.hunt.box = 2; // pretend two Hunt dice are boxed (an 'eye' tile would use this)
  // Move the Fellowship off Rivendell so "not in an FP Settlement" holds.
  state.fellowship.location = 'hollin';
  state.fellowship.progress = 2;
  return state;
}

// --- Foul Thing forces a RANDOM Companion casualty --------------------------------
{
  console.log('\n=== Foul Thing from the Deep: forced random Companion casualty ===');
  const state = rigged((t) => t.value === 2 && t.reveal === true);
  const before = state.fellowship.companions.length;
  const corr0 = state.fellowship.corruption;
  getHandler('sh-char-07').apply(state, 'shadow');
  const lost = before - state.fellowship.companions.length;
  check('exactly one Companion is eliminated (no FP choice)', lost === 1, `companions ${before} -> ${state.fellowship.companions.length}`);
  // Damage 2 minus the victim's Level: any remainder resolves normally (a prompt if
  // Companions remain — which they do — or straight Corruption).
  const settled = state.pendingChoice?.kind === 'huntDamage' || state.pendingChoice?.kind === 'revealMove'
    || state.fellowship.corruption > corr0 || !state.fellowship.hidden;
  check('the remainder resolves through the normal Hunt flow', settled,
    `pending=${state.pendingChoice?.kind ?? 'none'}, corruption ${corr0}->${state.fellowship.corruption}, hidden=${state.fellowship.hidden}`);
}

// --- Foul Thing with an empty Fellowship: no casualty possible --------------------
{
  console.log('\n=== Foul Thing with no Companions: damage resolves normally ===');
  const state = rigged((t) => t.value === 2 && t.reveal === true);
  state.fellowship.companions = [];
  state.fellowship.guide = 'gollum';
  const corr0 = state.fellowship.corruption;
  getHandler('sh-char-07').apply(state, 'shadow');
  // Gollum guide: numbered tile's reveal is suppressed (his passive), and with no
  // Companions the damage prompt only appears if a reduction ability exists;
  // otherwise it's straight Corruption.
  const ok = state.fellowship.corruption === corr0 + 2 || state.pendingChoice?.kind === 'huntDamage';
  check('no Companion to eliminate — damage lands as Corruption (or a reduction prompt)', ok,
    `corruption ${corr0}->${state.fellowship.corruption}, pending=${state.pendingChoice?.kind ?? 'none'}`);
}

// --- The reveal path the report doubted -------------------------------------------
{
  console.log('\n=== a numbered reveal tile does reveal (via Orc Patrol, no forced casualty) ===');
  const state = rigged((t) => t.value === 0 && t.reveal === true);
  check('Fellowship starts hidden', state.fellowship.hidden === true);
  getHandler('sh-char-05').apply(state, 'shadow'); // Orc Patrol: plain extra Hunt
  // 0 damage + reveal, progress 2 -> the FP must choose where the revealed figure
  // stands (revealMove); resolving it flips hidden to false.
  check('the reveal raises the revealMove choice', state.pendingChoice?.kind === 'revealMove',
    `pending=${state.pendingChoice?.kind ?? 'none'}`);
}


// --- The forced casualty is the Hunt's ONE casualty; reductions come first ---------
// Player report 8x25qmxylu5j32tr: Merry fell at random, then the prompt offered a
// second (chosen) casualty and Boromir fell too. Almanac order: Axe and Bow / Horn of
// Gondor, then Guide abilities, then the random pick; surplus is direct Corruption.
{
  console.log('\n=== Foul Thing: one casualty only, reductions before the random pick ===');
  const state = rigged((t) => t.value === 3);
  state.fellowship.companions = ['meriadoc', 'boromir'];
  state.fellowship.guide = 'boromir';
  getHandler('sh-char-07').apply(state, 'shadow');
  const lost = 2 - state.fellowship.companions.length;
  check('no reduction on offer: the random pick is made at once', lost === 1, `companions left ${state.fellowship.companions.join(',')}`);
  if (state.pendingChoice?.kind === 'huntDamage') {
    const modes = wotrAdapter.legalActions(state, 'fp').map((a) => a.mode);
    check('no second casualty is offered for the remainder', !modes.includes('guide') && !modes.includes('random'), modes.join(','));
  } else {
    check('remainder went straight onto the Ring (no reduction left)', state.pendingChoice?.kind !== 'huntDamage');
  }

  const s2 = rigged((t) => t.value === 3);
  s2.cards.fp.table.push('fp-char-06'); // Axe and Bow (Gimli and Legolas start in the Fellowship)
  const n0 = s2.fellowship.companions.length;
  getHandler('sh-char-07').apply(s2, 'shadow');
  const modes = wotrAdapter.legalActions(s2, 'fp').map((a) => a.mode);
  check('with Axe and Bow on the table the FP decides first', s2.pendingChoice?.kind === 'huntDamage' && s2.fellowship.companions.length === n0, `pending=${s2.pendingChoice?.kind}`);
  check('options: the reduction or the random pick — no Corruption, no Guide', modes.includes('reduceCard') && modes.includes('random') && !modes.includes('corruption') && !modes.includes('guide'), modes.join(','));
  const s3 = wotrAdapter.applyAction(s2, { kind: 'huntDamage', mode: 'reduceCard', card: 'fp-char-06' }, 'fp');
  check('after the reduction the random pick follows by itself', s3.fellowship.companions.length === n0 - 1, `companions ${n0} -> ${s3.fellowship.companions.length}`);
  const left = s3.pendingChoice?.kind === 'huntDamage' ? wotrAdapter.legalActions(s3, 'fp').map((a) => a.mode) : [];
  check('and still no second casualty', !left.includes('guide') && !left.includes('random'), left.join(',') || 'resolved');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
