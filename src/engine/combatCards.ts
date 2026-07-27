// Combat-card effects (rules-spec §7, the bottom half of every Event card). Many
// cards share a combat title, so effects are keyed by TITLE. Each maps to a
// CombatMods the battle roll reads. Mechanically-simple effects are modelled
// faithfully; a few intricate ones (specific Character elimination, forfeit-
// Leadership bookkeeping, retreat-as-card) are approximated or omitted — a card
// with no mapped title is simply not offered as a combat card. See D5 note.
import { EVENT_BY_ID } from './data';

export interface CombatMods {
  /** +N to the owner's COMBAT ROLL dice (lowers the hit target). The cards name the
   *  Combat roll and the Leader re-roll separately ("Add 1 to all dice on your Combat
   *  roll" vs "…on your Combat roll and Leader re-roll"), so these are two fields —
   *  a Combat-roll bonus does NOT carry into the re-roll (player report). */
  rollBonus?: number;
  /** +N to the owner's LEADER RE-ROLL dice. */
  rerollBonus?: number;
  /** "Both Armies add N…" (Deadly Strife, Desperate Battle): the roll/re-roll bonus
   *  applies to the ENEMY's rolls too, not just the owner's. */
  symmetricBonus?: boolean;
  /** +N to the enemy's COMBAT ROLL hit target (their dice are worse). */
  enemyRollPenalty?: number;
  /** Cap the enemy's number of dice this round. */
  maxDiceEnemy?: number;
  /** The enemy rolls N fewer Combat dice, to a minimum of one (Dread and Despair). */
  enemyDiceReduction?: number;
  /** Roll an extra attack of N dice (hits on 5+), added to the owner's hits. */
  extraAttackDice?: number;
  /** +N hits if the owner scored at least one hit. */
  bonusHitsIfAny?: number;
  /** +N hits if the owner has at least twice the enemy's units. */
  bonusHitsIfOutnumber?: number;
  /** Cancel the enemy's combat card entirely. */
  cancelEnemyCard?: boolean;
  /** Negate the enemy's Leader re-roll. */
  negateEnemyReroll?: boolean;
  /** Negate it ONLY when the Shadow's Nazgûl Leadership equals or exceeds the total
   *  Free Peoples Leadership — Foul Stench states that as a condition, not a cost, and
   *  it used to be applied unconditionally. Evaluated at roll time in rollHits, where
   *  both Forces are known. */
  negateEnemyRerollIfNazgulDominant?: boolean;
  /** Cancel N hits the owner would take this round. */
  cancelHits?: number;
  /** `cancelHits` only applies if the ENEMY scored at least this many hits this
   *  round. Shield-wall reads "if your opponent scored two or more hits, cancel
   *  one hit" — a single hit is NOT cancelled (player report). Default 1. */
  cancelHitsMinEnemyHits?: number;
  /** +N hits if, after the re-roll, the owner scored MORE total hits than the
   *  enemy (Mûmakil's second, later-initiative effect). Evaluated post-roll. */
  bonusHitIfOutscore?: number;
  /** Forfeit a Companion's Leadership to turn N missed dice into hits: +N hits,
   *  −N from the owner's re-roll Leadership (Mighty Attack). */
  guaranteedHits?: number;
  /** Reduce the owner's own Leader re-roll dice by N (the forfeit cost). */
  ownLeadershipPenalty?: number;
  /** Spend N of the owner's hits to eliminate up to N enemy Minions in the
   *  battle (Blade of Westernesse). */
  eliminateMinion?: number;
  /** If the owner scored ≥1 hit, eliminate up to N enemy Nazgûl in the battle —
   *  they return to reinforcements (Fateful Strike). */
  eliminateNazgulIfHit?: number;
  /** Sacrifice one of the owner's Leaders to cancel one incoming hit
   *  (Heroic Death) — modelled as cancelHits with a Leader cost. */
  sacrificeLeaderToCancelHit?: number;
  // --- pre-combat timing effects (resolved BEFORE the normal roll, in
  //     initiative order; lower first, defender wins ties) ---
  /** Retreat the owner's Army to a free adjacent region before combat (Scouts). */
  retreatBeforeCombat?: boolean;
  /** Roll N extra dice as a pre-combat attack on the enemy (hits on 4+),
   *  applied immediately before the normal round (Durin's Bane). */
  preCombatAttackDice?: number;
  /** Reduce the ENEMY's effective Leadership by N this round (cancel a Companion's
   *  Leadership — Words of Power). */
  enemyLeadershipPenalty?: number;
  /** Cancel the enemy's Captain-of-the-West die bonus this round (the "abilities"
   *  half of Words of Power). */
  enemyCaptainCancel?: boolean;
  /** Black Breath: if the owner scored ≥1 hit, additionally eliminate one enemy FP
   *  Leader in the battle, OR a Companion whose Level ≤ the round's hits. */
  blackBreath?: boolean;
}

