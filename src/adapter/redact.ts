// Per-seat redaction (viewFor). Hides what a viewer must not know: the opponent's
// Event-card hand, and the RNG state (which determines future Hunt draws / rolls).
// The Fellowship's Progress and last-known position are PUBLIC in WotR (both are
// on the board), so they are not redacted. Log is default-deny: public entries +
// the viewer's own side-tagged entries only.
import type { GameState, Side } from '../engine/types';

export function redactStateForViewer(state: GameState, viewer: Side | null): GameState {
  const v: GameState = JSON.parse(JSON.stringify(state));
  v.rngState = 0; // never expose the RNG
  for (const side of ['fp', 'shadow'] as Side[]) {
    if (side === viewer) continue;
    // Opponent hand: preserve count, hide identities.
    v.cards[side].hand = v.cards[side].hand.map(() => 'hidden');
    // Opponent draw piles: order/identity hidden (counts kept).
    v.cards[side].draw.character = v.cards[side].draw.character.map(() => 'hidden');
    v.cards[side].draw.strategy = v.cards[side].draw.strategy.map(() => 'hidden');
  }
  // Log: public entries (side null) + the viewer's own side-tagged entries.
  v.log = v.log.filter((e) => e.side == null || e.side === viewer);
  return v;
}
