// valueModel — a learned position value for the search (src/ai/search.ts).
//
// P(the Shadow wins | position) as a logistic model over public features: the
// hand-set evaluator's own terms (evaluate.ts breakdown) plus a few raw quantities.
// The weights are FITTED to self-play outcomes by scripts/fit-value.mjs, not set by
// hand — the 1-ply evaluator's hand-set weights were the reason it re-derived the
// heuristic (docs/ai-1ply-evaluator.md, stage 4). The model is only ever asked about
// positions at the START of a turn (the search ends its playouts there), so it is
// trained on turn-start snapshots only. Reads public information only.
import type { GameState, Side, Nation, RegionId } from '../engine/types';
import { REGIONS, STANDARD_TILE_LIST, levelOf } from '../engine/data';
import { MORDOR_ENTRANCES } from '../engine/fellowship';
import { evaluate, type EvalBreakdown } from './evaluate';
import { dist, armyHere, settlementCtrl } from './wotrAI';
import { unitCount } from '../engine/armies';
import weights from './valueWeights.json';

const FP_NATIONS = new Set<Nation>(['dwarves', 'elves', 'gondor', 'north', 'rohan']);

/** Evaluator breakdown terms used as features (absent = 0). */
const EVAL_TERMS = [
  'ring.corruption', 'ring.mordorStep', 'ring.approach', 'ring.huntBox', 'ring.companions',
  'mil.units', 'mil.shadow.approach', 'mil.fp.approach', 'mil.shadow.staging', 'mil.fp.staging',
  'mil.shadow.garrisoned', 'mil.fp.garrisoned', 'mil.shadow.openDoor', 'mil.fp.openDoor',
  'mil.softObjective', 'pol.fp', 'pol.sh', 'tempo.hand',
];

export const FEATURE_NAMES: string[] = [
  ...EVAL_TERMS.map((k) => `ev:${k}`),
  'turn', 'shVp', 'fpVp', 'shVp2', 'fpVp2', 'corruption', 'corruption2', 'mordorStep', 'toGo', 'toGoTurn',
  'companions', 'companionLevels', 'huntPoolAvg', 'huntPoolEyes', 'fpHand', 'shHand',
  'fpAtWar', 'shAtWar', 'threatVp', 'turnShVp', 'turnCorr',
];

/** Raw features of a position, in FEATURE_NAMES order. */
export function features(state: GameState): number[] {
  const br: EvalBreakdown = {};
  evaluate(state, 'shadow', br);
  const fs = state.fellowship;
  const shVp = state.victoryPoints.shadow ?? 0, fpVp = state.victoryPoints.fp ?? 0;
  const toGo = fs.mordor !== null ? 0 : Math.max(0, Math.min(...MORDOR_ENTRANCES.map((e) => dist(fs.location, e))) - fs.progress);
  let lv = 0;
  for (const c of fs.companions) lv += Math.min(4, levelOf(c));
  let poolSum = 0, poolN = 0, eyes = 0;
  for (const i of state.hunt.pool) {
    const t = STANDARD_TILE_LIST[i];
    if (!t) continue;
    poolN++;
    if (t.value === 'eye') eyes++;
    else if (typeof t.value === 'number') poolSum += t.value;
  }
  let fpWar = 0, shWar = 0;
  for (const [n, ns] of Object.entries(state.nations) as [Nation, { step: number }][]) {
    if (ns.step !== 0) continue;
    if (FP_NATIONS.has(n)) fpWar++; else shWar++;
  }
  // VP of Free Peoples Settlements a Shadow Army stands next to, outnumbering the garrison.
  let threatVp = 0;
  for (const id of Object.keys(state.regions) as RegionId[]) {
    const def = REGIONS[id]!;
    if ((def.vp ?? 0) <= 0 || settlementCtrl(state, id) !== 'fp') continue;
    const here = unitCount(state, id);
    if ((def.adjacency as RegionId[]).some((a) => armyHere(state, a, 'shadow') && unitCount(state, a) > here)) threatVp += def.vp;
  }
  const turn = state.turn;
  return [
    ...EVAL_TERMS.map((k) => br[k] ?? 0),
    turn, shVp, fpVp, shVp * shVp / 10, fpVp * fpVp / 4, fs.corruption, fs.corruption * fs.corruption / 12,
    fs.mordor === null ? 0 : fs.mordor + 1, toGo, toGo * turn / 10,
    fs.companions.length, lv, poolN ? poolSum / poolN : 0, eyes,
    state.cards.fp.hand.length, state.cards.shadow.hand.length,
    fpWar, shWar, threatVp, turn * shVp / 10, turn * fs.corruption / 10,
  ];
}

interface Weights { names: string[]; mean: number[]; std: number[]; w: number[]; b: number }
const W = weights as unknown as Weights;
if (W.names.length && W.names.join() !== FEATURE_NAMES.join()) {
  throw new Error('valueWeights.json is stale: refit with scripts/fit-value.mjs');
}

/** P(Shadow wins) for a non-terminal position, from the fitted logistic model. */
export function shadowWinProb(state: GameState): number {
  if (state.winner) return state.winner === 'shadow' ? 1 : 0;
  if (!W.w.length) return 0.5;
  const x = features(state);
  let z = W.b;
  for (let i = 0; i < x.length; i++) z += W.w[i]! * (x[i]! - W.mean[i]!) / W.std[i]!;
  return 1 / (1 + Math.exp(-z));
}

/** The position's value for `side`, in [-1, 1]. */
export function value(state: GameState, side: Side): number {
  const p = shadowWinProb(state);
  return side === 'shadow' ? 2 * p - 1 : 1 - 2 * p;
}
