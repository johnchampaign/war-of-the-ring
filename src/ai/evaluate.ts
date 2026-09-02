// evaluate(state, side) — the 1-ply evaluator's position score (stage 1 of
// docs/ai-1ply-evaluator.md). Scores a STATE, not an action: the chooser (stage
// 3) will simulate each legal action and ask this function which resulting
// position it likes best. Reads ONLY public information — the same contract as
// the heuristic chooser, and stage 2's no-peek probe will enforce it
// structurally. Pure: no RNG, no Date, no mutation.
//
// v1 weights start from the action-scorer's measured relative magnitudes; they
// are tuned ONLY through the A/B protocol (the 0-for-4 record is about blind
// tuning, not a licence to skip discipline here).
import type { GameState, RegionId, Side, Nation } from '../engine/types';
import { REGIONS } from '../engine/data';
import { forceLeadership, unitCount } from '../engine/armies';
import { MORDOR_ENTRANCES } from '../engine/fellowship';
import { dist, settlementCtrl, armyHere, campaignTarget, planObjectives } from './wotrAI';

const FP_NATIONS_SET = new Set<Nation>(['dwarves', 'elves', 'gondor', 'north', 'rohan']);

/** Per-feature contributions, for the trace harness (scripts/eval-trace.mjs). */
export interface EvalBreakdown { [feature: string]: number }

/** Score `state` from `side`'s perspective — higher is better for that side.
 *  Implemented as one shared Shadow-minus-FP core, negated for the FP, so the
 *  two sides always agree on which of two positions favours whom. */
export function evaluate(state: GameState, side: Side, breakdown?: EvalBreakdown): number {
  // Every term is SIGNED from the Shadow's perspective (positive = good for the
  // Shadow); the final score is negated for the FP. The breakdown records the
  // signed contributions, so a trace reads directly as "what moved the number".
  let s = 0;
  const t = (k: string, v: number): void => { s += v; if (breakdown) breakdown[k] = (breakdown[k] ?? 0) + v; };
  // Terminal states dominate everything.
  if (state.winner) {
    t('terminal', state.winner === 'shadow' ? 1e6 : -1e6);
    return side === 'shadow' ? s : -s;
  }

  // ——— Victory points (the clocks: Shadow needs 10, FP needs 4 — p.44) ———————
  // Progress toward the asymmetric thresholds, superlinear near the end so a
  // position one capture from winning towers over one that is merely ahead.
  const shVp = state.victoryPoints.shadow ?? 0, fpVp = state.victoryPoints.fp ?? 0;
  t('vp.shadow', 340 * Math.pow(Math.min(1, shVp / 10), 1.5));
  t('vp.fp', -340 * Math.pow(Math.min(1, fpVp / 4), 1.5));

  // ——— The Ring (the other clock) ————————————————————————————————————————————
  const fs = state.fellowship;
  t('ring.corruption', 22 * fs.corruption);                        // 12 loses
  if (fs.mordor !== null) {
    t('ring.mordorStep', -55 * (fs.mordor + 1));                   // 5 steps to the Crack
  } else {
    const toGo = Math.max(0, Math.min(...MORDOR_ENTRANCES.map((e) => dist(fs.location, e))) - fs.progress);
    t('ring.approach', -(90 - Math.min(90, toGo * 9)));            // closer = worse for the Shadow
  }
  t('ring.huntBox', 6 * Math.min(5, state.hunt.box));
  t('ring.companions', -5 * fs.companions.length);                 // bodies that absorb the Hunt

  // ——— Military shape ————————————————————————————————————————————————————————
  // Board presence (units fielded minus lost-for-good), objective proximity for
  // the current campaign target, and the walk-in guard: own VP Settlements
  // standing garrisoned vs open with an enemy in reach.
  let shUnits = 0, fpUnits = 0;
  for (const r of Object.values(state.regions)) {
    for (const f of [r, r.siegeBox]) {
      if (!f) continue;
      for (const [n, u] of Object.entries(f.units) as [Nation, { regular: number; elite: number }][]) {
        const w = u.regular + 1.6 * u.elite;
        if (FP_NATIONS_SET.has(n)) fpUnits += w; else shUnits += w;
      }
    }
  }
  t('mil.units', 2.2 * (shUnits - fpUnits));
  for (const actor of ['shadow', 'fp'] as const) {
    const sign = actor === 'shadow' ? 1 : -1;
    const target = campaignTarget(state, actor);
    if (target) {
      // Nearest own army's distance to the objective: closing matters.
      let best = Infinity;
      for (const id of Object.keys(state.regions)) if (armyHere(state, id, actor)) best = Math.min(best, dist(id, target));
      if (best !== Infinity) t(`mil.${actor}.approach`, sign * Math.max(0, 30 - 3 * best));
      // Leadership with the army on the objective's doorstep (re-roll dice, cap 5).
      for (const id of Object.keys(state.regions)) {
        if (!armyHere(state, id, actor)) continue;
        if (id !== target && !(REGIONS[id]!.adjacency as RegionId[]).includes(target)) continue;
        t(`mil.${actor}.staging`, sign * 4 * Math.min(5, forceLeadership(state, state.regions[id]!, actor)));
        break;
      }
    }
    // The walk-in guard, both directions: each own VP Settlement standing EMPTY
    // with an enemy army within 2 is a capture waiting to happen.
    for (const id of Object.keys(state.regions)) {
      const def = REGIONS[id]!;
      if ((def.vp ?? 0) <= 0 || settlementCtrl(state, id) !== actor) continue;
      if (unitCount(state, id) > 0) { t(`mil.${actor}.garrisoned`, sign * 4 * def.vp); continue; }
      const enemy = actor === 'shadow' ? 'fp' : 'shadow';
      const near = (REGIONS[id]!.adjacency as RegionId[]).some((a) =>
        armyHere(state, a, enemy) || (REGIONS[a]!.adjacency as RegionId[]).some((b) => armyHere(state, b, enemy)));
      if (near) t(`mil.${actor}.openDoor`, -sign * 14 * def.vp);
    }
  }
  // The Shadow campaign plan's next objective already garrisoned by the FP is a
  // fight; open is an invitation — small term so plans prefer soft objectives.
  const objs = planObjectives(state);
  if (objs.length && !armyHere(state, objs[0]!, 'fp')) t('mil.softObjective', 8);

  // ——— Politics and tempo ————————————————————————————————————————————————————
  for (const [n, ns] of Object.entries(state.nations) as [Nation, { step: number; active: boolean }][]) {
    const atWarBonus = ns.step === 0 ? 3 : ns.active ? 1 : 0;
    t(`pol.${FP_NATIONS_SET.has(n) ? 'fp' : 'sh'}`, (FP_NATIONS_SET.has(n) ? -1 : 1) * atWarBonus * 4);
  }
  t('tempo.dice', 3 * (state.dice.shadow.length - state.dice.fp.length));
  t('tempo.hand', 1.5 * (state.cards.shadow.hand.length - state.cards.fp.hand.length));

  return side === 'shadow' ? s : -s;
}
