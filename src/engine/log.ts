// Structured append-only log. side=null => public; otherwise visible only to that
// side in redacted views (see adapter/redact.ts).
import type { GameState, Side } from './types';

export function log(state: GameState, side: Side | null, kind: string, msg: string): void {
  state.log.push({ turn: state.turn, side, kind, msg });
}

/** Record a transient informational notice for the UI to pop once (public). */
export function notify(state: GameState, msg: string): void {
  if (!state.notices) state.notices = [];
  const seq = (state.notices[state.notices.length - 1]?.seq ?? 0) + 1;
  state.notices.push({ seq, msg });
}
