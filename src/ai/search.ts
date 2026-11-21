// search — a sampled look-ahead over the heuristic's best few actions.
//
// For an action-resolution decision (a die to spend), the heuristic's top `cands`
// actions are each played out on `samples` determinized copies of the position, the
// SAME copies for every candidate (common random numbers: each pair of candidates is
// compared on identical hidden cards and dice, which is what makes a few samples
// enough to separate them). A playout runs both sides on the heuristic until the start
// of turn `turn + horizon` (or the end of the game) and is scored by the fitted value
// model (valueModel.ts). The heuristic's own pick stands unless a challenger's mean
// beats it by `margin` — noise must not overrule a hand-tuned choice.
//
// Every other decision (pending choices, the Hunt allocation, the Fellowship phase)
// stays with the heuristic for now.
//
// No peeking, by construction (the rule of docs/ai-1ply-evaluator.md): each copy is
// built from the actor's own redacted view, with every hidden thing re-dealt —
//   - the opponent's hand, draw piles and face-down discards: dealt at random from the
//     cards of their decks that are not public (discarded face up or on the table);
//   - the actor's own draw piles: reshuffled (materializeView);
//   - the RNG: a fresh seed (materializeView) — never the live dice;
//   - the Shadow's opening plan roll, hidden from the Free Peoples: re-rolled.
import { Rng } from 'digital-boardgame-framework';
import type { GameState, Side, Deck } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { wotrAdapter, applyActionInPlace } from '../adapter/wotrAdapter';
import { deckOf, EVENT_BY_ID } from '../engine/data';
import { chooseAction, topCandidates } from './wotrAI';
import { chooseActionHumanlike } from './humanlikeFP';
import { materializeView } from './simulate';
import { value } from './valueModel';

export interface SearchOptions {
  /** Candidates: the heuristic's best `cands` actions. */
  cands: number;
  /** Determinized copies, shared by every candidate. */
  samples: number;
  /** Playouts stop at the start of turn `turn + horizon` (or the game's end). */
  horizon: number;
  /** A challenger replaces the heuristic's pick only if its mean value is higher by this. */
  margin: number;
  /** Optional wall-clock cap in ms (tournament play); A/Bs use fixed samples for determinism. */
  budgetMs?: number;
  /** Opponent-model mix: on this fraction of samples a Free Peoples opponent plays the
   *  human-like policy (humanlikeFP.ts) in the playouts instead of the heuristic, so the
   *  search does not just exploit a copy of itself. Shadow searches only. */
  oppMix?: number;
  /** Opponent noise: in the playouts the opponent, on this fraction of its decisions,
   *  picks uniformly among its heuristic top 3 instead of the top 1 — a varied opponent
   *  model that names no particular policy. */
  oppNoise?: number;
}

export const DEFAULT_SEARCH: SearchOptions = { cands: 4, samples: 24, horizon: 1, margin: 0.03 };

/** Telemetry for the A/B harness. */
export const searchStats = { decisions: 0, overruled: 0, playouts: 0, refused: 0, dealMismatch: 0 };

const deckOfCard = (id: string): Deck => (EVENT_BY_ID[id]?.deck === 'Character' ? 'character' : 'strategy');

function shuffleInPlace<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** A runnable copy of the actor's view with every hidden thing re-dealt (see top). */
export function determinize(state: GameState, actor: Side, seed: number): GameState {
  const v = materializeView(state, actor, seed);
  const rng = new Rng(seed ^ 0x2545f491);
  const opp: Side = actor === 'fp' ? 'shadow' : 'fp';
  const piles = v.cards[opp];
  for (const deck of ['character', 'strategy'] as Deck[]) {
    const seen = new Set<string>([...piles.discard[deck], ...piles.table.filter((id) => deckOfCard(id) === deck)]);
    const pool = shuffleInPlace(deckOf(opp, deck).filter((id) => !seen.has(id)), rng);
    const marker = `hidden-${deck}`;
    const handSlots = piles.hand.flatMap((id, i) => (id === marker ? [i] : []));
    const downSlots = (piles.discardFaceDown ?? []).flatMap((id, i) => (id === marker ? [i] : []));
    const need = handSlots.length + downSlots.length + piles.draw[deck].length;
    if (pool.length !== need) searchStats.dealMismatch++;
    let k = 0;
    const next = (): string => pool[k++] ?? deckOf(opp, deck)[rng.int(deckOf(opp, deck).length)]!;
    for (const i of handSlots) piles.hand[i] = next();
    for (const i of downSlots) piles.discardFaceDown![i] = next();
    piles.draw[deck] = piles.draw[deck].map(() => next());
  }
  if (actor === 'fp') v.shadowPlanRoll = rng.int(100);
  v.log = v.log.slice(-8);
  return v;
}

