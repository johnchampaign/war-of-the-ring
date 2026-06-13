// Stale-turn reminder sweep. Cloudflare Pages has no native cron trigger, so this
// is an HTTP endpoint meant to be hit on a schedule (a Cloudflare Worker cron, an
// external pinger, or `curl` from CI). It emails the player who's been on the
// clock too long — the gap request-driven reminders miss when NO client is open.
//
// Auth: if CRON_SECRET is set, the caller must pass ?key=<secret> (or an
// Authorization: Bearer header). Without RESEND_API_KEY the sweep still runs but
// the notifier is a no-op (handy for a dry run). More specific than the catch-all
// [[path]].ts, so this file wins the /api/cron/sweep-reminders route.
import { makeCronServer, type Env } from '../../_lib/server';

const OLDER_THAN_MS = 15 * 60 * 1000; // remind once a seat has been idle 15 min

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Ctx { request: Request; env: Env; }

export const onRequest = async ({ request, env }: Ctx): Promise<Response> => {
  if (env.CRON_SECRET) {
    const url = new URL(request.url);
    const provided = url.searchParams.get('key') ?? (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== env.CRON_SECRET) return json({ error: 'forbidden' }, 403);
  }
  try {
    const server = makeCronServer(env);
    const result = await server.sweepTurnReminders({ olderThanMs: OLDER_THAN_MS });
    return json({ ok: true, emailsConfigured: !!env.RESEND_API_KEY, ...result });
  } catch (e) {
    const msg = (e as Error).message ?? 'error';
    return json({ error: msg }, /not configured/i.test(msg) ? 503 : 500);
  }
};
