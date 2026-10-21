// Victory conditions (rules-spec §13). Ring conditions end the game immediately
// whenever they occur; Military conditions are checked in phase 6. Lower-numbered
// conditions win ties.
import type { GameState, Side } from './types';
import { log } from './log';

/** A player abandons the game (no move for a long while): the other side wins. Ranked
 *  games otherwise never ended, so walking away from a lost game cost nothing
 *  (player report a05cialu8jn3as70; John, 2026-10-11). Not offered as a legal action —
 *  the scheduled sweep submits it for the idle seat. */
export function forfeit(state: GameState, side: Side, reason: string): void {
  if (state.winner) return;
  state.pendingChoice = null;
  state.pendingCombat = null;
  win(state, side === 'fp' ? 'shadow' : 'fp', reason);
}

function win(state: GameState, side: Side, reason: string): void {
  state.winner = side;
  state.winReason = reason;
  state.phase = 'gameOver';
  // "the Free Peoples" are plural, "the Shadow" singular (player report 1p2d6j180n0p5s1w).
  log(state, null, 'victory', `${side === 'fp' ? 'Free Peoples win' : 'Shadow wins'}: ${reason}`);
}

/** Ring-based conditions — checked continuously (after any Corruption/Mordor
 *  change). Returns true if the game ended. */
export function checkRingVictory(state: GameState): boolean {
  if (state.winner) return true;
  const fs = state.fellowship;
  if (fs.corruption >= 12) { win(state, 'shadow', 'The Ring-bearers succumb to the Ring (12 Corruption)'); return true; }
  if (fs.mordor === 5 && fs.corruption < 12) { win(state, 'fp', 'The Ring is destroyed at the Crack of Doom'); return true; }
  return false;
}

/** Military conditions — checked in phase 6. Shadow needs ≥10 VP of captured FP
 *  Settlements; FP needs ≥4 VP of captured Shadow Settlements. */
export function checkMilitaryVictory(state: GameState): boolean {
  if (state.winner) return true;
  // Rulebook p.44 numbers the conditions and states that "lower-numbered Victory
  // conditions take precedence over higher-numbered Victory conditions, if two or
  // more are achieved on the same turn". Shadow's "Conquers Middle-earth" (≥10 VP)
  // is condition 3 and the FP "Sauron is Banished" (≥4 VP) is condition 4, so a
  // simultaneous pair is won by the SHADOW. This read used to be inverted, handing
  // the game to the FP when both thresholds were met on the same Victory Check
  // (player report: Shadow hit 11 VP the turn the FP reached 4 and still lost).
  if (state.victoryPoints.shadow >= 10) { win(state, 'shadow', `The Shadow conquers Middle-earth (${state.victoryPoints.shadow} Victory Points)`); return true; }
  if (state.victoryPoints.fp >= 4) { win(state, 'fp', `Sauron is banished from Middle-earth (${state.victoryPoints.fp} Victory Points)`); return true; }
  return false;
}
