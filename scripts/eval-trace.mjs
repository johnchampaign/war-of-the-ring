#!/usr/bin/env vite-node
// eval-trace.mjs — the 1-ply evaluator's debuggability harness (stage 1,
// docs/ai-1ply-evaluator.md). Replays a heuristic self-play game and prints the
// position score at each turn boundary with its top signed feature
// contributions, so a bad weight is visible as a story ("mil.units carried the
// whole score") rather than a mystery.
//
//   npx vite-node scripts/eval-trace.mjs --seed 7 [--top 6]
//
// Also: --predict N runs N games and reports how often the turn-8 eval sign
// picks the eventual winner — a sanity number, NOT a gate (chooser A/Bs are the
// real test).
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { evaluate } from '../src/ai/evaluate.ts';

const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : def; };
const SEED = arg('--seed', 7);
const TOP = arg('--top', 6);
const PREDICT = arg('--predict', 0);

function play(seed, onTurn) {
  let s = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7);
  let guard = 0, lastTurn = 0;
  while (!wotrAdapter.result?.(s) && guard++ < 20000) {
    const actor = wotrAdapter.currentActor(s); if (!actor) break;
    const legal = wotrAdapter.legalActions(s, actor); if (!legal.length) break;
    if (s.turn !== lastTurn) { lastTurn = s.turn; onTurn?.(s); }
    s = wotrAdapter.applyAction(s, chooseAction(s, actor, legal, ai), actor);
  }
  return s;
}

if (PREDICT > 0) {
  let agree = 0, decided = 0;
  for (let g = 0; g < PREDICT; g++) {
    let at8 = null;
    const end = play(g + 1, (s) => { if (s.turn === 8 && at8 === null) at8 = evaluate(s, 'shadow'); });
    if (at8 === null || !end.winner) continue;
    decided++;
    if ((at8 > 0) === (end.winner === 'shadow')) agree++;
  }
  console.log(`turn-8 eval sign picked the winner in ${agree}/${decided} games (${(100 * agree / Math.max(1, decided)).toFixed(0)}%)`);
} else {
  console.log(`=== eval trace, seed ${SEED} (heuristic self-play) ===`);
  const end = play(SEED, (s) => {
    const b = {};
    const v = evaluate(s, 'shadow', b);
    const top = Object.entries(b).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, TOP)
      .map(([k, x]) => `${k} ${x > 0 ? '+' : ''}${x.toFixed(0)}`).join('  ');
    console.log(`T${String(s.turn).padStart(2)}  eval(shadow) ${String(v.toFixed(0)).padStart(6)}   ${top}`);
  });
  console.log(`winner: ${end.winner} (${end.winReason}) on turn ${end.turn}`);
}
