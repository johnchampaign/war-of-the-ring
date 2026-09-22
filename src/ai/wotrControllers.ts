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
    let a: WotrAction;
    try {
      a = chooseAction(ctx.state, ctx.actor, legal, rng) ?? legal[0]!;
    } catch {
      a = legal[0]!;
    }
    // Safety net: the heuristic may refine a legal action (e.g. pick which figures
    // move), and a refinement the engine refuses makes the server stop driving the
    // AI — the same refused move recurs on every refresh, so the human waits forever
    // (player report yzb5la09aq34yd70). Check the pick against the view and fall back
    // to the first listed action the engine accepts. Only if none can be confirmed
    // (hidden information) is the original pick sent as-is.
    if (accepts(ctx, a)) return a;
    return legal.find((l) => accepts(ctx, l)) ?? a;
  },
};

type Ctx = Parameters<PlayerController<GameState, WotrAction, Side>['selectAction']>[0];
function accepts(ctx: Ctx, a: WotrAction): boolean {
  if (!ctx.adapter.tryApplyAction) return true;
  try { return ctx.adapter.tryApplyAction(ctx.state, a, ctx.actor).ok; } catch { return false; }
}

export const wotrControllers: Record<string, PlayerController<GameState, WotrAction, Side>> = {
  standard,
};
