#!/usr/bin/env vite-node
// probe-taken-alive-before-reveal.mjs — player reports 112a3s6j4e4t0k09 and
// 1c514m61131f663v: a Hobbit "taken alive" by a Hunt tile that also reveals the
// Fellowship was placed AFTER the Fellowship figure had already moved, so his walk
// (correctly measured from where the Fellowship had been) started somewhere the figure
// no longer stood. The Hobbit is now placed first, then the reveal move is asked.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const [label, mode, guide] of [['the Guide (Pippin) taken as the casualty', 'guide', 'peregrin'], ['the Hobbit Guide separating for −1', 'reduceSeparate', 'peregrin']]) {
  console.log(`\n=== ${label}, on a tile that reveals ===`);
  let s = startGame(createGame({ seed: 21 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.fellowship.location = 'fangorn'; s.fellowship.progress = 2; s.fellowship.hidden = true; s.fellowship.mordor = null;
  s.fellowship.companions = ['peregrin', 'strider']; s.fellowship.guide = guide;
  s.hunt.draws = [{ seq: 1, value: 1, damage: 1, reveal: true, onMordor: false }];
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: true, revealIcon: true, numbered: true } };
  const legal = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'huntDamage');
  const act = legal.find((a) => a.mode === mode);
  check(`${mode} is offered`, !!act, legal.map((a) => a.mode).join(','));
  if (!act) continue;
  s = wotrAdapter.applyAction(s, act, 'fp');
  // A reduceSeparate may still owe damage choices for the rest; take them as Corruption.
  for (let i = 0; i < 5 && s.pendingChoice?.kind === 'huntDamage'; i++) s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'corruption' }, 'fp');
  check('Pippin is placed first', s.pendingChoice?.kind === 'separateMove', s.pendingChoice?.kind ?? 'none');
  check('…while the Fellowship figure still stands in Fangorn', s.fellowship.location === 'fangorn', s.fellowship.location);
  check('…and his walk starts there', s.pendingChoice?.data?.from === 'fangorn', s.pendingChoice?.data?.from);
  const place = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'separateMove' && a.target && a.target !== 'fangorn');
  if (!place) { check('Pippin has somewhere to go', false); continue; }
  s = wotrAdapter.applyAction(s, place, 'fp');
  check(`Pippin stands in ${place.target}`, s.characters.inPlay.peregrin === place.target);
  check('then the reveal move is asked', s.pendingChoice?.kind === 'revealMove', s.pendingChoice?.kind ?? 'none');
  const rv = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'revealMove' && a.target !== 'fangorn') ?? wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'revealMove');
  s = wotrAdapter.applyAction(s, rv, 'fp');
  check('the Fellowship is revealed where the player put it', !s.fellowship.hidden && s.fellowship.location === rv.target, `${s.fellowship.hidden} @ ${s.fellowship.location}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
