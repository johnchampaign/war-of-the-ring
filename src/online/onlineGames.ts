// The online games this browser has joined, so the lobby can list the ones still in
// progress (player report a05cialu8jn3as70: "is there a way to tell if I have any
// online games against the AI in progress?"). An online seat lives only in its
// invite link; nothing else remembered it, so a game opened once and left was lost
// to its player. A per-browser convenience: kept in localStorage, never relied on.

export interface OnlineGameRef { gameId: string; token: string; at: number }

const KEY = 'wotr.onlineGames.v1';
const MAX = 20;

export function listOnlineGames(): OnlineGameRef[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((g) => g && typeof g.gameId === 'string' && typeof g.token === 'string') : [];
  } catch { return []; }
}

function save(list: OnlineGameRef[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* storage unavailable */ }
}

/** Remember (or refresh) a seat, newest first. */
export function rememberOnlineGame(gameId: string, token: string): void {
  save([{ gameId, token, at: Date.now() }, ...listOnlineGames().filter((g) => !(g.gameId === gameId && g.token === token))]);
}

export function forgetOnlineGame(gameId: string, token: string): void {
  save(listOnlineGames().filter((g) => !(g.gameId === gameId && g.token === token)));
}

/** Where a remembered seat is played. */
export const onlineGameHref = (g: OnlineGameRef): string => `/?g=${encodeURIComponent(g.gameId)}&t=${encodeURIComponent(g.token)}`;

export interface OnlineGameStatus { you: 'fp' | 'shadow' | null; turn: number; yourTurn: boolean; gameOver: boolean }

/** The seat's current state from the server, or null if it can't be reached / is gone. */
export async function fetchOnlineGameStatus(g: OnlineGameRef): Promise<OnlineGameStatus | null> {
  try {
    const r = await fetch(`/api/games/${encodeURIComponent(g.gameId)}?as=${encodeURIComponent(g.token)}`);
    if (!r.ok) return null;
    const j = await r.json() as { you?: string; yourTurn?: boolean; gameOver?: boolean; view?: { turn?: number; winner?: unknown } };
    if (!j || !j.view) return null;
    const you = j.you === 'fp' || j.you === 'shadow' ? j.you : null;
    return { you, turn: j.view.turn ?? 0, yourTurn: !!j.yourTurn, gameOver: !!j.gameOver || !!j.view.winner };
  } catch { return null; }
}
