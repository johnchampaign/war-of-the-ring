// Structured append-only log — framework log-format v2 (GameLogEntry). Every
// entry flows through this choke point: appendGameLog stamps a monotonic `seq`
// (stable across capping) and we cap the in-state log at LOG_CAP entries.
// side=null => public. side set => private to that side (secret:true), matching
// the historical WotR semantic; adapter/redact.ts filters on `secret`.
import { appendGameLog } from 'digital-boardgame-framework';
import type { GameState, Side } from './types';

const LOG_CAP = 500;

export function log(state: GameState, side: Side | null, kind: string, msg: string, payload?: unknown): void {
  appendGameLog(state.log, {
    turn: state.turn,
    phase: state.phase,
    side,
    kind,
    msg,
    ...(payload !== undefined ? { payload } : {}),
    ...(side != null ? { secret: true as const } : {}),
  }, LOG_CAP);
}

/** A card entering a hand, logged publicly — WHICH deck and WHY, never the card's
 *  identity (that stays secret). Drawing used to be silent, so a hand that grew
 *  mid-turn was unexplainable from the log: a player audited the Free Peoples' opening
 *  hand, found it playing more cards than it had drawn, and neither he nor we could
 *  reconstruct where they came from (report 1y0753: it was King Brand's Men, whose own
 *  text draws a card). Every draw now says so. */
export function logCardDraw(state: GameState, side: Side, deck: 'character' | 'strategy', drew: boolean, reason?: string): void {
  const who = side === 'fp' ? 'Free Peoples' : 'Shadow';
  const d = deck === 'character' ? 'Character' : 'Strategy';
  log(state, null, 'event', drew
    ? `${who} draw a ${d} Event card${reason ? ` (${reason})` : ''}`
    : `${who} cannot draw — the ${d} deck is empty`);
}

/** Record a transient informational notice for the UI to pop once (public). */
export function notify(state: GameState, msg: string): void {
  if (!state.notices) state.notices = [];
  const seq = (state.notices[state.notices.length - 1]?.seq ?? 0) + 1;
  state.notices.push({ seq, msg });
}
