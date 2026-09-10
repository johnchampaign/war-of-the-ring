#!/usr/bin/env vite-node
// probe-humanlike-fp.mjs — the scripted human-like FP yardstick does the three things
// the human logs say humans do (rest at 2, hold at the gates above 4, storm a lone
// garrison with 3+), and otherwise defers to the heuristic.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseActionHumanlike } from '../src/ai/humanlikeFP.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const base = () => { const s = startGame(createGame({ seed: 61 })); s.pendingChoice = null; return s; };

console.log('\n=== REST: in Rivendell at Corruption 2, it rest-declares and does not move ===');
{
  const s = base(); s.phase = 'fellowship'; s.currentPlayer = 'fp'; s.fellowship.location = 'rivendell'; s.fellowship.corruption = 2; s.fellowship.progress = 0;
  const legal = [{ kind: 'declareFellowship', target: 'rivendell' }, { kind: 'skipFellowshipPhase' }];
  check('rest-declares in place', chooseActionHumanlike(s, 'fp', legal, new Rng(1)).kind === 'declareFellowship');
  s.phase = 'actionResolution'; s.dice.fp = ['character'];
  const acts = [{ kind: 'moveFellowship', die: 'character' }, { kind: 'skipDie', face: 'character' }, { kind: 'pass' }];
  check('will not move the Fellowship while healing', chooseActionHumanlike(s, 'fp', acts, new Rng(1)).kind !== 'moveFellowship');
  s.fellowship.corruption = 1;
  check('...but moves again at Corruption 1', chooseActionHumanlike(s, 'fp', acts, new Rng(1)).kind === 'moveFellowship');
}
console.log('\n=== PATIENCE: at the Morannon with Corruption 6 it does not enter Mordor ===');
{
  const s = base(); s.phase = 'fellowship'; s.currentPlayer = 'fp'; s.fellowship.location = 'morannon'; s.fellowship.corruption = 6; s.fellowship.progress = 0;
  // A heal spot within the declare range (geography is not checked by the chooser).
  const withHaven = [{ kind: 'enterMordor' }, { kind: 'declareFellowship', target: 'morannon' }, { kind: 'declareFellowship', target: 'minas-tirith' }, { kind: 'skipFellowshipPhase' }];
  const pick = chooseActionHumanlike(s, 'fp', withHaven, new Rng(1));
  check('falls back to the heal spot instead of entering', pick.kind === 'declareFellowship' && pick.target === 'minas-tirith', JSON.stringify(pick));
  const noHaven = [{ kind: 'enterMordor' }, { kind: 'declareFellowship', target: 'morannon' }, { kind: 'skipFellowshipPhase' }];
  check('with no heal spot in reach it does not stall — defers (enters)', chooseActionHumanlike(s, 'fp', noHaven, new Rng(1)).kind === 'enterMordor');
  s.fellowship.corruption = 3;
  check('enters at Corruption 3 (defers to the heuristic)', chooseActionHumanlike(s, 'fp', withHaven, new Rng(1)).kind === 'enterMordor');
}
console.log('\n=== STORM: a 4-unit stack next to a one-unit Dol Guldur attacks it ===');
{
  const s = base(); s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.dice.fp = ['army'];
  s.regions['dol-guldur'].units = { sauron: { regular: 1, elite: 0 } };
  s.regions['narrows-of-the-forest'].units = { elves: { regular: 3, elite: 1 } }; s.regions['narrows-of-the-forest'].leaders = 1;
  const legal = [{ kind: 'attack', from: 'narrows-of-the-forest', to: 'dol-guldur' }, { kind: 'moveArmy', from: 'narrows-of-the-forest', to: 'north-anduin-vale' }, { kind: 'pass' }];
  const pick = chooseActionHumanlike(s, 'fp', legal, new Rng(1));
  check('storms the lone garrison', pick.kind === 'attack' && pick.to === 'dol-guldur', JSON.stringify(pick));
  s.regions['dol-guldur'].units = { sauron: { regular: 4, elite: 0 } };
  check('a real garrison is left to the heuristic (no uphill attack)', chooseActionHumanlike(s, 'fp', legal, new Rng(1)).kind !== 'attack');
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
