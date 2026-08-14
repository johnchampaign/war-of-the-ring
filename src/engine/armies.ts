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

/** Saruman's "Servants of the White Hand": while he is in play, "each Isengard Elite
 *  unit is considered to be a Leader as well as an Army unit for ALL movement and
 *  combat purposes" (card text). So an Isengard Elite is a Leader for the
 *  Character-die army action too, not just for the Leader re-roll. */
export const whiteHandActive = (state: Pick<GameState, 'characters'>): boolean =>
  state.characters.entered.includes('saruman') && !state.characters.eliminated.includes('saruman');

/** Loose Force shape — a region, a siege box, or a rearguard/move selection. */
type FigureSet = { units: Partial<Record<string, { regular?: number; elite?: number }>>; leaders: number; nazgul: number; characters: string[] };

/** How many figures in `f` satisfy the Character-die requirement that the Army
 *  "contain at least one Leader or Character" (p.28).
 *
 *  `forAttack` matters for Saruman only: he can never leave Orthanc, so he cannot be
 *  the figure that joins a Character-die MOVE — but an attack is different, because
 *  "attacking units do not actually move into the region they are attacking" (p.28),
 *  so a Character present in the attacking Army leads it whether he can march or not.
 *  (Player report: an Orthanc army with Saruman and two Isengard Elites was refused a
 *  Character-die attack. The Elites alone are Leaders, so it was refusable twice over.) */
export function charDieLeaders(state: Pick<GameState, 'characters'>, f: FigureSet, side: Side, forAttack: boolean): number {
  const chars = f.characters.filter((c) => characterSide(c) === side && (forAttack || c !== 'saruman'));
  const whiteHand = side === 'shadow' && whiteHandActive(state) ? (f.units.isengard?.elite ?? 0) : 0;
  return (side === 'fp' ? f.leaders : f.nazgul) + chars.length + whiteHand;
}

/** The Leader figures that belong to a side: FP Leaders for the Free Peoples,
 *  Nazgûl for the Shadow. */
type LeaderPool = { leaders: number; nazgul: number };

/** Move only the Leaders/Nazgûl belonging to `side` between two Forces, leaving the
 *  enemy's behind. Leaders and Nazgûl are NOT Army units, so a region holding only
 *  Nazgûl is still "free" and a Free Peoples Army may legally march in — but it must
 *  not carry them off when it leaves again. Every whole-stack mover (army move,
 *  post-battle advance, retreat, card-driven move) previously merged both pools
 *  wholesale, which let Nazgûl ride along inside Free Peoples Armies and, mirrored,
 *  stranded FP Leaders inside Shadow ones (player report: "in some cases Nazgûl can
 *  be moved as part of Free Peoples armies"). */
