// Structured append-only log. side=null => public; otherwise visible only to that
// side in redacted views (see adapter/redact.ts).
import type { GameState, Side } from './types';

export function log(state: GameState, side: Side | null, kind: string, msg: string): void {
  state.log.push({ turn: state.turn, side, kind, msg });
}
