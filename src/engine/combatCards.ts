// Combat-card effects (rules-spec §7, the bottom half of every Event card). Many
// cards share a combat title, so effects are keyed by TITLE. Each maps to a
// CombatMods the battle roll reads. Mechanically-simple effects are modelled
// faithfully; a few intricate ones (specific Character elimination, forfeit-
// Leadership bookkeeping, retreat-as-card) are approximated or omitted — a card
// with no mapped title is simply not offered as a combat card. See D5 note.
import { EVENT_BY_ID } from './data';

export interface CombatMods {
  /** +N to the owner's Combat roll AND Leader re-roll dice (lowers the hit target). */
  rollBonus?: number;
  /** +N to the enemy's hit target (their dice are worse). */
  enemyRollPenalty?: number;
  /** Cap the enemy's number of dice this round. */
  maxDiceEnemy?: number;
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
  /** Cancel N hits the owner would take this round. */
  cancelHits?: number;
  /** +N hits if, after the re-roll, the owner scored MORE total hits than the
   *  enemy (Mûmakil's second, later-initiative effect). Evaluated post-roll. */
  bonusHitIfOutscore?: number;
}

// Effects by combat title.
const BY_TITLE: Record<string, CombatMods> = {
  // straight die bonuses
  'Valour': { rollBonus: 1 },
  'Servant of the Secret Fire': { rollBonus: 1 },
  'Devilry of Orthanc': { rollBonus: 1 },
  "Ents' Rage": { rollBonus: 2 },
  'It Is a Gift': { rollBonus: 1 },
  'One for the Dark Lord': { rollBonus: 1 },
  'Cruel as Death': { rollBonus: 1 },
  'They Are Terrible': { rollBonus: 1 },
  'Mighty Attack': { rollBonus: 1 },
  'Andúril': { rollBonus: 1 },
  'Deadly Strife': { rollBonus: 2 },
  'Desperate Battle': { rollBonus: 1 },
  'Relentless Assault': { rollBonus: 1 },
  // weaken the enemy
  'Daylight': { maxDiceEnemy: 3 },
  'Brave Stand': { maxDiceEnemy: 3 },
  'Huorn-dark': { maxDiceEnemy: 2 },
  'Advantageous Position': { enemyRollPenalty: 1 },
  'Dread and Despair': { enemyRollPenalty: 1 },
  'Confusion': { enemyRollPenalty: 1 },
  'Foul Stench': { negateEnemyReroll: true },
  // extra attacks
  'Charge': { extraAttackDice: 3 },
  'Sudden Strike': { extraAttackDice: 3 },
  'We Come to Kill': { extraAttackDice: 3 },
  'Onslaught': { extraAttackDice: 4 },
  // extra hits
  'No Quarter': { bonusHitsIfAny: 1 },
  'Nameless Wood': { bonusHitsIfAny: 2 },
  'Great Host': { bonusHitsIfOutnumber: 1 },
  // cancels / defense
  'Daring Defiance': { cancelEnemyCard: true },
  'Swarm of Bats': { cancelEnemyCard: true },
  'Shield-wall': { cancelHits: 1 },
  // multi-effect (per-effect initiative 3-5): +1 dice (init 3) AND +1 hit if you
  // outscore the enemy after the re-roll (init 5). See data.ts initiative note.
  'Mûmakil': { rollBonus: 1, bonusHitIfOutscore: 1 },
};

/** The combat mods for a card id, or null if its combat half isn't modelled. */
export function combatModsFor(cardId: string): CombatMods | null {
  const title = EVENT_BY_ID[cardId]?.combat?.title;
  return title ? (BY_TITLE[title] ?? null) : null;
}
export const hasCombatEffect = (cardId: string): boolean => combatModsFor(cardId) !== null;
export const EMPTY_MODS: CombatMods = {};
