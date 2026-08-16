// Persistence for LOCAL games (solo vs AI, and hotseat).
//
// Online games already resume — the server holds them. Local play lived purely in
// memory, so a refresh, a crash, or a phone backgrounding the tab destroyed a game
// outright, with no warning and nothing to go back to. This stores the whole game
// after every move and offers it back from the lobby.
//
// One slot. "Resume my game" is the only thing anyone wants here, and a save list
// would need naming/managing UI for a game you play one at a time.
//
// The blob holds the FULL, un-redacted GameState — both hands, the Hunt bag, the RNG
// cursor. That is not a new disclosure: the local client already holds exactly that in
// memory (it runs the engine in the tab and redacts per view). It does mean a
// determined solo player could read their AI opponent's hand out of localStorage,
// which was equally true of the in-memory game via devtools.
import type { GameState, Side } from '../engine/types';

const KEY = 'wotr.localGame.v1';
/** Bump when the shape of THIS envelope changes; older saves are then discarded. */
const FORMAT = 1;

export interface LocalSave {
  format: number;
  /** wotrAdapter.schemaVersion at save time — a mismatch means the engine state shape
   *  moved under us, and the adapter's migrate() throws by design, so we discard. */
  schemaVersion: number;
  savedAt: number;
  state: GameState;
  /** The side the AI plays; null for hotseat. */
  aiSide: Side | null;
  /** The AI's tie-break Rng cursor (Rng.serialize()), so a resumed game plays on
   *  deterministically instead of restarting the sequence. */
  aiRng: number;
  /** Where the "what happened while you were away" summary starts. */
  oppLogStart: number;
  /** Move-receipt times (client clock, epoch ms), ascending by log seq — the
   *  local mirror of the server's dbf_log_times (feature F). Stamped by the
   *  local CLIENT, never the engine (which stays clock-free). Optional: saves
   *  from before the feature simply resume with an undated log. */
  logTimes?: { seq: number; at: number }[];
  /** Denormalised for the lobby label so it needn't parse the whole state. */
  turn: number;
}

export interface SavePeek { turn: number; aiSide: Side | null; savedAt: number }

const store = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/** Write the slot. Never throws — a full or blocked quota must not break a move. */
export function saveLocalGame(save: Omit<LocalSave, 'format' | 'savedAt'>): void {
  const s = store();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ ...save, format: FORMAT, savedAt: Date.now() }));
  } catch {
    // Quota exceeded (the log grows all game) or storage disabled in private mode.
    // Drop the stale slot rather than leaving a half-written or long-outdated game
    // that would resume the player into the past.
    try { s.removeItem(KEY); } catch { /* nothing more to do */ }
  }
}

export function clearLocalGame(): void {
  try { store()?.removeItem(KEY); } catch { /* ignore */ }
}

/** Read the slot, or null when there is nothing usable. Anything malformed, from a
 *  different envelope format, or from a different engine schema is dropped rather
 *  than half-loaded — resuming a game the engine can no longer interpret is worse
 *  than starting fresh. */
export function loadLocalGame(schemaVersion: number): LocalSave | null {
  const s = store();
  if (!s) return null;
  let raw: string | null = null;
  try { raw = s.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const save = JSON.parse(raw) as LocalSave;
    if (save?.format !== FORMAT || save.schemaVersion !== schemaVersion) { clearLocalGame(); return null; }
    if (!save.state?.regions || typeof save.state.turn !== 'number') { clearLocalGame(); return null; }
    // A decided game is nothing to resume. The client drops the slot when a game ends
    // on a move, but checking here too covers a game that ended by any other path and
    // any slot written by an older build — the lobby must never offer a finished game.
    if (save.state.winner) { clearLocalGame(); return null; }
    return save;
  } catch {
    clearLocalGame();
    return null;
  }
}

/** Just enough to label the lobby's Resume button. */
export function peekLocalGame(schemaVersion: number): SavePeek | null {
  const save = loadLocalGame(schemaVersion);
  return save ? { turn: save.turn, aiSide: save.aiSide, savedAt: save.savedAt } : null;
}

/** "vs AI (Free Peoples) · turn 7 · 5 minutes ago" */
export function describeSave(p: SavePeek): string {
  const mode = p.aiSide ? `vs AI (you are ${p.aiSide === 'fp' ? 'Shadow' : 'Free Peoples'})` : 'hotseat';
  const mins = Math.max(0, Math.round((Date.now() - p.savedAt) / 60000));
  const when = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago`
    : mins < 60 * 24 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
  return `${mode} · turn ${p.turn} · ${when}`;
}
