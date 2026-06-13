// Online transport: a GameClientApi over the /api/* routes, for the framework's
// useGame hook (Phase 3 UI). Pure fetch — no React, no engine. The UI renders the
// redacted `view` and submits actions; it never owns rules and never drives the
// opponent.
import type { GameState } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';

export interface ViewResult {
  view: GameState;
  yourTurn: boolean;
  turn: number;
  gameOver: boolean;
  you: 'fp' | 'shadow';
}

export interface GameClientApi {
  fetch(): Promise<ViewResult>;
  submit(action: WotrAction): Promise<ViewResult>;
  legalActions(): Promise<WotrAction[]>;
  report(body: { message: string; category?: string; severity?: string }): Promise<{ reportId: string }>;
}

export function makeGameClient(gameId: string, token: string): GameClientApi {
  const base = `/api/games/${encodeURIComponent(gameId)}`;
  const q = `?as=${encodeURIComponent(token)}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}${q}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json());
  return {
    fetch: () => fetch(`${base}${q}`).then((r) => r.json()),
    submit: (action) => post('/submit', { action }),
    legalActions: () => fetch(`${base}/legal${q}`).then((r) => r.json()).then((r) => r.legalActions ?? r),
    report: (body) => post('/report', body),
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
