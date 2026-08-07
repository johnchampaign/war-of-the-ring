// Interactive battle resolution (rules-spec §7). Combat is a resumable
// sub-machine: it pauses with a PendingChoice for each side's combat-card play
// EVERY round (gated by the card's "Play if…" precondition), casualty selection
// (when the choice is meaningful), the attacker's cease/continue decision, and
// the defender's retreat decision — honoring the prompt-for-every-choice fidelity
// decision. Still deferred: initiative-ordered resolution of competing effects
// (a card's initiative only matters when both sides' effects collide — see D5)
// and a few intricate per-effect cards (e.g. Mûmakil's two timings).
import type { GameState, Nation, RegionId, Side, PendingCombat } from './types';
import { REGIONS, sideOfNation, EVENT_BY_ID, COMPANIONS, UPGRADES, levelOf, characterSide, characterDef } from './data';
import { withRng } from './rng';
import { unitCount, captureIfEnemySettlement, armySide, freeForMovement, settlementController, forceUnitCount, forceLeadership, charDieLeaders, liftSiegeIfAbandoned, mergeForceInto, moveOwnLeaders, type Force, type MoveSelection } from './armies';
import { onArmyAttacked } from './politics';
import { shadowBarredFromRegion, fpCombatCardsBarredAt } from './persistent';
import { combatModsFor, variableCostFor, hasCombatEffect, describeCombatMods, EMPTY_MODS, type CombatMods, type VariableCost } from './combatCards';
import { log } from './log';

// Safety backstop only — a real field battle terminates when the attacker ceases
// or one side is wiped (always, since every round removes units). Set well above
// any legitimate battle's length (grinding a full 10-unit stack takes ~6 rounds at
// ~1.7 hits/round, more with leadership re-rolls) so the cap never cuts a genuine
// fight short; it exists purely to guarantee the sub-machine can't loop forever.
const MAX_ROUNDS = 15;
const clamp = (lo: number, hi: number, v: number): number => Math.max(lo, Math.min(hi, v));
const other = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

/** A combat card's initiative for resolution order (lower resolves first). For a
 *  ranged/multi-effect card ("3-5") use its earliest effect (the min). Unknown
 *  initiative resolves last. */
function cardInitiative(cardId: string): number {
  const ini = EVENT_BY_ID[cardId]?.initiative;
  if (typeof ini === 'number') return ini;
  if (typeof ini === 'string') { const m = ini.match(/\d+/); return m ? Number(m[0]) : 99; }
  return 99;
}

/** Is `target` within `n` region-steps of `from` (inclusive)? Bounded BFS. */
function withinRegions(from: RegionId, target: RegionId, n: number): boolean {
  const seen = new Set([from]);
  let layer = [from];
  for (let d = 0; d < n; d++) {
    const next: RegionId[] = [];
    for (const r of layer) for (const adj of REGIONS[r]?.adjacency ?? []) if (!seen.has(adj)) { seen.add(adj); next.push(adj); }
    layer = next;
  }
  return seen.has(target);
}

/** All free adjacent regions a `side` army could retreat into. */
function freeAdjacentRegions(state: GameState, regionId: RegionId, side: Side): RegionId[] {
  return REGIONS[regionId]!.adjacency.filter((adj) => freeForMovement(state, adj, side));
}
/** The first such region, or null (used for "can retreat?" / pre-combat retreats). */
const nationsWithUnits = (state: GameState, id: RegionId): Nation[] =>
  (Object.keys(state.regions[id]!.units) as Nation[]).filter((n) => (state.regions[id]!.units[n]!.regular + state.regions[id]!.units[n]!.elite) > 0);

/** Hits for one side's roll, applying that side's combat-card mods and the
 *  enemy's penalty mods. */
/** A combat roll's faces, for the battle popup: the main dice, any leadership
 *  re-rolls, and the to-hit target so the UI can colour the hits. */
export interface CombatRoll { dice: number[]; rerolls: number[]; target: number; rerollTarget?: number }
function rollHits(state: GameState, ownRegion: RegionId, enemyRegion: RegionId, side: Side,
  baseTarget: number, ownMods: CombatMods, enemyMods: CombatMods, whiteRiderForfeit = false, roll?: CombatRoll, force?: Force,
  enemyForce?: Force): number {
  // `force` (a siege box) overrides where this side's figures are read from — used
  // for the boxed DEFENDER in a siege assault (they're in to.siegeBox, not the region).
  const own: Force = force ?? state.regions[ownRegion]!;
  // Captain of the West: +1 Combat Strength (die) if such a Companion is in this FP Army.
  const captain = side === 'fp' && !enemyMods.enemyCaptainCancel && own.characters.some((c) => CAPTAINS.has(c)) ? 1 : 0;
  let count = Math.min(5, forceUnitCount(own) + captain);
  if (enemyMods.maxDiceEnemy != null) count = Math.min(count, enemyMods.maxDiceEnemy);
  // Dread and Despair: "rolls one Combat die less (to a minimum of one)".
  if (enemyMods.enemyDiceReduction) count = Math.max(1, count - enemyMods.enemyDiceReduction);
  // "Both Armies add N…" (Deadly Strife, Desperate Battle) also lifts THIS side's dice.
  const shared = enemyMods.symmetricBonus ? enemyMods : null;
  const rollBonus = (ownMods.rollBonus ?? 0) + (shared?.rollBonus ?? 0);
  const rerollBonus = (ownMods.rerollBonus ?? 0) + (shared?.rerollBonus ?? 0);
  // Two targets: the cards bonus the Combat roll and the Leader re-roll separately.
  // Enemy to-hit penalties (Advantageous Position, Confusion) name the Combat roll only.
  const target = clamp(2, 6, baseTarget - rollBonus + (enemyMods.enemyRollPenalty ?? 0));
  const rerollTarget = clamp(2, 6, baseTarget - rerollBonus);
  // Forfeiting a Companion's Leadership (Mighty Attack) costs re-roll dice.
  let leadVal = Math.min(5, forceLeadership(state, own, side));
  // Gandalf the White "The White Rider": when the FP chose (at battle start) to forfeit
  // his Leadership, all Nazgûl Leadership (incl. the Witch-king) is negated this battle.
  if (whiteRiderForfeit) {
    const shR = side === 'shadow' ? ownRegion : enemyRegion, sr = state.regions[shR]!;
    const nazgulLead = sr.nazgul + (sr.characters.includes('witch-king') ? 2 : 0);
    leadVal = Math.max(0, leadVal - (side === 'shadow' ? nazgulLead : 1));
  }
  const lead = Math.max(0, leadVal - (ownMods.ownLeadershipPenalty ?? 0) - (enemyMods.enemyLeadershipPenalty ?? 0));
  // Foul Stench cancels the FP Leader re-roll only "if the Nazgûl Leadership equals or
  // exceeds the total Free Peoples Leadership" (p. card text). `side` here is the side
  // ROLLING, so this fires while the FP rolls and the Shadow holds the card.
  let conditionalNegate = false;
  if (enemyMods.negateEnemyRerollIfNazgulDominant && side === 'fp') {
    const shadow = enemyForce ?? state.regions[enemyRegion]!;
    conditionalNegate = forceLeadership(state, shadow, 'shadow') >= forceLeadership(state, own, 'fp');
  }
  const allowReroll = !enemyMods.negateEnemyReroll && !conditionalNegate;
  if (roll) { roll.dice = []; roll.rerolls = []; roll.target = target; roll.rerollTarget = rerollTarget; }
  let hits = withRng(state, (rng) => {
    let h = 0, failed = 0;
    for (let i = 0; i < count; i++) { const d = rng.rollDie(6); roll?.dice.push(d); if (d === 6 || (d !== 1 && d >= target)) h++; else failed++; }
    // The re-roll ALLOWANCE is fixed before any die is thrown (p.30: re-roll one die
    // per Leadership point, up to the number of misses). It must not be the loop
    // condition — `failed--` below mutates it, so a re-roll that HIT used to steal a
    // re-roll die from the ones still owed (player report: 3 misses with Leadership
    // 5 got only 2 re-rolls, because the first re-roll hit).
    const rerollDice = allowReroll ? Math.min(lead, failed) : 0;
    for (let i = 0; i < rerollDice; i++) { const d = rng.rollDie(6); roll?.rerolls.push(d); if (d === 6 || (d !== 1 && d >= rerollTarget)) { h++; failed--; } }
    for (let i = 0; i < (ownMods.extraAttackDice ?? 0); i++) { const d = rng.rollDie(6); if (d >= 5) h++; } // extra attack hits on 5+
    // Mighty Attack: turn up to N still-missed dice into hits.
    h += Math.min(ownMods.guaranteedHits ?? 0, failed);
    return h;
  });
  if ((ownMods.bonusHitsIfAny ?? 0) > 0 && hits > 0) hits += ownMods.bonusHitsIfAny!;
  if ((ownMods.bonusHitsIfOutnumber ?? 0) > 0 && forceUnitCount(own) >= 2 * Math.max(1, unitCount(state, enemyRegion))) hits += ownMods.bonusHitsIfOutnumber!;
  return hits;
}

const MINION_SET = new Set(['witch-king', 'saruman', 'mouth-of-sauron']);

/** Apply a combat card's enemy-figure eliminations after the rolls. Returns the
 *  owner's remaining hits (Blade of Westernesse spends a hit per Minion killed).
 *  Eliminated Nazgûl return to the Sauron reinforcements; Minions are removed for
 *  good. `enemy` is the region holding the card owner's opponent. */
/** `e` is the TARGET side's Force and `enemy` the region it is fought in — they differ
 *  whenever one side is in the siege box (assault or sortie), where the region's own
 *  `units`/`characters` belong to the OTHER side. */
function applyCombatEliminations(state: GameState, e: Force, enemy: RegionId, mods: CombatMods, ownHits: number): number {
  let hits = ownHits;
  for (let n = mods.eliminateNazgulIfHit ?? 0; n > 0 && hits > 0 && e.nazgul > 0; n--) {
    e.nazgul -= 1;
    state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) + 1;
    log(state, null, 'combat', `a Nazgûl is eliminated at ${enemy}`);
  }
  for (let n = mods.eliminateMinion ?? 0; n > 0 && hits > 0; n--) {
    const i = e.characters.findIndex((c) => MINION_SET.has(c));
    if (i < 0) break;
    const id = e.characters.splice(i, 1)[0]!;
    state.characters.eliminated.push(id);
    hits -= 1; // the hit is spent to make the kill
    log(state, null, 'combat', `${id} is eliminated at ${enemy}`);
  }
  // Black Breath: on a scoring round, additionally eliminate one enemy FP figure
  // (no hit spent). Shadow-optimal target: the highest-Level Companion whose Level
  // ≤ the round's hits, else one FP Leader. (Auto-resolved like the other combat-
  // card eliminations; the "may"/target choice is taken in the owner's favour.)
  if (mods.blackBreath && ownHits > 0) {
    const comps = e.characters.filter((c) => COMPANION_IDS.has(c) && levelOf(c) <= ownHits).sort((a, b) => levelOf(b) - levelOf(a));
    if (comps.length) {
      const id = comps[0]!;
      e.characters.splice(e.characters.indexOf(id), 1);
      state.characters.eliminated.push(id);
      delete state.characters.inPlay[id];
      log(state, null, 'combat', `Black Breath: ${id} is eliminated at ${enemy}`);
    } else if (e.leaders > 0) {
      e.leaders -= 1;
      log(state, null, 'combat', `Black Breath: an FP Leader is eliminated at ${enemy}`);
    }
  }
  return hits;
}

