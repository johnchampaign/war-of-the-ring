// The 1-ply evaluator chooser (stage 3 of docs/ai-1ply-evaluator.md): simulate
// every legal action on a determinized copy, score where each lands with
// evaluate(), pick the argmax. Same signature and determinism contract as the
// heuristic chooseAction — same (state, rng) always picks the same action — so
// the tournament, the local client and (later) the Linode worker can swap it in
// behind a controller key with no plumbing changes.
//
// Pending choices go through the SAME path: the actor's own choice payload
// survives redaction, so a casualty allocation or an advance decision is judged
// by simulating each option's consequences, exactly like a die action.
import type { Rng } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { chooseAction as heuristicChoose } from './wotrAI';
import { simulateAction } from './simulate';

/** Samples per candidate. Chance nodes (dice, tiles) differ per sample; the
 *  scores are averaged. Dropped to 1 on very wide decisions to hold the latency
 *  budget (spec: ~1.1 ms/simulation; 85 candidates x3 ≈ 290 ms). */
const K = 3;
const WIDE_DECISION = 120;

export function chooseActionEval(state: GameState, actor: Side, legal: WotrAction[], rng: Rng): WotrAction {
  if (legal.length === 1) return legal[0]!;
  const k = legal.length > WIDE_DECISION ? 1 : K;
  let best: WotrAction | null = null;
  let bestScore = -Infinity;
  let scored = 0;
  for (const a of legal) {
    let sum = 0, ok = 0;
    for (let i = 0; i < k; i++) {
      const v = simulateAction(state, actor, a, rng.int(0x7fffffff));
      if (v !== null) { sum += v; ok++; }
    }
    if (ok === 0) continue; // materialization refused this candidate in every sample
    scored++;
    const score = sum / ok + rng.next() * 1e-6; // deterministic-per-rng tie noise
    if (score > bestScore) { bestScore = score; best = a; }
  }
  // If nothing simulated (a materialization edge), the heuristic still knows how
  // to play — never return an arbitrary or illegal fallback.
  if (!best || scored === 0) return heuristicChoose(state, actor, legal, rng);
  return best;
}
