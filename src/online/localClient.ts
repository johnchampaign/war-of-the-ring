// Local in-browser game client (no network). Runs the engine directly via the same
// wotrAdapter the server uses. Two modes:
//   • hotseat  — two humans share the screen; whoever is up controls it.
//   • vs AI    — the human plays one side; the heuristic AI (src/ai) auto-plays the
//                other. The human only ever sees their own redacted view and only
//                acts on their own turn; the AI's moves are applied between turns.
import { Rng } from 'digital-boardgame-framework';
import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import { createGame } from '../engine/setup';
import { wotrAdapter, startGame } from '../adapter/wotrAdapter';
import { chooseAction } from '../ai/wotrAI';
import { log } from '../engine/log';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameClientApi, ViewResult } from './gameClient';
import { applyCombatScenario } from '../devtabs/combatScenario';

const other = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');
const sideName = (s: Side): string => (s === 'fp' ? 'Free Peoples' : 'Shadow');
// Same-origin on the deployed site; the deployed (CORS-open) endpoint from the local
// dev client, which has no Functions runtime.
const isLocalDev = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
const REPORT_ENDPOINT = (isLocalDev ? 'https://war-of-the-ring.pages.dev' : '') + '/api/report';
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// "Randomness fingerprint" of a state: the RNG cursor (advances on any dice/Hunt/
// combat roll via withRng) plus the total cards left in the draw piles (a card draw
// shrinks a pile without touching the RNG). If an action changes either, it rolled
// dice or drew a card — i.e. it revealed hidden information. Undoing across that is a
// "foreknowledge" undo.
const drawTotal = (s: GameState): number =>
  (['fp', 'shadow'] as Side[]).reduce((n, side) => n + s.cards[side].draw.character.length + s.cards[side].draw.strategy.length, 0);
const fingerprint = (s: GameState): string => `${s.rngState}|${drawTotal(s)}`;

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

  // Undo history: a snapshot of the state + its fingerprint taken just BEFORE each
  // action the controlling human takes. Undo restores the most recent snapshot.
  const history: Array<{ state: GameState; fp: string }> = [];
  const HISTORY_CAP = 300;

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
      if (actor && (!aiSide || actor === human)) {
        // Snapshot the pre-action state so this step can be undone.
        history.push({ state: clone(state), fp: fingerprint(state) });
        if (history.length > HISTORY_CAP) history.shift();
        state = wotrAdapter.applyAction(state, action, actor);
      }
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
    undoStatus: () => {
      const prev = history[history.length - 1];
      if (!prev) return { canUndo: false, foreknowledge: false };
      const foreknowledge = prev.fp !== fingerprint(state);
      // 2-player (hotseat): a foreknowledge undo would leak hidden info — disallow it.
      // vs AI: always allowed, but flagged so the UI warns and the engine logs it.
      if (!aiSide && foreknowledge) {
        return { canUndo: false, foreknowledge: true, reason: 'Undoing past a dice roll or card draw would reveal hidden information in a 2-player game.' };
      }
      return { canUndo: true, foreknowledge };
    },
    undo: async () => {
      const prev = history[history.length - 1];
      if (!prev) return snapshot();
      const foreknowledge = prev.fp !== fingerprint(state);
      if (!aiSide && foreknowledge) return snapshot();    // never permitted in 2-player
      history.pop();
      state = prev.state;
      // Record a foreknowledge undo on the (restored) log so it's visible that the
      // player re-decided after seeing a random outcome.
      if (foreknowledge) log(state, human, 'undo', `${sideName(human)} used a foreknowledge undo — re-deciding after seeing a random outcome (dice/cards).`);
      oppLogStart = state.log.length;
      opened = true;
      return snapshot();
    },
    // Local play has no server-side game, so reports go to the public /api/report
    // endpoint (same-origin on the deployed site; the CORS-open deployed endpoint
    // from the local dev client, which has no Functions runtime).
    // Never-silent report via the framework helper (resolves only on a confirmed
    // reportId; throws on any failure). Local play has no server game, so it posts to
    // the public /api/report endpoint with the seat/turn for context.
    // Attach the game log so a LOCAL report is triage-driven (no opponent to
    // protect in solo/AI/hotseat play — the reporter already sees the whole game).
    report: (body) => submitReportViaHttp(REPORT_ENDPOINT, { ...body, you: aiSide ? human : (wotrAdapter.currentActor(state) ?? human), turn: state.turn, log: (state.log ?? []).slice(-2000) }),
  };
}
