// Abandoned ranked games (John, 2026-10-11; player report a05cialu8jn3as70). Kept free
// of Supabase / Cloudflare imports so scripts/probe-forfeit.mjs can run it on FsStore.
import type { WotrAction } from '../../src/adapter/wotrAction';

// A ranked game never ended if a player simply stopped, so leaving a lost game cost
// nothing on the leaderboard. Once a ranked game has had no move for FORFEIT_IDLE_DAYS,
// the seat on the clock forfeits: the sweep submits `forfeit` AS that seat through the
// normal request-path server, so the game resolves and is rated exactly as any other
// ending does. Only a HUMAN seat is ever forfeited (an AI seat never sits idle, and if
// one somehow did, the human must not lose for it), and only in games where at least
// one human has claimed a ranked identity.
export const FORFEIT_IDLE_DAYS = 14;
// Games that had already gone quiet before this rule existed are left alone: their
// players were never told that walking away now costs a game.
const FORFEIT_RULE_START = Date.parse('2026-10-11T00:00:00Z');

export interface ForfeitOpts { nowMs?: number; maxForfeits?: number; dryRun?: boolean }
export interface ForfeitResult { candidates: number; forfeited: { gameId: string; seat: string }[]; remaining: number; errors: string[] }

/** Server-like / store-like: the slices of GameServer and the store this needs. */
interface ForfeitServer {
  fetch(gameId: string, token: string): Promise<{ view: unknown; yourTurn: boolean; gameOver: boolean }>;
  submit(gameId: string, token: string, action: WotrAction): Promise<unknown>;
}
interface ForfeitStore {
  listActiveGames(): Promise<{ gameId: string; tokens: Record<string, string>; identities?: Record<string, string> }[]>;
  listSnapshotStats?(gameIds: string[]): Promise<Map<string, { lastAt?: string }>>;
}

export async function forfeitIdle(server: ForfeitServer, store: ForfeitStore, opts: ForfeitOpts = {}): Promise<ForfeitResult> {
  const now = opts.nowMs ?? Date.now();
  const max = opts.maxForfeits ?? 4;
  const cutoff = now - FORFEIT_IDLE_DAYS * 86_400_000;
  const quietSince = FORFEIT_RULE_START - FORFEIT_IDLE_DAYS * 86_400_000;
  const isAi = (id: string | undefined) => !id || id.startsWith('ai:');
  // This game's seats are exactly fp + shadow; the store is shared with other games.
  const ranked = (await store.listActiveGames()).filter((m) => {
    const seats = Object.keys(m.tokens ?? {}).sort().join(',');
    return seats === 'fp,shadow' && Object.values(m.identities ?? {}).some((id) => !isAi(id));
  });
  const stats: Map<string, { lastAt?: string }> = store.listSnapshotStats ? await store.listSnapshotStats(ranked.map((m) => m.gameId)) : new Map();
  const idle = ranked.filter((m) => {
    const at = Date.parse(stats.get(m.gameId)?.lastAt ?? '');
    return Number.isFinite(at) && at < cutoff && at >= quietSince;
  });
  const forfeited: { gameId: string; seat: string }[] = [];
  const errors: string[] = [];
  let remaining = 0;
  for (const m of idle) {
    if (forfeited.length >= max) { remaining++; continue; }
    try {
      for (const seat of ['fp', 'shadow'] as const) {
        if (m.identities?.[seat]?.startsWith('ai:')) continue; // an AI seat is never forfeited
        const token = m.tokens[seat];
        if (!token) continue;
        const r = await server.fetch(m.gameId, token);
        const v = r.view as unknown as { fellowship?: unknown; hunt?: unknown } | null;
        if (!v?.fellowship || !v.hunt || r.gameOver || !r.yourTurn) continue;
        if (!opts.dryRun) await server.submit(m.gameId, token, { kind: 'forfeit', days: FORFEIT_IDLE_DAYS });
        forfeited.push({ gameId: m.gameId, seat });
        break;
      }
    } catch (e) { errors.push(`${m.gameId}: ${(e as Error).message ?? String(e)}`); }
  }
  return { candidates: idle.length, forfeited, remaining, errors };
}
