#!/usr/bin/env vite-node
// probe-ai-1110.mjs — a small Army keeps its dice when it takes casualties.
//  - An Army of five or fewer units rolls a die per unit, so a hit is cheaper as a
//    reduced Elite than as a removed Regular. The Shadow already played it that way
//    (report 0r0z4m1t2b260556); the Free Peoples still shed every Regular first, so
//    Dol Amroth's 5 Regulars and 2 Elites took 5 hits as five Regulars and went into
//    the siege on 2 dice instead of 4 (report xxonzrpfvr2daycy).
//  - A siege attacker still sheds Regulars first: it spends its Elites to press on.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Let the AI allocate `hits` one step at a time on `region`, applying each step by hand. */
function allocate(side, region, nation, units, hits, combat) {
  const s = startGame(createGame({ seed: 4 }));
  s.regions[region].units = { [nation]: { ...units } };
  s.pendingCombat = { attacker: side === 'fp' ? 'shadow' : 'fp', defender: side, from: region, to: region, round: 1, siege: false, ...combat };
  const steps = [];
  for (let left = hits; left > 0; left--) {
    s.pendingChoice = { owner: side, kind: 'combatCasualties', data: { region, side, hits: left, next: 'onslaught' } };
    const legal = wotrAdapter.legalActions(s, side).filter((a) => a.kind === 'casualtyStep' && a.step !== 'removeElite');
    const a = chooseAction(s, side, legal, new Rng(1));
    steps.push(a.step);
    const u = s.regions[region].units[nation];
    if (a.step === 'removeRegular') u.regular--; else { u.elite--; u.regular++; }
  }
  const u = s.regions[region].units[nation];
  return { u, units: u.regular + u.elite, steps };
}

console.log('\n=== Free Peoples: 5 Regulars + 2 Elites take 5 hits in the field ===');
{
  const r = allocate('fp', 'dol-amroth', 'gondor', { regular: 5, elite: 2 }, 5, {});
  check('four units (four dice) survive, not two Elites', r.units === 4, `${JSON.stringify(r.u)} via ${r.steps.join(', ')}`);
}
console.log('\n=== Free Peoples: 2 Regulars + 2 Elites take 1 hit ===');
{
  const r = allocate('fp', 'dol-amroth', 'gondor', { regular: 2, elite: 2 }, 1, {});
  check('an Elite is reduced, keeping four dice', r.steps[0] === 'reduceElite', r.steps.join(', '));
}
console.log('\n=== Shadow: the same rule still holds ===');
{
  const r = allocate('shadow', 'gorgoroth', 'sauron', { regular: 2, elite: 2 }, 1, {});
  check('an Elite is reduced, keeping four dice', r.steps[0] === 'reduceElite', r.steps.join(', '));
}
console.log('\n=== a Free Peoples siege attacker keeps its Elites ===');
{
  const s = allocate('fp', 'dol-amroth', 'gondor', { regular: 2, elite: 2 }, 1, { attacker: 'fp', defender: 'shadow', siege: true });
  check('a Regular is removed', s.steps[0] === 'removeRegular', s.steps.join(', '));
}

console.log(failures ? `\nFAIL: ${failures} failed` : '\nOK: all AI 11-10 checks pass');
process.exit(failures ? 1 : 0);
