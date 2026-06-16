// Interactive battle resolution (rules-spec §7). Combat is a resumable
// sub-machine: it pauses with a PendingChoice for each side's combat-card play
// EVERY round (gated by the card's "Play if…" precondition), casualty selection
// (when the choice is meaningful), the attacker's cease/continue decision, and
// the defender's retreat decision — honoring the prompt-for-every-choice fidelity
// decision. Still deferred: initiative-ordered resolution of competing effects
// (a card's initiative only matters when both sides' effects collide — see D5)
// and a few intricate per-effect cards (e.g. Mûmakil's two timings).
import type { GameState, Nation, RegionId, Side, PendingCombat } from './types';
import { REGIONS, sideOfNation, EVENT_BY_ID, COMPANIONS, UPGRADES, levelOf } from './data';
import { withRng } from './rng';
import { unitCount, leadership, captureIfEnemySettlement, armySide, freeForMovement, settlementController, enforceSiegeCap, type MoveSelection } from './armies';
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
  baseTarget: number, ownMods: CombatMods, enemyMods: CombatMods, whiteRiderForfeit = false): number {
  // Captain of the West: +1 Combat Strength (die) if such a Companion is in this FP Army.
  const captain = side === 'fp' && !enemyMods.enemyCaptainCancel && state.regions[ownRegion]!.characters.some((c) => CAPTAINS.has(c)) ? 1 : 0;
  let count = Math.min(5, unitCount(state, ownRegion) + captain);
  if (enemyMods.maxDiceEnemy != null) count = Math.min(count, enemyMods.maxDiceEnemy);
  const target = clamp(2, 6, baseTarget - (ownMods.rollBonus ?? 0) + (enemyMods.enemyRollPenalty ?? 0));
  // Forfeiting a Companion's Leadership (Mighty Attack) costs re-roll dice.
  let leadVal = Math.min(5, leadership(state, ownRegion, side));
  // Gandalf the White "The White Rider": when the FP chose (at battle start) to forfeit
  // his Leadership, all Nazgûl Leadership (incl. the Witch-king) is negated this battle.
  if (whiteRiderForfeit) {
    const shR = side === 'shadow' ? ownRegion : enemyRegion, sr = state.regions[shR]!;
    const nazgulLead = sr.nazgul + (sr.characters.includes('witch-king') ? 2 : 0);
    leadVal = Math.max(0, leadVal - (side === 'shadow' ? nazgulLead : 1));
  }
  const lead = Math.max(0, leadVal - (ownMods.ownLeadershipPenalty ?? 0) - (enemyMods.enemyLeadershipPenalty ?? 0));
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

// --- Attack split: the rearguard (rulebook p.28) -----------------------------
const nationAtWar = (state: GameState, n: Nation): boolean => state.nations[n].step === 0;

/** The figures that must be left out of the battle: the player's explicit rearguard
 *  selection, plus ALL units of the attacker's not-At-War Nations (which may never
 *  join a battle — a split is mandatory when such units are present). */
type Rearguard = NonNullable<PendingCombat['rearguard']>;
function fullRearguard(state: GameState, from: RegionId, side: Side, explicit?: MoveSelection): Rearguard {
  const r = state.regions[from]!;
  const units: Record<string, { regular: number; elite: number }> = {};
  for (const [n, u] of Object.entries(explicit?.units ?? {})) units[n] = { regular: u?.regular ?? 0, elite: u?.elite ?? 0 };
  for (const n of Object.keys(r.units) as Nation[]) {
    if (sideOfNation(n) === side && !nationAtWar(state, n) && (r.units[n]!.regular + r.units[n]!.elite) > 0) {
      units[n] = { regular: r.units[n]!.regular, elite: r.units[n]!.elite }; // all not-At-War units stay
    }
  }
  return { units, leaders: explicit?.leaders ?? 0, nazgul: explicit?.nazgul ?? 0, characters: explicit?.characters ?? [] };
}

/** Validate an attack's (optional) rearguard split. Returns an error string, or null. */
export function attackError(state: GameState, from: RegionId, side: Side, explicit?: MoveSelection, viaCharacterDie = false): string | null {
  if (armySide(state, from) !== side) return 'No attacking army';
  const r = state.regions[from]!;
  const rg = fullRearguard(state, from, side, explicit);
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
  if (viaCharacterDie && (r.leaders - rg.leaders) + (r.nazgul - rg.nazgul) + (r.characters.length - rg.characters.length) < 1) {
    return 'A Character-die attack must include a Leader or Character';
  }
  return null;
}

/** Remove the rearguard figures from `from`, returning the stash (held in the
 *  PendingCombat for the battle's duration). */
function stashRearguard(state: GameState, from: RegionId, rg: Rearguard): PendingCombat['rearguard'] {
  const r = state.regions[from]!;
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
  const r = state.regions[region]!;
  for (const [n, u] of Object.entries(stash.units)) {
    const d = r.units[n as Nation] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; r.units[n as Nation] = d;
  }
  r.leaders += stash.leaders; r.nazgul += stash.nazgul; r.characters.push(...stash.characters);
}

/** Begin a battle: political reactions, then set up the sub-machine. The driver
 *  (combatStep, run from advance) takes it from here. */
export function startBattle(state: GameState, attacker: Side, from: RegionId, to: RegionId,
  opts: { siegeRounds?: number; fpCardLock?: boolean; defenderDicePenalty?: number; rearguard?: MoveSelection } = {}): void {
  for (const n of nationsWithUnits(state, to)) onArmyAttacked(state, n, to);
  const dReg = REGIONS[to]!;
  const defender = other(attacker);
  const isStronghold = dReg.settlement === 'Stronghold';
  const alreadyBesieged = isStronghold && state.regions[to]!.besieged;
  const pc: PendingCombat = {
    attacker, defender, from, to, round: 0,
    fortified: dReg.settlement === 'City' || dReg.settlement === 'Fortification' || dReg.settlement === 'Stronghold',
    step: 'attackerCard', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0,
    defDicePenalty: opts.defenderDicePenalty,
  };
  if (opts.siegeRounds) {
    // Grond / The Fighting Uruk-hai force a multi-round assault on a besieged Stronghold.
    pc.siege = true; pc.siegeRoundsLeft = opts.siegeRounds; pc.fpCardLock = !!opts.fpCardLock;
  } else if (alreadyBesieged) {
    pc.siege = true; pc.siegeRoundsLeft = 1; // a normal siege assault is one round
  } else if (isStronghold && settlementController(state, to) === defender) {
    pc.step = 'siegeWithdraw'; // the defender may withdraw into the siege instead of a field battle
  }
  // Split off the rearguard (explicit + forced not-At-War units) before the battle.
  const rg = fullRearguard(state, from, attacker, opts.rearguard);
  const rgHasFigure = Object.values(rg.units).some((u) => u.regular + u.elite > 0) || rg.leaders > 0 || rg.nazgul > 0 || rg.characters.length > 0;
  if (rgHasFigure) pc.rearguard = stashRearguard(state, from, rg);
  state.pendingCombat = pc;
  log(state, null, 'combat', `${attacker} attacks ${to} from ${from}${pc.siege ? ' (siege assault)' : ''}${pc.rearguard ? ' (rearguard left behind)' : ''}`);
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
  if (advance && unitCount(state, pc.from) > 0) { advanceInto(state, pc.attacker, pc.from, pc.to); state.regions[pc.to]!.besieged = false; }
  if (pc.siege && unitCount(state, pc.from) === 0) state.regions[pc.to]!.besieged = false; // siege lifted: attacker gone
  log(state, null, 'combat', `battle at ${pc.to} ended (atk ${unitCount(state, pc.from)} / def ${unitCount(state, pc.to)})`);
  // The rearguard rejoins its origin region (it never advances into the battle).
  if (pc.rearguard) restoreRearguard(state, pc.from, pc.rearguard);
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
        // Stronghold gives the attacker a 6-to-hit: the first round of a field
        // battle, and EVERY round of a siege assault.
        const atkTarget = pc.fortified && (pc.siege || pc.round === 0) ? 6 : 5;
        const atkHits = rollHits(state, pc.from, pc.to, pc.attacker, atkTarget, aMods, dMods, pc.whiteRiderForfeit);
        // Help Unlooked For: cap the defender's dice (min 1) via the existing maxDiceEnemy mod.
        const defEnemyMods = pc.defDicePenalty
          ? { ...aMods, maxDiceEnemy: Math.max(1, Math.min(5, unitCount(state, pc.to)) - pc.defDicePenalty) }
          : aMods;
        const defHits = rollHits(state, pc.to, pc.from, pc.defender, 5, dMods, defEnemyMods, pc.whiteRiderForfeit);
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
            state.pendingChoice = { owner: pc.defender, kind: 'combatCasualties', data: { region: pc.to, side: pc.defender, hits: pc.atkHits, next: pc.siege ? 'siegeAdvance' : 'continueDecision' } };
            return;
          }
          applyCasualties(state, pc.to, pc.defender, pc.atkHits, 'regularsFirst');
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
        if (unitCount(state, pc.to) === 0) { finishCombat(state, true); return; }
        pc.siegeRoundsLeft = (pc.siegeRoundsLeft ?? 1) - 1;
        if (pc.siegeRoundsLeft > 0 && unitCount(state, pc.from) > 0) { pc.round += 1; pc.step = 'attackerCard'; continue; }
        finishCombat(state, false); return; // the siege holds; attacker remains besieging
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
/** Resolve the defender's siege-withdraw choice: retreat into the Stronghold (the
 *  region becomes besieged, no battle this action) or stand and fight a field battle. */
export function resolveSiegeWithdraw(state: GameState, withdraw: boolean): void {
  const pc = state.pendingCombat!;
  state.pendingChoice = null;
  if (withdraw) {
    state.regions[pc.to]!.besieged = true;
    enforceSiegeCap(state, pc.to); // a besieged Stronghold holds at most 5 units (rulebook p.31)
    log(state, null, 'combat', `${pc.defender} withdraws into the siege at ${pc.to}`);
    finishCombat(state, false); // siege established; the assault itself is a later action
    return;
  }
  pc.step = 'attackerCard'; // fight in the open
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
  if (has('defending in a field battle')) return pc.defender === 'fp' && !pc.fortified;
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
  // a Companion is in the besieged Stronghold.
  if (side === 'fp' && pc?.fpCardLock && pc.round === 0
    && !state.regions[pc.to]!.characters.some(isCompanion)) return [];
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
export function attackTargets(state: GameState, side: Side): Array<[RegionId, RegionId]> {
  const out: Array<[RegionId, RegionId]> = [];
  const enemy = other(side);
  for (const from of Object.keys(state.regions)) {
    if (armySide(state, from) !== side || !hasAtWarUnit(state, from, side)) continue;
    // Every adjacent enemy army is a target (an army may face several); no cap.
    for (const to of REGIONS[from]!.adjacency) if (armySide(state, to) === enemy && !(side === 'shadow' && shadowBarredFromRegion(state, to))) out.push([from, to]);
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
