// Determinized one-action simulation (stage 2 of docs/ai-1ply-evaluator.md).
//
// The load-bearing rule: the simulation state is BUILT FROM the actor's own
// redacted view (viewFor), so everything the actor must not know is absent by
// construction — not-cheating is structural. The holes are then filled with
// plausible stand-ins:
//   - rngState        -> a fresh sim seed (NEVER the live RNG — that foresees
//                        the actual dice and tiles).
//   - own draw decks  -> same composition, reshuffled. The view exposes the
//                        actor's own deck ORDER (decks draw by .shift()), but a
//                        player only knows composition, not order.
//   - opponent hand   -> stays as the view's 'hidden-*' placeholders. During a
//                        cascade the in-sim opponent therefore declines combat
//                        cards (an unknown id has no combat effect) — the
//                        documented determinized assumption: the opponent is
//                        simulated as playing no Event/Combat cards.
//   - Hunt pool       -> composition is public (the tile mix is printed and
//                        draws are open); draws pick by rng.int, so replacing
//                        rngState covers it.
//
// After applying the candidate action, the immediate CASCADE (a battle's
// rounds, a Hunt's damage chain, forced discards) is auto-resolved for BOTH
// sides with the existing heuristic chooser as the in-simulation policy, so a
// candidate is judged by where its whole consequence lands, not by its first
// pending prompt.
import { Rng } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { wotrAdapter } from '../adapter/wotrAdapter';
import { redactStateForViewer } from '../adapter/redact';
import { chooseAction } from './wotrAI';
import { evaluate } from './evaluate';

/** Fisher–Yates on a copy, driven by the sim rng (deterministic per seed). */
function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The actor's redacted view, materialized into a runnable state. */
export function materializeView(state: GameState, actor: Side, simSeed: number): GameState {
  const v = redactStateForViewer(state, actor);
  const rng = new Rng(simSeed);
  v.rngState = new Rng(rng.int(0x7fffffff)).serialize();
  for (const side of ['fp', 'shadow'] as Side[]) {
    v.cards[side].draw.character = shuffled(v.cards[side].draw.character, rng);
    v.cards[side].draw.strategy = shuffled(v.cards[side].draw.strategy, rng);
  }
  return v;
}

const CASCADE_GUARD = 300;

/** Apply `action` for `actor` on a determinized copy and auto-resolve the
 *  resulting cascade; returns the evaluator's score of where it lands (from
 *  `actor`'s perspective), or null when the sim refuses the action (a
 *  materialization edge — the caller should fall back to the heuristic score).
 *  Deterministic: same (state, actor, action, simSeed) -> same score. */
export function simulateAction(state: GameState, actor: Side, action: WotrAction, simSeed: number): number | null {
  // Bound, not extracted: the adapter's methods call each other through `this`,
  // and an unbound call made every simulation fail closed as ok:false.
  const tryApply = wotrAdapter.tryApplyAction!.bind(wotrAdapter);
  let sim = materializeView(state, actor, simSeed);
  const cascadeRng = new Rng(simSeed ^ 0x5bd1e995);
  const res = tryApply(sim, action, actor);
  if (!res.ok) return null;
  sim = res.state;
  let guard = 0;
  while (sim.pendingChoice && !sim.winner && guard++ < CASCADE_GUARD) {
    const owner = sim.pendingChoice.owner as Side;
    const legal = wotrAdapter.legalActions(sim, owner);
    if (!legal.length) break;
    const pick = chooseAction(sim, owner, legal, cascadeRng);
    const r = tryApply(sim, pick, owner);
    if (!r.ok) break; // never loop on a refused cascade step
    sim = r.state;
  }
  return evaluate(sim, actor);
}
