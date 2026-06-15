// The action vocabulary — one variant per player decision the engine surfaces.
// (First playable slice: Fellowship/Hunt + dice spending. Army/combat/muster/
// event-play actions are added in later increments.)
import type { Deck, DieFace, Nation, RegionId } from '../engine/types';

export type WotrAction =
  // Fellowship phase (FP) — one action ends the phase.
  | { kind: 'skipFellowshipPhase' }
  | { kind: 'declareFellowship'; target: RegionId }
  | { kind: 'enterMordor' }
  // Hunt Allocation phase (Shadow).
  | { kind: 'allocateHunt'; dice: number }
  // Action Resolution (current player) — each consumes one die unless noted.
  | { kind: 'moveFellowship' }   // FP, Character die
  | { kind: 'hideFellowship' }   // FP, Character die
  | { kind: 'separateCompanion'; companion: string } // FP, Character die
  | { kind: 'bringUpgrade'; which: 'aragorn' | 'gandalf-white' } // FP, Will of the West
  | { kind: 'drawEvent'; deck: Deck } // Event die
  | { kind: 'playEvent'; cardId: string } // Event die: play a card from hand
  | { kind: 'diplomaticAction'; nation: Nation } // Muster die: advance political track
  | { kind: 'recruitUnit'; nation: Nation; region: RegionId; regular: number; elite: number } // Muster die
  | { kind: 'bringMinion'; minion: 'witch-king' | 'saruman' | 'mouth-of-sauron'; region: RegionId } // Muster die (Shadow)
  | { kind: 'moveArmy'; from: RegionId; to: RegionId }   // Army die
  | { kind: 'attack'; from: RegionId; to: RegionId }      // Army die
  | { kind: 'skipDie'; face: DieFace } // discard a die, no effect
  | { kind: 'pass' }             // yield to opponent, no die spent
  // Interactive combat sub-machine (resolving a PendingChoice).
  | { kind: 'playCombatCard'; cardId: string | null } // play a combat card (or none)
  | { kind: 'chooseCasualties'; plan: 'regularsFirst' | 'elitesFirst' }
  | { kind: 'combatContinue'; cont: boolean }  // attacker: continue or cease
  | { kind: 'combatRetreat'; retreat: boolean } // defender: retreat or stand
  | { kind: 'retreatTo'; region: RegionId }     // defender: chosen retreat destination
  | { kind: 'siegeWithdraw'; withdraw: boolean } // defender: withdraw into the siege or fight
  // Move an independent character via a Character die: 'nazgul' (a region's
  // Nazgûl group), a Minion id, or a separated Companion id.
  | { kind: 'moveCharacter'; char: string; from: RegionId; to: RegionId }
  // Follow-up target choice for an interactive event card (fields per card).
  | { kind: 'eventTarget'; card: string; from?: RegionId; to?: RegionId; region?: RegionId; companion?: string; mode?: 'move' | 'attack'; done?: boolean }
  // Palantír of Orthanc bonus draw (Shadow): choose which deck to draw from.
  | { kind: 'bonusDraw'; deck: 'character' | 'strategy' }
  // Lure of the Ring (FP responds): take Corruption equal to the Companion's Level, or eliminate him.
  | { kind: 'lureChoice'; mode: 'corruption' | 'eliminate' }
  // Hunt damage resolution (FP): absorb as Corruption, lose a Companion, or use a
  // damage-reduction ability (separate the Hobbit Guide / Gollum reveal).
  | { kind: 'huntDamage'; mode: 'corruption' | 'guide' | 'random' | 'reduceSeparate' | 'reduceReveal' | 'reduceCard' }
  // On-table Hunt interceptions (FP): Wizard's Staff (prevent the draw) and
  // Mithril Coat (redraw the drawn tile).
  | { kind: 'huntPreventDraw'; prevent: boolean }
  | { kind: 'huntRedraw'; redraw: boolean };
