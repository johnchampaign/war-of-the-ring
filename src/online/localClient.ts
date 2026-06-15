// Local in-browser game client (hotseat). Runs the engine directly in the browser
// via the same wotrAdapter the server uses — no network. Hotseat is "a preset of
// the same transport": the active player's screen shows their own redacted view
// (the inactive player can't peek at hidden info). Also lets the UI run in the
// Vite preview with no /api. The ONLINE client (gameClient.ts) is byte-compatible.
import { createGame } from '../engine/setup';
import { wotrAdapter, startGame } from '../adapter/wotrAdapter';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameClientApi, ViewResult } from './gameClient';
import { applyCombatScenario } from '../devtabs/combatScenario';

export function makeLocalClient(seed: number, scenario?: 'combat'): GameClientApi {
  let state: GameState = startGame(createGame({ seed }));
  if (scenario === 'combat') state = applyCombatScenario(state);

  const snapshot = (): ViewResult => {
    const actor = wotrAdapter.currentActor(state) as Side | null;
    const over = !!wotrAdapter.result?.(state);
    const viewer: Side = actor ?? 'fp';
    return {
      view: wotrAdapter.viewFor(state, viewer) as GameState,
      yourTurn: !over,           // hotseat: whoever is up controls this screen
      turn: state.turn,
      gameOver: over,
      you: viewer,
    };
  };

  return {
    fetch: async () => snapshot(),
    submit: async (action: WotrAction) => {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (actor) state = wotrAdapter.applyAction(state, action, actor);
      return snapshot();
    },
    legalActions: async () => {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      return actor ? wotrAdapter.legalActions(state, actor) : [];
    },
    report: async () => ({ reportId: 'local' }),
  };
}