// --- Per-casualty allocation (rulebook p.30) ---------------------------------
// "For each hit, remove one Regular, OR replace one Elite with a Regular.
//  Alternatively, for every TWO hits, you may remove one Elite."
// This used to be a single regularsFirst/elitesFirst PLAN applied to the whole
// batch, which cannot express the mixed allocations the rules allow — a besieged
// {3R,3E} taking 3 hits could only become {3E} (siege kept, 3 dice) or {6R} (5
// dice, no Elite left to press the assault), never the 1R+1E the player wanted
// (player report). Each hit is now its own choice, and the "two hits for one
// Elite" option exists at all for the first time.
export type CasualtyStepKind = 'removeRegular' | 'reduceElite' | 'removeElite';
export interface CasualtyOption { step: CasualtyStepKind; nation: Nation; cost: number }

/** Every legal way to absorb the next hit(s) from this Force. The nation is part of
 *  the choice: which Nation loses a figure is the owner's call (p.30), and it matters
 *  (a Nation's pool, and whether its Elites survive to press a siege). */
export function casualtyOptions(f: Force, hits: number): CasualtyOption[] {
  const out: CasualtyOption[] = [];
  if (hits <= 0) return out;
  for (const n of Object.keys(f.units) as Nation[]) {
    const u = f.units[n]; if (!u) continue;
    if (u.regular > 0) out.push({ step: 'removeRegular', nation: n, cost: 1 });
    if (u.elite > 0) out.push({ step: 'reduceElite', nation: n, cost: 1 });
    if (u.elite > 0 && hits >= 2) out.push({ step: 'removeElite', nation: n, cost: 2 });
  }
  return out;
}

/** Apply ONE allocation. Returns the hits it consumed (0 if it was illegal).
 *  Shadow figures recycle to reinforcements; FP losses are permanent (p.30). */
function applyCasualtyOption(state: GameState, f: Force, side: Side, opt: CasualtyOption): number {
  const u = f.units[opt.nation]; if (!u) return 0;
  if (opt.step === 'removeRegular' && u.regular > 0) {
    u.regular -= 1; if (side === 'shadow') state.reinforcements[opt.nation].regular += 1;
  } else if (opt.step === 'reduceElite' && u.elite > 0) {
    u.elite -= 1; u.regular += 1; if (side === 'shadow') state.reinforcements[opt.nation].elite += 1;
  } else if (opt.step === 'removeElite' && u.elite > 0) {
    u.elite -= 1; if (side === 'shadow') state.reinforcements[opt.nation].elite += 1;
  } else return 0;
  if (u.regular === 0 && u.elite === 0) delete f.units[opt.nation];
  return opt.cost;
}

/** Absorb every hit whose allocation is FORCED (exactly one legal option), so the
 *  player is never asked to "choose" a non-choice. Returns the hits still open. */
function absorbForced(state: GameState, f: Force, side: Side, hits: number): number {
  let left = hits;
  for (;;) {
    const opts = casualtyOptions(f, left);
    if (left <= 0 || opts.length !== 1) return left;
    const spent = applyCasualtyOption(state, f, side, opts[0]!);
    if (spent <= 0) return left; // defensive: never spin
    left -= spent;
  }
}

/** True when the owner still has a real decision to make about these hits. */
function meaningfulForceCasualty(f: Force, hits: number): boolean {
  return casualtyOptions(f, hits).length > 1;
}

/** Apply `hits` steps to a region's army. regularsFirst removes Regulars before
 *  downgrading Elites; elitesFirst downgrades Elites first (preserving unit
 *  count). Shadow casualties recycle to reinforcements; FP casualties are gone. */
export function applyCasualties(state: GameState, id: RegionId, side: Side, hits: number, plan: 'regularsFirst' | 'elitesFirst'): void {
  applyForceCasualties(state, state.regions[id]!, side, hits, plan);
}
/** Apply casualties to a Force (a region or a siege box). */
function applyForceCasualties(state: GameState, f: Force, side: Side, hits: number, plan: 'regularsFirst' | 'elitesFirst'): void {
  for (let h = 0; h < hits; h++) {
    const nations = (Object.keys(f.units) as Nation[]).filter((n) => (f.units[n]!.regular + f.units[n]!.elite) > 0);
    if (!nations.length) break;
    if (plan === 'regularsFirst') {
      const wr = nations.find((n) => f.units[n]!.regular > 0);
      if (wr) { f.units[wr]!.regular -= 1; if (side === 'shadow') state.reinforcements[wr].regular += 1; }
      else { const n = nations[0]!; f.units[n]!.elite -= 1; f.units[n]!.regular += 1; if (side === 'shadow') state.reinforcements[n].elite += 1; }
    } else {
      const we = nations.find((n) => f.units[n]!.elite > 0);
      if (we) { f.units[we]!.elite -= 1; f.units[we]!.regular += 1; if (side === 'shadow') state.reinforcements[we].elite += 1; }
      else { const n = nations[0]!; f.units[n]!.regular -= 1; if (side === 'shadow') state.reinforcements[n].regular += 1; }
    }
  }
  finishForceCasualties(state, f);
}

/** Run once the last hit has landed: if the Army is gone, its Leaders/Nazgûl and
 *  Characters go with it. Per rulebook p.30 every Character that was part of a
 *  destroyed Army is permanently removed — Companions AND Shadow Minions (Saruman,
 *  the Witch-king, the Mouth of Sauron). Recording the elimination is what drops the
 *  bonus Action die (dice.poolSize reads entered && !eliminated) and clears the
 *  on-map roster; without it a besieged Saruman survived the fall of Orthanc and kept
 *  his die (player report). Idempotent — the event-casualty follow-up (The Ents
 *  Awake) re-checks `eliminated` — so the per-hit path may call it after each step. */
function finishForceCasualties(state: GameState, f: Force): void {
  if (forceUnitCount(f) !== 0) return;
  for (const c of f.characters) {
    if (!state.characters.eliminated.includes(c)) state.characters.eliminated.push(c);
    delete state.characters.inPlay[c];
  }
  if (f.characters.length) log(state, null, 'combat', `${f.characters.join(', ')} eliminated with the destroyed Army`);
  f.leaders = 0; f.nazgul = 0; f.characters = [];
}

/** The Force a pending casualty choice is allocating from (region, or the siege box
 *  when the side taking the hits is the boxed one). */
function pendingCasualtyForce(state: GameState): Force | null {
  const ch = state.pendingChoice;
  if (!ch || (ch.kind !== 'combatCasualties' && ch.kind !== 'eventCasualties')) return null;
  const d = ch.data as { region: RegionId; boxed?: boolean };
  const box = state.regions[d.region]?.siegeBox;
  return (ch.kind === 'combatCasualties' && d.boxed && box) ? box : state.regions[d.region] ?? null;
}

/** The allocations currently on offer (for the adapter's legalActions). */
export function pendingCasualtyOptions(state: GameState): CasualtyOption[] {
  const f = pendingCasualtyForce(state);
  if (!f) return [];
  const d = state.pendingChoice!.data as { hits: number };
  return casualtyOptions(f, d.hits);
}

/** Apply ONE chosen allocation, then either re-prompt for the next hit or finish
 *  (advancing the battle sub-machine / running the event follow-up). Forced
 *  allocations in between are absorbed silently. */
export function resolveCasualtyStep(state: GameState, step: CasualtyStepKind, nation: Nation): void {
  const ch = state.pendingChoice!;
  const isEvent = ch.kind === 'eventCasualties';
  const d = ch.data as { region: RegionId; side: Side; hits: number; next?: PendingCombat['step']; boxed?: boolean; then?: CasualtyThen | null };
  const f = pendingCasualtyForce(state)!;
  const opts = casualtyOptions(f, d.hits);
  const chosen = opts.find((o) => o.step === step && o.nation === nation) ?? opts[0];
  let left = d.hits;
  if (chosen) left -= applyCasualtyOption(state, f, d.side, chosen);
  left = absorbForced(state, f, d.side, left);
  if (meaningfulForceCasualty(f, left)) {
    state.pendingChoice = { ...ch, data: { ...d, hits: left } };
    return;
  }
  finishForceCasualties(state, f);
  state.pendingChoice = null;
  if (isEvent) runCasualtyThen(state, d.then ?? null);
  else state.pendingCombat!.step = d.next!;
}

// --- Event-inflicted casualties: the OWNER chooses absorption -----------------
// Direct-damage Event cards (The Ents Awake, Dreadful Spells, …) eliminate Army
// units. Per the casualty rules the OWNING player chooses which units are lost
// (Regulars removed vs Elites reduced), exactly like combat casualties — so we
// defer to an `eventCasualties` PendingChoice whenever the choice is meaningful,
// then run any card-specific follow-up. `then` is plain data (serializable), not
// a closure, so the choice survives a save/reload.
export type CasualtyThen = { kind: 'entsAwake'; region: RegionId; naz0: number; minions: string[] };

function runCasualtyThen(state: GameState, then?: CasualtyThen | null): void {
  if (!then) return;
  if (then.kind === 'entsAwake') {
    if (forceUnitCount(state.regions[then.region]!) === 0) {
      state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) + then.naz0; // recycle Nazgûl
      const gone: string[] = [];
      for (const m of then.minions) if (!state.characters.eliminated.includes(m)) { state.characters.eliminated.push(m); delete state.characters.inPlay[m]; gone.push(m); }
      if (gone.length) log(state, null, 'event', `The Ents Awake: the Orthanc Army is destroyed — eliminated ${gone.join(', ')}`);
    }
  }
}

/** Apply event-inflicted `hits` to a region's Army, prompting the owner for the
 *  absorption plan when the choice is meaningful; otherwise auto-resolve and run
 *  the follow-up immediately. */
export function queueOrApplyEventCasualties(state: GameState, side: Side, region: RegionId, hits: number, then?: CasualtyThen): void {
  if (hits <= 0) { runCasualtyThen(state, then); return; }
  const f = state.regions[region]!;
  const left = absorbForced(state, f, side, hits); // forced losses need no prompt
  if (meaningfulForceCasualty(f, left)) {
    state.pendingChoice = { owner: side, kind: 'eventCasualties', data: { region, side, hits: left, then: then ?? null } };
    return;
  }
  finishForceCasualties(state, f);
  runCasualtyThen(state, then);
}

/** Resolve a pending `eventCasualties` choice with the owner's chosen plan. */
export function resolveEventCasualties(state: GameState, plan: 'regularsFirst' | 'elitesFirst'): void {
  const d = state.pendingChoice!.data as { region: RegionId; side: Side; hits: number; then: CasualtyThen | null };
  applyCasualties(state, d.region, d.side, d.hits, plan);
  state.pendingChoice = null;
  runCasualtyThen(state, d.then);
}

// --- Attack split: the rearguard (rulebook p.28) -----------------------------
const nationAtWar = (state: GameState, n: Nation): boolean => state.nations[n].step === 0;

/** The figures that must be left out of the battle: the player's explicit rearguard
 *  selection, plus ALL units of the attacker's not-At-War Nations (which may never
 *  join a battle — a split is mandatory when such units are present). */