export function moveOwnLeaders(side: Side, src: LeaderPool, dst: LeaderPool): void {
  if (side === 'fp') { dst.leaders += src.leaders; src.leaders = 0; }
  else { dst.nazgul += src.nazgul; src.nazgul = 0; }
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
  // "Free Peoples Leaders can never be in a region without Free Peoples Army units"
  // (p.26). The movement paths enforce this (moveArmySplit, moveSelectedUnits) but
  // the MUSTER path did not, so a Leader could be recruited alone into an empty
  // friendly Settlement (player report). Nazgûl are NOT restricted this way — the
  // rule names Free Peoples Leaders — so this gate is FP-only.
  if (side === 'fp' && leader > 0 && unitCount(state, id) + regular + elite === 0) return false;
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

/** Why `side` may NOT muster in the Settlement at `id`, or null if it can. Mirrors
 *  the gates in `recruit`/`recruitRegions`; the UI surfaces the string when a player
 *  clicks one of their own Settlements and no muster is on offer, so a refusal
 *  explains itself instead of looking like a bug. A player reported "I can't muster
 *  in Lorien while it is empty" — every rule that can stop you there is invisible on
 *  the board (the Nation's Political Track position, an enemy Control marker left
 *  behind by a capture, an exhausted reinforcement pool), so the game now says which.
 *  Rulebook p.26–27. Returns null for regions that are none of `side`'s business. */
export function musterBlockReason(state: GameState, id: RegionId, side: Side): string | null {
  const def = REGIONS[id]; if (!def) return null;
  const name = def.name ?? id;
  if (def.settlement === 'Fortification') {
    return `${name} is a Fortification, not a Settlement — troops can never be mustered there (p.26).`;
  }
  const nation = def.nation;
  if (!def.settlement || !nation || sideOfNation(nation) !== side) return null; // not yours to muster in
  if (settlementController(state, id) !== side) {
    return `${name} is under enemy control — you cannot muster in a Settlement the enemy controls (p.27). Retake it first.`;
  }
  if (armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp')) return `There is an enemy Army in ${name}.`;
  if (state.regions[id]!.besieged) return `${name} is under siege — no troops can be mustered into a besieged Stronghold (p.27).`;
  if (!isAtWar(state, nation)) {
    return `${cap1(nation)} is not At War, so it cannot muster (p.26). Advance ${cap1(nation)} to “At War” on the Political Track first.`;
  }
  if (unitCount(state, id) >= STACKING_LIMIT) return `${name} already holds ${STACKING_LIMIT} Army units — the stacking limit (p.26).`;
  const pool = state.reinforcements[nation] as { regular: number; elite: number };
  if (pool.regular < 1 && pool.elite < 1) {
    return `${cap1(nation)} has no units left in reinforcements — every figure is already on the board or lost (p.27).`;
  }
  return null;
}

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
  const movingLeaders = sel.leaders ?? 0, movingNazgul = sel.nazgul ?? 0;
  // Saruman cannot leave Orthanc (character card) — silently drop him from the movers
  // rather than rejecting the whole move, so he simply holds.
  const chars = (sel.characters ?? []).filter((c) => c !== 'saruman');
  if (movingLeaders < 0 || movingLeaders > src.leaders || movingNazgul < 0 || movingNazgul > src.nazgul) return false;
  // A split may only take the mover's OWN Leader figures: FP Leaders for the Free
  // Peoples, Nazgûl for the Shadow. Without this an FP split could name the Nazgûl
  // sharing its region and march off with them (see moveOwnLeaders).
  if (side === 'fp' ? movingNazgul > 0 : movingLeaders > 0) return false;
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
  // movers (a Nazgûl is the Shadow's Leader — same rule as the whole-army move; a
  // moving Isengard Elite is a Leader too while Saruman is in play).
  const movingSel = { units: sel.units ?? {}, leaders: movingLeaders, nazgul: movingNazgul, characters: chars };
  if (viaCharacterDie && charDieLeaders(state, movingSel, side, false) < 1) return false;
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
  liftSiegeIfAbandoned(state, from); // a besieger that vacates the field lifts the siege
  if (dn && sideOfNation(dn) !== side) activateNation(state, dn, { region: to });
  log(state, null, 'army', `Split army ${from} -> ${to} (${movingUnits} unit${movingUnits > 1 ? 's' : ''})`);
  return true;
}

export function moveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  if (!canMoveArmy(state, from, to, side)) return false;
  const src = state.regions[from]!, dst = state.regions[to]!;
  // Merge units, leaders, nazgûl, characters. Only THIS side's Nations move — if
  // enemy units ever illegally share the region (a card bug once merged two Armies),
  // a whole-army move must not carry them off (report: "Gondor stole my Southron Army").
  for (const nation of Object.keys(src.units) as Nation[]) {
    if (sideOfNation(nation) !== side) continue;
    const u = src.units[nation]!;
    const d = dst.units[nation] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[nation] = d;
    delete src.units[nation];
  }
  // Only THIS side's Characters move with its Army; an enemy Character sharing the
  // region (e.g. a stranded Companion under a Shadow Army) stays put. Saruman never
  // leaves Orthanc (character card: "Saruman cannot leave Orthanc"), so he holds too.
  const movingChars = src.characters.filter((c) => characterSide(c) === side && c !== 'saruman');
  moveOwnLeaders(side, src, dst); dst.characters.push(...movingChars);
  src.characters = src.characters.filter((c) => !movingChars.includes(c));
  // Capture an undefended enemy Settlement.
  captureIfEnemySettlement(state, to, side);
  liftSiegeIfAbandoned(state, from); // a besieger that vacates the field lifts the siege
  // Entering a Nation's region activates that Nation (rules p.34) — covers regions
  // with no Settlement, where capture wouldn't fire.
  const dn = REGIONS[to]!.nation;
  if (dn && sideOfNation(dn) !== side) activateNation(state, dn, { region: to });
  log(state, null, 'army', `Moved army ${from} -> ${to}`);
  return true;
}

/** State repair: no legal play ever leaves units of BOTH sides in one region's
 *  open field (a besieged garrison lives in the siege box, never in `units`) —
 *  such a mix can only come from a bug (Corsairs of Umbar once merged an attack
 *  instead of fighting it, and whole-army moves then dragged the enemy's units
 *  along). Run from advance() after every action: the Army the engine already
 *  treats as the region's owner (armySide) stays; the stranded side's units leave
 *  the board the same way casualties do (Shadow units back to reinforcements, FP
 *  units removed), so an already-corrupted save heals on its next action. */
