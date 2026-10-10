#!/usr/bin/env vite-node
// probe-hunt-box-timing.mjs — the die a Fellowship move spends joins the Hunt Box only
// once that move's Hunt is resolved (p.41), so the box shown while the Hunt is still
// being answered must not count it yet (player report 5v48363m643y5c06: the overlay
// added the die straight away). The engine marks the die as "entering" until the
// Action ends; the overlay leaves it out until then.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== the moving die is "entering" while its Hunt is answered ===');
let seen = 0, cleared = 0, bad = [];
for (let seed = 1; seed <= 60 && seen < 5; seed++) {
  let s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['character', 'character']; s.dice.shadow = ['army'];
  s.hunt.box = 5; s.hunt.fpDiceInBox = 1;
  const move = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'moveFellowship');
  if (!move) continue;
  s = wotrAdapter.applyAction(s, { ...move, die: 'character' }, 'fp');
  if (!s.pendingChoice) { if (s.hunt.fpDieEntering) bad.push(`${seed}: still entering after a finished Action`); continue; }
  seen++;
  if (!s.hunt.fpDieEntering || s.hunt.fpDiceInBox !== 2) bad.push(`${seed}: mid-Hunt entering=${s.hunt.fpDieEntering} box=${s.hunt.fpDiceInBox}`);
  for (let i = 0; i < 20 && s.pendingChoice; i++) {
    const side = wotrAdapter.currentActor(s);
    s = wotrAdapter.applyAction(s, chooseAction(s, side, wotrAdapter.legalActions(s, side), new Rng(seed)), side);
  }
  if (!s.pendingChoice) { if (s.hunt.fpDieEntering) bad.push(`${seed}: still entering after the Hunt`); else cleared++; }
}
check('a Hunt paused for an answer was found', seen > 0, `${seen} seeds`);
check('mid-Hunt the die is marked entering, and cleared when the Action ends', bad.length === 0, bad.join('; ') || `${cleared} cleared`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
