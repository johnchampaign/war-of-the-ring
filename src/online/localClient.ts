// Local in-browser game client (no network). Runs the engine directly via the same
// wotrAdapter the server uses. Two modes:
//   • hotseat  — two humans share the screen; whoever is up controls it.
//   • vs AI    — the human plays one side; the heuristic AI (src/ai) auto-plays the
//                other. The human only ever sees their own redacted view and only
//                acts on their own turn; the AI's moves are applied between turns.
import { Rng, recordPlay } from 'digital-boardgame-framework';
import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import { createGame } from '../engine/setup';
import { wotrAdapter, startGame } from '../adapter/wotrAdapter';
import { chooseAction } from '../ai/wotrAI';
import { log } from '../engine/log';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { GameClientApi, ViewResult } from './gameClient';
import { applyCombatScenario } from '../devtabs/combatScenario';
import { applyMordorScenario } from '../devtabs/mordorScenario';
import { saveLocalGame, clearLocalGame, type LocalSave } from './localSave';

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

export function makeLocalClient(seed: number, opts: { scenario?: 'combat' | 'mordor'; aiSide?: Side; resume?: LocalSave } = {}): GameClientApi {
  const resume = opts.resume ?? null;
  let state: GameState = resume ? resume.state : startGame(createGame({ seed }));
  if (!resume && opts.scenario === 'combat') state = applyCombatScenario(state);
  if (!resume && opts.scenario === 'mordor') state = applyMordorScenario(state);
  const aiSide = resume ? resume.aiSide : (opts.aiSide ?? null);  // the side the AI plays (null = hotseat)
  const human: Side = aiSide ? other(aiSide) : 'fp';
  // Dev scenarios are throwaway boards; a resumed game is not a NEW play, so neither
  // is beaconed or persisted.
  const persist = !opts.scenario;
  // Best-effort play-count beacon, once when a local game starts (never throws/blocks).
  if (persist && !resume) recordPlay('war-of-the-ring', aiSide ? 'ai' : 'hotseat');
  // Restoring the AI's tie-break cursor (rather than re-seeding) keeps a resumed game
  // on the same deterministic track it was already following.
  const aiRng = resume ? Rng.fromState(resume.aiRng) : new Rng(seed * 1000 + 7);

  // Move-receipt times (feature F): the local mirror of the server's
  // dbf_log_times. The CLIENT stamps its own clock whenever the log grows —
  // the engine stays clock-free. Ascending by seq; a log entry's display time
  // is the first stamp with seq >= entry.seq.
  const logTimes: { seq: number; at: number }[] = resume?.logTimes ? [...resume.logTimes] : [];
  const stampNow = (): void => {
    const last = state.log[state.log.length - 1];
    if (!last) return;
    // An undo shrank the log: stamps past its end are for entries that no
    // longer exist — drop them so the replayed moves get fresh times.
    while (logTimes.length && logTimes[logTimes.length - 1]!.seq > last.seq) logTimes.pop();
    const prev = logTimes[logTimes.length - 1];
    if (!prev || last.seq > prev.seq) logTimes.push({ seq: last.seq, at: Date.now() });
  };

  /** Write the game to its slot after anything that changes it. Once the game is over
   *  the slot is dropped instead — there is nothing left to resume, and leaving it
   *  would offer the player a finished game from the lobby. */
  const persistNow = (): void => {
    if (!persist) return;
    if (wotrAdapter.result?.(state)) { clearLocalGame(); return; }
    saveLocalGame({
      schemaVersion: wotrAdapter.schemaVersion ?? 0, state, aiSide,
      aiRng: aiRng.serialize(), oppLogStart, turn: state.turn, logTimes,
    });
  };

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
  // On resume, keep the boundary the saved game had and treat the session as already
  // opened, so reloading mid-turn does not wipe a pending "while you were away" summary.
  let oppLogStart = resume ? resume.oppLogStart : 0;
  let opened = !!resume;

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
    // `oppLogStart` is an index into the FULL log, but the view's log is REDACTED
    // (opponent-side-tagged entries are stripped, same rule as redact.ts). Slicing
    // the shorter redacted log with a full-log index shows the wrong entries — or,
    // once enough hidden entries pile up (e.g. the Shadow's combat-card plays by
    // turn 2), an index PAST the end, so the "while you waited" summary silently
    // shows nothing. Translate the boundary into the redacted log's index space.
    const redactedBoundary = state.log.slice(0, oppLogStart).filter((e) => e.side == null || e.side === viewer).length;
    (view as unknown as { oppLogStart: number }).oppLogStart = redactedBoundary;
    return { view, yourTurn: !over && (aiSide ? actor === human : true), turn: state.turn, gameOver: over, you: viewer };
  };

  return {
    mode: aiSide ? 'vs-ai' : 'hotseat',
    aiSide,
    // Opening sets the marker to "nothing new"; later refreshes must NOT reset it
    // (in local play the opponent acts inside submit, so a poll mustn't wipe the
    // pending summary).
    fetch: async () => {
      const before = state.log.length;
      runAI();
      const firstOpen = !opened;
      if (firstOpen) { oppLogStart = state.log.length; opened = true; }
      // Persist on the very first open too, not just on a move: a game the player
      // started but has not yet acted in is still a game, and losing it to a reload is
      // the exact complaint this exists to fix.
      if (firstOpen || state.log.length !== before) { stampNow(); persistNow(); }
      return snapshot();
    },
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
      stampNow();
      persistNow();
      return snapshot();
    },
    legalActions: async () => {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (!actor || (aiSide && actor !== human)) return [];
      return wotrAdapter.legalActions(state, actor);
    },
    logTimes: async () => logTimes.map((t) => ({ seq: t.seq, at: new Date(t.at).toISOString() })),
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
      stampNow(); // also prunes stamps past the restored log's end
      persistNow();
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
    report: (body) => {
      // Attach a STATE SNAPSHOT for triage: the reporter's redacted view + the legal
      // actions available right now. Makes "option X isn't offered" bugs diagnosable
      // without a repro — we can see whether X was in legalActions and why. It's the
      // reporter's OWN view (no hidden opponent info beyond what they already see).
      const seat = aiSide ? human : (wotrAdapter.currentActor(state) ?? human);
      const cur = wotrAdapter.currentActor(state);
      let stateSnap = '';
      try {
        // Client context (mode, viewport, UI-summary state) so triage doesn't have to
        // guess the setup — a "no pop-up" / "layout looks wrong" report is only
        // diagnosable if we know vs-AI vs hotseat and the screen size it was seen on.
        const w = typeof window !== 'undefined' ? window : undefined;
        const client = {
          mode: aiSide ? 'vs-ai' : 'hotseat',
          humanSide: human, aiSide: aiSide ?? null,
          yourTurn: aiSide ? cur === human : true,
          oppLogStart, // full-log index the "while you waited" summary keys off
          viewport: w ? { w: w.innerWidth, h: w.innerHeight, dpr: w.devicePixelRatio } : null,
          userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
        };
        stateSnap = JSON.stringify({
          seat, currentActor: cur, client,
          legalActions: cur ? wotrAdapter.legalActions(state, cur) : [],
          view: wotrAdapter.viewFor(state, seat),
        }).slice(0, 200000);
      } catch { /* never let snapshotting block a report */ }
      return submitReportViaHttp(REPORT_ENDPOINT, { ...body, you: seat, turn: state.turn, log: (state.log ?? []).slice(-2000), snapshot: stateSnap });
    },
  };
}