export function sweepStrandedUnits(state: GameState): void {
  for (const id of Object.keys(state.regions)) {
    const r = state.regions[id]!;
    const owner = armySide(state, id);
    // "Free Peoples Leaders can never be in a region without Free Peoples Army units"
    // (p.26) — a Leader left alone is removed. The movement and muster paths all refuse
    // to create that state, but any effect that REMOVES the region's last Free Peoples
    // unit leaves the Leaders standing: Stormcrow's "lose one unit of that Nation" was
    // caught doing exactly this in the soak, and every sibling card loss has the same
    // shape. On the map a lone Leader draws a Free Peoples Army badge over a region the
    // inspector correctly reports as empty — the player report "an army is displayed on
    // the map, but hovering says it's a free region without the army".
    // The old check ran only under a SHADOW Army, and the `!owner` guard below skipped
    // EMPTY regions entirely, which is the very case that renders as a phantom Army.
    // A besieged garrison keeps its Leaders in the siege box, so check there too before
    // removing any — the box is where a besieged Nation's Leaders legitimately live.
    if (r.leaders > 0 && owner !== 'fp' && !forceHasFpUnits(r.siegeBox)) {
      log(state, null, 'army', `${r.leaders} stranded Free Peoples Leader(s) in ${id} are removed — a Leader can never be alone (p.26)`);
      r.leaders = 0;
    }
    if (!owner) continue;
    for (const n of Object.keys(r.units) as Nation[]) {
      const u = r.units[n]!;
      if (sideOfNation(n) === owner || u.regular + u.elite === 0) continue;
      // DO NOT delete: this sweep exists to repair a corrupted save, but a mixed
      // region can also be a legitimate engine bug in progress, and deleting is
      // irreversible — FP units never come back. It once destroyed three real
      // Dwarven units when a siege-lift merged a garrison under an enemy army
      // (fixed in liftSiegeIfAbandoned). Report it and leave the board alone; the
      // movers all filter by side now, so a mix can no longer spread.
      log(state, null, 'army', `⚠ ${u.regular + u.elite} ${n} unit(s) share ${id} with an enemy Army — this should be impossible; please report it`);
    }
  }
}

/** Does this Force (a siege box, possibly absent) hold any Free Peoples Army units? */
function forceHasFpUnits(f: Force | undefined): boolean {
  if (!f) return false;
  for (const n of Object.keys(f.units) as Nation[]) {
    const u = f.units[n]!;
    if (sideOfNation(n) === 'fp' && u.regular + u.elite > 0) return true;
  }
  return false;
}

/** Units over the 10-unit stacking limit in a (non-besieged) region — these must
 *  be removed by the controlling player after a move/muster (rulebook p.26). */
