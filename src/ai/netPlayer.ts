// netPlayer — one ply of look-ahead scored by the learned value net (valueNet.ts).
//
// For an action-resolution decision, the heuristic's top `cands` actions are each applied
// to `samples` determinized copies (the SAME copies for every candidate, as in search.ts),
// the immediate consequences are resolved — every pending choice that follows, both
// sides', by the heuristic, until the game is back at an ordinary decision — and the net
// scores the position reached. Unlike search.ts there is no playout of the rest of the
// turn, so the opponent's later moves are judged by the net, not predicted by a copy of
// our own heuristic. The heuristic's pick stands unless a challenger beats it by `margin`.
// Other decisions stay with the heuristic. No peeking: copies come from determinize().
import { Rng } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { wotrAdapter, applyActionInPlace } from '../adapter/wotrAdapter';
import { chooseAction, topCandidates } from './wotrAI';
import { determinize } from './search';
import type { ValueNet } from './valueNet';

export interface NetPlayerOptions { cands: number; samples: number; margin: number }
export const DEFAULT_NET_PLAYER: NetPlayerOptions = { cands: 8, samples: 8, margin: 0.02 };
export const netStats = { decisions: 0, overruled: 0, sims: 0, refused: 0 };

const SETTLE_GUARD = 400;
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Resolve pending choices (both sides, heuristic) until an ordinary decision or the end. */
function settle(sim: GameState, rng: Rng): boolean {
  for (let n = 0; n < SETTLE_GUARD; n++) {
    if (sim.winner || !sim.pendingChoice) return true;
    const who = wotrAdapter.currentActor(sim);
    if (!who) return false;
    const legal = wotrAdapter.legalActions(sim, who);
    if (!legal.length) return false;
    try { applyActionInPlace(sim, chooseAction(sim, who, legal, rng), who); } catch { return false; }
  }
  return false;
}

export function netScores(net: ValueNet, state: GameState, actor: Side, legal: WotrAction[], rng: Rng, o: NetPlayerOptions = DEFAULT_NET_PLAYER): { cands: WotrAction[]; mean: number[] } | null {
  const cands = topCandidates(state, actor, legal, rng, o.cands);
  if (!cands) return null;
  if (cands.length === 1) return { cands, mean: [0] };
  netStats.decisions++;
  const sum = cands.map(() => 0);
  let cnt = 0;
  for (let i = 0; i < o.samples; i++) {
    const seed = rng.int(0x7fffffff);
    const det = determinize(state, actor, seed);
    const vals: (number | null)[] = cands.map((c) => {
      const sim = clone(det);
      try { applyActionInPlace(sim, c, actor); } catch { return null; }
      netStats.sims++;
      return settle(sim, new Rng(seed ^ 0x3c6ef372)) ? net.value(sim, actor) : null;
    });
    if (vals.some((x) => x === null)) { netStats.refused++; continue; }
    vals.forEach((x, j) => { sum[j] += x!; });
    cnt++;
  }
  if (!cnt) return { cands: [cands[0]!], mean: [0] };
  return { cands, mean: sum.map((x) => x / cnt) };
}

export function chooseActionNet(net: ValueNet, state: GameState, actor: Side, legal: WotrAction[], rng: Rng, o: NetPlayerOptions = DEFAULT_NET_PLAYER): WotrAction {
  const r = netScores(net, state, actor, legal, rng, o);
  if (!r) return chooseAction(state, actor, legal, rng);
  if (r.cands.length === 1) return r.cands[0]!;
  let best = 0;
  for (let j = 1; j < r.cands.length; j++) if (r.mean[j]! > r.mean[best]! && r.mean[j]! > r.mean[0]! + o.margin) best = j;
  if (best !== 0) netStats.overruled++;
  return r.cands[best]!;
}
