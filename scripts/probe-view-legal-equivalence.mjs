#!/usr/bin/env vite-node
// probe-view-legal-equivalence.mjs — the online client works out its legal actions from
// the seat's own redacted view instead of asking the server again after every move
// (player report 6ytzcs3z6hcoznm0: each click took seconds). That is only sound while
// legalActions(viewFor(state, side), side) gives exactly legalActions(state, side): a
// rule that peeks at hidden information (the other hand's faces, the Hunt bag's order,
// the dice RNG) would make the two lists drift. Whole games, both FP opponents, every
// decision compared.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionHumanlike } from '../src/ai/humanlikeFP.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== legal actions from the seat\'s own view match the server\'s ===');
let checked = 0; const diffs = [];
for (let g = 0; g < 10; g++) {
  let s = startGame(createGame({ seed: 7100 + g })); const rng = new Rng(g + 1);
  for (let i = 0; i < 5000 && !wotrAdapter.result(s); i++) {
    const side = wotrAdapter.currentActor(s); if (!side) break;
    const legal = wotrAdapter.legalActions(s, side);
    let fromView;
    try { fromView = JSON.stringify(wotrAdapter.legalActions(JSON.parse(JSON.stringify(wotrAdapter.viewFor(s, side))), side)); } catch (e) { fromView = `threw ${e.message}`; }
    checked++;
    if (fromView !== JSON.stringify(legal) && diffs.length < 5) diffs.push(`game ${g} ${s.pendingChoice?.kind ?? s.phase}`);
    const a = side === 'fp' && g % 2 ? chooseActionHumanlike(s, side, legal, rng) : chooseAction(s, side, legal, rng);
    const res = wotrAdapter.tryApplyAction(s, a, side); if (!res.ok) break; s = res.state;
  }
}
check('every decision gives the same list', diffs.length === 0, diffs.join('; ') || `${checked} decisions`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