export function overStack(state: GameState, id: RegionId): number {
  // A besieged region has TWO stacks and they are capped separately: the boxed
  // GARRISON by the 5-unit siege limit (enforceSiegeCap), and the BESIEGER standing in
  // the open field by the normal 10 (p.32 — the open field is an ordinary Army). This
  // used to bail out for any besieged region, exempting the besieger entirely, so a
  // besieging stack could grow past 10 and attack with 11+ units (player report: "the
  // enemy attacked with 11 or more units… in every case those were sieges"). Note
  // unitCount reads r.units, which during a siege IS the besieger — the garrison lives
  // in r.siegeBox and is never counted here.
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

export function captureIfEnemySettlement(state: GameState, id: RegionId, side: Side, viaAttack = false): void {
  const def = REGIONS[id]!;
  if (!def.settlement) return;
  // A Stronghold under siege is still held by its boxed garrison — walking a second
  // (reinforcing) Army into the besieger's region must NOT capture it. Doing so set
  // the control marker early, so the real storm later found the Settlement already
  // "ours" and awarded no VP (player report: "Elves take Moria but no VP"). The
  // legitimate capture in finishCombat deletes the box first, so it still fires.
  // Keyed on a LIVE garrison, not the `besieged` flag: a stale flag with no box must
  // still fall through to the recapture branch below, which clears it.
  const garrison = state.regions[id]!.siegeBox;
  if (garrison && forceUnitCount(garrison) > 0) return;
  if (settlementController(state, id) === side) return;
  const owner = def.nation ? sideOfNation(def.nation) : null;
  const enemy: Side = side === 'fp' ? 'shadow' : 'fp';
  if (side === owner) {
    // Recapture by the original owner: remove the Settlement Control marker and
    // reverse the VP the enemy had gained when they captured it (rules p.32). Also
    // clear any stale siege state — a Settlement you've just retaken can't still be
    // "besieged by the enemy", and a lingering flag wrongly blocks mustering there
    // (player report: couldn't muster in a liberated Helm's Deep).
    state.regions[id]!.control = null;
    state.regions[id]!.besieged = false;
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
  // A Fortification (Fords of Isen, Osgiliath) is NOT a Settlement, so capturing it
  // never advances the owning Nation's political track (rulebook p.36).
  if (def.nation && def.settlement !== 'Fortification') onSettlementCaptured(state, def.nation, id, viaAttack);
}

/** A siege ends the instant the besieger leaves the region's open field. If `id` is a
 *  besieged region whose field no longer holds a besieging (enemy) Army, lift the
 *  siege: the boxed garrison returns to the open field (rulebook p.51). Called after
 *  any operation that may vacate a region. No-op unless a siege was actually abandoned. */
export function liftSiegeIfAbandoned(state: GameState, id: RegionId): void {
  const r = state.regions[id]!;
  if (!r.besieged || !r.siegeBox) return;
  // Read the garrison's side from the BOX ITSELF, never from who controls the
  // Settlement: control flips when a Stronghold is captured, and inferring from it
  // then gets besieger/garrison exactly backwards — the box was merged into a field
  // still held by the enemy, producing a region with BOTH sides' units (soak: a
  // Dwarven garrison merged under a Shadow army in Erebor).
  let garrison: Side | null = null;
  for (const n of Object.keys(r.siegeBox.units) as Nation[]) {
    const u = r.siegeBox.units[n]!;
    if (u.regular + u.elite > 0) { garrison = sideOfNation(n); break; }
  }
  if (garrison === null) { delete r.siegeBox; r.besieged = false; return; } // empty box: nothing to return
  const besieger: Side = garrison === 'fp' ? 'shadow' : 'fp';
  if (armySide(state, id) === besieger) return; // besieger still holds the field — siege continues
  mergeForceInto(state, id, r.siegeBox);
  delete r.siegeBox; r.besieged = false;
  log(state, null, 'combat', `the siege of ${REGIONS[id]!.name ?? id} is lifted — its garrison returns to the field`);
}

/** The region where `char` stands WITH an Army of `side`, or null. A besieged
 *  Character is with his Army inside the Stronghold, so the siege box counts — the
 *  region's open field belongs to the besieger there, and asking `armySide` alone
 *  reports the enemy (player report: "The Last Battle" was refused with Aragorn
 *  holding Minas Morgul under siege). */
export function characterWithArmy(state: GameState, char: string, side: Side): RegionId | null {
  const id = state.characters.inPlay[char];
  if (!id) return null;
  const r = state.regions[id]; if (!r) return null;
  if (r.siegeBox?.characters.includes(char)) {
    return forceUnitCount(r.siegeBox) > 0 && forceSide(r.siegeBox) === side ? id : null;
  }
  return armySide(state, id) === side ? id : null;
}
/** Which side's units make up a Force (siege box or region), if any. */
function forceSide(f: Force): Side | null {
  for (const n of Object.keys(f.units) as Nation[]) {
    if ((f.units[n]!.regular + f.units[n]!.elite) > 0) return sideOfNation(n);
  }
  return null;
}

/** State repair: rebuild `characters.inPlay` from where the figures actually are.
 *  `regions[].characters` (plus a besieged Stronghold's `siegeBox`) is the truth; the
 *  `inPlay` map is only an index — but Army moves, splits, post-battle advances and
 *  retreats all carry Characters along by editing the region arrays, and several of
 *  those paths never refreshed the index. A stale index is invisible on the board and
 *  then quietly breaks whatever reads it: "The Last Battle" refused to play with
 *  Aragorn besieged in Minas Morgul because the index still said Minas Tirith (player
 *  report). Runs from advance() after every action, BEFORE the on-table card sweep
 *  that reads it. Only rewrites entries for Characters actually found on the map —
 *  Companions inside the Fellowship are indexed elsewhere and must not be touched. */
export function reindexBoardCharacters(state: GameState): void {
  for (const id of Object.keys(state.regions)) {
    const r = state.regions[id]!;
    for (const c of r.characters) if (state.characters.inPlay[c] !== id) state.characters.inPlay[c] = id;
    for (const c of r.siegeBox?.characters ?? []) if (state.characters.inPlay[c] !== id) state.characters.inPlay[c] = id;
  }
}

/** Merge a Force's figures INTO a region, additively.
 *  A returning garrison MUST be merged, never assigned: the open field can already
 *  hold friendly figures (the besieger having left, or a stale `besieged` flag with
 *  friendly units walked back in), and `r.units = box.units` silently deletes them.
 *  That was a real units-vanishing bug — a split move that left a one-unit garrison
 *  behind in a stale-besieged Stronghold saw that unit overwritten by the returning
 *  box, along with any Leaders standing with it. */
export function mergeForceInto(state: GameState, id: RegionId, f: Force): void {
  const r = state.regions[id]!;
  for (const n of Object.keys(f.units) as Nation[]) {
    const u = f.units[n]!;
    if (u.regular + u.elite === 0) continue;
    const d = r.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; r.units[n] = d;
  }
  r.leaders += f.leaders; r.nazgul += f.nazgul;
  for (const c of f.characters) if (!r.characters.includes(c)) r.characters.push(c);
}