type Rearguard = NonNullable<PendingCombat['rearguard']>;
function fullRearguard(state: GameState, from: RegionId, side: Side, explicit?: MoveSelection, force?: Force): Rearguard {
  const r = force ?? state.regions[from]!; // a sortie's army is the siege box, not the region
  const units: Record<string, { regular: number; elite: number }> = {};
  for (const [n, u] of Object.entries(explicit?.units ?? {})) units[n] = { regular: u?.regular ?? 0, elite: u?.elite ?? 0 };
  for (const n of Object.keys(r.units) as Nation[]) {
    if (sideOfNation(n) === side && !nationAtWar(state, n) && (r.units[n]!.regular + r.units[n]!.elite) > 0) {
      units[n] = { regular: r.units[n]!.regular, elite: r.units[n]!.elite }; // all not-At-War units stay
    }
  }
  return { units, leaders: explicit?.leaders ?? 0, nazgul: explicit?.nazgul ?? 0, characters: explicit?.characters ?? [] };
}

/** The side whose Army units occupy a Force (a region or a siege box), or null. */
function forceSide(f: Force): Side | null {
  for (const n of Object.keys(f.units) as Nation[]) if ((f.units[n]!.regular + f.units[n]!.elite) > 0) return sideOfNation(n);
  return null;
}
/** `id`'s siege box when it is `side`'s besieged garrison with an enemy Army standing in
 *  the open field — i.e. the force that could mount a SORTIE from that Stronghold (p.32).
 *  Null when `side` is the besieger instead, or there is no live siege. */
export function sortieForce(state: GameState, id: RegionId, side: Side): Force | null {
  const r = state.regions[id]!, box = r.siegeBox;
  if (!box || !r.besieged || forceUnitCount(box) === 0) return null;
  if (armySide(state, id) !== other(side)) return null; // no besieger in the open field to attack
  return forceSide(box) === side ? box : null;
}

/** Validate an attack's (optional) rearguard split. Returns an error string, or null. */
export function attackError(state: GameState, from: RegionId, side: Side, explicit?: MoveSelection, viaCharacterDie = false): string | null {
  // A SORTIE attacks out of the siege box, so the attacking "army" is the box, not the
  // region — the region holds the besieger (p.32).
  const sortieBox = sortieForce(state, from, side);
  if (!sortieBox && armySide(state, from) !== side) return 'No attacking army';
  const r = sortieBox ?? state.regions[from]!;
  const rg = fullRearguard(state, from, side, explicit, sortieBox ?? undefined);
  let armyUnits = 0, rgUnits = 0;
  for (const n of Object.keys(r.units) as Nation[]) armyUnits += r.units[n]!.regular + r.units[n]!.elite;
  for (const [n, u] of Object.entries(rg.units)) {
    const have = r.units[n as Nation] ?? { regular: 0, elite: 0 };
    if (u.regular < 0 || u.elite < 0 || u.regular > have.regular || u.elite > have.elite) return 'Rearguard exceeds the army';
    rgUnits += u.regular + u.elite;
  }
  if (rg.leaders > r.leaders || rg.nazgul > r.nazgul) return 'Rearguard exceeds the army';
  for (const c of rg.characters) if (!r.characters.includes(c)) return 'Rearguard figure not present';
  if (armyUnits - rgUnits < 1) return 'The attacking army must keep at least one unit';
  const rgHasFigure = rgUnits > 0 || rg.leaders > 0 || rg.nazgul > 0 || rg.characters.length > 0;
  if (rgHasFigure && rgUnits < 1) return 'A rearguard must contain at least one unit';
  // Only the attacker's OWN Leaders/Characters satisfy a Character-die attack — never
  // an enemy Character sharing the region. Saruman DOES count here (unlike a move):
  // the attacking units never leave their region (p.28), so his "cannot leave Orthanc"
  // is no obstacle — and while he is in play each Isengard Elite is a Leader in its
  // own right ("Servants of the White Hand").
  if (viaCharacterDie && charDieLeaders(state, r, side, true) - charDieLeaders(state, rg, side, true) < 1) {
    return 'A Character-die attack must include a Leader or Character';
  }
  return null;
}

/** Remove the rearguard figures from `from`, returning the stash (held in the
 *  PendingCombat for the battle's duration). */
function stashRearguard(state: GameState, from: RegionId, rg: Rearguard, force?: Force): PendingCombat['rearguard'] {
  const r = force ?? state.regions[from]!; // a sortie splits its rearguard out of the siege box
  const stash = { units: {} as Record<string, { regular: number; elite: number }>, leaders: rg.leaders, nazgul: rg.nazgul, characters: [...rg.characters] };
  for (const [n, u] of Object.entries(rg.units)) {
    if (u.regular + u.elite === 0) continue;
    r.units[n as Nation]!.regular -= u.regular; r.units[n as Nation]!.elite -= u.elite;
    stash.units[n] = { regular: u.regular, elite: u.elite };
    if (r.units[n as Nation]!.regular === 0 && r.units[n as Nation]!.elite === 0) delete r.units[n as Nation];
  }
  r.leaders -= rg.leaders; r.nazgul -= rg.nazgul;
  for (const c of rg.characters) r.characters.splice(r.characters.indexOf(c), 1);
  return stash;
}

/** Put a stashed rearguard back into a region (when the battle ends). */
function restoreRearguard(state: GameState, region: RegionId, stash: NonNullable<PendingCombat['rearguard']>): void {
  restoreRearguardInto(state.regions[region]!, stash);
}
/** As above, but into an arbitrary Force — a sortie's rearguard stays in the siege box
 *  ("A rearguard may be formed and left behind in the Stronghold", p.32). */
function restoreRearguardInto(r: Force, stash: NonNullable<PendingCombat['rearguard']>): void {
  for (const [n, u] of Object.entries(stash.units)) {
    const d = r.units[n as Nation] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; r.units[n as Nation] = d;
  }
  r.leaders += stash.leaders; r.nazgul += stash.nazgul; r.characters.push(...stash.characters);
}

/** The DEFENDER's figures during a battle: the siege box when the defender is
 *  boxed (RAW siege assault — besieger occupies the region, defenders in the box),
 *  otherwise the region itself. */
function defForce(state: GameState, pc: PendingCombat): Force {
  const box = state.regions[pc.to]!.siegeBox;
  return pc.boxed === pc.defender && box ? box : state.regions[pc.to]!;
}
/** The ATTACKER's figures during a battle: the siege box in a SORTIE (p.32 — the
 *  besieged Army attacks the besiegers, and in this model never physically leaves the
 *  box, which is also why ceasing puts it back in the Stronghold for free), otherwise
 *  the region. In a sortie `from === to`, so the region itself holds the BESIEGER. */
function atkForce(state: GameState, pc: PendingCombat): Force {
  const box = state.regions[pc.from]!.siegeBox;
  return pc.boxed === pc.attacker && box ? box : state.regions[pc.from]!;
}
const atkCount = (state: GameState, pc: PendingCombat): number => forceUnitCount(atkForce(state, pc));
const defCount = (state: GameState, pc: PendingCombat): number => forceUnitCount(defForce(state, pc));
/** Cap a region's siege box at the 5-unit garrison limit (excess recycled). */
function capSiegeBox(state: GameState, id: RegionId): void {
  const box = state.regions[id]!.siegeBox; if (!box) return;
  let excess = forceUnitCount(box) - 5;
  if (excess <= 0) return;
  for (const kind of ['regular', 'elite'] as const) {
    for (const n of Object.keys(box.units) as Nation[]) {
      const u = box.units[n]; if (!u) continue;
      while (excess > 0 && u[kind] > 0) { u[kind] -= 1; state.reinforcements[n][kind] += 1; excess -= 1; }
    }
    if (excess <= 0) break;
  }
}

/** How much a side could actually pay for its variable-cost card right now: the card's
 *  own cap, limited by what that side has to spend. Self-hits cannot exceed the units
 *  present (spending your last unit would wipe your own army mid-round); a Nazgûl
 *  Leadership forfeit cannot exceed the Leadership you have. */
function costRange(state: GameState, pc: PendingCombat, side: Side, vc: VariableCost): { min: number; max: number } {
  const own = side === pc.attacker ? atkForce(state, pc) : defForce(state, pc);
  const have = vc.kind === 'selfHits'
    ? Math.max(0, forceUnitCount(own) - 1)          // never self-annihilate
    : forceLeadership(state, own, side);
  const max = Math.min(vc.cap, have);
  return { min: Math.min(vc.min, max), max };
}

/** The card `side` played this round, if it has a cost of the given timing that has not
 *  been paid yet. */
function unpaidCost(state: GameState, pc: PendingCombat, side: Side, timing: VariableCost['timing']):
  { card: string; vc: VariableCost; range: { min: number; max: number } } | null {
  const card = side === pc.attacker ? pc.attackerCard : pc.defenderCard;
  const paid = side === pc.attacker ? pc.atkCardCost : pc.defCardCost;
  if (!card || paid !== undefined) return null;
  const vc = variableCostFor(card);
  if (!vc || vc.timing !== timing) return null;
  const range = costRange(state, pc, side, vc);
  return { card, vc, range };
}

/** Charge the chosen cost. Self-hits are applied to the payer's own Force; a Leadership
 *  forfeit is charged through ownLeadershipPenalty at roll time, so nothing to do here. */
function payCardCost(state: GameState, pc: PendingCombat, side: Side, vc: VariableCost, amount: number): void {
  if (amount <= 0) return;
  if (vc.kind === 'selfHits') {
    const own = side === pc.attacker ? atkForce(state, pc) : defForce(state, pc);
    applyForceCasualties(state, own, side, amount, 'regularsFirst');
    log(state, null, 'combat', `${side === 'fp' ? 'Free Peoples' : 'Shadow'} inflict ${amount} hit${amount === 1 ? '' : 's'} on their own units to power the card`);
  } else {
    log(state, null, 'combat', `${side === 'fp' ? 'Free Peoples' : 'Shadow'} forfeit ${amount} point${amount === 1 ? '' : 's'} of Nazgûl Leadership`);
  }
}

/** RAW p.31: "before every combat round, the defender must choose to either fight a
 *  field battle or retreat into a siege" — an Army defending a region containing a
 *  FRIENDLY Stronghold may fall back into it "at the beginning of any Combat round",
 *  not merely the first. Unavailable once the battle is already a siege battle: a
 *  besieged Army cannot retreat (p.31), and in an assault or a sortie one side is
 *  already boxed. */
function strongholdWithdrawAvailable(state: GameState, pc: PendingCombat): boolean {
  if (pc.boxed || pc.siege) return false;                       // assault / sortie / forced multi-round assault
  const r = state.regions[pc.to]!;
  if (r.besieged || r.siegeBox) return false;                   // already under siege
  if (REGIONS[pc.to]!.settlement !== 'Stronghold') return false;
  if (settlementController(state, pc.to) !== pc.defender) return false; // must be THEIR Stronghold
  return unitCount(state, pc.to) > 0;                           // somebody left to fall back
}

/** Begin a battle: political reactions, then set up the sub-machine. The driver
 *  (combatStep, run from advance) takes it from here. */
