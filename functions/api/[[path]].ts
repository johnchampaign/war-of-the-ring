// Cloudflare Pages Function: the /api/* lobby for online async play. Routes map
// onto the framework GameServer (see _lib/server.ts). Token auth via ?as=TOKEN.
// Mirrors the integration-guide route table.
import { makeServer, type Env } from '../_lib/server';
import { ConflictError, type BugReportRow } from 'digital-boardgame-framework/server';
import { createGame } from '../../src/engine/setup';
import { startGame } from '../../src/adapter/wotrAdapter';

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Ctx { request: Request; env: Env; params: { path?: string[] }; }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const onRequest = async (context: Ctx): Promise<Response> => {
  const { request, env } = context;
  const url = new URL(request.url);
  const seg = (context.params.path ?? []); // segments after /api/
  const token = url.searchParams.get('as') ?? '';
  const method = request.method;

  try {
    const server = makeServer(env);

    // POST /api/games — create a game, return { gameId, invites:{fp,shadow} }
    if (seg.length === 1 && seg[0] === 'games' && method === 'POST') {
      const body = await safeJson(request);
      const seed = randomSeed();
      const initialState = startGame(createGame({ seed }));
      const result = await server.createGame({
        initialState,
        players: ['fp', 'shadow'],
        emails: body?.emails,
      });
      return json(result, 201);
    }

    // Report triage — PUBLIC, per the agent-collaboration trust-tier split:
    //  • read returns a PII-stripped SUMMARY only (no server snapshot, reporter
    //    view, client log, or user-agent — those can carry the reporter's hidden
    //    info, e.g. the Fellowship position, so they stay token-gated).
    //  • resolve is a routine, reversible triage write (attach a note). The cost
    //    of a wrong write is "we re-open a report", so it needs no token.
    // GET /api/reports[?unresolved=1][&severity=..][&category=..]
    if (seg.length === 1 && seg[0] === 'reports' && method === 'GET') {
      const u = url.searchParams.get('unresolved');
      // Default to this game's reports only — the Supabase project is shared with
      // other games. Pass ?category= (e.g. an empty value via ?category=*) to widen.
      const cat = url.searchParams.get('category');
      const reports = await server.listReports({
        unresolved: u === '1' || u === 'true' ? true : undefined,
        severity: url.searchParams.get('severity') ?? undefined,
        category: cat === null ? 'wotr' : cat === '*' ? undefined : cat,
      });
      return json({ reports: reports.map(summarizeReport) });
    }
    // POST /api/reports/:id/resolve  { note }
    if (seg.length === 3 && seg[0] === 'reports' && seg[2] === 'resolve' && method === 'POST') {
      const body = await safeJson(request);
      await server.resolveReport(seg[1]!, String(body?.note ?? body?.resolution ?? '').slice(0, 2000));
      return json({ ok: true });
    }

    // /api/games/:id[...]
    if (seg.length >= 2 && seg[0] === 'games') {
      const gameId = seg[1]!;
      const sub = seg[2];

      if (sub === undefined && method === 'GET') return json(await server.fetch(gameId, token));
      if (sub === 'legal' && method === 'GET') return json({ legalActions: await server.legalActions(gameId, token) });
      if (sub === 'submit' && method === 'POST') {
        const body = await safeJson(request);
        return json(await server.submit(gameId, token, body?.action));
      }
      if (sub === 'report' && method === 'POST') {
        const body = await safeJson(request);
        return json(await server.report(gameId, token, body));
      }
      // In-game chat — auth-gated to the two seats (chat is private to the game).
      if (sub === 'chat' && method === 'GET') return json(await server.listMessages(gameId, token));
      if (sub === 'chat' && method === 'POST') {
        const body = await safeJson(request);
        return json(await server.postMessage(gameId, token, body?.message ?? body?.body ?? ''));
      }
    }

    return json({ error: 'not found' }, 404);
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', reason: (e as Error).message }, 409);
    const msg = (e as Error).message ?? 'error';
    // Client-fault errors (bad/expired token, wrong seat, out-of-turn, illegal
    // action) -> 4xx; everything else -> 500.
    let status = 500;
    if (/not configured/i.test(msg)) status = 503;            // server not set up
    else if (/your turn|not .*turn|out of turn/i.test(msg)) status = 409; // re-fetch & re-decide
    else if (/token|seat|unauthor|invalid/i.test(msg)) status = 403;
    else if (/illegal|cannot|no .*die|requires phase|not in hand|not playable/i.test(msg)) status = 422;
    return json({ error: msg }, status);
  }
};

// Public report summary: triage-relevant fields only. Deliberately omits
// serverSnapshot / reporterView / clientLog (can carry the reporter's hidden
// game state) and userAgent (fingerprinting) — those are token-gated reads.
function summarizeReport(r: BugReportRow) {
  return {
    reportId: r.reportId, gameId: r.gameId, reporterSide: r.reporterSide,
    turnNumber: r.turnNumber, message: r.message, severity: r.severity,
    category: r.category, clientBuild: r.clientBuild,
    createdAt: r.createdAt, resolution: r.resolution,
  };
}

async function safeJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return undefined; }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(a);
  return a[0]!;
}
