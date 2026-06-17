// Victory conditions (rules-spec §13). Ring conditions end the game immediately
// whenever they occur; Military conditions are checked in phase 6. Lower-numbered
// conditions win ties.
import type { GameState, Side } from './types';
import { log } from './log';

function win(state: GameState, side: Side, reason: string): void {
  state.winner = side;
  state.winReason = reason;
  state.phase = 'gameOver';
  log(state, null, 'victory', `${side} wins: ${reason}`);
}

/** Ring-based conditions — checked continuously (after any Corruption/Mordor
 *  change). Returns true if the game ended. */
export function checkRingVictory(state: GameState): boolean {
  if (state.winner) return true;
  const fs = state.fellowship;
  if (fs.corruption >= 12) { win(state, 'shadow', 'Ring-bearers corrupted (12)'); return true; }
  if (fs.mordor === 5 && fs.corruption < 12) { win(state, 'fp', 'Ring destroyed at the Crack of Doom'); return true; }
  return false;
}

/** Military conditions — checked in phase 6. Shadow needs ≥10 VP of captured FP
 *  Settlements; FP needs ≥4 VP of captured Shadow Settlements. */
export function checkMilitaryVictory(state: GameState): boolean {
  if (state.winner) return true;
  // The Free Peoples player checks (and wins) FIRST — rulebook p.44 — so an FP
  // Military victory takes precedence over a simultaneous Shadow one.
  if (state.victoryPoints.fp >= 4) { win(state, 'fp', `Military victory (${state.victoryPoints.fp} VP)`); return true; }
  if (state.victoryPoints.shadow >= 10) { win(state, 'shadow', `Military victory (${state.victoryPoints.shadow} VP)`); return true; }
  return false;
}