export function startBattle(state: GameState, attacker: Side, from: RegionId, to: RegionId,
  opts: { siegeRounds?: number; fpCardLock?: boolean; defenderDicePenalty?: number; rearguard?: MoveSelection; noCease?: boolean } = {}): void {
  const dReg = REGIONS[to]!;
  const defender = other(attacker);
  const box = state.regions[to]!.siegeBox;
  // ASSAULT: the besieger occupies the besieged region (from===to) and attacks the
  // boxed defenders. RELIEF (from≠to into a besieged region) is a normal field
  // battle vs the besieger in the open — not an assault.
  // Both an ASSAULT and a SORTIE happen inside one region (from===to) with a live siege;
  // which one it is depends on who is acting. The besieger occupies the open field, so
  // if the region's Army is the attacker's it's an assault on the box; if the BOX is the
  // attacker's it's a sortie (p.32). RELIEF (from≠to into a besieged region) is neither —
  // it's a normal field battle against the besieger in the open.
  const inSiegeRegion = from === to && !!box && state.regions[to]!.besieged;
  const sortie = inSiegeRegion && armySide(state, to) !== attacker;
  const assault = inSiegeRegion && !sortie;
  // Political reaction lands on the army actually attacked: the box in an assault, the
  // besieger standing in the open field in a sortie.
  for (const n of nationsWithUnits(state, to)) if (!assault) onArmyAttacked(state, n, to);
  if (assault) for (const n of Object.keys(box!.units) as Nation[]) if ((box!.units[n]!.regular + box!.units[n]!.elite) > 0) onArmyAttacked(state, n, to);
  const pc: PendingCombat = {
    attacker, defender, from, to, round: 0,
    // `fortified` means ONLY "this Settlement grants the first-round 6-to-hit", which
    // RAW p.31 gives to a City or Fortification and NOT to a Stronghold: "Attacking a
    // Stronghold … Fighting a Field Battle — a field battle is resolved normally as
    // described before." A Stronghold's protection is the retreat-into-siege option,
    // not a to-hit penalty. (The siege battle's own every-round 6+ is p.32 and comes
    // from `pc.siege`; a sortie forfeits everything and is neither.)
    fortified: !sortie && (dReg.settlement === 'City' || dReg.settlement === 'Fortification'),
    step: 'attackerCard', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0,
    defDicePenalty: opts.defenderDicePenalty,
    noCease: opts.noCease,
    atkUnits0: sortie ? forceUnitCount(box!) : unitCount(state, from),
    defUnits0: assault ? forceUnitCount(box!) : unitCount(state, to),
  };
  if (sortie) {
    // A field battle, not a siege battle: no 6-to-hit, no round cap, and the besieging
    // defender may retreat as usual. `boxed` just says whose figures are in the box.
    pc.boxed = attacker;
  } else if (assault) {
    pc.siege = true; pc.siegeRoundsLeft = opts.siegeRounds ?? 1; pc.boxed = defender; pc.fpCardLock = !!opts.fpCardLock;
  } else if (opts.siegeRounds && box) {
    // Grond / The Fighting Uruk-hai force a multi-round assault on a besieged Stronghold.
    // `boxed` MUST be set with `siege`, or defForce() resolves the assault against the
    // besieger's own units in the region and the battle ends after a round or two.
    pc.siege = true; pc.siegeRoundsLeft = opts.siegeRounds; pc.boxed = defender; pc.fpCardLock = !!opts.fpCardLock;
  }
  // NB the retreat-into-siege offer is NOT set up here: RAW p.31 puts it before EVERY
  // combat round, so combatStep inserts it ahead of each round's 'attackerCard' step
  // (see strongholdWithdrawAvailable) rather than only at battle start.
  // Split off the rearguard (explicit + forced not-At-War units) before the battle —
  // never for an assault (from===to; the besieger assaults with its whole force).
  if (!assault) {
    // A sortie splits its rearguard out of the siege box and leaves it in the Stronghold.
    const rg = fullRearguard(state, from, attacker, opts.rearguard, sortie ? box : undefined);
    const rgHasFigure = Object.values(rg.units).some((u) => u.regular + u.elite > 0) || rg.leaders > 0 || rg.nazgul > 0 || rg.characters.length > 0;
    if (rgHasFigure) pc.rearguard = stashRearguard(state, from, rg, sortie ? box : undefined);
  }
  pc.atkUnits0 = atkCount(state, pc); // attacking force after the rearguard is held aside
  state.pendingCombat = pc;
  // Name BOTH forces as they stand at the first roll (player report: "I always lose
  // track of the original forces and they're not listed in the log… that way the
  // resolution could be checked for accuracy"). Read after the rearguard split, so
  // the attacker shown is the force that actually fights.
  const atkDesc = describeForce(state, atkForce(state, pc), attacker);
  const defDesc = describeForce(state, defForce(state, pc), defender);
  log(state, null, 'combat',
    `${attacker} attacks ${to} from ${from}${pc.siege ? ' (siege assault)' : ''}${sortie ? ' (sortie)' : ''}${pc.rearguard ? ' (rearguard left behind)' : ''}`
    + ` — attacker ${atkDesc} vs defender ${defDesc}`,
    { from, to, attacker, attackerForce: atkDesc, defenderForce: defDesc, siege: !!pc.siege, sortie });
}

function retreatRegion(state: GameState, pc: PendingCombat): RegionId | null {
  return retreatOptions(state, pc)[0] ?? null; // same exclusions as the offer (p.31)
}

/** A Force's composition for the battle log — "2R, 5E, Saruman (Leadership 5)".
 *  Armies on the board are open information, so this is a public log line. Players
 *  asked for it so a battle's resolution can be checked against the rules: the
 *  Leadership total is exactly what sets the Leader re-roll count (p.30), and the
 *  unit count sets the Combat dice (both capped at 5). */
function describeForce(state: GameState, f: Force, side: Side): string {
  let reg = 0, eli = 0;
  for (const n of Object.keys(f.units) as Nation[]) { const u = f.units[n]!; reg += u.regular; eli += u.elite; }
  const parts: string[] = [];
  if (reg) parts.push(`${reg}R`);
  if (eli) parts.push(`${eli}E`);
  const figs = side === 'fp' ? f.leaders : f.nazgul;
  if (figs) parts.push(`${figs}${side === 'fp' ? 'L' : ' Nazgûl'}`);
  for (const c of f.characters) if (characterSide(c) === side) parts.push(characterDef(c)?.name ?? c);
  if (!parts.length) return 'empty';
  return `${parts.join(', ')} (${Math.min(5, forceUnitCount(f))} dice, Leadership ${forceLeadership(state, f, side)})`;
}

/** Resolve pre-combat-timing card effects (Scouts retreat, Durin's Bane special
 *  attack) in initiative order — lower first, defender wins ties (rules p.29).
 *  A retreat empties the owner's region; a pre-attack damages the enemy. Fully
 *  automatic (auto-picked retreat + auto casualties), like the sub-machine's
 *  other non-choice steps. */
function resolvePreCombat(state: GameState, pc: PendingCombat, aMods: CombatMods, dMods: CombatMods): boolean {
  const effects: Array<{ side: Side; ini: number; mods: CombatMods }> = [];
  if (pc.attackerCard && (aMods.retreatBeforeCombat || aMods.preCombatAttackDice)) effects.push({ side: pc.attacker, ini: cardInitiative(pc.attackerCard), mods: aMods });
  if (pc.defenderCard && (dMods.retreatBeforeCombat || dMods.preCombatAttackDice)) effects.push({ side: pc.defender, ini: cardInitiative(pc.defenderCard), mods: dMods });
  if (!effects.length) return false;
  effects.sort((x, y) => x.ini - y.ini || (x.side === pc.defender ? -1 : 1)); // lower first; tie -> defender
  for (const ef of effects) {
    const own = ef.side === pc.attacker ? pc.from : pc.to;
    const enemy = ef.side === pc.attacker ? pc.to : pc.from;
    if (unitCount(state, own) === 0) continue; // owner already left/wiped by an earlier pre-effect
    if (ef.mods.retreatBeforeCombat) {
      const dests = freeAdjacentRegions(state, own, ef.side);
      // Let the owner CHOOSE the destination when there's more than one (rulebook:
      // retreat is the retreating player's choice). Only the simple single-effect case
      // is interactive; a rare retreat+pre-attack combo keeps the auto-pick.
      if (dests.length > 1 && effects.length === 1) {
        pc.preCombatRetreatFrom = own;
        state.pendingChoice = { owner: ef.side, kind: 'preCombatRetreat' };
        return true; // pause; resolvePreCombatRetreat resumes
      }
      const dest = dests[0] ?? null;
      if (dest) { moveStack(state, own, dest, ef.side, true, true); log(state, null, 'combat', `${ef.side} retreats ${own}→${dest} before combat`); }
    } else if (ef.mods.preCombatAttackDice) {
      if (unitCount(state, enemy) === 0) continue;
      const dice = ef.mods.preCombatAttackDice;
      const hits = withRng(state, (rng) => { let h = 0; for (let i = 0; i < dice; i++) if (rng.rollDie(6) >= 4) h++; return h; });
      if (hits > 0) { applyCasualties(state, enemy, armySide(state, enemy)!, hits, 'regularsFirst'); log(state, null, 'combat', `pre-combat attack scores ${hits} at ${enemy}`); }
    }
  }
  return false;
}

/** Free regions the pre-combat retreater (Scouts) may withdraw to. */
export const preCombatRetreatDestinations = (state: GameState): RegionId[] => {
  const pc = state.pendingCombat;
  if (!pc?.preCombatRetreatFrom) return [];
  const side = armySide(state, pc.preCombatRetreatFrom);
  return side ? freeAdjacentRegions(state, pc.preCombatRetreatFrom, side) : [];
};

/** Resolve the chosen pre-combat retreat destination. Moves the whole Army there;
 *  combatStep's top-of-loop empty-region check then ends the battle (no combat). */
export function resolvePreCombatRetreat(state: GameState, region: RegionId): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  const from = pc.preCombatRetreatFrom;
  delete pc.preCombatRetreatFrom;
  if (!from) return;
  const side = armySide(state, from);
  const dests = freeAdjacentRegions(state, from, side!);
  const dest = dests.includes(region) ? region : dests[0];
  if (dest) { moveStack(state, from, dest, side!, true, true); log(state, null, 'combat', `${side} retreats ${from}→${dest} before combat`); }
}

/** Move the whole army at `from` into `to` (defender gone), capturing. */
function advanceInto(state: GameState, attacker: Side, from: RegionId, to: RegionId): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  // Only the attacker's Nations advance (defensive side filter — see moveStack).
  for (const n of Object.keys(src.units) as Nation[]) {
    if (sideOfNation(n) !== attacker) continue;
    const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
    delete src.units[n];
  }
  // Only the attacker's own Characters advance; an enemy Character in `from` stays.
  // Saruman never leaves Orthanc (character card), so he holds even on an advance.
  const movingChars = src.characters.filter((c) => characterSide(c) === attacker && c !== 'saruman');
  moveOwnLeaders(attacker, src, dst); dst.characters.push(...movingChars);
  src.characters = src.characters.filter((c) => !movingChars.includes(c));
  captureIfEnemySettlement(state, to, attacker, true); // a post-battle capture is an attack (Wormtongue)
  // If the advancing army was besieging `from`, vacating its field lifts that siege
  // (the boxed garrison returns to the field) — e.g. a besieger that wins a field
  // battle in an adjacent region and advances out (player report).
  liftSiegeIfAbandoned(state, from);
}

