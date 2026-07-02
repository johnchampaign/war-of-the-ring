// Event-card handler registry (rules-spec §4). Each card's effect is registered
// by id; play resolves via the registry. Only cards with a registered handler
// whose `canPlay` passes are offered/playable — unimplemented cards simply stay
// in hand (handlers are added incrementally). Handlers mutate state in place;
// randomness goes through withRng. Cite the card id; effects modify the standard
// rules per the card text.
import type { GameState, Nation, RegionId, Side } from '../types';

/** A chosen target for an interactive event card (fields used per card). `mode`
 *  distinguishes a card-granted Army move from an attack (and the Fellowship
 *  hide/move/decline choice on "There Is Another Way"). */
export interface EventTarget { from?: RegionId; to?: RegionId; region?: RegionId; nation?: Nation; companion?: string; mode?: 'move' | 'attack' | 'hide' | 'none' | 'recruit'; figure?: 'regular' | 'elite'; slot?: number; eye?: boolean }

export interface EventHandler {
  /** "Play on the table" — the card persists (its id goes to cards[side].table)
   *  instead of being discarded. (Persistent effects are wired per card.) */
  onTable?: boolean;
  /** Whether the card's precondition is currently met for `side`. Default: true. */
  canPlay?(state: GameState, side: Side): boolean;
  /** Apply the immediate effect (omitted for interactive cards — see targets). */
  apply?(state: GameState, side: Side): void;
  /** Interactive cards: the legal follow-up targets after the card is played. A
   *  non-empty result makes playEvent pause with an 'eventTarget' choice; the
   *  player's pick is applied via applyTarget. `applied` lists the targets already
   *  chosen this card (for multi-target cards that must exclude them). */
  targets?(state: GameState, side: Side, applied?: EventTarget[]): EventTarget[];
  /** Apply the player's pick. `applied` lists the PRIOR picks this card (before this
   *  one) — used by group-move cards whose destination moves the trailing group. */
  applyTarget?(state: GameState, side: Side, target: EventTarget, applied?: EventTarget[]): void;
  /** Multi-target cards: the max number of targets to apply (the player may stop
   *  early with a "done" option). Default 1 (single target). */
  repeat?: number;
  /** Suppress the "done" (stop-early) option for a multi-step card whose steps are
   *  all mandatory (e.g. separate a Companion → choose its destination). */
  noDone?: boolean;
  /** Offer "done" even before the first target is applied (for "move any or ALL …"
   *  cards where moving zero is a legal choice). */
  optionalFromStart?: boolean;
  /** Run AFTER the card is fully resolved (discarded, turn passed). Use for an
   *  effect that itself raises a follow-up PendingChoice (e.g. a Fellowship move
   *  that triggers a Hunt) — set last, it survives the eventTarget cleanup. */
  finalize?(state: GameState, side: Side, applied: EventTarget[]): void;
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
