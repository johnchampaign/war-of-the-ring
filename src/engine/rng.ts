// RNG helper: rehydrate the framework Rng from the serialized state, run a body
// that uses it, then write the advanced state back. Keeps all randomness
// deterministic and serialized in GameState.rngState.
import { Rng } from 'digital-boardgame-framework';
import type { GameState } from './types';

export function withRng<T>(state: GameState, body: (rng: Rng) => T): T {
  const rng = Rng.fromState(state.rngState);
  const result = body(rng);
  state.rngState = rng.serialize();
  return result;
}