/** Move the boxed garrison back into the region's open field (siege lifted). */
function liftSiege(state: GameState, id: RegionId): void {
  const r = state.regions[id]!, box = r.siegeBox; if (!box) return;
  // MERGE, never assign — see mergeForceInto: the open field can already hold friendly
  // figures, and overwriting `r.units` deletes them outright.
  mergeForceInto(state, id, box);
  delete r.siegeBox; r.besieged = false;
}

function finishCombat(state: GameState, advance: boolean): void {
  const pc = state.pendingCombat!;
  const r = state.regions[pc.to]!, box = r.siegeBox;
  const assault = pc.boxed === pc.defender && !!box; // besieger (in the region) storms the box
  const sortie = pc.boxed === pc.attacker && !!box;  // boxed garrison attacks the besiegers (p.32)
  // Losses snapshot BEFORE any move, read from whichever side sits in the box.
  const atkSurv = atkCount(state, pc);
  const defSurv = defCount(state, pc);
  const name = REGIONS[pc.to]!.name ?? pc.to;
  const side = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');
  // A wipe-out takes no ground. RAW p.32 ("Capturing a Settlement") gives the two
  // capture triggers, and BOTH require a surviving attacker: an enemy Army "enters
  // a region" (a dead Army enters nothing), or the Stronghold's defenders are
  // eliminated "and the besieging Army still has at least one unit remaining in the
  // region". A mutual wipe therefore captures nothing — it just ends the battle,
  // and (p.31) ends any siege, since an Army was completely eliminated.
  const mutualWipe = atkSurv === 0 && defSurv === 0;
  let captured = false, outcome: string;
  // Set when a relieving Army has earned the right to march into the freed region
  // (asked once the battle is fully wrapped up — see the end of this function).
  let reliefAdvance: { from: RegionId; to: RegionId; owner: Side } | null = null;
  if (sortie) {
    // The rearguard never left the Stronghold (p.32), so put it back BEFORE judging
    // whether the Stronghold stands undefended — a surviving rearguard still defends it.
    if (pc.rearguard) restoreRearguardInto(box!, pc.rearguard);
    const garrison = forceUnitCount(box!);
    if (defSurv === 0 && garrison > 0) {
      // Besiegers destroyed or retreated: the siege is over and the garrison returns to
      // the open field. p.32: a winning sortie "cannot advance outside of the region" —
      // it is already in its own region, so there is simply nothing further to move.
      liftSiege(state, pc.to);
      outcome = `The sortie from ${name} breaks the siege`;
    } else if (garrison === 0 && defSurv > 0) {
      // Every unit defending the Stronghold is gone and the besieger still holds the
      // region — p.32's second capture trigger, from the DEFENDER's side of this battle.
      delete r.siegeBox; r.besieged = false;
      captured = true; captureIfEnemySettlement(state, pc.to, pc.defender, true);
      outcome = `The sortie from ${name} is destroyed — ${side(pc.defender)} take the Stronghold`;
    } else if (garrison === 0 && defSurv === 0) {
      delete r.siegeBox; r.besieged = false;
      outcome = `Both Armies are destroyed at ${name}`;
    } else if (atkSurv === 0) {
      // The sortieing force died but a rearguard still holds the Stronghold, so the
      // Settlement does not fall — p.32 needs ALL its defenders eliminated.
      outcome = `The sortie from ${name} is destroyed — the Stronghold holds`;
    } else {
      // The attacker ceased: RAW moves the sortie back into the Stronghold. It never
      // left the box in this model, so the siege simply carries on.
      outcome = `The sortie from ${name} withdraws into the Stronghold`;
    }
  } else if (assault) {
    if (advance && defSurv === 0 && atkSurv > 0) { // garrison destroyed — the besieger (already here) takes the Stronghold
      captured = true; delete r.siegeBox; r.besieged = false; captureIfEnemySettlement(state, pc.to, pc.attacker, true);
      outcome = `${side(pc.attacker)} storm ${name}`;
    } else if (atkSurv === 0) {
      liftSiege(state, pc.to); // an empty box on a mutual wipe: the region simply ends up empty, control unchanged
      outcome = mutualWipe ? `Both Armies are destroyed at ${name} — siege lifted` : `The assault on ${name} is thrown back — siege lifted`;
    }
    else outcome = `The siege of ${name} holds`;
  } else if (box && advance && defSurv === 0) { // RELIEF: the besieger (defender here) is wiped → garrison reoccupies
    liftSiege(state, pc.to); outcome = `The siege of ${name} is lifted`;
    // p.32: a relieving Army "cannot advance into the region containing the Stronghold
    // unless the besieging Army is destroyed or retreats" — it just was, so the advance
    // is open, and p.31 makes it optional ("may immediately move"). It's a real choice:
    // the region is already friendly, so there's nothing to capture, and piling onto the
    // freed garrison can push the stack over the 10-unit limit. Ask, don't assume.
    if (atkSurv > 0) reliefAdvance = { from: pc.from, to: pc.to, owner: pc.attacker };
  } else { // normal field battle
    captured = advance && defSurv === 0 && atkSurv > 0;
    outcome = captured ? `${side(pc.attacker)} take ${name}`
      : mutualWipe ? `Both Armies are destroyed at ${name}`
      : pc.siege ? `The siege of ${name} holds` : `The attack on ${name} is repulsed`;
    if (advance && atkSurv > 0) { advanceInto(state, pc.attacker, pc.from, pc.to); r.besieged = false; }
    if (pc.siege && atkSurv === 0) r.besieged = false; // attacker gone
  }
  log(state, null, 'combat', `battle at ${pc.to} ended — ${outcome}`, {
    from: pc.from, to: pc.to, attacker: pc.attacker, rounds: pc.round + 1,
    atkLosses: Math.max(0, (pc.atkUnits0 ?? atkSurv) - atkSurv),
    defLosses: Math.max(0, (pc.defUnits0 ?? defSurv) - defSurv),
    captured, siege: !!pc.siege, outcome,
  });
  // The rearguard takes no part in the battle and never advances (p.28). When a relief
  // advance is still to be answered it must therefore stay held aside — restoring it
  // into `from` now would let advanceInto sweep it along. resolveRelieveAdvance puts it
  // back once the advance has (or hasn't) happened, matching the field battle's ordering.
  if (pc.rearguard && !reliefAdvance && !sortie) restoreRearguard(state, pc.from, pc.rearguard);
  state.lastBattle = {
    seq: (state.lastBattle?.seq ?? 0) + 1, from: pc.from, to: pc.to, attacker: pc.attacker, rounds: pc.round + 1,
    atkLosses: Math.max(0, (pc.atkUnits0 ?? atkSurv) - atkSurv), defLosses: Math.max(0, (pc.defUnits0 ?? defSurv) - defSurv),
    captured, siege: !!pc.siege, outcome, atkRoll: pc.atkRoll, defRoll: pc.defRoll,
  };
  const opp = other(pc.attacker);
  state.currentPlayer = state.dice[opp].length > 0 ? opp : pc.attacker;
  state.pendingCombat = null;
  // Asked after the battle is fully wrapped up — the advance is an End of Battle step
  // (p.31), so pendingCombat is already clear; currentActor follows pendingChoice.owner.
  if (reliefAdvance) {
    state.pendingChoice = {
      owner: reliefAdvance.owner, kind: 'relieveAdvance',
      data: { from: reliefAdvance.from, to: reliefAdvance.to, rearguard: pc.rearguard ?? null },
    };
  }
}

/** Resolve the relieving Army's optional End of Battle advance into the region whose
 *  siege it just broke (p.31 "may immediately move"; p.32 permits it once the besieging
 *  Army is destroyed or retreats). Returns the region advanced into, so the caller can
 *  run the over-stack check — the freed garrison is back on the field, so the combined
 *  stack can exceed 10 (p.26). Returns null when the Army holds its ground.
 *  DEVIATION (documented in docs/rules-spec.md): RAW advances "all or part" of the Army;
 *  this moves all of it, matching the field battle's advance. Splitting is available
 *  before the battle via the rearguard (p.28). */
export function resolveRelieveAdvance(state: GameState, advance: boolean): RegionId | null {
  const d = state.pendingChoice!.data as { from: RegionId; to: RegionId; rearguard: PendingCombat['rearguard'] | null };
  const owner = state.pendingChoice!.owner;
  const who = owner === 'fp' ? 'Free Peoples' : 'Shadow';
  state.pendingChoice = null;
  if (advance) advanceInto(state, owner, d.from, d.to);
  log(state, null, 'combat', advance
    ? `${who} advance into ${REGIONS[d.to]!.name ?? d.to}, relieving the siege`
    : `${who} hold at ${REGIONS[d.from]!.name ?? d.from} rather than advancing into ${REGIONS[d.to]!.name ?? d.to}`);
  // Only now — the rearguard must not be swept along by the advance (p.28).
  if (d.rearguard) restoreRearguard(state, d.from, d.rearguard);
  return advance ? d.to : null;
}

/** Drive the combat sub-machine until it needs a decision (sets pendingChoice)
 *  or the battle ends (clears pendingCombat). Called from advance(). */
