// Local in-browser game client (no network). Runs the engine directly via the same
// wotrAdapter the server uses. Two modes:
//   • hotseat  — two humans share the screen; whoever is up controls it.
//   • vs AI    — the human plays one side; the heuristic AI (src/ai) auto-plays the
//                other. The human only ever sees their own redacted view and only
//                acts on their own turn; the AI's moves are applied between turns.
import { Rng, recordPlay, recordFinish, type PlayMode } from 'digital-boardgame-framework';
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
  // Play-counter beacons only from a real page: the probe scripts drive this client
  // headlessly under vite-node, where they would otherwise ping the live hub and
  // inflate the counts. (probe-local-save stubs `window` and `fetch` to test them.)
  const beacons = persist && typeof window !== 'undefined';
  // Best-effort play-count beacon, once when a local game starts (never throws/blocks).
  // The mode is fixed for the life of this client (aiSide never changes), so the finish
  // beacon below reuses it verbatim.
  const playMode: PlayMode = aiSide ? 'ai' : 'hotseat';
  if (beacons && !resume) recordPlay('war-of-the-ring', playMode);
  // Matching "game finished" beacon: fires once, on the transition into game-over only.
  // Seeded from the starting state, so reopening an already-finished game never fires.
  // Undo can step back out of game-over, but this client still counts one finish.
  // Outcome only for vs-AI, from the human's side; hotseat has no single "human" side.
  let finishRecorded = !!wotrAdapter.result?.(state);
  const maybeRecordFinish = (): void => {
    if (!beacons || finishRecorded || !wotrAdapter.result?.(state)) return;
    finishRecorded = true;
    recordFinish('war-of-the-ring', playMode,
      aiSide ? { outcome: state.winner === human ? 'win' : 'loss' } : {});
  };
  // Restoring the AI's tie-break cursor (rather than re-seeding) keeps a resumed game
  // on the same deterministic track it was already following.
  const aiRng = resume ? Rng.fromState(resume.aiRng) : new Rng(seed * 1000 + 7);
  // The name this game's whole log is kept under in the browser (src/play/fullLog.ts);
  // carried in the save so a resumed game finds it again.
  const logKey = resume?.logKey ?? `local:${seed}:${Date.now().toString(36)}`;

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
    maybeRecordFinish();
    if (wotrAdapter.result?.(state)) { clearLocalGame(); return; }
    saveLocalGame({
      schemaVersion: wotrAdapter.schemaVersion ?? 0, state, aiSide,
      aiRng: aiRng.serialize(), oppLogStart: entriesThrough(oppLogSeq), oppLogSeq, turn: state.turn, logTimes, logKey,
    });
  };

  // The AI waits while the human has a result of their own action still to see — a card's
  // roll, a Hunt tile, a battle's outcome. It used to reply inside the same submit, so the
  // human's popup only appeared after the AI's move and its questions (player report
  // 184z1h4c0v086i62: the Athelas roll popped up after the Shadow's Stormcrow prompt).
  // Released by resumeAI(), which the page calls once those popups are clicked through —
  // never by a poll, so a slow reader isn't overtaken.
  let aiHeld = false;
  const resultMarks = (s: GameState): string =>
    `${(s.notices ?? []).reduce((m, n) => Math.max(m, n.seq), 0)}/${(s.hunt.draws ?? []).reduce((m, d) => Math.max(m, d.seq), 0)}/${s.lastBattle?.seq ?? 0}`;

  // Let the AI take every turn that is its own until control returns to the human
  // (or the game ends). Guarded against a stall so it can never loop forever.
  const runAI = (): void => {
    if (!aiSide || aiHeld) return;
    let guard = 0;
    while (!wotrAdapter.result?.(state) && guard++ < 2000) {
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (actor !== aiSide) break;
      const legal = wotrAdapter.legalActions(state, actor);
      if (legal.length === 0) break;
      state = wotrAdapter.applyAction(state, chooseAction(state, actor, legal, aiRng), actor);
    }
  };

  // Where the "what happened while you were away" summary begins — the first entry
  // the current viewer didn't cause — kept as the `seq` of the last entry BEFORE it.
  // It used to be a log INDEX, but the in-state log is capped (engine/log.ts): once a
  // game reaches the cap, appending drops the oldest entry and the length stops
  // growing, so "the log is longer than where the summary starts" never held again —
  // late in a long game the summary vanished, and a move the AI made on a refresh was
  // neither saved nor time-stamped. `seq` survives the cap. vs-AI: just after the human's
  // action (summary = the AI's turn). Hotseat: before the acting player's action (so
  // the NEXT player sees that turn). Surfaced on the view for the TurnSummary UI.
  // On resume, keep the boundary the saved game had and treat the session as already
  // opened, so reloading mid-turn does not wipe a pending "while you were away" summary.
  const tailSeq = (): number => state.log[state.log.length - 1]?.seq ?? 0;
  const entriesThrough = (seq: number): number => state.log.filter((e) => e.seq <= seq).length;
  // A save from before the switch holds the index; its log is the one it indexed.
  let oppLogSeq = resume ? (resume.oppLogSeq ?? resume.state.log[resume.oppLogStart - 1]?.seq ?? 0) : 0;
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
    // The view's log is REDACTED (opponent-side-tagged entries are stripped, same rule
    // as redact.ts), so the summary's start is counted in the redacted log's index
    // space: a full-log index there shows the wrong entries — or, once enough hidden
    // entries pile up (e.g. the Shadow's combat-card plays by turn 2), an index PAST
    // the end, and the "while you waited" summary silently shows nothing.
    const redactedBoundary = state.log.filter((e) => e.seq <= oppLogSeq && (e.side == null || e.side === viewer)).length;
    (view as unknown as { oppLogStart: number }).oppLogStart = redactedBoundary;
    return { view, yourTurn: !over && (aiSide ? actor === human : true), turn: state.turn, gameOver: over, you: viewer };
  };

  return {
    mode: aiSide ? 'vs-ai' : 'hotseat',
    aiSide,
    gameKey: logKey,
    // Opening sets the marker to "nothing new"; later refreshes must NOT reset it
    // (in local play the opponent acts inside submit, so a poll mustn't wipe the
    // pending summary).
    fetch: async () => {
      const before = tailSeq();
      runAI();
      const firstOpen = !opened;
      if (firstOpen) { oppLogSeq = tailSeq(); opened = true; }
      // Persist on the very first open too, not just on a move: a game the player
      // started but has not yet acted in is still a game, and losing it to a reload is
      // the exact complaint this exists to fix.
      if (firstOpen || tailSeq() !== before) { stampNow(); persistNow(); }
      return snapshot();
    },
    submit: async (action: WotrAction) => {
      const before = tailSeq();
      const actor = wotrAdapter.currentActor(state) as Side | null;
      if (actor && (!aiSide || actor === human)) {
        // Snapshot the pre-action state so this step can be undone.
        history.push({ state: clone(state), fp: fingerprint(state) });
        if (history.length > HISTORY_CAP) history.shift();
        const marks = resultMarks(state);
        state = wotrAdapter.applyAction(state, action, actor);
        if (aiSide && resultMarks(state) !== marks && wotrAdapter.currentActor(state) === aiSide) aiHeld = true;
      }
      const afterHuman = tailSeq();
      runAI();                                            // then let the AI take its turn(s)
      oppLogSeq = aiSide ? afterHuman : before;         // vs-AI: AI's entries; hotseat: the acting player's turn (for the next viewer)
      stampNow();
      persistNow();
      return snapshot();
    },
    /** True while the AI is waiting for the human to see a result (see aiHeld). */
    aiHeld: () => aiHeld,
    /** The human has seen their results: let the AI take its turn(s). */
    resumeAI: async () => {
      if (!aiHeld) return snapshot();
      aiHeld = false;
      const before = tailSeq();
      runAI();
      if (tailSeq() !== before) { stampNow(); persistNow(); }
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
      // Allowed in every local mode — vs AI and hotseat alike (John, 2026-09-14: a
      // hotseat player testing lines wants it; both players share the screen, so the
      // re-decision happens in plain sight). Flagged so the UI warns and the log records it.
      return { canUndo: true, foreknowledge };
    },
    undo: async () => {
      const prev = history[history.length - 1];
      if (!prev) return snapshot();
      const foreknowledge = prev.fp !== fingerprint(state);
      history.pop();
      state = prev.state;
      aiHeld = false; // back before the action whose result held the AI
      // Record a foreknowledge undo on the (restored) log so it's visible that the
      // player re-decided after seeing a random outcome.
      // In hotseat the undoer is whoever is to act in the restored state, not the fixed
      // `human` seat (which is always Free Peoples there). The entry is PUBLIC (side
      // null): a side-tagged entry is secret to that seat, which would hide the record
      // from exactly the hotseat opponent it exists to inform. It names no hidden info.
      const undoer: Side = aiSide ? human : ((wotrAdapter.currentActor(state) as Side | null) ?? human);
      if (foreknowledge) log(state, null, 'undo', `${sideName(undoer)} used a foreknowledge undo — re-deciding after seeing a random outcome (dice/cards).`);
      oppLogSeq = tailSeq();
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
          oppLogSeq, // log seq the "while you waited" summary starts after
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