// Effects by combat title.
const BY_TITLE: Record<string, CombatMods> = {
  // straight die bonuses — Combat roll ONLY ("Add 1 to all dice on your Combat roll")
  'Valour': { rollBonus: 1 },
  'Servant of the Secret Fire': { rollBonus: 1 },
  'Devilry of Orthanc': { rollBonus: 1 },
  "Ents' Rage": { rollBonus: 2 },
  // …and the ones that name BOTH rolls ("your Combat roll and Leader re-roll")
  'It Is a Gift': { rollBonus: 1, rerollBonus: 1 },
  'One for the Dark Lord': { rollBonus: 1, rerollBonus: 1 },
  // fixed Nazgûl-Leadership forfeits (no choice — the cost is stated on the card)
  'Cruel as Death': { rollBonus: 1, ownLeadershipPenalty: 2 },
  'They Are Terrible': { rerollBonus: 1, ownLeadershipPenalty: 1 }, // Leader re-roll ONLY
  // forfeit a Companion's Leadership to turn one miss into a hit
  'Mighty Attack': { guaranteedHits: 1, ownLeadershipPenalty: 1 },
  'Andúril': { guaranteedHits: 1, ownLeadershipPenalty: 1 }, // Strider's rating; upgraded to Aragorn's 2 in combatModsFor
  // "Both Armies add N to all dice on their Combat roll and Leader re-roll"
  'Deadly Strife': { rollBonus: 2, rerollBonus: 2, symmetricBonus: true },
  'Desperate Battle': { rollBonus: 1, rerollBonus: 1, symmetricBonus: true },
  'Relentless Assault': {}, // sized by the self-hits the owner chooses to inflict (VARIABLE_COST)
  // weaken the enemy
  'Daylight': { maxDiceEnemy: 3 },
  'Brave Stand': { maxDiceEnemy: 3 },
  'Huorn-dark': { maxDiceEnemy: 2 },
  'Advantageous Position': { enemyRollPenalty: 1 },
  // Forfeit 1 Nazgûl Leadership → the enemy rolls 1 fewer COMBAT die (not a worse
  // to-hit). Forfeiting more than one point is a choice — unmodelled (D5).
  'Dread and Despair': {}, // sized by the Nazgûl Leadership the owner forfeits (VARIABLE_COST)
  'Confusion': { enemyRollPenalty: 1 },
  'Foul Stench': { negateEnemyRerollIfNazgulDominant: true }, // RAW gates it on Leadership (see the field)
  // cancel one enemy Companion's Leadership + abilities for the round
  'Words of Power': { enemyLeadershipPenalty: 1, enemyCaptainCancel: true },
  // eliminate an FP Leader / Companion when the Leader re-roll scores a hit
  'Black Breath': { blackBreath: true },
  // extra attacks
  'Charge': { extraAttackDice: 3 },
  'Sudden Strike': { extraAttackDice: 3 },
  'We Come to Kill': { extraAttackDice: 3 },
  'Onslaught': {}, // resolved as its own post-casualty step, not a roll modifier (VARIABLE_COST)
  // extra hits
  'No Quarter': { bonusHitsIfAny: 1 },
  'Nameless Wood': { bonusHitsIfAny: 2 },
  'Great Host': { bonusHitsIfOutnumber: 1 },
  // cancels / defense
  'Daring Defiance': { cancelEnemyCard: true },
  'Swarm of Bats': { cancelEnemyCard: true },
  'Shield-wall': { cancelHits: 1, cancelHitsMinEnemyHits: 2 },
  // multi-effect (per-effect initiative 3-5): +1 dice (init 3) AND +1 hit if you
  // outscore the enemy after the re-roll (init 5). See data.ts initiative note.
  'Mûmakil': { rollBonus: 1, bonusHitIfOutscore: 1 },
  // elimination / sacrifice
  'Blade of Westernesse': { eliminateMinion: 1 },
  'Fateful Strike': { eliminateNazgulIfHit: 1 },
  'Heroic Death': { sacrificeLeaderToCancelHit: 1 },
  // pre-combat timing (resolved before the normal roll, in initiative order)
  'Scouts': { retreatBeforeCombat: true },          // init 1
  "Durin's Bane": { preCombatAttackDice: 3 },       // init 2
};

