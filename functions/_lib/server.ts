// Per-request GameServer factory for the Cloudflare Pages Functions. Imports the
// framework server via the Workers-safe BARREL ('digital-boardgame-framework/
// server' — it exports SupabaseStore but NOT FsStore/node:fs; FsStore lives in
// '…/server/node'). The Supabase client + GameServer are cached at module scope
// across requests (warm isolates). The static game catalog (assets/*.json) is the
// engine's own module-scoped import — never in the snapshot.
import {
  GameServer, SupabaseStore, NoopNotifier, ResendNotifier,
  SupabaseBroadcaster, NoopBroadcaster, verifyIdentityToken, type Jwks,
} from 'digital-boardgame-framework/server';
import { jsonCodec } from 'digital-boardgame-framework';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { wotrAdapter } from '../../src/adapter/wotrAdapter';
import { wotrControllers } from '../../src/ai/wotrControllers';
import type { GameState } from '../../src/engine/types';
import type { WotrAction } from '../../src/adapter/wotrAction';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_BASE_URL?: string;
  CRON_SECRET?: string;
  /** Shared secret matching the hub's RATINGS_INGEST_KEY (enables ranked play). */
  RATINGS_INGEST_KEY?: string;
}

const HUB = 'https://games-hub-5vo.pages.dev';
let _jwks: Jwks | undefined;
let _jwksAt = 0;
async function getJwks(): Promise<Jwks> {
  if (!_jwks || Date.now() - _jwksAt > 3_600_000) {
    _jwks = (await (await fetch(`${HUB}/id/jwks`)).json()) as Jwks;
    _jwksAt = Date.now();
  }
  return _jwks;
}

type WotrServer = GameServer<GameState, WotrAction, 'fp' | 'shadow'>;

let cachedSupabase: SupabaseClient | null = null;
let cachedKey = '';

function supabase(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  const key = env.SUPABASE_URL + '|' + env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cachedSupabase || cachedKey !== key) {
    cachedSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    cachedKey = key;
  }
  return cachedSupabase;
}

/** Bare Supabase store — for direct report writes (e.g. game-log uploads) that
 *  aren't tied to a server-side game. */
export function makeStore(env: Env): SupabaseStore {
  return new SupabaseStore(supabase(env));
}

const baseUrl = (env: Env) => env.PUBLIC_BASE_URL ?? 'https://war-of-the-ring.pages.dev';
const gameUrlFor = (env: Env) => (gameId: string, token: string) =>
  `${baseUrl(env)}/play/${gameId}?as=${token}`;

/** Request-path server: broadcasts a "moved" / "message" signal after each move
 *  or chat post so the waiting opponent's client refreshes instantly (signal
 *  only — never state). Reminder emails are NOT sent here (NoopNotifier); that's
 *  the cron's job, to avoid emailing on every request. */
export function makeServer(env: Env): WotrServer {
  return new GameServer<GameState, WotrAction, 'fp' | 'shadow'>({
    snapshotHistory: 20,   // cap per-game snapshot history (framework >=0.32)
    adapter: wotrAdapter,
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(supabase(env)),
    aiControllers: wotrControllers, // server-driven AI seats (rated)
    playBeacon: { appId: 'war-of-the-ring' }, // best-effort 'online' play beacon on createGame
    notifier: new NoopNotifier(),
    broadcaster: new SupabaseBroadcaster({
      supabaseUrl: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    gameUrl: gameUrlFor(env),
    // Ranked play: verify hub identity tokens (claimSeat) + auto-report results.
    verifyIdentity: async (t) => verifyIdentityToken(t, await getJwks()),
    ...(env.RATINGS_INGEST_KEY
      ? { ratings: { game: 'war-of-the-ring', ingestKey: env.RATINGS_INGEST_KEY } }
      : {}),
  });
}

/** Cron-path server for sweepTurnReminders: uses the real ResendNotifier (when
 *  RESEND_API_KEY is set) so the player on the clock gets an "it's your move"
 *  email even with no client open. No broadcaster — the sweep makes no moves. */
export function makeCronServer(env: Env): WotrServer {
  const notifier = env.RESEND_API_KEY
    ? new ResendNotifier({
        apiKey: env.RESEND_API_KEY,
        from: env.RESEND_FROM ?? 'War of the Ring <noreply@war-of-the-ring.pages.dev>',
        subject: ({ turn }) => `War of the Ring — it's your move (turn ${turn})`,
      })
    : new NoopNotifier();
  return new GameServer<GameState, WotrAction, 'fp' | 'shadow'>({
    adapter: wotrAdapter,
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(supabase(env)),
    playBeacon: { appId: 'war-of-the-ring' }, // best-effort 'online' play beacon on createGame
    notifier,
    broadcaster: new NoopBroadcaster(),
    gameUrl: gameUrlFor(env),
  });
}

// ————— Move-receipt timestamps (feature F, 2026-08-15) —————————————————————
// The engine is clock-free by design (no Date.now in src/engine), so the log
// has ORDER but no TIME. These helpers hang wall-clock receipt times off the
// framework log's `seq` at the transport layer: one dbf_log_times row per
// applied move, stamped when the server accepts it. A log entry's display time
// is the FIRST stamp with log_seq >= entry.seq (stamps are monotonic in seq).

/** Best-effort: record that the move producing log seq `logSeq` arrived now.
 *  Duplicate seq (e.g. a re-fetch race) is ignored; a clock must never block or
 *  fail a move, so errors are swallowed. */
export async function stampLogTime(env: Env, gameId: string, logSeq: number, seat: string): Promise<void> {
  try {
    await supabase(env).from('dbf_log_times').upsert(
      { game_id: gameId, log_seq: logSeq, seat: seat || null },
      { onConflict: 'game_id,log_seq', ignoreDuplicates: true },
    );
  } catch { /* best-effort */ }
}

/** All receipt times for a game, ascending by seq. Non-PII transport metadata
 *  (a wall-clock instant + which seat moved — the same information the
 *  opponent's "moved" broadcast already carries), so it's a public read under
 *  the trust-tier split. */
export async function fetchLogTimes(env: Env, gameId: string): Promise<{ seq: number; at: string; seat: string | null }[]> {
  const { data } = await supabase(env).from('dbf_log_times')
    .select('log_seq, seat, created_at')
    .eq('game_id', gameId)
    .order('log_seq', { ascending: true })
    .limit(10000);
  return (data ?? []).map((r: { log_seq: number; seat: string | null; created_at: string }) =>
    ({ seq: r.log_seq, at: r.created_at, seat: r.seat }));
}

/** Trim every RESOLVED game to its final snapshot (dbf_prune_resolved_snapshots,
 *  supabase/schema.sql). Returns rows removed, or null if the function is
 *  missing / the call failed — best-effort housekeeping, never throws. */
export async function pruneResolvedSnapshots(env: Env): Promise<number | null> {
  try {
    const { data, error } = await supabase(env).rpc('dbf_prune_resolved_snapshots');
    return error ? null : (typeof data === 'number' ? data : null);
  } catch { return null; }
}
