// Per-request GameServer factory for the Cloudflare Pages Functions. Imports the
// framework server via the Workers-safe BARREL ('digital-boardgame-framework/
// server' — it exports SupabaseStore but NOT FsStore/node:fs; FsStore lives in
// '…/server/node'). The Supabase client + GameServer are cached at module scope
// across requests (warm isolates). The static game catalog (assets/*.json) is the
// engine's own module-scoped import — never in the snapshot.
import { GameServer, SupabaseStore, NoopNotifier } from 'digital-boardgame-framework/server';
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
}

let cachedSupabase: SupabaseClient | null = null;
let cachedKey = '';

export function makeServer(env: Env): GameServer<GameState, WotrAction, 'fp' | 'shadow'> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  const key = env.SUPABASE_URL + '|' + env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cachedSupabase || cachedKey !== key) {
    cachedSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    cachedKey = key;
  }
  return new GameServer<GameState, WotrAction, 'fp' | 'shadow'>({
    adapter: wotrAdapter,
    codec: jsonCodec<GameState>(),
    store: new SupabaseStore(cachedSupabase),
    notifier: new NoopNotifier(), // Resend wired later (Phase 3 kit)
    gameUrl: (gameId, token) =>
      `${env.PUBLIC_BASE_URL ?? 'https://war-of-the-ring.pages.dev'}/play/${gameId}?as=${token}`,
  });
}
