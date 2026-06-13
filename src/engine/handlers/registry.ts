// Event-card handler registry (rules-spec §4). Each card's effect is registered
// by id; play resolves via the registry. Only cards with a registered handler
// whose `canPlay` passes are offered/playable — unimplemented cards simply stay
// in hand (handlers are added incrementally). Handlers mutate state in place;
// randomness goes through withRng. Cite the card id; effects modify the standard
// rules per the card text.
import type { GameState, Side } from '../types';

export interface EventHandler {
  /** "Play on the table" — the card persists (its id goes to cards[side].table)
   *  instead of being discarded. (Persistent effects are wired per card.) */
  onTable?: boolean;
  /** Whether the card's precondition is currently met for `side`. Default: true. */
  canPlay?(state: GameState, side: Side): boolean;
  /** Apply the immediate effect. */
  apply(state: GameState, side: Side): void;
}

const handlers = new Map<string, EventHandler>();

export function register(id: string, h: EventHandler): void {
  handlers.set(id, h);
}
export function getHandler(id: string): EventHandler | undefined {
  return handlers.get(id);
}
export function canPlayCard(state: GameState, id: string, side: Side): boolean {
  const h = handlers.get(id);
  if (!h) return false;
  return h.canPlay ? h.canPlay(state, side) : true;
}
