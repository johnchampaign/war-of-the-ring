// Armies: composition queries, mustering (recruit), and movement with settlement
// capture (rules-spec §1, §6). Combat is in combat.ts.
import type { GameState, Nation, RegionId, Side, ArmyUnits } from './types';
import { FP_NATIONS } from './types';
import { REGIONS, sideOfNation, characterDef, characterSide, nationName, COMPANIONS } from './data';
import { isAtWar, onSettlementCaptured, activateNation } from './politics';
import { shadowBarredFromRegion } from './persistent';
import { log } from './log';

export const STACKING_LIMIT = 10;

/** A side's NAME for log text — never its id ("Free Peoples captured Minas Morgul",
 *  not "fp captured Minas Morgul"; player report 252i1t0s6j6b6o5y). */
const sideLabel = (s: Side): string => (s === 'fp' ? 'Free Peoples' : 'Shadow');

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

/** Leadership = Leaders/Nazgûl + Character leadership ratings present. NOT capped: the
 *  five-dice limit is on the Leader re-roll (p.28), so it is applied at the roll, after
 *  forfeits and penalties (player report: Leadership 6 minus a forfeited point showed 5
 *  but re-rolled only 4, because the cap had already cut 6 to 5 before the forfeit). */
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
  return l;
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

/** A FREE REGION for `side` (p.10) — stricter than "free for the purposes of Army
 *  movement": no enemy Army AND no enemy-controlled Settlement. "A region containing a
 *  Stronghold controlled by the enemy is also free for a player when the Stronghold is
 *  besieged by an Army of that player" (p.10) — when besieged, the garrison sits in the
 *  siege box and OUR Army holds the open field.
 *
 *  Army MOVEMENT may enter an empty enemy Settlement; a RETREAT may not (Almanac,
 *  "Appendix: Moving and Retreating": "A Free Peoples Army in Dimrill Dale may not
 *  retreat into an empty and uncaptured Moria … or into an empty and captured Lórien").
 *  Retreats used the movement test, so an enemy-held Settlement was offered as a
 *  retreat destination (player report 5u4q1y0m5o1y6l4m: Westemnet). */
