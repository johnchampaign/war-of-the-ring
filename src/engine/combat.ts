// Interactive battle resolution (rules-spec §7). Combat is a resumable
// sub-machine: it pauses with a PendingChoice for each side's combat-card play
// EVERY round (gated by the card's "Play if…" precondition), casualty selection
// (when the choice is meaningful), the attacker's cease/continue decision, and
// the defender's retreat decision — honoring the prompt-for-every-choice fidelity
// decision. Still deferred: initiative-ordered resolution of competing effects
// (a card's initiative only matters when both sides' effects collide — see D5)
// and a few intricate per-effect cards (e.g. Mûmakil's two timings).
import type { GameState, Nation, RegionId, Side, PendingCombat } from './types';
import { REGIONS, sideOfNation, EVENT_BY_ID } from './data';
import { withRng } from './rng';
import { unitCount, leadership, captureIfEnemySettlement, armySide, freeForMovement } from './armies';
import { onArmyAttacked } from './politics';
import { shadowBarredFromRegion, fpCombatCardsBarredAt } from './persistent';
import { combatModsFor, hasCombatEffect, EMPTY_MODS, type CombatMods } from './combatCards';
import { log } from './log';

const MAX_ROUNDS = 5;
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
function freeAdjacentFor(state: GameState, regionId: RegionId, side: Side): RegionId | null {
  return freeAdjacentRegions(state, regionId, side)[0] ?? null;
}
const nationsWithUnits = (state: GameState, id: RegionId): Nation[] =>
  (Object.keys(state.regions[id]!.units) as Nation[]).filter((n) => (state.regions[id]!.units[n]!.regular + state.regions[id]!.units[n]!.elite) > 0);

/** Hits for one side's roll, applying that side's combat-card mods and the
 *  enemy's penalty mods. */
function rollHits(state: GameState, ownRegion: RegionId, enemyRegion: RegionId, side: Side,
  baseTarget: number, ownMods: CombatMods, enemyMods: CombatMods): number {
  let count = Math.min(5, unitCount(state, ownRegion));
  if (enemyMods.maxDiceEnemy != null) count = Math.min(count, enemyMods.maxDiceEnemy);
  const target = clamp(2, 6, baseTarget - (ownMods.rollBonus ?? 0) + (enemyMods.enemyRollPenalty ?? 0));
  // Forfeiting a Companion's Leadership (Mighty Attack) costs re-roll dice.
  const lead = Math.max(0, Math.min(5, leadership(state, ownRegion, side)) - (ownMods.ownLeadershipPenalty ?? 0));
  const allowReroll = !enemyMods.negateEnemyReroll;
  let hits = withRng(state, (rng) => {
    let h = 0, failed = 0;
    for (let i = 0; i < count; i++) { const d = rng.rollDie(6); if (d === 6 || (d !== 1 && d >= target)) h++; else failed++; }
    if (allowReroll) for (let i = 0; i < Math.min(lead, failed); i++) { const d = rng.rollDie(6); if (d === 6 || (d !== 1 && d >= target)) { h++; failed--; } }
    for (let i = 0; i < (ownMods.extraAttackDice ?? 0); i++) { const d = rng.rollDie(6); if (d >= 5) h++; } // extra attack hits on 5+
    // Mighty Attack: turn up to N still-missed dice into hits.
    h += Math.min(ownMods.guaranteedHits ?? 0, failed);
    return h;
  });
  if ((ownMods.bonusHitsIfAny ?? 0) > 0 && hits > 0) hits += ownMods.bonusHitsIfAny!;
  if ((ownMods.bonusHitsIfOutnumber ?? 0) > 0 && unitCount(state, ownRegion) >= 2 * Math.max(1, unitCount(state, enemyRegion))) hits += ownMods.bonusHitsIfOutnumber!;
  return hits;
}

const MINION_SET = new Set(['witch-king', 'saruman', 'mouth-of-sauron']);

/** Apply a combat card's enemy-figure eliminations after the rolls. Returns the
 *  owner's remaining hits (Blade of Westernesse spends a hit per Minion killed).
 *  Eliminated Nazgûl return to the Sauron reinforcements; Minions are removed for
 *  good. `enemy` is the region holding the card owner's opponent. */
function applyCombatEliminations(state: GameState, enemy: RegionId, mods: CombatMods, ownHits: number): number {
  const e = state.regions[enemy]!;
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
  return hits;
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
    step: 'attackerCard', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0,
  };
  log(state, null, 'combat', `${attacker} attacks ${to} from ${from}`);
  void def;
}

