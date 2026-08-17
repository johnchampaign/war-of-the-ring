-- War of the Ring — Supabase schema.
-- This is the Digital Boardgame Framework schema (tables prefixed dbf_), copied
-- here for convenience; it is identical to
-- node_modules/digital-boardgame-framework/supabase/schema.sql. Apply it once to
-- the project in the SQL editor. RLS is REQUIRED (the server uses the
-- service-role key, which bypasses RLS; the anon key — shipped to clients for
-- Realtime — is then denied everything).

create table if not exists dbf_games (
  game_id     text primary key,
  players     jsonb not null,
  tokens      jsonb not null,
  emails      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  resolved    boolean not null default false,
  reminder    jsonb
);
create index if not exists dbf_games_active on dbf_games(game_id) where resolved = false;

create table if not exists dbf_snapshots (
  game_id     text not null references dbf_games(game_id) on delete cascade,
  turn        integer not null,
  state       text not null,
  created_at  timestamptz not null default now(),
  primary key (game_id, turn)
);
create index if not exists dbf_snapshots_latest on dbf_snapshots(game_id, turn desc);

create table if not exists dbf_messages (
  id          bigint generated always as identity primary key,
  game_id     text not null references dbf_games(game_id) on delete cascade,
  seat        text not null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists dbf_messages_game on dbf_messages(game_id, created_at);

create table if not exists dbf_reports (
  report_id        text primary key,
  game_id          text not null,
  reporter_side    text not null,
  turn_number      integer not null,
  server_snapshot  text not null,
  reporter_view    text not null,
  client_log       jsonb not null default '[]'::jsonb,
  message          text not null,
  severity         text not null,
  category         text,
  client_build     text,
  user_agent       text,
  created_at       timestamptz not null default now(),
  resolution       jsonb
);
create index if not exists dbf_reports_created on dbf_reports(created_at desc);
create index if not exists dbf_reports_severity on dbf_reports(severity);
create index if not exists dbf_reports_category on dbf_reports(category);
create index if not exists dbf_reports_unresolved on dbf_reports(report_id) where resolution is null;
create index if not exists dbf_reports_game on dbf_reports(game_id);

-- Row-level security — REQUIRED. Enable with NO policies: denies the anon key,
-- server keeps full access via the service-role key.
alter table dbf_games     enable row level security;
alter table dbf_snapshots enable row level security;
alter table dbf_messages  enable row level security;
alter table dbf_reports   enable row level security;

-- Move-receipt timestamps for the game log (feature F, 2026-08-15).
-- One row per applied move: log_seq is the highest engine-log seq present after
-- that move, stamped with the server's receipt time. Clients map each log entry
-- to the FIRST row with log_seq >= entry.seq (times are monotonic in seq). The
-- engine stays clock-free — this is transport metadata, never game state.
-- Framework-shaped (built on GameLogEntry.seq): candidate to upstream into the
-- framework's schema.sql.
create table if not exists dbf_log_times (
  game_id     text not null references dbf_games(game_id) on delete cascade,
  log_seq     integer not null,
  seat        text,
  created_at  timestamptz not null default now(),
  primary key (game_id, log_seq)
);
create index if not exists dbf_log_times_game on dbf_log_times(game_id, log_seq);
alter table dbf_log_times enable row level security;

-- Snapshot pruning (2026-08-17). The framework keeps up to `snapshotHistory`
-- (20) snapshots per game and never trims a game once it RESOLVES, so finished
-- games kept their whole undo history forever — 72% of the shared project's
-- database (7,891 snapshots / 1.37 GB raw across 666 finished games) and the
-- reason the free tier hit its 500 MB cap. This trims every finished game to its
-- final snapshot (results/replays keep working). Called daily by the WotR cron
-- sweep (functions/api/cron/sweep-reminders.ts); safe to run any time.
-- Framework-shaped: candidate to upstream.
create or replace function dbf_prune_resolved_snapshots()
returns integer
language sql
security definer
as $$
  with gone as (
    delete from dbf_snapshots s
    using dbf_games g
    where g.game_id = s.game_id
      and g.resolved
      and s.turn < (select max(turn) from dbf_snapshots x where x.game_id = s.game_id)
    returning 1
  )
  select count(*)::integer from gone;
$$;
revoke all on function dbf_prune_resolved_snapshots() from public, anon, authenticated;