const PLAYOUT_GUARD = 4000;

/** Play `sim` forward in place on the heuristic until the start of `stopTurn` or the
 *  game's end. False if the engine refused a step (the copy is then unusable). */
interface OppModel { humanlikeFp: boolean; side: Side; noise: number }

function opponentPick(sim: GameState, who: Side, legal: WotrAction[], rng: Rng, m: OppModel): WotrAction {
  if (m.humanlikeFp && who === 'fp') return chooseActionHumanlike(sim, who, legal, rng);
  if (m.noise && rng.next() < m.noise) {
    const top = topCandidates(sim, who, legal, rng, 3);
    if (top && top.length > 1) return top[rng.int(top.length)]!;
  }
  return chooseAction(sim, who, legal, rng);
}

function playout(sim: GameState, stopTurn: number, rng: Rng, m: OppModel): boolean {
  let n = 0;
  while (!sim.winner && n++ < PLAYOUT_GUARD) {
    if (sim.turn >= stopTurn && sim.phase === 'fellowship' && !sim.pendingChoice) return true;
    const who = wotrAdapter.currentActor(sim);
    if (!who) return false;
    const legal = wotrAdapter.legalActions(sim, who);
    if (!legal.length) return false;
    const pick = who === m.side ? opponentPick(sim, who, legal, rng, m) : chooseAction(sim, who, legal, rng);
    try { applyActionInPlace(sim, pick, who); } catch { return false; }
    if (sim.log.length > 64) sim.log.splice(0, sim.log.length - 16);
  }
  return !!sim.winner;
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** The candidates and their mean playout values (null: the heuristic decides alone).
 *  Exposed for the probe: the means must not depend on anything hidden from `actor`. */
export function searchScores(state: GameState, actor: Side, legal: WotrAction[], rng: Rng, opts: SearchOptions = DEFAULT_SEARCH): { cands: WotrAction[]; mean: number[] } | null {
  const cands = topCandidates(state, actor, legal, rng, opts.cands);
  if (!cands) return null;
  if (cands.length === 1) return { cands, mean: [0] };
  searchStats.decisions++;
  const t0 = opts.budgetMs ? Date.now() : 0;
  const sum = cands.map(() => 0), cnt = cands.map(() => 0);
  const stopTurn = state.turn + opts.horizon;
  for (let i = 0; i < opts.samples; i++) {
    if (opts.budgetMs && i >= 4 && Date.now() - t0 > opts.budgetMs) break;
    const seed = rng.int(0x7fffffff);
    const det = determinize(state, actor, seed);
    const m: OppModel = {
      side: actor === 'fp' ? 'shadow' : 'fp', noise: opts.oppNoise ?? 0,
      humanlikeFp: actor === 'shadow' && !!opts.oppMix && new Rng(seed ^ 0x1b873593).next() < opts.oppMix,
    };
    const vals: (number | null)[] = cands.map((c) => {
      const sim = clone(det);
      try { applyActionInPlace(sim, c, actor); } catch { return null; }
      searchStats.playouts++;
      return playout(sim, stopTurn, new Rng(seed ^ 0x68e31da4), m) ? value(sim, actor) : null;
    });
    // Common random numbers: a sample counts only if every candidate finished on it,
    // so all means are over the same samples.
    if (vals.some((x) => x === null)) { searchStats.refused++; continue; }
    vals.forEach((x, j) => { sum[j] += x!; cnt[j]++; });
  }
  if (!cnt[0]) return { cands: [cands[0]!], mean: [0] };
  return { cands, mean: sum.map((x, j) => x / cnt[j]!) };
}

/** Choose for `actor`: the heuristic, overruled by the search where it finds better. */
export function chooseActionSearch(state: GameState, actor: Side, legal: WotrAction[], rng: Rng, opts: SearchOptions = DEFAULT_SEARCH): WotrAction {
  const r = searchScores(state, actor, legal, rng, opts);
  if (!r) return chooseAction(state, actor, legal, rng);
  const { cands, mean } = r;
  if (cands.length === 1) return cands[0]!;
  let best = 0;
  for (let j = 1; j < cands.length; j++) if (mean[j]! > mean[best]! && mean[j]! > mean[0]! + opts.margin) best = j;
  if (best !== 0) searchStats.overruled++;
  return cands[best]!;
}
