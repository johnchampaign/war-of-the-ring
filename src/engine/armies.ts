// Armies: composition queries, mustering (recruit), and movement with settlement
// capture (rules-spec §1, §6). Combat is in combat.ts.
import type { GameState, Nation, RegionId, Side, ArmyUnits } from './types';
import { REGIONS, sideOfNation, characterDef, characterSide } from './data';
import { isAtWar, onSettlementCaptured, activateNation } from './politics';
import { shadowBarredFromRegion } from './persistent';
import { log } from './log';

export const STACKING_LIMIT = 10;

/** Total Army units (regular + elite, all nations) in a region. */
export function unitCount(state: GameState, id: RegionId): number {
  return forceUnitCount(state.regions[id]!);
}

/** A combatant's figures — a region and a siege box share this shape. The siege
 *  model (RAW) keeps the boxed defenders in `region.siegeBox`, a Force. */
export type Force = { units: Partial<Record<Nation, ArmyUnits>>; leaders: number; nazgul: number; characters: string[] };
export function forceUnitCount(f: Force): number {
  let n = 0;
  for (const u of Object.values(f.units)) n += u!.regular + u!.elite;
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
  return forceLeadership(state, state.regions[id]!, side);
}
/** Leadership of a Force (region or siege box) for `side`. */
export function forceLeadership(state: GameState, f: Force, side: Side): number {
  let l = side === 'fp' ? f.leaders : f.nazgul;
  for (const cid of f.characters) {
    const d = characterDef(cid);
    if (d && sideOfNation((d.nation && d.nation !== 'any' ? d.nation : (side === 'fp' ? 'gondor' : 'sauron')) as Nation) === side) {
      l += d.leadership;
    }
  }
  // Saruman's "Servants of the White Hand": each Isengard Elite is also a Leader.
  if (side === 'shadow' && state.characters.entered.includes('saruman') && !state.characters.eliminated.includes('saruman')) {
    l += f.units.isengard?.elite ?? 0;
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
  opts: { ignoreAtWar?: boolean; leader?: number } = {}): boolean {
  const def = REGIONS[id]!;
  if (!def.settlement || def.nation !== nation) return false;
  if (!opts.ignoreAtWar && !isAtWar(state, nation)) return false; // Event cards may recruit before At War (rules-spec §6)
  const side = sideOfNation(nation);
  if (settlementController(state, id) !== side) return false; // not friendly/free
  if (armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp')) return false;
  // Can't MUSTER troops into a Stronghold besieged by the enemy (rulebook p.26).
  // Event-card recruits (ignoreAtWar) may, per p.27.
  if (!opts.ignoreAtWar && state.regions[id]!.besieged) return false;
  const pool = state.reinforcements[nation] as { regular: number; elite: number; leader?: number };
  const leader = opts.leader ?? 0;
  if (regular > pool.regular || elite > pool.elite || leader > (pool.leader ?? 0)) return false;
  if (unitCount(state, id) + regular + elite > STACKING_LIMIT) return false;
  pool.regular -= regular; pool.elite -= elite;
  const r = state.regions[id]!;
  const u: ArmyUnits = r.units[nation] ?? { regular: 0, elite: 0 };
  u.regular += regular; u.elite += elite;
  r.units[nation] = u;
  if (leader > 0) { pool.leader = (pool.leader ?? 0) - leader; r.leaders += leader; }
  log(state, null, 'muster', `Recruited ${regular}R/${elite}E${leader ? `/${leader}L` : ''} ${nation} in ${id}`);
  return true;
}

/** A region where the Shadow may muster a Nazgûl: a free (no FP Army) Sauron
 *  Stronghold the Shadow controls (rules-spec §6, "Nazgûl are always recruited in
 *  the Strongholds of the Sauron Nation"). */
export function canRecruitNazgul(state: GameState, id: RegionId): boolean {
  const def = REGIONS[id]!;
  if (def.nation !== 'sauron' || def.settlement !== 'Stronghold') return false;
  if (settlementController(state, id) !== 'shadow') return false;
  if (armySide(state, id) === 'fp' || state.regions[id]!.besieged) return false;
  return (state.reinforcements.sauron as { nazgul?: number }).nazgul! > 0;
}

export const SIEGE_LIMIT = 5;
/** Enforce the 5-Army-unit Stronghold siege cap (rulebook p.31): when a Stronghold
 *  comes under siege, units beyond five are removed immediately (Regulars first,
 *  then Elites), recycled to reinforcements. Leaders are unlimited. */
export function enforceSiegeCap(state: GameState, id: RegionId): void {
  const r = state.regions[id]!;
  let excess = unitCount(state, id) - SIEGE_LIMIT;
  if (excess <= 0) return;
  const nations = Object.keys(r.units) as Nation[];
  for (const kind of ['regular', 'elite'] as const) {
    for (const n of nations) {
      const u = r.units[n]; if (!u) continue;
      while (excess > 0 && u[kind] > 0) { u[kind] -= 1; state.reinforcements[n][kind] += 1; excess -= 1; }
    }
    if (excess <= 0) break;
  }
}

/** Muster a single Nazgûl into a Sauron Stronghold (the Shadow's "Leader/Nazgûl"
 *  muster figure). Returns false if illegal. */
export function recruitNazgul(state: GameState, id: RegionId): boolean {
  if (!canRecruitNazgul(state, id)) return false;
  const pool = state.reinforcements.sauron as { nazgul: number };
  pool.nazgul -= 1; state.regions[id]!.nazgul += 1;
  log(state, null, 'muster', `Mustered a Nazgûl in ${id}`);
  return true;
}

/** Whether `side` may move the whole Army from `from` to `to` (rules-spec §6, §8).
 *  Shared by moveArmy and the legal-action enumerator so the two never diverge. */
export function canMoveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  return moveBlockReason(state, from, to, side) === null;
}

const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why `side` may NOT move the whole Army from `from` to `to`, or null if the move
 *  is legal. Single source of truth — canMoveArmy and the legal-action enumerator
 *  both derive from this, and the UI surfaces the string so a refused merge/move
 *  explains itself instead of silently doing nothing. Rules: rulebook p.26–27. */
export function moveBlockReason(state: GameState, from: RegionId, to: RegionId, side: Side): string | null {
  if (!REGIONS[from]!.adjacency.includes(to)) return 'Those regions are not adjacent.';
  if (armySide(state, from) !== side) return 'You have no Army to move there.';
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return 'A card effect bars the Shadow from that region.';
  // Enemy units present: that's an attack (handled elsewhere), not a move/merge.
  const occ = armySide(state, to);
  if (occ !== null && occ !== side) {
    const dn = REGIONS[to]!.nation;
    const blockedNation = (Object.keys(state.regions[from]!.units) as Nation[]).find((n) => !isAtWar(state, n) && dn && dn !== n);
    return blockedNation
      ? `Enemy units there, and ${cap1(blockedNation)} is not At War — you can neither attack nor move into that region until ${cap1(blockedNation)} reaches War.`
      : 'Enemy units there — attack the region instead of moving into it.';
  }
  // (RAW siege model: a besieged region's open field holds the BESIEGER under the
  // normal 10-unit limit — joining them is a normal move/merge. The boxed garrison
  // is sealed in its 5-cap siege box and can't be reinforced by movement.)
  // Non-belligerent nations cannot cross another nation's border (rulebook p.27).
  const dn = REGIONS[to]!.nation;
  for (const nation of Object.keys(state.regions[from]!.units) as Nation[]) {
    if (!isAtWar(state, nation) && dn && dn !== nation) {
      return `${cap1(nation)} is not At War — its units cannot enter ${cap1(dn)}'s borders. Advance ${cap1(nation)} to War first (or split off only its At-War units).`;
    }
  }
  return null;
}

/** Move all of a region's Army (with its Leaders/Nazgûl/Characters) to an
 *  adjacent free region; captures an enemy Settlement entered with no defender.
 *  Simplified: moves the whole stack (no splitting yet). */
/** A partial selection of an Army's figures, for a split move (rulebook p.27).
 *  Omitted fields move nothing of that kind; an omitted `sel` entirely moves the
 *  whole Army. */
export interface MoveSelection {
  units?: Partial<Record<Nation, { regular?: number; elite?: number }>>;
  leaders?: number;
  nazgul?: number;
  characters?: string[];
}

/** Validate + apply a SPLIT move: only the selected figures move; the rest stay as
 *  a separate Army (rulebook p.27). Enforces the same movement legality as
 *  canMoveArmy plus the split rules: ≥1 unit moves, FP Leaders can't be left with no
 *  combat units, and (Character-die moves) ≥1 Leader/Character must join the movers. */
export function moveArmySplit(state: GameState, from: RegionId, to: RegionId, side: Side, sel: MoveSelection, viaCharacterDie = false): boolean {
  const src = state.regions[from]!, dst = state.regions[to]!;
  if (!REGIONS[from]!.adjacency.includes(to)) return false;
  if (armySide(state, from) !== side) return false;
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return false;
  if (!freeForMovement(state, to, side)) return false;
  // The selection must be available, and move at least one combat unit.
  let movingUnits = 0;
  for (const [n, u] of Object.entries(sel.units ?? {}) as [Nation, { regular?: number; elite?: number }][]) {
    const have = src.units[n] ?? { regular: 0, elite: 0 };
    const mr = u.regular ?? 0, me = u.elite ?? 0;
    if (mr < 0 || me < 0 || mr > have.regular || me > have.elite) return false;
    movingUnits += mr + me;
  }
  if (movingUnits < 1) return false;
  const movingLeaders = sel.leaders ?? 0, movingNazgul = sel.nazgul ?? 0, chars = sel.characters ?? [];
  if (movingLeaders < 0 || movingLeaders > src.leaders || movingNazgul < 0 || movingNazgul > src.nazgul) return false;
  for (const c of chars) if (!src.characters.includes(c) || characterSide(c) !== side) return false;
  // Only the moving Nations matter for the not-At-War border rule.
  const dn = REGIONS[to]!.nation;
  for (const n of Object.keys(sel.units ?? {}) as Nation[]) if (!isAtWar(state, n) && dn && dn !== n) return false;
  // (RAW siege model: a besieged region's open field is the besieger under the
  // normal 10-unit limit; the boxed garrison can't be reinforced by movement.)
  // FP Leaders can never be in a region with no combat units: if the origin keeps
  // Leaders it must keep ≥1 unit (so a full vacate forces all FP Leaders to follow).
  const remainingUnits = unitCount(state, from) - movingUnits;
  if (side === 'fp' && remainingUnits === 0 && src.leaders - movingLeaders > 0) return false;
  // A Character-die move that splits must take ≥1 Leader/Nazgûl/Character with the
  // movers (a Nazgûl is the Shadow's Leader — same rule as the whole-army move).
  if (viaCharacterDie && movingLeaders === 0 && movingNazgul === 0 && chars.length === 0) return false;
  // Apply.
  for (const [n, u] of Object.entries(sel.units ?? {}) as [Nation, { regular?: number; elite?: number }][]) {
    const have = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    const mr = u.regular ?? 0, me = u.elite ?? 0;
    have.regular -= mr; have.elite -= me; d.regular += mr; d.elite += me; dst.units[n] = d;
    if (have.regular === 0 && have.elite === 0) delete src.units[n];
  }
  src.leaders -= movingLeaders; dst.leaders += movingLeaders;
  src.nazgul -= movingNazgul; dst.nazgul += movingNazgul;
  for (const c of chars) { src.characters.splice(src.characters.indexOf(c), 1); dst.characters.push(c); }
  captureIfEnemySettlement(state, to, side);
  if (dn && sideOfNation(dn) !== side) activateNation(state, dn, { region: to });
  log(state, null, 'army', `Split army ${from} -> ${to} (${movingUnits} unit${movingUnits > 1 ? 's' : ''})`);
  return true;
}

export function moveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  if (!canMoveArmy(state, from, to, side)) return false;
  const src = state.regions[from]!, dst = state.regions[to]!;
  // Merge units, leaders, nazgûl, characters.
  for (const nation of Object.keys(src.units) as Nation[]) {
    const u = src.units[nation]!;
    const d = dst.units[nation] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[nation] = d;
  }
  // Only THIS side's Characters move with its Army; an enemy Character sharing the
  // region (e.g. a stranded Companion under a Shadow Army) stays put.
  const movingChars = src.characters.filter((c) => characterSide(c) === side);
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...movingChars);
  src.units = {}; src.leaders = 0; src.nazgul = 0;
  src.characters = src.characters.filter((c) => characterSide(c) !== side);
  // Capture an undefended enemy Settlement.
  captureIfEnemySettlement(state, to, side);
  // Entering a Nation's region activates that Nation (rules p.34) — covers regions
  // with no Settlement, where capture wouldn't fire.
  const dn = REGIONS[to]!.nation;
  if (dn && sideOfNation(dn) !== side) activateNation(state, dn, { region: to });
  log(state, null, 'army', `Moved army ${from} -> ${to}`);
  return true;
}

