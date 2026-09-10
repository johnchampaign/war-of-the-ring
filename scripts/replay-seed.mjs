#!/usr/bin/env vite-node
// replay-seed.mjs — replay ONE tournament seed (same setup seed and the same choice
// RNG the tournament uses, seed*1000+7) and print how it ended, the action count per
// turn, and a tail of the log. Written to chase a game that ran to turn 1020 in a
// `--fp humanlike` soak (the yardstick's rest/step oscillation; fixed with a turn
// cap). Usage: vite-node scripts/replay-seed.mjs --seed 926 [--fp humanlike|heuristic]
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionHumanlike } from '../src/ai/humanlikeFP.ts';
const seed = Number(process.argv[process.argv.indexOf('--seed') + 1]);
const fpCtrl = process.argv.includes('--fp') ? process.argv[process.argv.indexOf('--fp') + 1] : 'humanlike';
const rng = new Rng(seed * 1000 + 7); // the tournament's choice RNG
let s = startGame(createGame({ seed }));
let n = 0; const turnAt = new Map();
while (n < 20000 && !wotrAdapter.result(s)) {
  const actor = wotrAdapter.currentActor(s); if (!actor) break;
  const legal = wotrAdapter.legalActions(s, actor); if (!legal.length) break;
  const a = actor === 'fp' && fpCtrl === 'humanlike' ? chooseActionHumanlike(s, actor, legal, rng) : chooseAction(s, actor, legal, rng);
  s = wotrAdapter.applyAction(s, a, actor); n++;
  if (!turnAt.has(s.turn)) turnAt.set(s.turn, n);
}
console.log('actions', n, 'turn', s.turn, 'phase', s.phase, 'result', wotrAdapter.result(s)?.reason ?? 'none', 'pending', s.pendingChoice?.kind ?? 'none');
console.log('actions per turn (last 8 turns):', [...turnAt.entries()].slice(-8).map(([t, k]) => `${t}:${k}`).join(' '));
const fs = s.fellowship; console.log('fellowship', { location: fs.location, hidden: fs.hidden, progress: fs.progress, corruption: fs.corruption, mordor: fs.mordor, companions: fs.companions.length });
console.log('vp', s.victoryPoints, 'dice fp', s.dice.fp, 'shadow', s.dice.shadow);
for (const e of s.log.slice(-30)) console.log(`  T${e.turn} ${e.phase} ${e.kind}: ${e.msg.slice(0, 110)}`);
