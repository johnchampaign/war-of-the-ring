// Online transport: a GameClientApi over the /api/* routes, for the framework's
// useGame hook (Phase 3 UI). Pure fetch — no React, no engine. The UI renders the
// redacted `view` and submits actions; it never owns rules and never drives the
// opponent. Also exposes the standard-kit messaging (chat) + realtime subscribe
// factories; the local hotseat client omits them (no remote opponent to push to).
import { subscribeSupabaseRealtime } from 'digital-boardgame-framework/client/realtime';
import { submitReportViaHttp } from 'digital-boardgame-framework/client';
import type { ChatMessage } from 'digital-boardgame-framework/client';
import type { GameState } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';

export interface ViewResult {
  view: GameState;
  yourTurn: boolean;
  turn: number;
  gameOver: boolean;
  you: 'fp' | 'shadow';
}

/** Whether an undo is currently available, and whether it would cross a random
 *  outcome the player has already seen ("foreknowledge"). In a 2-player game a
 *  foreknowledge undo is disallowed (canUndo:false, with a reason); vs the AI it's
 *  allowed but flagged so the UI can warn + the engine can log it. */
export interface UndoStatus { canUndo: boolean; foreknowledge: boolean; reason?: string }

export interface GameClientApi {
  fetch(): Promise<ViewResult>;
  submit(action: WotrAction): Promise<ViewResult>;
  legalActions(): Promise<WotrAction[]>;
  report(body: { message: string; category?: string; severity?: 'bug' | 'rules-question' | 'feedback'; clientBuild?: string }): Promise<{ reportId: string }>;
  // Local-only undo (hotseat / vs AI). Absent on the online client (server-side undo
  // is a separate, deferred feature). undoStatus is a synchronous read of the local
  // history; undo() reverts one action and returns the refreshed view.
  undo?(): Promise<ViewResult>;
  undoStatus?(): UndoStatus;
  // Online-only (absent on the hotseat client):
  listMessages?(): Promise<ChatMessage[]>;
  postMessage?(body: string): Promise<ChatMessage[]>;
  /** Realtime "a move happened" subscription (for useGame). */
  subscribeMoves?: (onChange: () => void) => () => void;
  /** Realtime "a chat message was posted" subscription (for useMessages). */
  subscribeMessages?: (onChange: () => void) => () => void;
}

// Public Supabase url + anon key, baked in at build time when present. Enables
// realtime push; absent -> the hooks fall back to polling (still correct).
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function makeGameClient(gameId: string, token: string): GameClientApi {
  const base = `/api/games/${encodeURIComponent(gameId)}`;
  const q = `?as=${encodeURIComponent(token)}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}${q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json());

  const realtime = SB_URL && SB_ANON
    ? (event: 'moved' | 'message') => subscribeSupabaseRealtime({ supabaseUrl: SB_URL, anonKey: SB_ANON, gameId, event })
    : null;

  return {
    fetch: () => fetch(`${base}${q}`).then((r) => r.json()),
    submit: (action) => post('/submit', { action }),
    legalActions: () => fetch(`${base}/legal${q}`).then((r) => r.json()).then((r) => r.legalActions ?? r),
    // Never-silent: resolves only on a server-confirmed reportId; rejects on network
    // error / non-OK status / unparseable body / missing id (framework helper).
    report: (body) => submitReportViaHttp(`${base}/report${q}`, body),
    listMessages: () => fetch(`${base}/chat${q}`).then((r) => r.json()),
    postMessage: (body: string) => post('/chat', { message: body }),
    subscribeMoves: realtime ? realtime('moved') : undefined,
    subscribeMessages: realtime ? realtime('message') : undefined,
  };
}

/** Create a new online game; returns the gameId and both seats' invite URLs. */
export async function createOnlineGame(): Promise<{ gameId: string; invites: Record<'fp' | 'shadow', string> }> {
  return fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then((r) => r.json());
}

/** Parse a seat invite from the URL (?g=<gameId>&t=<token>, or an ?as= invite). */
export function readOnlineInvite(search = window.location.search): { gameId: string; token: string } | null {
  const p = new URLSearchParams(search);
  const gameId = p.get('g'); const token = p.get('t') ?? p.get('as');
  return gameId && token ? { gameId, token } : null;
}
