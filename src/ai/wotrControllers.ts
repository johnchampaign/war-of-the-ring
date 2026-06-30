// Server-side AI opponents for War of the Ring, keyed by difficulty. The key is
// the rating-id suffix the AI plays under on the leaderboard (e.g.
// `ai:war-of-the-ring:standard`). Bump a key (e.g. 'standard@2') if you change
// the AI's strength so it earns a fresh rating instead of dragging the old one.
//
// This wraps the existing heuristic `chooseAction` (src/ai/wotrAI.ts) — a pure,
// synchronous, public-information chooser over the SAME action vocabulary as a
// human — as a framework PlayerController. The server drives every AI seat after
// each move (createGame's `ai` map), so the AI's play can't be tampered with by
// the human's client. No DOM / engine-internal deps: the controller reads only
// the redacted view it's handed and chooses via ctx.adapter.legalActions.
import { Rng, type PlayerController } from 'digital-boardgame-framework';
import type { GameState } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import { chooseAction } from './wotrAI';

type Side = 'fp' | 'shadow';

// Single difficulty: the v1 heuristic. It's the FAST path — a one-pass scoring
// over legal actions with shallow look-ahead (no deep search), well within a
// server CPU budget.
const standard: PlayerController<GameState, WotrAction, Side> = {
  selectAction: async (ctx) => {
    const legal = ctx.adapter.legalActions(ctx.state, ctx.actor);
    if (legal.length === 0) throw new Error(`wotr AI: no legal actions for ${ctx.actor}`);
    // chooseAction wants a framework Rng for deterministic tie-breaks; ctx.rng is
    // exactly that. Guard against a heuristic edge case returning an off-list
    // action by falling back to the first legal action.
    const rng = ctx.rng instanceof Rng ? ctx.rng : new Rng(1);
    try {
      const a = chooseAction(ctx.state, ctx.actor, legal, rng);
      return a ?? legal[0]!;
    } catch {
      return legal[0]!;
    }
  },
};

export const wotrControllers: Record<string, PlayerController<GameState, WotrAction, Side>> = {
  standard,
};