/** A short, plain-language summary of what a combat card actually DOES mechanically,
 *  for the battle log — so a player can audit the resolution against the dice that
 *  follow instead of guessing (player report: "the AI plays a card for an effect
 *  without telling me what it did"). Empty string if nothing is modelled. */
export function describeCombatMods(mods: CombatMods): string {
  const p: string[] = [];
  if (mods.rollBonus && mods.rerollBonus) p.push(`+${mods.rollBonus} to Combat roll and Leader re-roll dice${mods.symmetricBonus ? ' for BOTH Armies' : ''}`);
  else {
    if (mods.rollBonus) p.push(`+${mods.rollBonus} to Combat roll dice`);
    if (mods.rerollBonus) p.push(`+${mods.rerollBonus} to Leader re-roll dice`);
  }
  if (mods.enemyRollPenalty) p.push(`−${mods.enemyRollPenalty} to the enemy's Combat roll dice`);
  if (mods.maxDiceEnemy != null) p.push(`enemy rolls at most ${mods.maxDiceEnemy} Combat dice`);
  if (mods.enemyDiceReduction) p.push(`enemy rolls ${mods.enemyDiceReduction} fewer Combat ${mods.enemyDiceReduction === 1 ? 'die' : 'dice'} (min 1)`);
  if (mods.ownLeadershipPenalty) p.push(`forfeits ${mods.ownLeadershipPenalty} Leadership (fewer re-roll dice)`);
  if (mods.enemyLeadershipPenalty) p.push(`enemy Leadership −${mods.enemyLeadershipPenalty}`);
  if (mods.enemyCaptainCancel) p.push('cancels the Captain of the West bonus');
  if (mods.negateEnemyReroll) p.push('cancels the enemy Leader re-roll');
  if (mods.cancelEnemyCard) p.push("cancels the enemy's Combat card");
  if (mods.preCombatAttackDice) p.push(`pre-combat attack: ${mods.preCombatAttackDice} dice, hits on 4+`);
  if (mods.extraAttackDice) p.push(`extra attack: ${mods.extraAttackDice} dice, hits on 5+`);
  if (mods.guaranteedHits) p.push(`turns ${mods.guaranteedHits} miss into a hit`);
  if (mods.bonusHitsIfAny) p.push(`+${mods.bonusHitsIfAny} hit${mods.bonusHitsIfAny === 1 ? '' : 's'} if it scored any`);
  if (mods.bonusHitsIfOutnumber) p.push(`+${mods.bonusHitsIfOutnumber} hit if it outnumbers 2:1`);
  if (mods.bonusHitIfOutscore) p.push(`+${mods.bonusHitIfOutscore} hit if it outscores the enemy`);
  if (mods.cancelHits) p.push(`cancels ${mods.cancelHits} incoming hit${(mods.cancelHitsMinEnemyHits ?? 1) > 1 ? ` (only if the enemy scored ${mods.cancelHitsMinEnemyHits}+)` : ''}`);
  if (mods.sacrificeLeaderToCancelHit) p.push('may sacrifice a Leader to cancel a hit');
  if (mods.eliminateMinion) p.push('may spend a hit to eliminate a Minion');
  if (mods.eliminateNazgulIfHit) p.push('eliminates a Nazgûl if it scored a hit');
  if (mods.blackBreath) p.push('eliminates an enemy Leader/Companion if it scored a hit');
  if (mods.retreatBeforeCombat) p.push('retreats before the Combat roll');
  return p.join('; ');
}