export function combatStep(state: GameState): void {
  const pc = state.pendingCombat;
  if (!pc) return;
  for (;;) {
    // A wiped Army ends the battle — but NEVER between the two halves of the
    // casualty step. RAW p.29: the five Combat-round steps are "resolved
    // simultaneously by the players"; p.30 fixes only the DECISION order ("the
    // attacker decides first how to remove his units"). So when the attacker's
    // removal wipes him, the defender must STILL take the attacker's hits — p.31
    // names "one or BOTH Armies are completely eliminated" as an End of Battle
    // outcome. Skipping this guard for that one transition is what makes hits
    // simultaneous rather than attacker-first-resolved (a defender used to survive
    // a mutual wipe because pc.atkHits were silently discarded).
    if (pc.step !== 'defenderCasualties' && (atkCount(state, pc) === 0 || defCount(state, pc) === 0)) { finishCombat(state, true); return; }
    // The White Rider: once per battle, if Gandalf the White is in the FP Army and the
    // Shadow has Nazgûl Leadership to negate, ask the FP whether to forfeit his Leadership.
    if (!pc.whiteRiderAsked && whiteRiderApplicable(state, pc)) {
      pc.whiteRiderAsked = true;
      state.pendingChoice = { owner: 'fp', kind: 'whiteRider' }; // FP is always a participant
      return;
    }
    // Witch-king "Sorcerer": after the Shadow's round-1 Combat card, offer the draw.
    if (pc.sorcererDeck && !pc.sorcererAsked) {
      pc.sorcererAsked = true;
      state.pendingChoice = { owner: 'shadow', kind: 'sorcererDraw', data: { deck: pc.sorcererDeck } };
      return;
    }
    switch (pc.step) {
      case 'attackerCard': {
        // p.31 asks the Stronghold's defender "field battle or retreat into a siege?"
        // at the START of every round — including the first — so the offer is inserted
        // here rather than once at battle start. The latch is per-round: declining in
        // round 0 does not waive the choice in round 1.
        if (pc.siegeWithdrawAsked !== pc.round && strongholdWithdrawAvailable(state, pc)) {
          pc.step = 'siegeWithdraw'; continue;
        }
        if (hasPlayableCombatCard(state, pc.attacker)) { state.pendingChoice = { owner: pc.attacker, kind: 'combatCard' }; return; }
        pc.step = 'defenderCard'; continue;
      }
      case 'defenderCard': {
        if (hasPlayableCombatCard(state, pc.defender)) { state.pendingChoice = { owner: pc.defender, kind: 'combatCard' }; return; }
        pc.step = 'cardCost'; continue;
      }
      case 'cardCost': {
        // "Up to two hits against your units", "forfeit one or more points of Nazgûl
        // Leadership" — the owner sizes the card before the roll. Attacker first, so the
        // order matches the rest of the round. A side with nothing to spend is charged 0
        // rather than prompted with a single dead option.
        for (const side of [pc.attacker, pc.defender]) {
          const due = unpaidCost(state, pc, side, 'preRoll');
          if (!due) continue;
          if (due.range.max <= 0) {
            if (side === pc.attacker) pc.atkCardCost = 0; else pc.defCardCost = 0;
            continue;
          }
          state.pendingChoice = { owner: side, kind: 'combatCardCost',
            data: { card: due.card, kind: due.vc.kind, min: due.range.min, max: due.range.max } };
          return;
        }
        pc.step = 'beginRound'; continue;
      }
      case 'beginRound': {
        if (pc.round >= MAX_ROUNDS) { finishCombat(state, false); return; }
        // Both cards are now committed — announce them PUBLICLY (they're revealed
        // simultaneously per RAW; a "none" is stated explicitly so the opponent can
        // tell "no card" apart from "a card I didn't see" — player report). One entry
        // per side, tagged with the card id, so the OPPONENT's revealed combat card is
        // hoverable in the log and sorts by play order in the discard browser (the
        // owner's own earlier side-tagged play entry is hidden from the other seat).
        // Name BOTH halves — the combat title ('Desperate Battle') and the card it's
        // printed on ('Monsters Roused') — so the log entry correlates with the same
        // card's appearance in the discard browser, which lists the EVENT name
        // (player report: found "Monsters Roused" in the discard, couldn't find it
        // in the log — it was announced only by its combat title).
        const cardName = (id: string | null) => {
          if (!id) return 'no Combat Card';
          const def = EVENT_BY_ID[id];
          const combat = def?.combat?.title, event = def?.name;
          return combat && event && combat !== event ? `'${combat}' (combat half of ${event})` : `'${combat ?? event ?? id}'`;
        };
        const sideName = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');
        // Each side's combat card (if any) applies THIS round, then is spent —
        // a fresh card may be played next round (rules-spec §7, p.29).
        const aCtx = { ownCharacters: atkForce(state, pc).characters, cost: pc.atkCardCost };
        const dCtx = { ownCharacters: defForce(state, pc).characters, cost: pc.defCardCost };
        let aMods = pc.attackerCard ? (combatModsFor(pc.attackerCard, aCtx) ?? EMPTY_MODS) : EMPTY_MODS;
        let dMods = pc.defenderCard ? (combatModsFor(pc.defenderCard, dCtx) ?? EMPTY_MODS) : EMPTY_MODS;
        // Cancels resolve in initiative order (lower first; tie -> defender). A
        // cancel removes the opponent's card only if it resolves first — the
        // attacker (never the tie-winner) needs strictly lower initiative; the
        // defender wins ties.
        const aIni = pc.attackerCard ? cardInitiative(pc.attackerCard) : 99;
        const dIni = pc.defenderCard ? cardInitiative(pc.defenderCard) : 99;
        let aCancelled = false, dCancelled = false;
        if (aMods.cancelEnemyCard && pc.defenderCard && aIni < dIni) { dMods = EMPTY_MODS; dCancelled = true; }
        if (dMods.cancelEnemyCard && pc.attackerCard && dIni <= aIni) { aMods = EMPTY_MODS; aCancelled = true; }
        // Announce each card WITH what it mechanically does this round, so the dice
        // that follow can be audited against it (player report: a card was played
        // "for an effect without telling me what it did"). Logged after the cancel
        // check so a cancelled card reads as cancelled.
        const played = (card: string | null, mods: CombatMods, cancelled: boolean) => {
          if (!card) return cardName(card);
          if (cancelled) return `${cardName(card)} — CANCELLED by the opposing card`;
          const what = describeCombatMods(mods);
          return `${cardName(card)}${what ? ` — ${what}` : ''}`;
        };
        log(state, null, 'combat', `Round ${pc.round + 1}: ${sideName(pc.attacker)} (attacker) play ${played(pc.attackerCard, aMods, aCancelled)}`);
        if (pc.attackerCard) state.log[state.log.length - 1]!.card = pc.attackerCard;
        log(state, null, 'combat', `Round ${pc.round + 1}: ${sideName(pc.defender)} (defender) play ${played(pc.defenderCard, dMods, dCancelled)}`);
        if (pc.defenderCard) state.log[state.log.length - 1]!.card = pc.defenderCard;
        // Pre-combat timing effects (Scouts retreat / Durin's Bane pre-attack)
        // resolve in initiative order before the normal roll; either can end the
        // battle (a retreat empties a region, a pre-attack can wipe one).
        if (resolvePreCombat(state, pc, aMods, dMods)) return; // paused: owner is choosing the pre-combat retreat destination
        if (atkCount(state, pc) === 0 || defCount(state, pc) === 0) { finishCombat(state, true); return; }
        // Stronghold gives the attacker a 6-to-hit: the first round of a field
        // battle, and EVERY round of a siege assault. A sortie forfeits the
        // Stronghold's protection entirely (p.32: "both Armies scoring hits on a
        // '5' or higher"), which `fortified: false` already encodes.
        const atkTarget = (pc.siege || (pc.fortified && pc.round === 0)) ? 6 : 5;
        const aRoll: CombatRoll = { dice: [], rerolls: [], target: atkTarget };
        const atkHits = rollHits(state, pc.from, pc.to, pc.attacker, atkTarget, aMods, dMods, pc.whiteRiderForfeit, aRoll,
          pc.boxed === pc.attacker ? state.regions[pc.from]!.siegeBox : undefined, defForce(state, pc));
        // Help Unlooked For: cap the defender's dice (min 1) via the existing maxDiceEnemy mod.
        const defEnemyMods = pc.defDicePenalty
          ? { ...aMods, maxDiceEnemy: Math.max(1, Math.min(5, forceUnitCount(defForce(state, pc))) - pc.defDicePenalty) }
          : aMods;
        const dRoll: CombatRoll = { dice: [], rerolls: [], target: 5 };
        const defHits = rollHits(state, pc.to, pc.from, pc.defender, 5, dMods, defEnemyMods, pc.whiteRiderForfeit, dRoll,
          pc.boxed === pc.defender ? state.regions[pc.to]!.siegeBox : undefined, atkForce(state, pc));
        pc.atkRoll = aRoll; pc.defRoll = dRoll;
        // Hit cancellation: Shield-wall, plus Heroic Death's sacrifice-a-Leader.
        // Shield-wall only fires "if your opponent scored two or more hits", so a
        // cancel is gated on the ENEMY's rolled hits clearing cancelHitsMinEnemyHits.
        const cancelFor = (m: CombatMods, enemyHits: number) =>
          (enemyHits >= (m.cancelHitsMinEnemyHits ?? 1) ? (m.cancelHits ?? 0) : 0) + (m.sacrificeLeaderToCancelHit ?? 0);
        const dCancel = cancelFor(dMods, atkHits);
        const aCancel = cancelFor(aMods, defHits);
        if ((aMods.sacrificeLeaderToCancelHit ?? 0) > 0 && defHits > 0) { const af = atkForce(state, pc); af.leaders = Math.max(0, af.leaders - 1); }
        if ((dMods.sacrificeLeaderToCancelHit ?? 0) > 0 && atkHits > 0) { const df = defForce(state, pc); df.leaders = Math.max(0, df.leaders - 1); }
        let atk = Math.max(0, atkHits - dCancel);
        let def = Math.max(0, defHits - aCancel);
        // Mûmakil's later effect: +hits if you outscored the enemy (snapshot the
        // pre-bonus totals so simultaneous bonuses compare fairly).
        const a0 = atk, d0 = def;
        if (aMods.bonusHitIfOutscore && a0 > d0) atk += aMods.bonusHitIfOutscore;
        if (dMods.bonusHitIfOutscore && d0 > a0) def += dMods.bonusHitIfOutscore;
        // Enemy-figure eliminations (Blade of Westernesse / Fateful Strike): the
        // attacker's card targets the defender's army (pc.to), and vice versa.
        // (Force-keyed, not region-keyed: when either side is boxed the region's figures
        // belong to its opponent, so the region form used to strike the caster's OWN army.)
        atk = applyCombatEliminations(state, defForce(state, pc), pc.to, aMods, atk);
        def = applyCombatEliminations(state, atkForce(state, pc), pc.from, dMods, def);
        pc.atkHits = atk; pc.defHits = def;
        // Announce the round's dice PUBLICLY so both players can audit the resolution
        // (player report: "the log should display the combat dice rolls").
        // `rolled` is what the dice scored; `hits` is what survives card effects.
        // Show both when they differ, so a cancelled hit doesn't read as a bad
        // dice count (player report: "Shield Wall reduced the hits — did it?").
        const fmt = (roll: CombatRoll, rolled: number, hits: number) =>
          `[${roll.dice.join(' ')}] on ${roll.target}+`
          // The re-roll can have its OWN to-hit (cards bonus the two rolls separately).
          + (roll.rerolls.length ? ` re-roll [${roll.rerolls.join(' ')}]${roll.rerollTarget != null && roll.rerollTarget !== roll.target ? ` on ${roll.rerollTarget}+` : ''}` : '')
          + ` → ${rolled} hit${rolled === 1 ? '' : 's'}`
          + (hits !== rolled ? ` (${hits} after card effects)` : '');
        log(state, null, 'combat', `Round ${pc.round + 1} dice — attacker ${fmt(aRoll, atkHits, atk)}; defender ${fmt(dRoll, defHits, def)}`,
          { round: pc.round + 1, region: pc.to, attacker: { ...aRoll, hits: atk, rolled: atkHits }, defender: { ...dRoll, hits: def, rolled: defHits } });
        pc.attackerCard = null; pc.defenderCard = null;
        pc.atkCardCost = undefined; pc.defCardCost = undefined; // costs are per-round, like the cards
        pc.step = 'attackerCasualties'; continue;
      }
      case 'attackerCasualties': {
        if (pc.defHits > 0) {
          const boxedAtk = pc.boxed === pc.attacker; // sortie: the attacker's figures are in the box
          const f = atkForce(state, pc);
          // Forced hits land silently; the owner is asked only about the rest (p.30).
          const left = absorbForced(state, f, pc.attacker, pc.defHits);
          if (meaningfulForceCasualty(f, left)) {
            state.pendingChoice = { owner: pc.attacker, kind: 'combatCasualties', data: { region: pc.from, side: pc.attacker, hits: left, next: 'defenderCasualties', boxed: boxedAtk } };
            return;
          }
          finishForceCasualties(state, f);
        }
        pc.step = 'defenderCasualties'; continue;
      }
      case 'defenderCasualties': {
        if (pc.atkHits > 0) {
          const boxedDef = pc.boxed === pc.defender;
          const f = defForce(state, pc);
          const left = absorbForced(state, f, pc.defender, pc.atkHits);
          if (meaningfulForceCasualty(f, left)) {
            state.pendingChoice = { owner: pc.defender, kind: 'combatCasualties', data: { region: pc.to, side: pc.defender, hits: left, next: 'onslaught', boxed: boxedDef } };
            return;
          }
          finishForceCasualties(state, f);
        }
        pc.step = 'onslaught'; continue;
      }
      case 'onslaught': {
        // "AFTER removing casualties from the Combat roll and Leader re-roll, you may
        // inflict and apply up to four additional hits against your units. Roll one die
        // for each hit you inflicted … and score one hit against the enemy on each
        // result of 4+." Its own step because it is the only card paid after casualties.
        for (const side of [pc.attacker, pc.defender]) {
          const due = unpaidCost(state, pc, side, 'postCasualty');
          if (!due) continue;
          if (due.range.max <= 0) {
            if (side === pc.attacker) pc.atkCardCost = 0; else pc.defCardCost = 0;
            continue;
          }
          state.pendingChoice = { owner: side, kind: 'combatCardCost',
            data: { card: due.card, kind: due.vc.kind, min: due.range.min, max: due.range.max, postCasualty: true } };
          return;
        }
        pc.step = pc.siege ? 'siegeAdvance' : 'continueDecision'; continue;
      }
      case 'siegeWithdraw': {
        // The defender chooses: withdraw into the Stronghold (siege box) or fight in the open.
        state.pendingChoice = { owner: pc.defender, kind: 'siegeWithdraw' };
        return;
      }
      case 'siegeAdvance': {
        // A siege round resolved: capture if the garrison is gone, else count down
        // the assault's rounds (the attacker can't be made to continue past them).
        if (forceUnitCount(defForce(state, pc)) === 0) { finishCombat(state, true); return; }
        pc.siegeRoundsLeft = (pc.siegeRoundsLeft ?? 1) - 1;
        if (pc.siegeRoundsLeft > 0 && atkCount(state, pc) > 0) { pc.round += 1; pc.step = 'attackerCard'; continue; }
        // Out of rounds: the attacker MAY extend the assault one more round by
        // reducing one of his Elite units to a Regular (rulebook p.32) — a real
        // choice, not an auto-decline (player report).
        if (attackerHasElite(state, pc)) { state.pendingChoice = { owner: pc.attacker, kind: 'siegeExtend' }; return; }
        finishCombat(state, false); return; // the siege holds; attacker remains besieging
      }
      case 'continueDecision': {
        if (defCount(state, pc) === 0 || atkCount(state, pc) === 0) { finishCombat(state, true); return; }
        // Corsairs of Umbar: the attacker "cannot cease the attack" — press on.
        if (pc.noCease) { pc.step = 'retreatDecision'; continue; }
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
  const d = state.pendingChoice!.data as { region: RegionId; side: Side; hits: number; next: PendingCombat['step']; boxed?: boolean };
  const box = state.regions[d.region]!.siegeBox;
  applyForceCasualties(state, d.boxed && box ? box : state.regions[d.region]!, d.side, d.hits, plan);
  state.pendingCombat!.step = d.next;
  state.pendingChoice = null;
}
/** Whether the assaulting army still has an Elite unit to reduce (the currency for
 *  extending an assault past its rounds — rulebook p.32). */
function attackerHasElite(state: GameState, pc: PendingCombat): boolean {
  if (unitCount(state, pc.from) === 0) return false;
  return Object.values(state.regions[pc.from]!.units).some((u) => (u?.elite ?? 0) > 0);
}
/** Resolve the attacker's press-the-assault choice: reduce one Elite to a Regular to
 *  fight one more siege round (rulebook p.32), or stop (the siege holds). */
export function resolveSiegeExtend(state: GameState, extend: boolean): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  if (!extend) { finishCombat(state, false); return; }
  const r = state.regions[pc.from]!;
  const n = (Object.keys(r.units) as Nation[]).find((k) => (r.units[k]?.elite ?? 0) > 0);
  if (!n) { finishCombat(state, false); return; } // no Elite left to spend (shouldn't happen — gated on offer)
  r.units[n]!.elite -= 1; r.units[n]!.regular += 1; // the reduction swaps the figure on the board
  log(state, null, 'combat', `${pc.attacker} presses the assault: an Elite is reduced to a Regular for another round`);
  pc.siegeRoundsLeft = 1;
  pc.round += 1;
  pc.step = 'attackerCard'; // advance() re-drives the battle sub-machine
}
/** Resolve a variable-size combat card's cost: charge it, and for Onslaught roll the
 *  counter-attack it buys (one die per self-inflicted hit, a hit on 4+) and apply those
 *  hits to the enemy. The casualty allocation for BOTH sides of this exchange is
 *  auto-resolved Regulars-first — a documented deviation, matching the other
 *  card-driven eliminations. */
export function resolveCombatCardCost(state: GameState, amount: number): void {
  const pc = state.pendingCombat!;
  const d = state.pendingChoice!.data as { card: string; kind: VariableCost['kind']; min: number; max: number; postCasualty?: boolean };
  const side = state.pendingChoice!.owner;
  state.pendingChoice = null;
  const paid = Math.max(d.min, Math.min(d.max, Math.floor(amount)));
  if (side === pc.attacker) pc.atkCardCost = paid; else pc.defCardCost = paid;
  const vc = variableCostFor(d.card)!;
  payCardCost(state, pc, side, vc, paid);

  if (d.postCasualty && paid > 0) {
    // Onslaught's counter-attack. Hits on 4+, not the 5+ of a normal Combat roll.
    const dice: number[] = [];
    let hits = 0;
    withRng(state, (rng) => { for (let i = 0; i < paid; i++) { const r = rng.rollDie(6); dice.push(r); if (r >= 4) hits++; } });
    const enemy = other(side);
    const target = side === pc.attacker ? defForce(state, pc) : atkForce(state, pc);
    log(state, null, 'combat', `Onslaught counter-attack: [${dice.join(' ')}] on 4+ → ${hits} hit${hits === 1 ? '' : 's'}`);
    if (hits > 0) applyForceCasualties(state, target, enemy, hits, 'regularsFirst');
  }
  // Re-enter the same step so the OTHER side's cost (if any) is asked before moving on.
}

/** Resolve the defender's siege-withdraw choice: retreat into the Stronghold (the
 *  region becomes besieged, no battle this action) or stand and fight a field battle. */
export function resolveSiegeWithdraw(state: GameState, withdraw: boolean): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  if (withdraw) {
    const r = state.regions[pc.to]!;
    // RAW p.31: the defenders go into the Stronghold Box, and "the region around the
    // Stronghold is left open to the enemy, WHO MAY immediately advance into the
    // region. IF the attacking Army chooses to advance, the Stronghold is now
    // considered under siege and the battle is over." So the advance — and with it
    // whether a siege exists at all — is the attacker's call, not automatic.
    r.siegeBox = { units: r.units, leaders: r.leaders, nazgul: r.nazgul, characters: r.characters };
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    // NB the 5-unit garrison cap is NOT applied yet: it bites when a Stronghold "comes
    // under siege", and no siege exists until the besieger actually advances.
    state.pendingChoice = { owner: pc.attacker, kind: 'besiegerAdvance' };
    return;
  }
  // Fight in the open THIS round. The latch is per-round, so p.31 offers the choice
  // again at the start of the next one.
  pc.siegeWithdrawAsked = pc.round;
  pc.step = 'attackerCard';
}

/** Resolve the attacker's "advance into the vacated region?" call after a defender has
 *  retreated into the Stronghold (p.31). Advancing establishes the siege and ends the
 *  battle; declining leaves nobody besieging, so per p.32 ("if no Army units are left
 *  behind, the Stronghold is no longer under siege") the garrison simply comes back out
 *  and the battle ends with the ground unchanged. */
export function resolveBesiegerAdvance(state: GameState, advance: boolean): void {
  const pc = state.pendingCombat!;
  const r = state.regions[pc.to]!;
  state.pendingChoice = null;
  if (!advance) {
    // No besieger, no siege: the garrison returns to the open field it just left.
    if (r.siegeBox) mergeForceInto(state, pc.to, r.siegeBox);
    delete r.siegeBox; r.besieged = false;
    log(state, null, 'combat', `${pc.defender} fall back into ${REGIONS[pc.to]!.name ?? pc.to}, but ${pc.attacker} does not advance — no siege`);
    if (pc.rearguard) restoreRearguard(state, pc.from, pc.rearguard);
    state.lastBattle = {
      seq: (state.lastBattle?.seq ?? 0) + 1, from: pc.from, to: pc.to, attacker: pc.attacker, rounds: pc.round,
      atkLosses: Math.max(0, (pc.atkUnits0 ?? 0) - unitCount(state, pc.from)),
      defLosses: Math.max(0, (pc.defUnits0 ?? 0) - unitCount(state, pc.to)), captured: false, siege: false,
      outcome: `${pc.attacker === 'fp' ? 'Free Peoples' : 'Shadow'} decline to besiege ${REGIONS[pc.to]!.name ?? pc.to}`,
    };
    const opp0 = other(pc.attacker);
    state.currentPlayer = state.dice[opp0].length > 0 ? opp0 : pc.attacker;
    state.pendingCombat = null;
    return;
  }
  {
    capSiegeBox(state, pc.to); // NOW it comes under siege — garrison capped at 5 (p.31)
    moveStack(state, pc.from, pc.to, pc.attacker, false); // besieger occupies the open field (NO capture — the boxed garrison holds the Settlement)
    r.besieged = true;
    log(state, null, 'combat', `${pc.defender} withdraws into the siege at ${pc.to}; ${pc.attacker} besieges`);
    // The rearguard rejoins `from`; record the siege as established; resume the turn.
    if (pc.rearguard) restoreRearguard(state, pc.from, pc.rearguard);
    // `pc.round` is 0-based and counts the rounds ALREADY fought, so it is exactly the
    // round count for a mid-battle withdrawal (0 when they fall back before fighting).
    // Both sides can have real losses by then, so neither total is hard-coded any more.
    state.lastBattle = {
      seq: (state.lastBattle?.seq ?? 0) + 1, from: pc.from, to: pc.to, attacker: pc.attacker, rounds: pc.round,
      atkLosses: Math.max(0, (pc.atkUnits0 ?? 0) - unitCount(state, pc.to)), // the besieger has just moved from -> to
      defLosses: Math.max(0, (pc.defUnits0 ?? 0) - (r.siegeBox ? forceUnitCount(r.siegeBox) : 0)), captured: false, siege: true,
      outcome: `${pc.defender === 'fp' ? 'Free Peoples' : 'Shadow'} withdraw into the siege at ${REGIONS[pc.to]!.name ?? pc.to}`
        + (pc.round > 0 ? ` after ${pc.round} round${pc.round === 1 ? '' : 's'}` : ''),
    };
    const opp = other(pc.attacker);
    state.currentPlayer = state.dice[opp].length > 0 ? opp : pc.attacker;
    state.pendingCombat = null;
  }
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
    const dests = retreatOptions(state, pc);
    if (dests.length === 1) { moveStack(state, pc.to, dests[0]!, pc.defender, true, true); finishCombat(state, true); return; }
    if (dests.length > 1) { state.pendingChoice = { owner: pc.defender, kind: 'retreatTo' }; return; } // defender picks where
    // none available -> stand
  }
  // Next round re-opens combat-card play (cards are per-round now).
  pc.round += 1; pc.step = 'attackerCard';
}

