// Local in-browser game client (no network). Runs the engine directly via the same
// wotrAdapter the server uses. Two modes:
//   • hotseat  — two humans share the screen; whoever is up controls it.
//   • vs AI    — the human plays one side; the heuristic AI (src/ai) auto-plays the
//                other. The human only ever sees their own redacted view and only
//                acts on their own turn; the AI's moves are applied between turns.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../engine/setup';
import { wotrAdapter, startGame } from '../adapter/wotrAdapter';
import { chooseAction } from '../ai/wotrAI';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameClientApi, ViewResult } from './gameClient';
import { applyCombatScenario } from '../devtabs/combatScenario';

const other = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

export function makeLocalClient(seed: number, opts: { scenario?: 'combat'; aiSide?: Side } = {}): GameClientApi {
  let state: GameState = startGame(createGame({ seed }));
  if (opts.scenario === 'combat') state = applyCombatScenario(state);
  const aiSide = opts.aiSide ?? null;          // the side the AI plays (null = hotseat)
  const human: Side = aiSide ? other(aiSide) : 'fp';
  const aiRng = new Rng(seed * 1000 + 7);      // independent tie-break RNG for the AI

  // Let the AI take every turn that is its own until control returns to the human
  // (or the game ends). Guarded against a stall so it can never loop forever.
  const runAI = (): void => {
    if (!aiSide) return;
    let guard = 0;
    while (!wotrAdapter.result?.(state) && guard++ < 2000) {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (actor !== aiSide) break;
      const legal = wotrAdapter.legalActions(state, actor);
      if (legal.length === 0) break;
      state = wotrAdapter.applyAction(state, chooseAction(state, actor, legal, aiRng), actor);
    }
  };

  // Log index where the "what happened while you were away" summary begins — the
  // first entry the current viewer didn't cause. vs-AI: just after the human's
  // action (summary = the AI's turn). Hotseat: before the acting player's action (so
  // the NEXT player sees that turn). Surfaced on the view for the TurnSummary UI.
  let oppLogStart = 0;
  let opened = false;

  const snapshot = (): ViewResult => {
    const actor = wotrAdapter.currentActor(state) as Side | null;
    const over = !!wotrAdapter.result?.(state);
    // vs-AI: always show the human's view, and it's their turn only when they're up.
    // hotseat: show whoever is currently up (they control this screen).
    const viewer: Side = aiSide ? human : (actor ?? 'fp');
    const view = wotrAdapter.viewFor(state, viewer) as GameState;
    (view as unknown as { oppLogStart: number }).oppLogStart = oppLogStart;
    return { view, yourTurn: !over && (aiSide ? actor === human : true), turn: state.turn, gameOver: over, you: viewer };
  };

  return {
    // Opening sets the marker to "nothing new"; later refreshes must NOT reset it
    // (in local play the opponent acts inside submit, so a poll mustn't wipe the
    // pending summary).
    fetch: async () => { runAI(); if (!opened) { oppLogStart = state.log.length; opened = true; } return snapshot(); },
    submit: async (action: WotrAction) => {
      const before = state.log.length;
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (actor && (!aiSide || actor === human)) state = wotrAdapter.applyAction(state, action, actor);
      const afterHuman = state.log.length;
      runAI();                                            // then let the AI take its turn(s)
      oppLogStart = aiSide ? afterHuman : before;         // vs-AI: AI's entries; hotseat: the acting player's turn (for the next viewer)
      return snapshot();
    },
    legalActions: async () => {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (!actor || (aiSide && actor !== human)) return [];
      return wotrAdapter.legalActions(state, actor);
    },
    report: async () => ({ reportId: 'local' }),
  };
}
