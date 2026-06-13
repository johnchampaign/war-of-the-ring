// Interactive battle resolution (rules-spec §7). Combat is a resumable
// sub-machine: it pauses with a PendingChoice for casualty selection (when the
// choice is meaningful), the attacker's cease/continue decision, and the
// defender's retreat decision. (Combat-card play within a battle is still
// deferred — auto "no card" — and noted; everything else is now a real prompt,
// honoring the prompt-for-every-choice fidelity decision.)
import type { GameState, Nation, RegionId, Side, PendingCombat } from './types';
import { REGIONS, sideOfNation } from './data';
import { withRng } from './rng';
import { unitCount, leadership, captureIfEnemySettlement, armySide, freeForMovement } from './armies';
import { onArmyAttacked } from './politics';
import { log } from './log';

const MAX_ROUNDS = 5;
const other = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');
const nationsWithUnits = (state: GameState, id: RegionId): Nation[] =>
  (Object.keys(state.regions[id]!.units) as Nation[]).filter((n) => (state.regions[id]!.units[n]!.regular + state.regions[id]!.units[n]!.elite) > 0);

function rollHits(state: GameState, count: number, leadershipN: number, target: number): number {
  return withRng(state, (rng) => {
    let hits = 0; const fails = [];
    for (let i = 0; i < count; i++) { const d = rng.rollDie(6); if (d >= target && d !== 1) hits++; else fails.push(d); }
    const rerolls = Math.min(leadershipN, fails.length, 5);
    for (let i = 0; i < rerolls; i++) if (rng.rollDie(6) >= target) hits++;
    return hits;
  });
}

/** A casualty plan changes the outcome only when both Regulars and Elites are
 *  present — only then do we prompt; otherwise removal is auto. */
function meaningfulCasualty(state: GameState, id: RegionId, hits: number): boolean {
  if (hits <= 0) return false;
  let reg = 0, el = 0;
  for (const u of Object.values(state.regions[id]!.units)) { reg += u.regular; el += u.elite; }
  return reg > 0 && el > 0;
}

/** Apply `hits` steps to a region's army. regularsFirst removes Regulars before
 *  downgrading Elites; elitesFirst downgrades Elites first (preserving unit
 *  count). Shadow casualties recycle to reinforcements; FP casualties are gone. */
export function applyCasualties(state: GameState, id: RegionId, side: Side, hits: number, plan: 'regularsFirst' | 'elitesFirst'): void {
  const r = state.regions[id]!;
  for (let h = 0; h < hits; h++) {
    const nations = nationsWithUnits(state, id);
    if (!nations.length) break;
    if (plan === 'regularsFirst') {
      const wr = nations.find((n) => r.units[n]!.regular > 0);
      if (wr) { r.units[wr]!.regular -= 1; if (side === 'shadow') state.reinforcements[wr].regular += 1; }
      else { const n = nations[0]!; r.units[n]!.elite -= 1; r.units[n]!.regular += 1; if (side === 'shadow') state.reinforcements[n].elite += 1; }
    } else {
      const we = nations.find((n) => r.units[n]!.elite > 0);
      if (we) { r.units[we]!.elite -= 1; r.units[we]!.regular += 1; if (side === 'shadow') state.reinforcements[we].elite += 1; }
      else { const n = nations[0]!; r.units[n]!.regular -= 1; if (side === 'shadow') state.reinforcements[n].regular += 1; }
    }
  }
  if (unitCount(state, id) === 0) { r.leaders = 0; r.nazgul = 0; r.characters = []; }
}

/** Begin a battle: political reactions, then set up the sub-machine. The driver
 *  (combatStep, run from advance) takes it from here. */
export function startBattle(state: GameState, attacker: Side, from: RegionId, to: RegionId): void {
  const def = state.regions[to]!;
  for (const n of nationsWithUnits(state, to)) onArmyAttacked(state, n);
  const dReg = REGIONS[to]!;
  state.pendingCombat = {
    attacker, defender: other(attacker), from, to, round: 0,
    fortified: dReg.settlement === 'City' || dReg.settlement === 'Fortification' || dReg.settlement === 'Stronghold',
    step: 'beginRound', atkHits: 0, defHits: 0,
  };
  log(state, null, 'combat', `${attacker} attacks ${to} from ${from}`);
  void def;
}

function retreatRegion(state: GameState, pc: PendingCombat): RegionId | null {
  for (const adj of REGIONS[pc.to]!.adjacency) if (freeForMovement(state, adj, pc.defender)) return adj;
  return null;
}

/** Move the whole army at `from` into `to` (defender gone), capturing. */
function advanceInto(state: GameState, attacker: Side, from: RegionId, to: RegionId): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  for (const n of Object.keys(src.units) as Nation[]) {
    const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
  }
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
  src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
  captureIfEnemySettlement(state, to, attacker);
}