/** The combat mods for a card id, or null if its combat half isn't modelled. */
/** What the card's owner has in the battle, for the few effects whose size depends on
 *  it. Optional: callers that only want to know whether a card HAS an effect (the AI's
 *  card valuation, `hasCombatEffect`) can omit it and get the baseline. */
export interface CombatModContext {
  ownCharacters?: readonly string[];
  /** What the owner chose to pay for a variable-size card this round. */
  cost?: number;
}

/** Cards whose effect is sized by a cost the OWNER chooses when playing them.
 *  RAW wording, and why each is here rather than a flat entry in BY_TITLE:
 *   - Relentless Assault: "you may inflict and apply UP TO TWO hits against your
 *     units. Add 1 to all dice on your Combat roll FOR EACH hit you inflicted."
 *   - Dread and Despair: "forfeit ONE OR MORE points of Nazgûl Leadership. …the
 *     Free Peoples player rolls one Combat die less (to a minimum of one) FOR EVERY
 *     point you have chosen to forfeit."
 *   - Onslaught: "AFTER removing casualties…, you may inflict and apply UP TO FOUR
 *     additional hits against your units. Roll one die for each hit you inflicted…
 *     and score one hit against the enemy on each result of 4+."
 *  All three used to grant their benefit for free at a fixed size. */
export interface VariableCost {
  /** What is spent: the owner's own Army units, or points of Nazgûl Leadership. */
  kind: 'selfHits' | 'nazgulLeadership';
  /** When the owner is asked. Onslaught is the only post-casualty one. */
  timing: 'preRoll' | 'postCasualty';
  /** Most that may be spent by the card's own text (further capped by what the
   *  owner actually has). */
  cap: number;
  /** Least that may be spent. "One or more" is mandatory once the card is played;
   *  "you may" allows zero. */
  min: number;
}

const VARIABLE_COST: Record<string, VariableCost> = {
  'Relentless Assault': { kind: 'selfHits', timing: 'preRoll', cap: 2, min: 0 },
  'Dread and Despair': { kind: 'nazgulLeadership', timing: 'preRoll', cap: 99, min: 1 },
  'Onslaught': { kind: 'selfHits', timing: 'postCasualty', cap: 4, min: 0 },
};

/** The variable cost of the card, or null when its size is fixed. */
export function variableCostFor(cardId: string): VariableCost | null {
  const title = EVENT_BY_ID[cardId]?.combat?.title;
  return title ? (VARIABLE_COST[title] ?? null) : null;
}

export function combatModsFor(cardId: string, ctx?: CombatModContext): CombatMods | null {
  const title = EVENT_BY_ID[cardId]?.combat?.title;
  if (!title) return null;
  const base = BY_TITLE[title];
  if (!base) return null;
  // Andúril: "forfeit Strider's Leadership to change one missed die to a hit, OR
  // forfeit Aragorn's Leadership to change UP TO TWO." Which one you have decides it —
  // there is no real choice, because forfeiting Aragorn costs his full Leadership (2)
  // whether you convert one die or two, so converting two is never worse. The table
  // holds Strider's numbers; upgrade them when Aragorn is the one in the battle.
  if (title === 'Andúril' && ctx?.ownCharacters?.includes('aragorn')) {
    return { ...base, guaranteedHits: 2, ownLeadershipPenalty: 2 };
  }
  // Variable-size cards: the mods ARE the cost the owner paid. Until it is chosen the
  // card does nothing, so an unanswered prompt can never leak a free effect.
  const cost = ctx?.cost ?? 0;
  if (title === 'Relentless Assault') return cost > 0 ? { ...base, rollBonus: cost } : base;
  if (title === 'Dread and Despair') return cost > 0 ? { ...base, enemyDiceReduction: cost, ownLeadershipPenalty: cost } : base;
  return base;
}
export const hasCombatEffect = (cardId: string): boolean => combatModsFor(cardId) !== null;
export const EMPTY_MODS: CombatMods = {};