function retreatRegion(state: GameState, pc: PendingCombat): RegionId | null {
  return freeAdjacentFor(state, pc.to, pc.defender);
}

/** Resolve pre-combat-timing card effects (Scouts retreat, Durin's Bane special
 *  attack) in initiative order — lower first, defender wins ties (rules p.29).
 *  A retreat empties the owner's region; a pre-attack damages the enemy. Fully
 *  automatic (auto-picked retreat + auto casualties), like the sub-machine's
 *  other non-choice steps. */
function resolvePreCombat(state: GameState, pc: PendingCombat, aMods: CombatMods, dMods: CombatMods): void {
  const effects: Array<{ side: Side; ini: number; mods: CombatMods }> = [];
  if (pc.attackerCard && (aMods.retreatBeforeCombat || aMods.preCombatAttackDice)) effects.push({ side: pc.attacker, ini: cardInitiative(pc.attackerCard), mods: aMods });
  if (pc.defenderCard && (dMods.retreatBeforeCombat || dMods.preCombatAttackDice)) effects.push({ side: pc.defender, ini: cardInitiative(pc.defenderCard), mods: dMods });
  if (!effects.length) return;
  effects.sort((x, y) => x.ini - y.ini || (x.side === pc.defender ? -1 : 1)); // lower first; tie -> defender
  for (const ef of effects) {
    const own = ef.side === pc.attacker ? pc.from : pc.to;
    const enemy = ef.side === pc.attacker ? pc.to : pc.from;
    if (unitCount(state, own) === 0) continue; // owner already left/wiped by an earlier pre-effect
    if (ef.mods.retreatBeforeCombat) {
      const dest = freeAdjacentFor(state, own, ef.side);
      if (dest) { moveStack(state, own, dest); log(state, null, 'combat', `${ef.side} retreats ${own}→${dest} before combat`); }
    } else if (ef.mods.preCombatAttackDice) {
      if (unitCount(state, enemy) === 0) continue;
      const dice = ef.mods.preCombatAttackDice;
      const hits = withRng(state, (rng) => { let h = 0; for (let i = 0; i < dice; i++) if (rng.rollDie(6) >= 4) h++; return h; });
      if (hits > 0) { applyCasualties(state, enemy, armySide(state, enemy)!, hits, 'regularsFirst'); log(state, null, 'combat', `pre-combat attack scores ${hits} at ${enemy}`); }
    }
  }
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
      case 'attackerCard': {
        if (hasPlayableCombatCard(state, pc.attacker)) { state.pendingChoice = { owner: pc.attacker, kind: 'combatCard' }; return; }
        pc.step = 'defenderCard'; continue;
      }
      case 'defenderCard': {
        if (hasPlayableCombatCard(state, pc.defender)) { state.pendingChoice = { owner: pc.defender, kind: 'combatCard' }; return; }
        pc.step = 'beginRound'; continue;
      }
      case 'beginRound': {
        if (pc.round >= MAX_ROUNDS) { finishCombat(state, false); return; }
        // Each side's combat card (if any) applies THIS round, then is spent —
        // a fresh card may be played next round (rules-spec §7, p.29).
        let aMods = pc.attackerCard ? (combatModsFor(pc.attackerCard) ?? EMPTY_MODS) : EMPTY_MODS;
        let dMods = pc.defenderCard ? (combatModsFor(pc.defenderCard) ?? EMPTY_MODS) : EMPTY_MODS;
        // Cancels resolve in initiative order (lower first; tie -> defender). A
        // cancel removes the opponent's card only if it resolves first — the
        // attacker (never the tie-winner) needs strictly lower initiative; the
        // defender wins ties.
        const aIni = pc.attackerCard ? cardInitiative(pc.attackerCard) : 99;
        const dIni = pc.defenderCard ? cardInitiative(pc.defenderCard) : 99;
        if (aMods.cancelEnemyCard && pc.defenderCard && aIni < dIni) dMods = EMPTY_MODS;
        if (dMods.cancelEnemyCard && pc.attackerCard && dIni <= aIni) aMods = EMPTY_MODS;
        // Pre-combat timing effects (Scouts retreat / Durin's Bane pre-attack)
        // resolve in initiative order before the normal roll; either can end the
        // battle (a retreat empties a region, a pre-attack can wipe one).
        resolvePreCombat(state, pc, aMods, dMods);
        if (unitCount(state, pc.from) === 0 || unitCount(state, pc.to) === 0) { finishCombat(state, true); return; }
        const atkTarget = pc.round === 0 && pc.fortified ? 6 : 5; // siege bonus first round only
        const atkHits = rollHits(state, pc.from, pc.to, pc.attacker, atkTarget, aMods, dMods);
        const defHits = rollHits(state, pc.to, pc.from, pc.defender, 5, dMods, aMods);
        // Hit cancellation: Shield-wall, plus Heroic Death's sacrifice-a-Leader.
        const dCancel = (dMods.cancelHits ?? 0) + (dMods.sacrificeLeaderToCancelHit ?? 0);
        const aCancel = (aMods.cancelHits ?? 0) + (aMods.sacrificeLeaderToCancelHit ?? 0);
        if ((aMods.sacrificeLeaderToCancelHit ?? 0) > 0 && defHits > 0) state.regions[pc.from]!.leaders = Math.max(0, state.regions[pc.from]!.leaders - 1);
        if ((dMods.sacrificeLeaderToCancelHit ?? 0) > 0 && atkHits > 0) state.regions[pc.to]!.leaders = Math.max(0, state.regions[pc.to]!.leaders - 1);
        let atk = Math.max(0, atkHits - dCancel);
        let def = Math.max(0, defHits - aCancel);
        // Mûmakil's later effect: +hits if you outscored the enemy (snapshot the
        // pre-bonus totals so simultaneous bonuses compare fairly).
        const a0 = atk, d0 = def;
        if (aMods.bonusHitIfOutscore && a0 > d0) atk += aMods.bonusHitIfOutscore;
        if (dMods.bonusHitIfOutscore && d0 > a0) def += dMods.bonusHitIfOutscore;
        // Enemy-figure eliminations (Blade of Westernesse / Fateful Strike): the
        // attacker's card targets the defender's army (pc.to), and vice versa.
        atk = applyCombatEliminations(state, pc.to, aMods, atk);
        def = applyCombatEliminations(state, pc.from, dMods, def);
        pc.atkHits = atk; pc.defHits = def;
        pc.attackerCard = null; pc.defenderCard = null;
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
    const dests = freeAdjacentRegions(state, pc.to, pc.defender);
    if (dests.length === 1) { moveStack(state, pc.to, dests[0]!); finishCombat(state, true); return; }
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
  const dests = freeAdjacentRegions(state, pc.to, pc.defender);
  const dest = dests.includes(region) ? region : dests[0];
  if (dest) { moveStack(state, pc.to, dest); finishCombat(state, true); return; }
  pc.round += 1; pc.step = 'attackerCard'; // shouldn't happen; stand as a fallback
}

/** Free regions the defender may retreat into (for the 'retreatTo' choice). */
export const retreatDestinations = (state: GameState): RegionId[] => {
  const pc = state.pendingCombat;
  return pc ? freeAdjacentRegions(state, pc.to, pc.defender) : [];
};
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

// Companion ids (separated Companions can be "in the battle"); Hobbits among them.
const COMPANION_IDS = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin', 'aragorn', 'gandalf-white']);
const HOBBIT_IDS = new Set(['meriadoc', 'peregrin']);

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
  if (has('defending in a field battle')) return pc.defender === 'fp' && !pc.fortified;
  return true;
}

/** Hand cards a side could play as a combat card now: a modelled combat effect
 *  AND a satisfied precondition (rules-spec §7). */
export function playableCombatCards(state: GameState, side: Side): string[] {
  const pc = state.pendingCombat;
  // Denethor's Folly: the FP may not use Combat cards for a battle in Minas Tirith.
  if (side === 'fp' && pc && fpCombatCardsBarredAt(state, pc.to)) return [];
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
  }
  pc.step = pc.step === 'attackerCard' ? 'defenderCard' : 'beginRound';
  state.pendingChoice = null;
}

/** Regions where `side` has an At-War Army adjacent to an enemy Army. */
export function attackTargets(state: GameState, side: Side, cap = 8): Array<[RegionId, RegionId]> {
  const out: Array<[RegionId, RegionId]> = [];
  const enemy = other(side);
  for (const from of Object.keys(state.regions)) {
    if (out.length >= cap) break;
    if (armySide(state, from) !== side || !hasAtWarUnit(state, from, side)) continue;
    for (const to of REGIONS[from]!.adjacency) if (armySide(state, to) === enemy && !(side === 'shadow' && shadowBarredFromRegion(state, to))) { out.push([from, to]); break; }
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
