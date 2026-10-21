#!/usr/bin/env vite-node
// probe-ai-1020.mjs — AI reports of 2026-10-20.
//  - 0z730r2v731u1k3a: a Character die's Nazgûl stage on a siege only up to its
//    re-roll cap, the Army's own Leadership counted (Isengard Elites under Saruman);
//    the spare wraith presses the hidden Fellowship.
//  - 0o284w65081k1l24: Saruman waits while Gandalf the Grey could still leave the
//    Fellowship this turn — the Free Peoples hold a Will die and a Character die, a
//    second Will die, or an Elven Ring to make one.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const turn = (side, seed = 1) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = side; s.pendingChoice = null;
  return s;
};
const decide = (s, side) => chooseAction(s, side, wotrAdapter.legalActions(s, side), new Rng(3));
const show = (a) => JSON.stringify(a).slice(0, 120);

console.log('\n=== Nazgûl: enough for the siege, one for the Fellowship ===');
{
  let s = turn('shadow');
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.characters.entered.push('saruman', 'witch-king');
  s.characters.inPlay['saruman'] = 'orthanc'; s.characters.inPlay['witch-king'] = 'west-harondor';
  s.regions['west-harondor'].characters.push('witch-king');
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.regions['fords-of-bruinen'].nazgul = 1; s.regions['trollshaws'].nazgul = 1; s.regions['north-ithilien'].nazgul = 2;
  const hd = s.regions['helms-deep'];
  hd.units = { isengard: { regular: 7, elite: 1 } }; hd.leaders = 0; hd.besieged = true;
  hd.siegeBox = { units: { rohan: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.fellowship.location = 'goblins-gate'; s.fellowship.hidden = true; s.fellowship.progress = 0;
  s.dice.shadow = ['character']; s.dice.fp = []; s.cards.shadow.hand = [];
  const moves = [];
  for (let i = 0; i < 12; i++) {
    const a = decide(s, 'shadow');
    if (a.kind === 'moveCharacter') moves.push(`${a.char} ${a.from}→${a.to}${a.count ? ` x${a.count}` : ''}`);
    s = wotrAdapter.applyAction(s, a, 'shadow');
    if (s.pendingChoice?.owner !== 'shadow') break;
  }
  check('a Nazgûl ends on the Fellowship at Goblin\'s Gate', s.regions['goblins-gate'].nazgul > 0, moves.join(', '));
  check('…and the siege still gets the Witch-king', s.regions['helms-deep'].characters.includes('witch-king'), moves.join(', '));
}

console.log('\n=== Saruman waits on Gandalf the Grey ===');
const sarumanTurn = (fpDice, seed) => {
  const s = turn('shadow', seed);
  s.nations.isengard.step = 0;
  s.dice.shadow = ['muster', 'army']; s.dice.fp = fpDice;
  return decide(s, 'shadow');
};
for (const seed of [1, 2, 3]) {
  const a = sarumanTurn(['will', 'armyMuster'], seed);
  check(`seed ${seed}: Will + an Elven Ring's Character die — Saruman waits`, !(a.kind === 'bringMinion' && a.minion === 'saruman'), show(a));
  const b = sarumanTurn(['will'], seed);
  check(`seed ${seed}: a lone Will die (nothing to free Gandalf with) — Saruman comes`, b.kind === 'bringMinion' && b.minion === 'saruman', show(b));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