export function freeRegion(state: GameState, id: RegionId, side: Side): boolean {
  if (!freeForMovement(state, id, side)) return false;
  const ctrl = settlementController(state, id);
  if (ctrl === null || ctrl === side) return true;
  return !!state.regions[id]!.besieged && armySide(state, id) === side;
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
  // Can't MUSTER troops into a Stronghold besieged by the enemy (rulebook p.26).
  // Event-card recruits (ignoreAtWar) may, per p.28 — they land in the siege box.
  const besiegedHere = !!state.regions[id]!.besieged;
  if (!opts.ignoreAtWar && besiegedHere) return false;
  const dest = opts.ignoreAtWar ? eventRecruitTarget(state, id, side) : null;
  if (!dest && armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp')) return false;
  if (opts.ignoreAtWar && !dest) return false;
  const into: Force = dest ? dest.force : state.regions[id]!;
  const limit = dest ? dest.limit : STACKING_LIMIT;
  const pool = state.reinforcements[nation] as { regular: number; elite: number; leader?: number };
  const leader = opts.leader ?? 0;
  if (regular > pool.regular || elite > pool.elite || leader > (pool.leader ?? 0)) return false;
  if (forceUnitCount(into) + regular + elite > limit) return false;
  // "Free Peoples Leaders can never be in a region without Free Peoples Army units"
  // (p.26). The movement paths enforce this (moveArmySplit, moveSelectedUnits) but
  // the MUSTER path did not, so a Leader could be recruited alone into an empty
  // friendly Settlement (player report). Nazgûl are NOT restricted this way — the
  // rule names Free Peoples Leaders — so this gate is FP-only.
  if (side === 'fp' && leader > 0 && forceUnitCount(into) + regular + elite === 0) return false;
  pool.regular -= regular; pool.elite -= elite;
  const u: ArmyUnits = into.units[nation] ?? { regular: 0, elite: 0 };
  u.regular += regular; u.elite += elite;
  into.units[nation] = u;
  if (leader > 0) { pool.leader = (pool.leader ?? 0) - leader; into.leaders += leader; }
  log(state, null, 'muster', `Recruited ${regular}R/${elite}E${leader ? `/${leader}L` : ''} ${nation} in ${id}`);
  return true;
}

/** A region where the Shadow may muster a Nazgûl: a free (no FP Army) Sauron
 *  Stronghold the Shadow controls (rules-spec §6, "Nazgûl are always recruited in
 *  the Strongholds of the Sauron Nation"). */
export function canRecruitNazgul(state: GameState, id: RegionId): boolean {
  const def = REGIONS[id]!;
  if (def.nation !== 'sauron' || def.settlement !== 'Stronghold') return false;
  // p.26: reinforcements are recruited only in a Settlement of a Nation that is "At
  // War". Nazgûl are Sauron Leaders, so the Muster die can place one only once Sauron
  // is At War — the gate `recruit()` already applies to every other figure, and this
  // path was simply missing it (player report 1f2q456i4h3b470x).
  if (!isAtWar(state, 'sauron')) return false;
  if (settlementController(state, id) !== 'shadow') return false;
  if (armySide(state, id) === 'fp' || state.regions[id]!.besieged) return false;
  return (state.reinforcements.sauron as { nazgul?: number }).nazgul! > 0;
}

/** Where an EVENT-CARD recruit for `side` lands in `id`, and the stacking limit that
 *  applies there — or null if `side` may not recruit there at all.
 *
 *  Rulebook p.28 ("Using an Event card to recruit troops"): a card may recruit into a
 *  region even if "the region includes a Stronghold under siege". Our siege model puts
 *  the BESIEGER in the region's open field (`units`) and the garrison in `siegeBox`, so
 *  which stack the figures join depends on who is recruiting:
 *   - the besieged garrison recruits INTO the Stronghold (the box), capped at five
 *     Army units (p.31);
 *   - the besieger recruits into the open field, which p.33 says "is considered free
 *     for the besieging player", under the normal 10-unit limit.
 *  The Almanac confirms both directions ("It is possible for the Free Peoples to
 *  recruit by a card at a Stronghold … when a Free Peoples Army is under siege inside
 *  a Stronghold"). Without this, `recruitable`/`placeUnits` read the besieger's stack
 *  for both sides, so Imrahil of Dol Amroth and Celeborn's Galadhrim were unplayable
 *  while their Stronghold was besieged and Olog-hai could not reinforce a siege
 *  (player reports).
 *
 *  DEVIATION: the Almanac lets you over-recruit past the five-unit siege cap and then
 *  choose which units to remove (a way to trade Regulars for Elites); we simply cap the
 *  recruit at five. Noted in docs/rules-spec.md. */
export function eventRecruitTarget(state: GameState, id: RegionId, side: Side): { force: Force; limit: number } | null {
  const r = state.regions[id];
  if (!r) return null;
  const box = r.siegeBox;
  if (!r.besieged || !box || forceUnitCount(box) === 0) {
    return armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp') ? null : { force: r, limit: STACKING_LIMIT };
  }
  if (forceSide(box) === side) return { force: box, limit: SIEGE_LIMIT };   // the garrison
  if (armySide(state, id) === side) return { force: r, limit: STACKING_LIMIT }; // the besieger
  return null;
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
    return `${nationName(nation)} is not At War, so it cannot muster (p.26). Advance ${nationName(nation)} to “At War” on the Political Track first.`;
  }
  if (unitCount(state, id) >= STACKING_LIMIT) return `${name} already holds ${STACKING_LIMIT} Army units — the stacking limit (p.26).`;
  const pool = state.reinforcements[nation] as { regular: number; elite: number };
  if (pool.regular < 1 && pool.elite < 1) {
    return `${nationName(nation)} has no units left in reinforcements — every figure is already on the board or lost (p.27).`;
  }
  return null;
}

/** Why `side` may NOT move the whole Army from `from` to `to`, or null if the move
 *  is legal. Single source of truth — canMoveArmy and the legal-action enumerator
 *  both derive from this, and the UI surfaces the string so a refused merge/move
 *  explains itself instead of silently doing nothing. Rules: rulebook p.26–27. */
/** Hop count between two regions over adjacency (Infinity if unreachable). Memoised:
 *  adjacency is a property of the map, never of the game. */