function finishCombat(state: GameState, advance: boolean): void {
  const pc = state.pendingCombat!;
  if (advance && unitCount(state, pc.from) > 0) advanceInto(state, pc.attacker, pc.from, pc.to);
  log(state, null, 'combat', `battle at ${pc.to} ended (atk ${unitCount(state, pc.from)} / def ${unitCount(state, pc.to)})`);
  // Resume Action Resolution: opponent of attacker acts if able (else attacker).
  const opp = other(pc.attacker);
  state.currentPlayer = state.dice[opp].length > 0 ? opp : pc.attacker;
  state.pendingCombat = null;
}

/** Drive the combat sub-machine until it needs a decision (sets pendingChoice)
 *  or the battle ends (clears pendingCombat). Called from advance(). */
export function combatStep(state: GameState): void {
  const pc = state.pendingCombat;
  if (!pc) return;
  for (;;) {
    if (unitCount(state, pc.from) === 0 || unitCount(state, pc.to) === 0) { finishCombat(state, true); return; }
    switch (pc.step) {
      case 'beginRound': {
        if (pc.round >= MAX_ROUNDS) { finishCombat(state, false); return; }
        const atkTarget = pc.round === 0 && pc.fortified ? 6 : 5;
        pc.atkHits = rollHits(state, Math.min(5, unitCount(state, pc.from)), leadership(state, pc.from, pc.attacker), atkTarget);
        pc.defHits = rollHits(state, Math.min(5, unitCount(state, pc.to)), leadership(state, pc.to, pc.defender), 5);
        pc.step = 'attackerCasualties'; continue;
      }
      case 'attackerCasualties': {
        if (pc.defHits > 0) {
          if (meaningfulCasualty(state, pc.from, pc.defHits)) {
            state.pendingChoice = { owner: pc.attacker, kind: 'combatCasualties', data: { region: pc.from, side: pc.attacker, hits: pc.defHits, next: 'defenderCasualties' } };
            return;
          }
          applyCasualties(state, pc.from, pc.attacker, pc.defHits, 'regularsFirst');
        }
        pc.step = 'defenderCasualties'; continue;
      }
      case 'defenderCasualties': {
        if (pc.atkHits > 0) {
          if (meaningfulCasualty(state, pc.to, pc.atkHits)) {
            state.pendingChoice = { owner: pc.defender, kind: 'combatCasualties', data: { region: pc.to, side: pc.defender, hits: pc.atkHits, next: 'continueDecision' } };
            return;
          }
          applyCasualties(state, pc.to, pc.defender, pc.atkHits, 'regularsFirst');
        }
        pc.step = 'continueDecision'; continue;
      }
      case 'continueDecision': {
        if (unitCount(state, pc.to) === 0 || unitCount(state, pc.from) === 0) { finishCombat(state, true); return; }
        state.pendingChoice = { owner: pc.attacker, kind: 'combatContinue' };
        return;
      }
      case 'retreatDecision': {
        state.pendingChoice = { owner: pc.defender, kind: 'combatRetreat' };
        return;
      }
    }
  }
}

// --- resolvers for the combat PendingChoices (called from the adapter) ----
export function resolveCasualties(state: GameState, plan: 'regularsFirst' | 'elitesFirst'): void {
  const d = state.pendingChoice!.data as { region: RegionId; side: Side; hits: number; next: PendingCombat['step'] };
  applyCasualties(state, d.region, d.side, d.hits, plan);
  state.pendingCombat!.step = d.next;
  state.pendingChoice = null;
}
export function resolveContinue(state: GameState, cont: boolean): void {
  state.pendingChoice = null;
  if (cont) state.pendingCombat!.step = 'retreatDecision';
  else finishCombat(state, false); // attacker ceases; stays in place
}
export function resolveRetreat(state: GameState, retreat: boolean): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  if (retreat) {
    const dest = retreatRegion(state, pc);
    if (dest) { moveStack(state, pc.to, dest); finishCombat(state, true); return; }
    // no retreat available -> stand
  }
  pc.round += 1; pc.step = 'beginRound';
}
function moveStack(state: GameState, from: RegionId, to: RegionId): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  for (const n of Object.keys(src.units) as Nation[]) {
    const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
  }
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
  src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
}

export const canRetreat = (state: GameState): boolean => retreatRegion(state, state.pendingCombat!) !== null;

/** Regions where `side` has an At-War Army adjacent to an enemy Army. */
export function attackTargets(state: GameState, side: Side, cap = 8): Array<[RegionId, RegionId]> {
  const out: Array<[RegionId, RegionId]> = [];
  const enemy = other(side);
  for (const from of Object.keys(state.regions)) {
    if (out.length >= cap) break;
    if (armySide(state, from) !== side || !hasAtWarUnit(state, from, side)) continue;
    for (const to of REGIONS[from]!.adjacency) if (armySide(state, to) === enemy) { out.push([from, to]); break; }
  }
  return out;
}
function hasAtWarUnit(state: GameState, id: RegionId, side: Side): boolean {
  const r = state.regions[id]!;
  for (const n of Object.keys(r.units) as Nation[]) {
    if (sideOfNation(n) === side && (r.units[n]!.regular + r.units[n]!.elite) > 0 && state.nations[n].step === 0) return true;
  }
  return false;
}
