#!/usr/bin/env vite-node
// probe-declare-once.mjs — the Fellowship's position is declared ONCE per turn
// (rulebook p.39, Fellowship Phase), and so is the Corruption healed by declaring
// in a Free Peoples City/Stronghold.
//
// Player report 4r4z: "Fellowship declared at dale multiple times in one round?" —
// five declarations at Dale in a single Fellowship phase walked Corruption from 5
// down to 0. The phase deliberately stays OPEN after a declaration (the FP may
// still change the Guide or enter Mordor), and nothing stopped a re-declaration in
// place, which healed again every time.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A game parked in the Fellowship phase with the Fellowship sitting in an
 *  unconquered Free Peoples City (Dale) and some Corruption to burn. */
function board() {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'fellowship';
  state.fellowship.location = 'dale';
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  state.fellowship.progress = 0;
  state.fellowship.corruption = 5;
  state.flags.fellowshipDeclaredThisTurn = false;
  return state;
}

console.log('\n=== declaring the Fellowship heals at most once per turn ===');
{
  let state = board();
  const declares = () => wotrAdapter.legalActions(state, 'fp').filter((a) => a.kind === 'declareFellowship');
  check('declaring in place is offered', declares().length > 0);

  state = wotrAdapter.applyAction(state, { kind: 'declareFellowship', target: 'dale' }, 'fp');
  check('the first declaration heals 1 Corruption', state.fellowship.corruption === 4, `corruption ${state.fellowship.corruption}`);
  check('the phase stays open (Guide change / enter Mordor)', state.phase === 'fellowship');
  check('no second declaration is offered', declares().length === 0, JSON.stringify(declares()));

  const retry = wotrAdapter.tryApplyAction(state, { kind: 'declareFellowship', target: 'dale' }, 'fp');
  check('a forced second declaration is rejected', !retry.ok, retry.reason ?? '');
  check('Corruption is unchanged by the rejected declaration', retry.state.fellowship.corruption === 4);

  // Ending the phase and reaching next turn's Fellowship phase re-arms it.
  state.flags.fellowshipDeclaredThisTurn = false; // what phase 1 (Recover) does
  check('next turn the declaration is offered again', declares().length > 0);
}

console.log('\n=== the once-per-turn gate does not block the rest of the phase ===');
{
  let state = board();
  state.fellowship.location = 'morannon'; // a Mordor entrance
  state = wotrAdapter.applyAction(state, { kind: 'declareFellowship', target: 'morannon' }, 'fp');
  const acts = wotrAdapter.legalActions(state, 'fp');
  check('entering Mordor is still offered after declaring', acts.some((a) => a.kind === 'enterMordor'));
  check('ending the Fellowship phase is still offered', acts.some((a) => a.kind === 'skipFellowshipPhase'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll declare-once checks passed.');
process.exit(failures ? 1 : 0);
