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
  | { kind: 'drawEvent'; deck: Deck } // Event die
  | { kind: 'playEvent'; cardId: string } // Event die: play a card from hand
  | { kind: 'diplomaticAction'; nation: Nation } // Muster die: advance political track
  | { kind: 'recruitUnit'; nation: Nation; region: RegionId; regular: number; elite: number } // Muster die
  | { kind: 'moveArmy'; from: RegionId; to: RegionId }   // Army die
  | { kind: 'attack'; from: RegionId; to: RegionId }      // Army die
  | { kind: 'skipDie'; face: DieFace } // discard a die, no effect
  | { kind: 'pass' };            // yield to opponent, no die spent
