// Armies: composition queries, mustering (recruit), and movement with settlement
// capture (rules-spec §1, §6). Combat is in combat.ts.
import type { GameState, Nation, RegionId, Side, ArmyUnits } from './types';
import { REGIONS, sideOfNation, characterDef } from './data';
import { isAtWar, onSettlementCaptured } from './politics';
import { shadowBarredFromRegion } from './persistent';
import { log } from './log';

export const STACKING_LIMIT = 10;

/** Total Army units (regular + elite, all nations) in a region. */
export function unitCount(state: GameState, id: RegionId): number {
  let n = 0;
  for (const u of Object.values(state.regions[id]!.units)) n += u.regular + u.elite;
  return n;
}

/** The side whose Army occupies a region, or null if no Army units. (A region
 *  never holds both sides' Army units.) */
export function armySide(state: GameState, id: RegionId): Side | null {
  const r = state.regions[id]!;
  for (const nation of Object.keys(r.units) as Nation[]) {
    if ((r.units[nation]!.regular + r.units[nation]!.elite) > 0) return sideOfNation(nation);
  }
  return null;
}

/** Combat Strength = unit count capped at 5 dice. */
export const combatStrength = (state: GameState, id: RegionId): number => Math.min(5, unitCount(state, id));

/** Leadership = Leaders/Nazgûl + Character leadership ratings present, capped 5. */
export function leadership(state: GameState, id: RegionId, side: Side): number {
  const r = state.regions[id]!;
  let l = side === 'fp' ? r.leaders : r.nazgul;
  for (const cid of r.characters) {
    const d = characterDef(cid);
    if (d && sideOfNation((d.nation && d.nation !== 'any' ? d.nation : (side === 'fp' ? 'gondor' : 'sauron')) as Nation) === side) {
      l += d.leadership;
    }
  }
  return Math.min(5, l);
}

/** Who controls a region's Settlement (the marker side, or the original owner). */
export function settlementController(state: GameState, id: RegionId): Side | null {
  const def = REGIONS[id]!;
  if (!def.settlement) return null;
  return state.regions[id]!.control ?? (def.nation ? sideOfNation(def.nation) : null);
}

/** Free for the purposes of Army movement for `side`: no enemy Army present. */
export function freeForMovement(state: GameState, id: RegionId, side: Side): boolean {
  const occ = armySide(state, id);
  return occ === null || occ === side;
}

/** Recruit reinforcements into a free, friendly, At-War Settlement (Muster die,
 *  simplified). Places `regular`/`elite` of `nation`; returns false if illegal. */
export function recruit(state: GameState, nation: Nation, id: RegionId, regular: number, elite: number,
  opts: { ignoreAtWar?: boolean } = {}): boolean {
  const def = REGIONS[id]!;
  if (!def.settlement || def.nation !== nation) return false;
  if (!opts.ignoreAtWar && !isAtWar(state, nation)) return false; // Event cards may recruit before At War (rules-spec §6)
  const side = sideOfNation(nation);
  if (settlementController(state, id) !== side) return false; // not friendly/free
  if (armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp')) return false;
  const pool = state.reinforcements[nation];
  if (regular > pool.regular || elite > pool.elite) return false;
  if (unitCount(state, id) + regular + elite > STACKING_LIMIT) return false;
  pool.regular -= regular; pool.elite -= elite;
  const r = state.regions[id]!;
  const u: ArmyUnits = r.units[nation] ?? { regular: 0, elite: 0 };
  u.regular += regular; u.elite += elite;
  r.units[nation] = u;
  log(state, null, 'muster', `Recruited ${regular}R/${elite}E ${nation} in ${id}`);
  return true;
}

/** Whether `side` may move the whole Army from `from` to `to` (rules-spec §6, §8).
 *  Shared by moveArmy and the legal-action enumerator so the two never diverge. */
export function canMoveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  if (!REGIONS[from]!.adjacency.includes(to)) return false;
  if (armySide(state, from) !== side) return false;
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return false; // A Power too Great / Tom Bombadil
  if (!freeForMovement(state, to, side)) return false;
  if (unitCount(state, from) + unitCount(state, to) > STACKING_LIMIT) return false;
  // Non-belligerent nations cannot cross another nation's border (rules-spec §8).
  const dn = REGIONS[to]!.nation;
  for (const nation of Object.keys(state.regions[from]!.units) as Nation[]) {
    if (!isAtWar(state, nation) && dn && dn !== nation) return false;
  }
  return true;
}

/** Move all of a region's Army (with its Leaders/Nazgûl/Characters) to an
 *  adjacent free region; captures an enemy Settlement entered with no defender.
 *  Simplified: moves the whole stack (no splitting yet). */
export function moveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  if (!canMoveArmy(state, from, to, side)) return false;
  const src = state.regions[from]!, dst = state.regions[to]!;
  // Merge units, leaders, nazgûl, characters.
  for (const nation of Object.keys(src.units) as Nation[]) {
    const u = src.units[nation]!;
    const d = dst.units[nation] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[nation] = d;
  }
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
  src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
  // Capture an undefended enemy Settlement.
  captureIfEnemySettlement(state, to, side);
  log(state, null, 'army', `Moved army ${from} -> ${to}`);
  return true;
}

export function captureIfEnemySettlement(state: GameState, id: RegionId, side: Side): void {
  const def = REGIONS[id]!;
  if (!def.settlement) return;
  if (settlementController(state, id) === side) return;
  // capturing
  state.regions[id]!.control = side;
  const vp = def.vp;
  if (vp > 0) {
    state.victoryPoints[side] += vp;
    log(state, null, 'army', `${side} captured ${id} (+${vp} VP, total ${state.victoryPoints[side]})`);
  }
  if (def.nation) onSettlementCaptured(state, def.nation, id);
}
