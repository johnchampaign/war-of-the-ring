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
//
// Budgets. A Pages Function gets ~50 subrequests per request and a caller's
// fetch survives ~100 s. The sweep is one batched turn lookup plus a clock write
// per game that moved (framework >=0.46, `budgetMs`), so it fits; but a prune
// queued AFTER it in the same request was starved of subrequests and never ran
// — which is why the database kept growing. So: a forced prune is its own
// request, and on the daily tick the prune goes FIRST.
//
//   POST /api/cron/sweep-reminders                 sweep (+ daily prune first at PRUNE_HOUR_UTC)
//   POST /api/cron/sweep-reminders?prune=1         SQL prune only (dbf_prune_resolved_snapshots)
//   POST /api/cron/sweep-reminders?prune=finished  framework pruneFinishedGames() only, budgeted;
//                                                  re-call until truncated is false
import { makeCronServer, pruneResolvedSnapshots, countSnapshots, type Env } from '../../_lib/server';

// Nudge a seat only once it's been on the clock a good while — async PvP, not a
// chess clock. The framework marks a turn reminded so it won't re-nag each sweep.
const OLDER_THAN_MS = 6 * 60 * 60 * 1000; // 6 hours
// Sweep budget: well inside the ~100 s a caller's fetch survives.
const SWEEP_BUDGET_MS = 20_000;
// 04:00 UTC = 00:00 EDT — the daily resolved-snapshot prune runs on that tick.
const PRUNE_HOUR_UTC = 4;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Ctx { request: Request; env: Env; }

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  if (env.CRON_SECRET) {
    const provided = request.headers.get('x-cron-key')
      ?? url.searchParams.get('key')
      ?? (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== env.CRON_SECRET) return json({ error: 'forbidden' }, 403);
  }
  try {
    const mode = url.searchParams.get('prune');

    // ?prune=1 — the SQL function, alone. One subrequest.
    if (mode === '1') {
      const t0 = Date.now();
      const prune = await pruneResolvedSnapshots(env);
      return json({ ok: true, mode: 'prune-only', ms: Date.now() - t0, prunedSnapshots: prune.count,
        ...(prune.error ? { pruneError: prune.error } : {}) });
    }

    const server = makeCronServer(env);

    // ?prune=finished — one-off size cleanup through the framework (no SQL
    // function / grant), per game, budgeted; reports dbf_snapshots row counts
    // before/after so the effect is verifiable. Re-call until truncated is false.
    if (mode === 'finished') {
      const before = await countSnapshots(env);
      const t0 = Date.now();
      // maxPrunes 35: ~50 subrequests per request minus the batched lookups and
      // the two row counts. Already-collapsed games cost nothing (>=0.48).
      const r = await server.pruneFinishedGames({ budgetMs: 60_000, maxPrunes: 35 });
      const after = await countSnapshots(env);
      return json({ ok: true, mode: 'prune-finished', ms: Date.now() - t0, snapshotsBefore: before, snapshotsAfter: after, ...r });
    }

    // Normal tick. Daily prune FIRST so it has a subrequest budget.
    const pruneDue = new Date().getUTCHours() === PRUNE_HOUR_UTC;
    const prune = pruneDue ? await pruneResolvedSnapshots(env) : { count: null as number | null };

    const t0 = Date.now();
    const result = await server.sweepTurnReminders({ olderThanMs: OLDER_THAN_MS, budgetMs: SWEEP_BUDGET_MS });
    const sweepMs = Date.now() - t0;
    // Visible via `wrangler pages deployment tail` — which half of a run is slow.
    console.log(JSON.stringify({ cron: 'sweep-reminders', sweepMs, pruneDue, ...result, prunedSnapshots: prune.count, pruneError: prune.error }));
    return json({ ok: true, emailsConfigured: !!env.RESEND_API_KEY, sweepMs, prunedSnapshots: prune.count,
      ...(prune.error ? { pruneError: prune.error } : {}), ...result });
  } catch (e) {
    const msg = (e as Error).message ?? 'error';
    return json({ error: msg }, /not configured/i.test(msg) ? 503 : 500);
  }
};
