#!/usr/bin/env vite-node
// probe-fellowship-phase-skip.mjs — a Fellowship phase with nothing to decide ends itself.
//
// Player report aihekly5hgvi5czw: "what if the fellowship phase was skipped on the
// Mordor track when there aren't any options?" On the Track nothing can be declared and
// Mordor is already entered, so unless a Level tie leaves another Guide to name, the
// only action was "End the Fellowship phase" — a click the opponent had to wait for.
// A forced single option, so the engine now takes it (docs/rules-spec.md).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { advance } from '../src/engine/phases.ts';
import { fellowshipPhaseHasChoice } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A game parked at the top of the Fellowship phase. */
function board(setup) {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'fellowship';
  state.pendingChoice = null;
  state.flags.fellowshipDeclaredThisTurn = false;
  setup(state);
  return state;
}
const onTrack = (companions, guide) => (state) => {
  const fs = state.fellowship;
  fs.mordor = 1; fs.hidden = true; fs.progress = 0;
  fs.companions = companions; fs.guide = guide;
};
const endLines = (state) => state.log.filter((e) => e.msg === 'Free Peoples end the Fellowship phase').length;

console.log('\n=== on the Mordor Track with Gollum as Guide, the phase ends itself ===');
{
  const state = board(onTrack([], 'gollum'));
  check('nothing to decide', !fellowshipPhaseHasChoice(state));
  check('the only legal action is to end the phase',
    JSON.stringify(wotrAdapter.legalActions(state, 'fp')) === JSON.stringify([{ kind: 'skipFellowshipPhase' }]));
  const before = endLines(state);
  advance(state);
  check('the engine moved on without the Free Peoples', state.phase !== 'fellowship', `phase ${state.phase}`);
  check('the phase boundary is still on the record', endLines(state) === before + 1);
}

console.log('\n=== one Companion left on the Track: still nothing to decide ===');
{
  const state = board(onTrack(['legolas'], 'legolas'));
  advance(state);
  check('the phase ends itself', state.phase !== 'fellowship', `phase ${state.phase}`);
}

console.log('\n=== a Level tie on the Track leaves a Guide to name: the phase waits ===');
{
  const state = board(onTrack(['legolas', 'gimli'], 'legolas'));
  check('a choice exists', fellowshipPhaseHasChoice(state));
  advance(state);
  check('the phase waits for the Free Peoples', state.phase === 'fellowship');
  check('the other Guide is offered',
    wotrAdapter.legalActions(state, 'fp').some((a) => a.kind === 'changeGuide' && a.companion === 'gimli'));
}

console.log('\n=== off the Track the phase waits whenever something is open ===');
{
  const hidden = board((s) => { s.fellowship.companions = ['legolas']; s.fellowship.guide = 'legolas'; s.fellowship.hidden = true; s.fellowship.mordor = null; });
  advance(hidden);
  check('hidden: a declaration is open, so it waits', hidden.phase === 'fellowship');

  const atGate = board((s) => { s.fellowship.companions = ['legolas']; s.fellowship.guide = 'legolas'; s.fellowship.hidden = false; s.fellowship.mordor = null; s.fellowship.location = 'morannon'; });
  advance(atGate);
  check('revealed at Morannon: Mordor can be entered, so it waits', atGate.phase === 'fellowship');

  const revealed = board((s) => { s.fellowship.companions = ['legolas']; s.fellowship.guide = 'legolas'; s.fellowship.hidden = false; s.fellowship.mordor = null; s.fellowship.location = 'dale'; });
  check('revealed elsewhere with one Guide candidate: only "end the phase" is legal',
    wotrAdapter.legalActions(revealed, 'fp').length === 1);
  advance(revealed);
  check('...so the phase ends itself', revealed.phase !== 'fellowship', `phase ${revealed.phase}`);
}

console.log('\n=== the helper agrees with the legal actions across real games ===');
{
  let checked = 0, mismatches = 0;
  for (let seed = 1; seed <= 6; seed++) {
    let state = startGame(createGame({ seed }));
    for (let n = 0; n < 1500 && !state.winner; n++) {
      const who = wotrAdapter.currentActor(state);
      if (!who) break;
      const legal = wotrAdapter.legalActions(state, who);
      if (!legal.length) break;
      if (state.phase === 'fellowship' && !state.pendingChoice) {
        checked++;
        if ((legal.length > 1) !== fellowshipPhaseHasChoice(state)) mismatches++;
        if (legal.length === 1) mismatches++; // the engine should never rest here with one option
      }
      state = wotrAdapter.applyAction(state, legal[(n * 7 + seed) % legal.length], who);
    }
  }
  check('helper and legal actions agree', mismatches === 0, `${checked} Fellowship phases, ${mismatches} mismatches`);
  check('some Fellowship phases were seen', checked > 10, `${checked}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