const hopMemo = new Map<string, number>();
export function regionHops(from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const key = `${from}|${to}`;
  const hit = hopMemo.get(key);
  if (hit !== undefined) return hit;
  const seen = new Set([from]);
  let layer: string[] = [from], d = 0;
  while (layer.length) {
    d++;
    const next: string[] = [];
    for (const r of layer) for (const n of REGIONS[r]?.adjacency ?? []) {
      if (seen.has(n)) continue;
      if (n === to) { hopMemo.set(key, d); return d; }
      seen.add(n); next.push(n);
    }
    layer = next;
  }
  hopMemo.set(key, Infinity);
  return Infinity;
}

/** Why this multi-region card route is illegal, or null if it is fine.
 *
 *  A card that moves an Army "through more than one region" traverses each one, and
 *  p.27 governs every step, not just the landing: "Any region entered by a moving
 *  Army must be either a free region or an enemy-controlled Settlement that is free
 *  of enemy Army units", and a Nation not yet At War may not cross another Nation's
 *  borders. `movingNations` are the Nations actually travelling (a split may leave
 *  the not-At-War half behind), which is why this cannot just call moveBlockReason
 *  per step — that reads the units sitting in each region on the way. */
export function cardPathBlockReason(state: GameState, from: RegionId, path: readonly RegionId[], side: Side, movingNations: readonly Nation[], maxSteps?: number): string | null {
  if (!path.length) return 'That route has no steps.';
  // A route may WALK BACK through a region it has already entered — nothing in p.27
  // forbids it, and the only restriction the Almanac places on a card move's shape is
  // that it "cannot end movement in the region that it started from" (which the
  // enumerators enforce by never offering from === to). Refusing a revisit outright
  // made legal detours untraceable (player report 306c5v2g003c6332). `maxSteps` is the
  // card's own allowance ("up to three regions") and is what bounds the route now.
  if (maxSteps !== undefined && path.length > maxSteps) return `That route is ${path.length} regions long — this card moves up to ${maxSteps}.`;
  let prev = from;
  for (const r of path) {
    if (!REGIONS[prev]?.adjacency.includes(r)) return `${cap1(REGIONS[prev]?.name ?? prev)} and ${cap1(REGIONS[r]?.name ?? r)} are not adjacent.`;
    if (side === 'shadow' && shadowBarredFromRegion(state, r)) return `A card effect bars the Shadow from ${REGIONS[r]?.name ?? r}.`;
    const occ = armySide(state, r);
    if (occ !== null && occ !== side) return `${REGIONS[r]?.name ?? r} holds an enemy Army — an Army may not move through one.`;
    const dn = REGIONS[r]?.nation;
    for (const nation of movingNations) {
      if (!isAtWar(state, nation) && dn && dn !== nation) {
        return `${nationName(nation)} is not At War — its units cannot enter another Nation's borders (${REGIONS[r]?.name ?? r}).`;
      }
    }
    prev = r;
  }
  return null;
}

/** A legal route of at most `maxSteps` from→to, preferring one that ENTERS NO enemy
 *  Settlement. Entering one captures it and wakes its Nation (p.27/p.32), which is a
 *  decision, not a side effect — so when the player has not traced a route the quiet
 *  way round is taken, and only a route with no alternative captures anything. */
export function quietCardPath(state: GameState, from: RegionId, to: RegionId, side: Side, movingNations: readonly Nation[], maxSteps: number): RegionId[] {
  const enemy: Side = side === 'fp' ? 'shadow' : 'fp';
  const wakes = (r: RegionId) => r !== to && !!REGIONS[r]?.settlement && REGIONS[r]!.settlement !== 'Fortification' && settlementController(state, r) === enemy;
  const passable = (r: RegionId) => !cardStepBlocked(state, r, side, movingNations);
  // Layered DP over step count, fewest captures first then fewest steps — the same
  // shape as the Fellowship's route (see fellowship.ts), for the same reason.
  const layers: Array<Map<string, { cost: number; prev: string | null }>> = [new Map([[from, { cost: 0, prev: null }]])];
  for (let k = 1; k <= Math.min(maxSteps, 12); k++) {
    const prevLayer = layers[k - 1]!, cur = new Map<string, { cost: number; prev: string | null }>();
    for (const [r, node] of prevLayer) {
      for (const n of REGIONS[r]?.adjacency ?? []) {
        if (!passable(n as RegionId)) continue;
        const cost = node.cost + (wakes(n as RegionId) ? 1 : 0);
        const seen = cur.get(n);
        if (!seen || cost < seen.cost) cur.set(n, { cost, prev: r });
      }
    }
    layers.push(cur);
  }
  let bestK = -1, bestCost = Infinity;
  for (let k = 1; k < layers.length; k++) {
    const hit = layers[k]!.get(to);
    if (hit && hit.cost < bestCost) { bestCost = hit.cost; bestK = k; }
  }
  if (bestK < 0) return [];
  const out: RegionId[] = [];
  let cur: string = to;
  for (let k = bestK; k >= 1; k--) { out.unshift(cur as RegionId); cur = layers[k]!.get(cur)!.prev!; }
  return out;
}