/** Resolve the defender's chosen retreat destination ('retreatTo' choice). */
export function resolveRetreatTo(state: GameState, region: RegionId): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  const dests = retreatOptions(state, pc);
  const dest = dests.includes(region) ? region : dests[0];
  if (dest) { moveStack(state, pc.to, dest, pc.defender, true, true); finishCombat(state, true); return; }
  pc.round += 1; pc.step = 'attackerCard'; // shouldn't happen; stand as a fallback
}

/** Free regions the defender may retreat into (for the 'retreatTo' choice). A
 *  retreat never runs INTO the attack (p.31): the region the attackers came from is
 *  excluded explicitly. In practice the attacking Army stays there for the battle's
 *  duration, so `freeForMovement` already rules it out — but a player reported a
 *  retreat onto the attack's origin, and the guarantee should not rest on the
 *  attacker happening to still have units on the square. */
function retreatOptions(state: GameState, pc: PendingCombat): RegionId[] {
  return freeAdjacentRegions(state, pc.to, pc.defender).filter((r) => r !== pc.from);
}

/** Free regions the defender may retreat into (for the 'retreatTo' choice). */
export const retreatDestinations = (state: GameState): RegionId[] => {
  const pc = state.pendingCombat;
  return pc ? retreatOptions(state, pc) : [];
};
/** `capture`: a retreat that ENTERS an undefended enemy Settlement captures it
 *  (p.32: "captured when an enemy Army enters" — any movement counts; player
 *  report: a Shadow army retreated into Pelargir without taking it). The one
 *  NON-capturing use is siege entry, where the boxed garrison still holds. */
