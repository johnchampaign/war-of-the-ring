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

  // A MIXED-NATION Shadow stack in Gorgoroth (Sauron + Southrons). Board.tsx draws
  // one badge per NATION, and both of these are on the same side — the case that
  // regressed when the badge's React key was `a.side`, so only Sauron's badge
  // rendered (player report). Staged here so the fix has a one-click repro.
  state.regions['gorgoroth']!.units = {
    sauron: { regular: 3, elite: 1 },
    southrons: { regular: 2, elite: 0 },
  };
  return state;
}