/** May an Army of `nations` STEP INTO `r` on a card move? One step of the rule
 *  `cardPathBlockReason` applies to a whole route: no enemy Army in the way, no
 *  card effect barring the Shadow, and no Nation crossing another's borders before
 *  it is At War.
 *
 *  `anyNation` asks the PERMISSIVE version of the last test — p.28 lets an Army split
 *  before a card move, so a mixed stack could in principle send only its At-War half,
 *  and a step barred to one travelling Nation is still open to another. Leaving it
 *  false asks the strict question — every named Nation must be able to enter.
 *
 *  **The ranged card-move enumerators ask the STRICT question**, because the target
 *  they emit is submitted as a whole-Army move: the split (`move`) is an optional
 *  decoration the player adds afterwards, and "move everything" in the picker is the
 *  bare action. Offering a destination only part of the stack could reach meant the
 *  engine refused a move it had itself just offered — for the AI and for a player who
 *  clicked it alike (soak 2026-09-20: Trollshaws → North Dunland, an FP stack whose
 *  not-At-War half could not cross into Isengard). The cost is that a mixed stack can
 *  no longer be offered a destination that ONLY its At-War half can reach; making that
 *  play available again needs the split to be expressible in the offer itself, which
 *  is a design question of its own rather than a flag. */
export function cardStepBlocked(state: GameState, r: RegionId, side: Side, nations: readonly Nation[], anyNation = false): boolean {
  if (side === 'shadow' && shadowBarredFromRegion(state, r)) return true;
  const occ = armySide(state, r);
  if (occ !== null && occ !== side) return true;
  const dn = REGIONS[r]?.nation;
  const barred = (n: Nation) => !isAtWar(state, n) && !!dn && dn !== n;
  if (!nations.length) return false;
  return anyNation ? nations.every(barred) : nations.some(barred);
}

/** Every region an Army of `nations` can legally REACH from `from` in 1..`maxSteps`
 *  card-move steps, mapped to the fewest steps that get there.
 *
 *  The move cards that state a range — Shadows Gather, The Shadow Lengthens, Through
 *  a Day and a Night — all carry the same clause: "the traversed regions must be free
 *  for the purposes of Army movement". Their enumerators used to measure a plain
 *  region-step DISTANCE over the bare map instead, so they offered moves whose route
 *  did not exist: an Army walled in behind an enemy Army was listed as a source and a
 *  destination (player report 4e6f6u1a5y3q381q — Helm's Deep, whose only ways out are
 *  the Fords of Isen and Westemnet, offered as an origin for a hop to Orthanc), and a
 *  Free Peoples Army walked Lórien → Moria straight through the Shadow units standing
 *  in between (player report y1hvvsejg6wgibm0). Distance is not reach; this is. */
export function cardMoveReach(state: GameState, from: RegionId, side: Side, nations: readonly Nation[], maxSteps: number, anyNation = true): Map<RegionId, number> {
  const out = new Map<RegionId, number>();
  let layer: RegionId[] = [from];
  const seen = new Set<string>([from]);
  for (let d = 1; d <= maxSteps && layer.length; d++) {
    const next: RegionId[] = [];
    for (const r of layer) {
      for (const a of (REGIONS[r]?.adjacency ?? []) as RegionId[]) {
        if (seen.has(a)) continue;
        if (cardStepBlocked(state, a, side, nations, anyNation)) continue;
        seen.add(a); out.set(a, d); next.push(a);
      }
    }
    layer = next;
  }
  out.delete(from); // a card move "cannot end movement in the region that it started from"
  return out;
}

