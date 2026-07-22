// Dev-only Mordor scenario (reached via the #mordor hash route). Drops the
// Ring-bearers onto the Mordor Track mid-climb so the track overlay, the
// entrance marker's step stamp, and the automatic-tile Hunt flow can be checked
// in the UI without playing eight turns to get there. Not part of normal play.
import type { GameState } from '../engine/types';

/** Mutate a freshly-started game into "on the Mordor Track" (in place). */
export function applyMordorScenario(state: GameState): GameState {
  const fs = state.fellowship;
  fs.location = 'morannon';
  fs.mordor = 3;
  fs.progress = 0;
  fs.corruption = 7;
  fs.hidden = true;

  // Action Resolution, FP to act, holding a Character die (the one that moves the
  // Fellowship) so the next step up the track is one click away.
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice.fp = ['character', 'character'];
  state.dice.shadow = ['army', 'character'];
  state.pendingChoice = null;
  state.pendingCombat = null;
  return state;
}
