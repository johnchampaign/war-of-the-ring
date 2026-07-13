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

/** Record a transient informational notice for the UI to pop once (public). */
export function notify(state: GameState, msg: string): void {
  if (!state.notices) state.notices = [];
  const seq = (state.notices[state.notices.length - 1]?.seq ?? 0) + 1;
  state.notices.push({ seq, msg });
}
