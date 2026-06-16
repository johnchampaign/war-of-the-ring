// Per-request GameServer factory for the Cloudflare Pages Functions. Imports the
// framework server via the Workers-safe BARREL ('digital-boardgame-framework/
// server' — it exports SupabaseStore but NOT FsStore/node:fs; FsStore lives in
// '…/server/node'). The Supabase client + GameServer are cached at module scope
// across requests (warm isolates). The static game catalog (assets/*.json) is the
// engine's own module-scoped import — never in the snapshot.
import {
  GameServer, SupabaseStore, NoopNotifier, ResendNotifier,
  SupabaseBroadcaster, NoopBroadcaster,
} from 'digital-boardgame-framework/server';
import { jsonCodec } from 'digital-boardgame-framework';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { wotrAdapter } from '../../src/adapter/wotrAdapter';
import type { GameState } from '../../src/engine/types';
import type { WotrAction } from '../../src/adapter/wotrAction';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  PUBLIC_BASE_URL?: string;
  CRON_SECRET?: string;
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
    adapter: wotrAdapter,
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(supabase(env)),
    notifier: new NoopNotifier(),
    broadcaster: new SupabaseBroadcaster({
      supabaseUrl: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
    }),
    gameUrl: gameUrlFor(env),
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
    notifier,
    broadcaster: new NoopBroadcaster(),
    gameUrl: gameUrlFor(env),
  });
}
