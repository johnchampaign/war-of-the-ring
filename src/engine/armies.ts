// Armies: composition queries, mustering (recruit), and movement with settlement
// capture (rules-spec §1, §6). Combat is in combat.ts.
import type { GameState, Nation, RegionId, Side, ArmyUnits } from './types';
import { REGIONS, sideOfNation, characterDef } from './data';
import { isAtWar, onSettlementCaptured, activateNation } from './politics';
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
  // Saruman's "Servants of the White Hand": each Isengard Elite is also a Leader.
  if (side === 'shadow' && state.characters.entered.includes('saruman') && !state.characters.eliminated.includes('saruman')) {
    l += r.units.isengard?.elite ?? 0;
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
  if (!REGIONS[from]!.adjacency.includes(to)) return false;
  if (armySide(state, from) !== side) return false;
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return false; // A Power too Great / Tom Bombadil
  if (!freeForMovement(state, to, side)) return false;
  // A besieged Stronghold holds at most 5 units, so reinforcing a siege is capped there.
  const cap = state.regions[to]!.besieged ? SIEGE_LIMIT : STACKING_LIMIT;
  if (unitCount(state, from) + unitCount(state, to) > cap) return false;
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
  for (const c of chars) if (!src.characters.includes(c)) return false;
  // Only the moving Nations matter for the not-At-War border rule.
  const dn = REGIONS[to]!.nation;
  for (const n of Object.keys(sel.units ?? {}) as Nation[]) if (!isAtWar(state, n) && dn && dn !== n) return false;
  const cap = dst.besieged ? SIEGE_LIMIT : STACKING_LIMIT;
  if (unitCount(state, to) + movingUnits > cap) return false;
  // FP Leaders can never be in a region with no combat units: if the origin keeps
  // Leaders it must keep ≥1 unit (so a full vacate forces all FP Leaders to follow).
  const remainingUnits = unitCount(state, from) - movingUnits;
  if (side === 'fp' && remainingUnits === 0 && src.leaders - movingLeaders > 0) return false;
  // A Character-die move that splits must take ≥1 Leader/Character with the movers.
  if (viaCharacterDie && movingLeaders === 0 && chars.length === 0) return false;
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
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
  src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
  // Capture an undefended enemy Settlement.
  captureIfEnemySettlement(state, to, side);
  // Entering a Nation's region activates that Nation (rules p.34) — covers regions
  // with no Settlement, where capture wouldn't fire.
  const dn = REGIONS[to]!.nation;
  if (dn && sideOfNation(dn) !== side) activateNation(state, dn, { region: to });
  log(state, null, 'army', `Moved army ${from} -> ${to}`);
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
