// Action dice: face distributions, pool sizing, and rolling. Faces per rulebook
// p.19. Eyes (Shadow) go to the Hunt Box at roll time (handled in phases.ts).
import type { DieFace, GameState, Side } from './types';
import { withRng } from './rng';
import { BASE_DICE } from './setup';

// 6 faces per physical die.
export const FP_DIE_FACES: DieFace[] = ['character', 'character', 'armyMuster', 'muster', 'event', 'will'];
export const SHADOW_DIE_FACES: DieFace[] = ['character', 'army', 'muster', 'armyMuster', 'event', 'eye'];

/** Dice-pool size for a side, including character bonuses. FP: +1 per
 *  Aragorn/Gandalf-the-White in play. Shadow: +1 per Minion in play, capped 10. */
export function poolSize(state: GameState, side: Side): number {
  const entered = state.characters.entered;
  if (side === 'fp') {
    let n = BASE_DICE.fp;
    if (entered.includes('aragorn')) n++;
    if (entered.includes('gandalf-white')) n++;
    return n;
  }
  let n = BASE_DICE.shadow;
  for (const m of ['saruman', 'witch-king', 'mouth-of-sauron']) if (entered.includes(m)) n++;
  return Math.min(n, 10);
}

/** Roll a side's available pool (count minus any dice held in the Hunt Box). */
export function rollPool(state: GameState, side: Side, count: number): DieFace[] {
  const faces = side === 'fp' ? FP_DIE_FACES : SHADOW_DIE_FACES;
  return withRng(state, (rng) => Array.from({ length: count }, () => rng.pick(faces)));
}