function moveStack(state: GameState, from: RegionId, to: RegionId, side: Side, capture = true, retreat = false): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  // Only `side`'s Nations travel — enemy units illegally sharing the region (a
  // corrupted state) must not be carried along by a retreat or advance.
  for (const n of Object.keys(src.units) as Nation[]) {
    if (sideOfNation(n) !== side) continue;
    const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
    delete src.units[n];
  }
  // Only the moving side's Characters travel; an enemy Character stranded in the
  // region stays behind (it never belonged to this Army). Saruman never leaves Orthanc
  // (character card). On a RETREAT there is a further rule — p.31, Special Exceptions:
  // "If the retreating Army contains a Character of Level 0, that Character is left
  // behind in the region." Level 0 is Saruman and Gollum, so this subsumes the Saruman
  // case on retreats and states the actual rule rather than one figure's name.
  const movingChars = src.characters.filter((c) =>
    characterSide(c) === side && c !== 'saruman' && !(retreat && levelOf(c) === 0));
  moveOwnLeaders(side, src, dst); dst.characters.push(...movingChars);
  src.characters = src.characters.filter((c) => !movingChars.includes(c));
  if (capture) captureIfEnemySettlement(state, to, side);
}

export const canRetreat = (state: GameState): boolean => retreatRegion(state, state.pendingCombat!) !== null;

/** The White Rider choice is offered only when Gandalf the White is in the FP Army and
 *  the Shadow has Nazgûl Leadership worth negating. */
export function whiteRiderApplicable(state: GameState, pc: PendingCombat): boolean {
  const fpR = pc.attacker === 'fp' ? pc.from : pc.to;
  const shR = pc.attacker === 'shadow' ? pc.from : pc.to;
  if (!state.regions[fpR]!.characters.includes('gandalf-white')) return false;
  const sr = state.regions[shR]!;
  return sr.nazgul + (sr.characters.includes('witch-king') ? 2 : 0) > 0;
}
/** Resolve the White Rider battle-start choice (combat resumes via advance). */
export function resolveWhiteRider(state: GameState, forfeit: boolean): void {
  state.pendingCombat!.whiteRiderForfeit = forfeit;
  state.pendingChoice = null;
}

// Companion ids (separated Companions can be "in the battle"); Hobbits among them.
const COMPANION_IDS = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin', 'aragorn', 'gandalf-white']);
const HOBBIT_IDS = new Set(['meriadoc', 'peregrin']);
// "Captain of the West": +1 Combat Strength to a FP Army these Companions are in.
const CAPTAINS = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'aragorn']);

/** Which of the battle's two regions holds the FP vs the Shadow army. */
function battleRegions(pc: PendingCombat): { fp: RegionId; sh: RegionId } {
  return pc.attacker === 'fp' ? { fp: pc.from, sh: pc.to } : { fp: pc.to, sh: pc.from };
}

/** Is a Combat card's precondition (the boldface "Play if…" line) met by the
 *  current battle? Covers the patterns the modelled cards use; an unrecognized
 *  precondition returns true (we can't prove it unmet — conservative). */
function combatPrecondMet(state: GameState, pc: PendingCombat, cardId: string): boolean {
  const pre = EVENT_BY_ID[cardId]?.combat?.precondition;
  if (!pre) return true;
  const { fp: fpR, sh: shR } = battleRegions(pc);
  const fp = state.regions[fpR]!, sh = state.regions[shR]!;
  const fpChars = fp.characters;
  const companionInBattle = fpChars.some((c) => COMPANION_IDS.has(c));
  const fpElite = Object.entries(fp.units).some(([n, u]) => sideOfNation(n as Nation) === 'fp' && u!.elite > 0);
  const shElite = Object.entries(sh.units).some(([n, u]) => sideOfNation(n as Nation) === 'shadow' && u!.elite > 0);
  const nazgulLeadership = sh.nazgul + (sh.characters.includes('witch-king') ? 2 : 0);
  const defNation = REGIONS[pc.to]!.nation;
  const has = (s: string) => pre.includes(s);

  if (has('Nazgûl is in the battle')) return sh.nazgul > 0 || sh.characters.includes('witch-king');
  if (has('same region as the Fellowship')) return pc.to === state.fellowship.location;
  if (has('Leader or a Companion')) return fp.leaders > 0 || companionInBattle;
  if (has('a Companion is in the battle')) return companionInBattle;
  if (has('Free Peoples Elite')) return fpElite;
  if (has('Shadow Elite')) return shElite;
  if (has('Southrons & Easterlings Elite')) return (sh.units.southrons?.elite ?? 0) > 0;
  if (has('Isengard Army unit')) return !!sh.units.isengard && REGIONS[pc.to]!.settlement === 'Stronghold';
  if (has('Leadership is 2')) return nazgulLeadership >= 2;
  if (has('Leadership is 1')) return nazgulLeadership >= 1;
  if (has('Rohan region, Fangorn or Orthanc')) return defNation === 'rohan' || pc.to === 'fangorn' || pc.to === 'orthanc';
  if (has('inside the borders of a Free Peoples Nation')) return !!defNation && sideOfNation(defNation) === 'fp';
  if (has('within two regions of Moria')) return withinRegions(pc.to, 'moria', 2);
  if (has('Strider/Aragorn')) return fpChars.includes('strider') || fpChars.includes('aragorn');
  if (has('Gandalf is in the battle')) return fpChars.includes('gandalf-grey') || fpChars.includes('gandalf-white');
  if (has('Hobbit')) return fpChars.some((c) => HOBBIT_IDS.has(c));
  // "Field battle" is RAW's term for any battle that is not a SIEGE battle (p.31 calls
  // the Stronghold's stand-and-fight option exactly that), so this keys on pc.siege —
  // not pc.fortified, which now only marks the City/Fortification to-hit penalty.
  if (has('defending in a field battle')) return pc.defender === 'fp' && !pc.siege;
  return true;
}

/** Hand cards a side could play as a combat card now: a modelled combat effect
 *  AND a satisfied precondition (rules-spec §7). */
const isCompanion = (id: string): boolean => !!(COMPANIONS[id] || UPGRADES[id]);
export function playableCombatCards(state: GameState, side: Side): string[] {
  const pc = state.pendingCombat;
  // Denethor's Folly: the FP may not use Combat cards for a battle in Minas Tirith.
  if (side === 'fp' && pc && fpCombatCardsBarredAt(state, pc.to)) return [];
  // Grond / The Fighting Uruk-hai: no FP Combat card in the first siege round unless
  // a Companion is in the besieged Stronghold. The garrison's Companions live in the
  // siege BOX (the region itself holds the besieger), so ask defForce — reading the
  // region made the exemption unreachable, locking the FP out even with a Companion.
  if (side === 'fp' && pc?.fpCardLock && pc.round === 0
    && !defForce(state, pc).characters.some(isCompanion)) return [];
  return state.cards[side].hand.filter((id) => hasCombatEffect(id) && (!pc || combatPrecondMet(state, pc, id)));
}
const hasPlayableCombatCard = (state: GameState, side: Side): boolean => playableCombatCards(state, side).length > 0;

/** Resolve the 'combatCard' PendingChoice: record the chosen card (or none) for
 *  the side whose step it is, discard it, and advance to the next card/round. */
export function resolvePlayCombatCard(state: GameState, cardId: string | null): void {
  const pc = state.pendingCombat!;
  const owner = pc.step === 'attackerCard' ? pc.attacker : pc.defender;
  if (cardId) {
    const hand = state.cards[owner].hand;
    const i = hand.indexOf(cardId);
    if (i >= 0) {
      hand.splice(i, 1);
      const deck = EVENT_BY_ID[cardId]!.deck === 'Character' ? 'character' : 'strategy';
      state.cards[owner].discard[deck].push(cardId);
    }
    if (pc.step === 'attackerCard') pc.attackerCard = cardId; else pc.defenderCard = cardId;
    log(state, owner, 'combat', `${owner} plays combat card ${EVENT_BY_ID[cardId]?.combat?.title ?? cardId}`);
    state.log[state.log.length - 1]!.card = cardId; // hoverable in the log
  }
  pc.step = pc.step === 'attackerCard' ? 'defenderCard' : 'beginRound';
  state.pendingChoice = null;
}

/** Regions where `side` has an At-War Army adjacent to an enemy Army. */
export function attackTargets(state: GameState, side: Side): Array<[RegionId, RegionId]> {
  const out: Array<[RegionId, RegionId]> = [];
  const enemy = other(side);
  for (const from of Object.keys(state.regions)) {
    // SORTIE (p.32): a besieged garrison may attack the besiegers in its own region,
    // fighting a field battle out of the Stronghold.
    const sb = sortieForce(state, from, side);
    if (sb && hasAtWarUnitInForce(state, sb, side) && !(side === 'shadow' && shadowBarredFromRegion(state, from))) out.push([from, from]);
    if (armySide(state, from) !== side || !hasAtWarUnit(state, from, side)) continue;
    // Every adjacent enemy army is a target (an army may face several); no cap.
    for (const to of REGIONS[from]!.adjacency) if (armySide(state, to) === enemy && !(side === 'shadow' && shadowBarredFromRegion(state, to))) out.push([from, to]);
    // ASSAULT: if we occupy a besieged Stronghold's open field, we may storm its box
    // (unless a card bars the Shadow from the region — same gate as a normal attack).
    const box = state.regions[from]!.siegeBox;
    if (box && forceUnitCount(box) > 0 && !(side === 'shadow' && shadowBarredFromRegion(state, from))) out.push([from, from]);
  }
  return out;
}
function hasAtWarUnit(state: GameState, id: RegionId, side: Side): boolean {
  return hasAtWarUnitInForce(state, state.regions[id]!, side);
}
function hasAtWarUnitInForce(state: GameState, f: Force, side: Side): boolean {
  for (const n of Object.keys(f.units) as Nation[]) {
    if (sideOfNation(n) === side && (f.units[n]!.regular + f.units[n]!.elite) > 0 && state.nations[n].step === 0) return true;
  }
  return false;
}