/** The Nations of `side` with units standing in `region` — who would be travelling
 *  if this Army made a card move. */
export function ownNationsIn(state: GameState, region: RegionId, side: Side): Nation[] {
  const u = state.regions[region]?.units ?? {};
  return (Object.keys(u) as Nation[]).filter((n) => sideOfNation(n) === side && (u[n]!.regular + u[n]!.elite) > 0);
}

/** The Nations of `side` with units in `from` whose figures MAY cross into `to`
 *  (p.27: a Nation not At War never crosses another Nation's border). */
export function nationsAllowedInto(state: GameState, from: RegionId, to: RegionId, side: Side): Nation[] {
  const dn = REGIONS[to]?.nation;
  return ownNationsIn(state, from, side).filter((n) => isAtWar(state, n) || !dn || dn === n);
}

/** Why NOT EVEN PART of `side`'s Army in `from` may move to `to`, or null when at
 *  least its At-War half can go.
 *
 *  p.27 lets a player move "all or some of the units" of an Army, so a stack whose
 *  Nations sit on different Political Track steps is not frozen in place: the units
 *  that are At War march, the rest stay behind as their own Army. The destination
 *  enumerator used to ask the STRICT question (`moveBlockReason`, which speaks for
 *  the whole stack), so a mixed Army was offered no destination at all across a
 *  foreign border — the board went dark and the only hint told the player to "split
 *  off only its At-War units", which is not a thing the move interface can be asked
 *  for until a destination has been picked (player report 615m5q0t090g205d: an Army
 *  in Vale of the Carnen with the Elves At War and the North still passive could not
 *  be moved into East Rhun at all). The offer is the permissive question now; the
 *  strict one is applied to whoever actually goes, when the move lands. */
export function partialMoveBlockReason(state: GameState, from: RegionId, to: RegionId, side: Side): string | null {
  const strict = moveBlockReason(state, from, to, side);
  if (strict === null) return strict;
  if (nationsAllowedInto(state, from, to, side).length > 0 && armySide(state, from) === side && freeForMovement(state, to, side) && REGIONS[from]!.adjacency.includes(to) && !(side === 'shadow' && shadowBarredFromRegion(state, to))) return null;
  return strict;
}

/** Whether ANY part of `side`'s Army in `from` may move to `to` — what the board asks
 *  before it lights a destination. See `partialMoveBlockReason`. */
export function canMoveSomeArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  return partialMoveBlockReason(state, from, to, side) === null;
}

