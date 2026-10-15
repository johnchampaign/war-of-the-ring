#!/usr/bin/env vite-node
// probe-triage-1015.mjs — player report 6d5b4l4o6b4a630x: a new Guide is nominated "at
// the end of each Fellowship phase" (rulebook p.38). Changing the Guide now closes the
// phase (so it can only follow a declaration or a Mordor entry), and entering Mordor
// no longer closes it (so the Guide can still be changed afterwards).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function board(location) {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'fellowship';
  Object.assign(state.fellowship, { location, hidden: true, mordor: null, progress: 0 });
  state.flags.fellowshipDeclaredThisTurn = false;
  return state;
}
const kinds = (s) => wotrAdapter.legalActions(s, 'fp').map((a) => a.kind);

console.log('\n=== changing the Guide ends the Fellowship phase ===');
{
  const s0 = board('rivendell');
  check('Strider is offered as Guide (tied Level 3)', wotrAdapter.legalActions(s0, 'fp').some((a) => a.kind === 'changeGuide' && a.companion === 'strider'));
  const s = wotrAdapter.applyAction(s0, { kind: 'changeGuide', companion: 'strider' }, 'fp');
  check('Strider guides', s.fellowship.guide === 'strider', s.fellowship.guide);
  check('the phase is over', s.phase !== 'fellowship', s.phase);
  check('the log closes the phase', s.log.some((e) => e.msg === 'Free Peoples end the Fellowship phase'));
}

console.log('\n=== declaring first, then changing the Guide ===');
{
  let s = board('rivendell');
  s = wotrAdapter.applyAction(s, { kind: 'declareFellowship', target: 'rivendell' }, 'fp');
  check('still in the Fellowship phase after declaring', s.phase === 'fellowship', s.phase);
  check('the Guide change is still offered', kinds(s).includes('changeGuide'));
}

console.log('\n=== entering Mordor keeps the phase open for a Guide change ===');
{
  let s = board('morannon');
  s = wotrAdapter.applyAction(s, { kind: 'enterMordor' }, 'fp');
  check('on the Mordor Track', s.fellowship.mordor === 0);
  check('still in the Fellowship phase', s.phase === 'fellowship', s.phase);
  const ks = kinds(s);
  check('the Guide change is offered', ks.includes('changeGuide'), ks.join(','));
  check('entering again is not', !ks.includes('enterMordor'));
  check('ending the phase is offered', ks.includes('skipFellowshipPhase'));
  s = wotrAdapter.applyAction(s, { kind: 'skipFellowshipPhase' }, 'fp');
  check('skipping ends it', s.phase !== 'fellowship', s.phase);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
