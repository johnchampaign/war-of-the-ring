#!/usr/bin/env vite-node
// probe-ai-1127.mjs — AI report of 2026-11-27.
//  - bo4wlikxvrrttazl: the Shadow sat on 9 Victory Points and attacked Dale; the Free
//    Peoples AI retreated to Erebor after one round, handing over the tenth point and
//    the game. A defender whose Settlement would give the attacker the game stands:
//    retreating is a certain loss, standing keeps whatever chance the dice leave.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function run(shadowVp) {
  let battles = 0, retreats = 0, stands = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let s = startGame(createGame({ seed }));
    s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
    s.nations.southrons.step = 0; s.nations.southrons.active = true;
    s.regions['northern-rhovanion'].units = { southrons: { regular: 5, elite: 1 } };
    s.regions['dale'].units = { north: { regular: 1, elite: 0 }, elves: { regular: 0, elite: 1 } };
    s.regions['dale'].leaders = 2;
    s.victoryPoints.shadow = shadowVp;
    s.dice.shadow = ['army']; s.dice.fp = [];
    const legal = wotrAdapter.legalActions(s, 'shadow');
    const atk = legal.find((a) => a.kind === 'attack' && a.from === 'northern-rhovanion' && a.to === 'dale');
    if (!atk) { check(`seed ${seed}: the attack is offered (setup)`, false); break; }
    s = wotrAdapter.applyAction(s, atk, 'shadow');
    battles++;
    for (let i = 0; i < 80 && (s.pendingCombat || s.pendingChoice) && !s.winner; i++) {
      const who = s.pendingChoice?.owner ?? wotrAdapter.currentActor(s);
      if (!who) break;
      const opts = wotrAdapter.legalActions(s, who);
      if (!opts.length) break;
      const a = chooseAction(s, who, opts, new Rng(seed * 7 + i));
      if (a.kind === 'combatRetreat' && who === 'fp') { if (a.retreat) retreats++; else stands++; }
      s = wotrAdapter.applyAction(s, a, who);
      if (!s.pendingCombat && !s.pendingChoice) break;
    }
  }
  return { battles, retreats, stands };
}

console.log('\n=== Shadow on 9 VP attacks Dale: the Free Peoples never retreat out of it ===');
{
  const r = run(9);
  check(`the Free Peoples were asked to retreat at least once (${r.retreats + r.stands} times over ${r.battles} battles)`, r.retreats + r.stands > 0);
  check('they never retreated out of Dale', r.retreats === 0, `${r.retreats} retreats`);
}

console.log('\n=== Shadow on 5 VP attacks Dale: the outnumbered defender may still fall back ===');
{
  const r = run(5);
  check(`the ordinary retreat is untouched (${r.retreats} retreats, ${r.stands} stands)`, r.retreats > 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