/** Units over the 10-unit stacking limit in a (non-besieged) region — these must
 *  be removed by the controlling player after a move/muster (rulebook p.26). */
export function overStack(state: GameState, id: RegionId): number {
  if (state.regions[id]!.besieged) return 0; // besieged garrison is a hard cap, never over-stacks
  return Math.max(0, unitCount(state, id) - STACKING_LIMIT);
}

/** Remove one Army figure (a regular or elite of `nation`) from a region back to
 *  its reinforcement pool — units removed for over-stacking "can re-enter the game
 *  later as reinforcements" (p.26). Returns false if there's no such figure. */
export function removeStackUnit(state: GameState, id: RegionId, nation: Nation, figure: 'regular' | 'elite'): boolean {
  const u = state.regions[id]!.units[nation];
  if (!u || u[figure] < 1) return false;
  u[figure] -= 1;
  if (u.regular === 0 && u.elite === 0) delete state.regions[id]!.units[nation];
  const pool = state.reinforcements[nation] as { regular: number; elite: number };
  pool[figure] += 1;
  log(state, null, 'army', `Removed an over-stacked ${nation} ${figure} from ${id} (over the ${STACKING_LIMIT}-unit limit)`);
  return true;
}

export function captureIfEnemySettlement(state: GameState, id: RegionId, side: Side): void {
  const def = REGIONS[id]!;
  if (!def.settlement) return;
  if (settlementController(state, id) === side) return;
  const owner = def.nation ? sideOfNation(def.nation) : null;
  const enemy: Side = side === 'fp' ? 'shadow' : 'fp';
  if (side === owner) {
    // Recapture by the original owner: remove the Settlement Control marker and
    // reverse the VP the enemy had gained when they captured it (rules p.32).
    state.regions[id]!.control = null;
    if (def.vp > 0) {
      state.victoryPoints[enemy] = Math.max(0, state.victoryPoints[enemy] - def.vp);
      log(state, null, 'army', `${side} recaptured ${id} (−${def.vp} VP from ${enemy}, total ${state.victoryPoints[enemy]})`);
    }
    return;
  }
  // Enemy capture: place the marker and gain VP; the owner's Nation reacts.
  state.regions[id]!.control = side;
  if (def.vp > 0) {
    state.victoryPoints[side] += def.vp;
    log(state, null, 'army', `${side} captured ${id} (+${def.vp} VP, total ${state.victoryPoints[side]})`);
  }
  if (def.nation) onSettlementCaptured(state, def.nation, id);
}
