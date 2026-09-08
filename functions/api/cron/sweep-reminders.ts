// Stale-turn reminder sweep. Cloudflare Pages has no native cron trigger, so this
// is an HTTP endpoint meant to be hit on a schedule (a Cloudflare Worker cron, an
// external pinger, or `curl` from CI). It emails the player who's been on the
// clock too long — the gap request-driven reminders miss when NO client is open.
//
// Auth: if CRON_SECRET is set, the caller must present it — as the `x-cron-key`
// header (what the reminder-cron Worker sends), a `?key=` param, or an
// Authorization: Bearer header. Without RESEND_API_KEY the sweep still runs but
// the notifier is a no-op (handy for a dry run). More specific than the catch-all
// [[path]].ts, so this file wins the /api/cron/sweep-reminders route.
import { makeCronServer, pruneResolvedSnapshots, type Env } from '../../_lib/server';

// Nudge a seat only once it's been on the clock a good while — async PvP, not a
// chess clock. The framework marks a turn reminded so it won't re-nag each sweep.
const OLDER_THAN_MS = 6 * 60 * 60 * 1000; // 6 hours
// Sweep budget: well inside the ~100 s ceiling a Worker's fetch survives, with room
// for the prune on its daily run.
const SWEEP_BUDGET_MS = 20_000;
// 04:00 UTC = 00:00 EDT — the daily resolved-snapshot prune runs on that tick.
const PRUNE_HOUR_UTC = 4;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Ctx { request: Request; env: Env; }

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  if (env.CRON_SECRET) {
    const url = new URL(request.url);
    const provided = request.headers.get('x-cron-key')
      ?? url.searchParams.get('key')
      ?? (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== env.CRON_SECRET) return json({ error: 'forbidden' }, 403);
  }
  try {
    const server = makeCronServer(env);
    const t0 = Date.now();
    // Time budget (framework >=0.46): a run returns cleanly instead of being cut at
    // Cloudflare's proxy limit; clocks already written persist and the next run
    // continues. Also one batched turn lookup instead of one request per game.
    const result = await server.sweepTurnReminders({ olderThanMs: OLDER_THAN_MS, budgetMs: SWEEP_BUDGET_MS });
    const t1 = Date.now();
    // Housekeeping on the same schedule: trim finished games to their final
    // snapshot (dbf_prune_resolved_snapshots — see supabase/schema.sql). Best-
    // effort; a failed prune must never fail the reminder sweep.
    // The prune is a full dbf_snapshots⋈dbf_games delete-scan — too heavy for every
    // 30 minutes on this instance, and no longer needed that often: the framework
    // (>=0.43) collapses a game's history when it resolves. Keep it as a once-a-day
    // safety net at the quietest hour. ?prune=1 forces it (for a manual run).
    const url = new URL(request.url);
    const pruneDue = url.searchParams.get('prune') === '1' || new Date().getUTCHours() === PRUNE_HOUR_UTC;
    const pruned = pruneDue ? await pruneResolvedSnapshots(env) : null;
    const t2 = Date.now();
    // Timing per phase — the cron Worker has been erroring (it gives up waiting on
    // this request); this says which half is slow. Visible via `wrangler pages deployment tail`.
    console.log(JSON.stringify({ cron: 'sweep-reminders', sweepMs: t1 - t0, pruneMs: t2 - t1, ...result, prunedSnapshots: pruned }));
    return json({ ok: true, emailsConfigured: !!env.RESEND_API_KEY, prunedSnapshots: pruned, ...result });
  } catch (e) {
    const msg = (e as Error).message ?? 'error';
    return json({ error: msg }, /not configured/i.test(msg) ? 503 : 500);
  }
};
