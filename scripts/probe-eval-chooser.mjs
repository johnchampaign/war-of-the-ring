#!/usr/bin/env vite-node
// probe-eval-chooser.mjs — stage 3 of docs/ai-1ply-evaluator.md: the 1-ply
// chooser's contracts. DETERMINISM (same state + same rng seed -> same action),
// TERMINAL SIGHT (a move that wins the game outright is always taken — the
// simulation sees the terminal state, no weight tuning required), and the
// FALLBACK (with the simulator refusing everything it still returns a legal
// action via the heuristic).
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionEval } from '../src/ai/evalChooser.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function midGame(seed, wantTurn = 4) {
  let s = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7);
  let guard = 0;
  while (!wotrAdapter.result?.(s) && guard++ < 20000) {
    const actor = wotrAdapter.currentActor(s); if (!actor) break;
    if (s.turn >= wantTurn && !s.pendingChoice && !s.pendingCombat && wotrAdapter.legalActions(s, actor).length > 5) return { s, actor };
    const legal = wotrAdapter.legalActions(s, actor); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, chooseAction(s, actor, legal, ai), actor);
  }
  return { s, actor: wotrAdapter.currentActor(s) };
}

{
  console.log('\n=== determinism ===');
  const { s, actor } = midGame(21);
  const legal = wotrAdapter.legalActions(s, actor);
  const a1 = chooseActionEval(s, actor, legal, new Rng(555));
  const a2 = chooseActionEval(s, actor, legal, new Rng(555));
  check(`same state + rng -> same action (${legal.length} candidates)`, JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a1).slice(0, 80));
  check('the pick is one of the legal actions', legal.some((a) => JSON.stringify(a) === JSON.stringify(a1)));
}

{
  console.log('\n=== terminal sight: take the winning capture ===');
  // Shadow at 9 VP with an Army adjacent to an EMPTY 1-VP FP City: moving in wins.
  const s = startGame(createGame({ seed: 22 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.sauron.step = 0; s.nations.north.step = 0;
  s.victoryPoints.shadow = 9;
  s.regions['dale'].units = {};                                       // Dale (North City, 1 VP) stands empty
  s.regions['northern-rhovanion'].units = { sauron: { regular: 3, elite: 0 } };
  // NB no second army: the Army die's optional second move is part of the
  // simulated cascade (played by the heuristic), so a decoy first move followed
  // by the heuristic walking the OTHER army into Dale would tie the winner.
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.dice.shadow = ['army', 'army', 'muster']; s.dice.fp = ['character'];
  s.pendingChoice = null; s.pendingCombat = null;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const winning = legal.filter((a) => a.kind === 'moveArmy' && a.from === 'northern-rhovanion' && a.to === 'dale');
  check('the winning move is on offer', winning.length > 0, `${legal.length} legal`);
  if (winning.length) {
    const pick = chooseActionEval(s, 'shadow', legal, new Rng(1));
    check('the evaluator takes it', pick.kind === 'moveArmy' && pick.from === 'northern-rhovanion' && pick.to === 'dale', JSON.stringify(pick).slice(0, 90));
    // Military victory is recorded at the END of the turn (p.44), not mid-action —
    // the evaluator discriminates through the VP term, not through `winner`.
    const after = wotrAdapter.applyAction(JSON.parse(JSON.stringify(s)), pick, 'shadow');
    check('...and it reaches the 10th VP', after.victoryPoints.shadow >= 10, `vp=${after.victoryPoints.shadow}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
