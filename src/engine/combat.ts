// Battle resolution (rules-spec §7). DEVIATION (documented): for the first
// playable slice combat is AUTO-RESOLVED deterministically — no interactive
// Combat-card / casualty / retreat prompts yet. Each round both sides roll
// Combat Strength dice (hit on 5+, or 6+ for the attacker's first round vs a
// City/Fortification/Stronghold), re-roll failed dice up to Leadership, then
// remove casualties (Regulars first; Elite downgrades to Regular = two steps).
// The attacker presses while it has at least as many units as the defender, to a
// round cap. A surviving attacker that destroys the defender advances and
// captures the Settlement. Interactive combat replaces this later.
import type { GameState, Nation, RegionId, Side } from './types';
import { REGIONS, sideOfNation } from './data';
import { withRng } from './rng';
import { unitCount, leadership, captureIfEnemySettlement } from './armies';
import { onArmyAttacked } from './politics';
import { log } from './log';

const MAX_ROUNDS = 5;

/** Remove `hits` steps from a region's army. Regulars are removed; Elites
 *  downgrade to Regular first (so an Elite absorbs two hits). Shadow casualties
 *  return to reinforcements; FP casualties are permanent. Returns units removed. */
function removeHits(state: GameState, id: RegionId, side: Side, hits: number): void {
  const r = state.regions[id]!;
  for (let h = 0; h < hits; h++) {
    const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
    if (nations.length === 0) break;
    // Prefer removing a Regular; else downgrade an Elite.
    const withReg = nations.find((n) => r.units[n]!.regular > 0);
    if (withReg) {
      r.units[withReg]!.regular -= 1;
      if (side === 'shadow') state.reinforcements[withReg].regular += 1;
    } else {
      const n = nations[0]!;
      r.units[n]!.elite -= 1; r.units[n]!.regular += 1; // downgrade
      if (side === 'shadow') state.reinforcements[n].elite += 1; // the elite figure recycles
    }
  }
  // If the army is wiped, its Leaders/Nazgûl/Characters are removed too.
  if (unitCount(state, id) === 0) { r.leaders = 0; r.nazgul = 0; r.characters = []; }
}

function rollHits(state: GameState, count: number, leadershipN: number, target: number): number {
  return withRng(state, (rng) => {
    let hits = 0; const fails: number[] = [];
    for (let i = 0; i < count; i++) {
      const d = rng.rollDie(6);
      if (d >= target && d !== 1) hits++; else fails.push(d);
    }
    // Leader re-roll of failed dice, up to Leadership (max 5).
    const rerolls = Math.min(leadershipN, fails.length, 5);
    for (let i = 0; i < rerolls; i++) { if (rng.rollDie(6) >= target) hits++; }
    return hits;
  });
}

/** Resolve a battle: the attacker's Army at `from` attacks the defender at `to`. */
export function resolveBattle(state: GameState, attacker: Side, from: RegionId, to: RegionId): void {
  const defender: Side = attacker === 'fp' ? 'shadow' : 'fp';
  // Political reaction: each defending nation activates + advances once.
  const def = state.regions[to]!;
  for (const n of Object.keys(def.units) as Nation[]) {
    if ((def.units[n]!.regular + def.units[n]!.elite) > 0) onArmyAttacked(state, n);
  }
  const defReg = REGIONS[to]!;
  const fortified = defReg.settlement === 'City' || defReg.settlement === 'Fortification' || defReg.settlement === 'Stronghold';

  log(state, null, 'combat', `${attacker} attacks ${to} from ${from}`);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (unitCount(state, from) === 0 || unitCount(state, to) === 0) break;
    const atkTarget = (round === 0 && fortified) ? 6 : 5; // fortification/siege first round
    const atkHits = rollHits(state, Math.min(5, unitCount(state, from)), leadership(state, from, attacker), atkTarget);
    const defHits = rollHits(state, Math.min(5, unitCount(state, to)), leadership(state, to, defender), 5);
    // Simultaneous: apply both.
    removeHits(state, to, defender, atkHits);
    removeHits(state, from, attacker, defHits);
    // Attacker presses only while not outnumbered; else ceases.
    if (unitCount(state, from) < unitCount(state, to)) break;
  }

  if (unitCount(state, to) === 0 && unitCount(state, from) > 0) {
    // Defender destroyed — attacker advances into the region and captures it.
    const src = state.regions[from]!, dst = state.regions[to]!;
    for (const n of Object.keys(src.units) as Nation[]) {
      const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
      d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
    }
    dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
    src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
    captureIfEnemySettlement(state, to, attacker);
    log(state, null, 'combat', `${attacker} won at ${to}`);
  } else {
    log(state, null, 'combat', `battle at ${to} ended (atk ${unitCount(state, from)} vs def ${unitCount(state, to)})`);
  }
}

/** Regions where `side` has an Army adjacent to an enemy Army (attack targets).
 *  Returns [from, to] pairs (capped representative set). */
export function attackTargets(state: GameState, side: Side, cap = 8): Array<[RegionId, RegionId]> {
  const out: Array<[RegionId, RegionId]> = [];
  const enemy: Side = side === 'fp' ? 'shadow' : 'fp';
  for (const from of Object.keys(state.regions)) {
    if (out.length >= cap) break;
    if (armyOwner(state, from) !== side) continue;
    // Only nations At War may start a battle (rules-spec §7).
    if (!hasAtWarUnit(state, from, side)) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (armyOwner(state, to) === enemy) { out.push([from, to]); break; }
    }
  }
  return out;
}

function armyOwner(state: GameState, id: RegionId): Side | null {
  const r = state.regions[id]!;
  for (const n of Object.keys(r.units) as Nation[]) {
    if ((r.units[n]!.regular + r.units[n]!.elite) > 0) return sideOfNation(n);
  }
  return null;
}
function hasAtWarUnit(state: GameState, id: RegionId, side: Side): boolean {
  const r = state.regions[id]!;
  for (const n of Object.keys(r.units) as Nation[]) {
    if (sideOfNation(n) === side && (r.units[n]!.regular + r.units[n]!.elite) > 0 && state.nations[n].step === 0) return true;
  }
  return false;
}