export function moveBlockReason(state: GameState, from: RegionId, to: RegionId, side: Side): string | null {
  if (!REGIONS[from]!.adjacency.includes(to)) return 'Those regions are not adjacent.';
  if (armySide(state, from) !== side) return 'You have no Army to move there.';
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return 'A card effect bars the Shadow from that region.';
  // Enemy units present, so the click was an ATTACK, not a move — nobody can "move into"
  // an occupied region in this UI: clicking one always resolves as an attack. The hint
  // therefore has to answer "why can't I attack?", and telling the player to "attack the
  // region instead" answered a question they had not asked (player report
  // 6q471p5u5r32472c). The real blocker there was that no Nation in the attacking Army
  // was At War — a Nation not At War cannot attack at all (p.28: an attacking Army must
  // be split so that only its At-War figures fight) — and the old wording missed it
  // whenever the target region lay outside any Nation's borders, because it only looked
  // for a border it could not cross.
  const occ = armySide(state, to);
  if (occ !== null && occ !== side) {
    const own = (Object.keys(state.regions[from]!.units) as Nation[])
      .filter((n) => sideOfNation(n) === side && (state.regions[from]!.units[n]!.regular + state.regions[from]!.units[n]!.elite) > 0);
    const sleeping = own.filter((n) => !isAtWar(state, n));
    if (own.length > 0 && sleeping.length === own.length) {
      const names = sleeping.map(nationName);
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return `Enemy units there, so this would be an attack — but ${list} ${names.length === 1 ? 'is' : 'are'} not At War, and an Army can only attack with figures of a Nation that is. Advance ${names.length === 1 ? 'it' : 'one of them'} to War on the Political Track first.`;
    }
    return 'Enemy units there — clicking an occupied region attacks it; an Army can never move into one.';
  }
  // (RAW siege model: a besieged region's open field holds the BESIEGER under the
  // normal 10-unit limit — joining them is a normal move/merge. The boxed garrison
  // is sealed in its 5-cap siege box and can't be reinforced by movement.)
  // Non-belligerent nations cannot cross another nation's border (rulebook p.27).
  const dn = REGIONS[to]!.nation;
  for (const nation of Object.keys(state.regions[from]!.units) as Nation[]) {
    if (!isAtWar(state, nation) && dn && dn !== nation) {
      // "another Nation's", not the id possessive — that read "Southrons's borders"
      // (player report 5j5m3419102n5o1g).
      return `${nationName(nation)} is not At War — its units cannot enter another Nation's borders. Advance ${nationName(nation)} to War first (or split off only its At-War units).`;
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

const FP_NATION_SET = new Set<string>(FP_NATIONS);
/** RAW p.34: a Companion (or group) that ENDS its movement in a City/Stronghold of a
 *  Free Peoples Nation it can activate — and not enemy-controlled — activates that
 *  Nation (presence only; never advances the track). Mirrors the separation rule; the
 *  Character-die move path previously skipped it (report: Gandalf into The Shire).
 *  The same rule reads "ends his movement OR ENTERS PLAY", so bringUpgrade calls this
 *  too when Aragorn is crowned / Gandalf the White arrives. A Companion moving WITH an
 *  Army ends his movement too, so every Army move calls it as well (player report:
 *  Strider marched an Army into The Shire and the North stayed passive). */
export function activateOnCompanionLand(state: GameState, side: Side, chars: string[], to: RegionId): void {
  if (side !== 'fp') return;
  const dn = REGIONS[to]?.nation as Nation | undefined;
  const st = REGIONS[to]?.settlement;
  if (!dn || !FP_NATION_SET.has(dn) || (st !== 'City' && st !== 'Stronghold')) return;
  if (settlementController(state, to) === 'shadow') return; // "unless controlled by the enemy"
  for (const c of chars) {
    const cn = COMPANIONS[c]?.nation; // 'any' companion (Gandalf/Aragorn-line) activates any FP Nation
    if (!cn || cn === 'any' || cn === dn) { activateNation(state, dn, { viaCompanion: true }); return; }
  }
}

/** Why moveArmySplit refused a selection — the same checks, in the same order, each
 *  with its own sentence. The adapter used to name the Character-die rule for EVERY
 *  failed split, so a Will-of-the-West move that left an FP Leader behind with no
 *  combat units was blamed on "a Character-die army move" (player report
 *  5j5j6p09554n1q5s). Null when the selection is legal. */
export function splitBlockReason(state: GameState, from: RegionId, to: RegionId, side: Side, sel: MoveSelection, viaCharacterDie = false): string | null {
  const src = state.regions[from]!;
  if (!REGIONS[from]!.adjacency.includes(to)) return 'Those regions are not adjacent.';
  if (armySide(state, from) !== side) return 'You have no Army to move there.';
  if (side === 'shadow' && shadowBarredFromRegion(state, to)) return 'A card effect bars the Shadow from that region.';
  if (!freeForMovement(state, to, side)) return moveBlockReason(state, from, to, side) ?? 'That region is not free for your Army to enter.';
  let movingUnits = 0;
  for (const [n, u] of Object.entries(sel.units ?? {}) as [Nation, { regular?: number; elite?: number }][]) {
    const have = src.units[n] ?? { regular: 0, elite: 0 };
    const mr = u.regular ?? 0, me = u.elite ?? 0;
    if (mr < 0 || me < 0 || mr > have.regular || me > have.elite) return 'Those figures are not in that Army.';
    movingUnits += mr + me;
  }
  if (movingUnits < 1) return 'At least one Army unit must move.';
  const movingLeaders = sel.leaders ?? 0, movingNazgul = sel.nazgul ?? 0;
  const chars = (sel.characters ?? []).filter((c) => c !== 'saruman');
  if (movingLeaders < 0 || movingLeaders > src.leaders || movingNazgul < 0 || movingNazgul > src.nazgul) return 'Those figures are not in that Army.';
  if (side === 'fp' ? movingNazgul > 0 : movingLeaders > 0) return 'You can only move your own Leaders.';
  for (const c of chars) if (!src.characters.includes(c) || characterSide(c) !== side) return 'Those figures are not in that Army.';
  const dn = REGIONS[to]!.nation;
  for (const n of Object.keys(sel.units ?? {}) as Nation[]) {
    if (!isAtWar(state, n) && dn && dn !== n) {
      return `${nationName(n)} is not At War — its units cannot enter another Nation's borders. Advance ${nationName(n)} to War first (or leave its units behind).`;
    }
  }
  const remainingUnits = unitCount(state, from) - movingUnits;
  if (side === 'fp' && remainingUnits === 0 && src.leaders - movingLeaders > 0) {
    return 'Free Peoples Leaders can never be left in a region without combat units (p.27) — this move empties the region, so its Leaders must go with the Army.';
  }
  const movingSel = { units: sel.units ?? {}, leaders: movingLeaders, nazgul: movingNazgul, characters: chars };
  if (viaCharacterDie && charDieLeaders(state, movingSel, side, false) < 1) {
    return side === 'fp'
      ? 'A Character-die Army move must take a Leader or Companion along with the moving units.'
      : 'A Character-die Army move must take a Leader or Character (a Nazgûl or Minion) along with the moving units.';
  }
  return null;
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
  activateOnCompanionLand(state, side, chars, to);
  log(state, null, 'army', `Moved army ${from} -> ${to} (${movingUnits} unit${movingUnits > 1 ? 's' : ''})`);
  return true;
}

export function moveArmy(state: GameState, from: RegionId, to: RegionId, side: Side): boolean {
  if (!canMoveArmy(state, from, to, side)) {
    // The whole stack cannot cross, but its At-War half can (p.27, "all or some of
    // the units"): move exactly the figures that may go and leave the rest standing
    // as their own Army. Nothing is lost to the player here — the units that stay
    // behind are the ones the Political Track forbids to travel, and the picker is
    // still there for anyone who wants to send fewer. Player report 615m5q0t090g205d.
    if (!canMoveSomeArmy(state, from, to, side)) return false;
    const allowed = nationsAllowedInto(state, from, to, side);
    const src0 = state.regions[from]!;
    const units: NonNullable<MoveSelection['units']> = {};
    for (const n of allowed) units[n] = { regular: src0.units[n]!.regular, elite: src0.units[n]!.elite };
    const stayers = ownNationsIn(state, from, side).filter((n) => !allowed.includes(n));
    const ok = moveArmySplit(state, from, to, side, {
      units,
      leaders: side === 'fp' ? src0.leaders : 0,
      nazgul: side === 'shadow' ? src0.nazgul : 0,
      characters: src0.characters.filter((c) => characterSide(c) === side),
    });
    if (ok && stayers.length) {
      const names = stayers.map(nationName);
      const list = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      log(state, null, 'army', `${list} ${names.length === 1 ? 'is' : 'are'} not At War and stayed in ${REGIONS[from]?.name ?? from}`);
    }
    return ok;
  }
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
  activateOnCompanionLand(state, side, movingChars, to);
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

export function captureIfEnemySettlement(state: GameState, id: RegionId, side: Side): void {
  const def = REGIONS[id]!;
  if (!def.settlement) return;
  // A Fortification (Osgiliath, Fords of Isen) is NOT a Settlement (p.10): it is never
  // captured, never carries a Settlement Control marker, and is worth no Victory
  // Points. We stamped a marker on it anyway, which showed up on the map as a control
  // diamond over two regions that can't be controlled (player report 1c0k225r21493a52).
  if (def.settlement === 'Fortification') return;
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
      log(state, null, 'army', `${sideLabel(side)} recaptured ${id} (−${def.vp} VP from the ${sideLabel(enemy)}, total ${state.victoryPoints[enemy]})`);
    }
    return;
  }
  // Enemy capture: place the marker and gain VP; the owner's Nation reacts.
  state.regions[id]!.control = side;
  if (def.vp > 0) {
    state.victoryPoints[side] += def.vp;
    log(state, null, 'army', `${sideLabel(side)} captured ${id} (+${def.vp} VP, total ${state.victoryPoints[side]})`);
  }
  // (A Fortification never reaches here — it is not a Settlement and returns above —
  // so capturing one still never advances the owning Nation's track, rulebook p.36.)
  if (def.nation) onSettlementCaptured(state, def.nation, id);
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

/** State repair: no besieged region may sit with no besieger in its open field.
 *  `liftSiegeIfAbandoned` already runs at every seam that vacates a region, but a
 *  siege left standing over an empty field is invisible on the board (the garrison
 *  sits in the box, so the Stronghold LOOKS empty) and silently blocks mustering
 *  there (p.27) — the shape of a player report we could not otherwise reproduce
 *  ("I can't muster in Lorien while it is empty, but it is still under control of
 *  the Free People's player"). One cheap sweep from advance() repairs the state
 *  whatever path produced it. Skipped while a battle is live: mid-combat the field
 *  can be momentarily empty between casualty steps, and finishCombat owns the siege
 *  bookkeeping there. */
export function sweepAbandonedSieges(state: GameState): void {
  if (state.pendingCombat) return;
  for (const id of Object.keys(state.regions)) liftSiegeIfAbandoned(state, id);
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
/** The Force `side` has standing in region `id`: its open-field Army, or the boxed
 *  garrison when `side` is the one under siege. A besieged Army is still IN its
 *  region (p.31) — only its units sit in the Stronghold Box — so any "is there an
 *  enemy Army here?" test must look in the box too. `armySide` alone reports the
 *  BESIEGER, which made Dreadful Spells unplayable against a Gondor garrison boxed
 *  in Minas Tirith (player report), and would have aimed its hits at the besieging
 *  Shadow Army had it been offered. Returns null if `side` has no Army there. */
export function armyForceOf(state: GameState, id: RegionId, side: Side): Force | null {
  const r = state.regions[id];
  if (!r) return null;
  if (armySide(state, id) === side) return r;
  const box = r.siegeBox;
  if (box && forceUnitCount(box) > 0 && forceSide(box) === side) return box;
  return null;
}

/** WHERE `side`'s figures in region `id` belong: the boxed garrison when `side` is
 *  the one under siege there, otherwise the region's open field. This is the single
 *  seam for "put a figure in this region" / "find a figure of mine in this region".
 *
 *  Unlike `armyForceOf` (which answers "does `side` have an ARMY here?" and returns
 *  null when it has none), this always returns a Force: a lone Character entering a
 *  friendly Stronghold whose garrison has been reduced to zero units still belongs in
 *  the box, not out in the field with the besieger.
 *
 *  Reaching past this helper straight to `region.characters` / `region.nazgul` is what
 *  produced a whole family of player reports: a Nazgûl flying into a besieged Orthanc
 *  landed with the FP besiegers instead of the garrison; Saruman mustered into that
 *  same Orthanc "joined the Free Peoples Army"; Gwaihir / We Prove the Swifter dropped
 *  Companions into a friendly besieged Stronghold's open field (i.e. into the enemy's
 *  arms); Companions separating inside one did the same; and figures already boxed were
 *  invisible to every enumerator, so a Nazgûl could not fly OUT of a friendly besieged
 *  Stronghold (legal — p.25 makes the FP-Stronghold rule "the only restriction" on
 *  Nazgûl flight). As the reporter put it: figures inside a Stronghold under siege are
 *  in the region for all observable purposes; only the display differs.
 *
 *  Which side is boxed: the box's own units decide, and when the box holds no units
 *  (Characters alone) the Stronghold's controller does — p.33, the garrison keeps
 *  control of the Stronghold while the besieger holds the field.
 *  `scripts/probe-siege-figure-force.mjs`. */
export function figureForce(state: GameState, id: RegionId, side: Side): Force {
  const r = state.regions[id]!;
  const box = r.siegeBox;
  if (!r.besieged || !box) return r;
  const boxedSide = forceSide(box) ?? settlementController(state, id);
  return boxedSide === side ? box : r;
}

/** Which side's units make up a Force (siege box or region), if any. */
export function forceSide(f: Force): Side | null {
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
