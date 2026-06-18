// Cloudflare Pages Function: the /api/* lobby for online async play. Routes map
// onto the framework GameServer (see _lib/server.ts). Token auth via ?as=TOKEN.
// Mirrors the integration-guide route table.
import { makeServer, makeStore, type Env } from '../_lib/server';
import { ConflictError, type BugReportRow } from 'digital-boardgame-framework/server';
import { createGame } from '../../src/engine/setup';
import { startGame } from '../../src/adapter/wotrAdapter';

// Game-log uploads come from any origin (incl. the dev client on localhost), so
// that one public endpoint is CORS-open. It writes non-PII AI-tuning data only.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...extra } });
const randomId = (): string => {
  const a = new Uint8Array(10);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
};

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

    // POST /api/gamelog — PUBLIC: a FINISHED game's log, uploaded to improve the AI
    // (the Axis & Allies / Tyrants pattern). Non-PII tuning data; CORS-open so the
    // dev client (different origin) can post too. Stored as a 'wotr-gamelog' report.
    if (seg.length === 1 && seg[0] === 'gamelog') {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (method === 'POST') {
        const body = await safeJson(request);
        const id = randomId();
        await makeStore(env).putReport({
          reportId: id,
          gameId: String(body?.gameId ?? 'local').slice(0, 64),
          reporterSide: String(body?.you ?? '?').slice(0, 16),
          turnNumber: Number(body?.turns) || 0,
          serverSnapshot: '',
          reporterView: '',
          clientLog: Array.isArray(body?.log) ? body.log.slice(-3000) : [],
          message: String(body?.message ?? 'GAME COMPLETE — uploaded for AI tuning').slice(0, 600),
          severity: 'feedback',
          category: 'wotr-gamelog',
          clientBuild: typeof body?.clientBuild === 'string' ? body.clientBuild : undefined,
          createdAt: new Date().toISOString(),
        });
        return json({ ok: true, reportId: id }, 200, CORS);
      }
    }

    // POST /api/report — PUBLIC: a bug / rules-question / feedback report from LOCAL
    // play (hotseat / vs AI), which has no server-side game to attach to. CORS-open
    // like gamelog so the dev client can post too. Stored as a normal 'wotr' report
    // so it lands in the triage queue alongside online reports.
    if (seg.length === 1 && seg[0] === 'report') {
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (method === 'POST') {
        const body = await safeJson(request);
        const id = randomId();
        const sev = String(body?.severity ?? 'bug');
        await makeStore(env).putReport({
          reportId: id,
          gameId: 'local',
          reporterSide: String(body?.you ?? '?').slice(0, 16),
          turnNumber: Number(body?.turn) || 0,
          serverSnapshot: '',
          reporterView: '',
          clientLog: Array.isArray(body?.log) ? body.log.slice(-3000) : [], // local game log, for triage
          message: String(body?.message ?? '').slice(0, 2000),
          severity: ['bug', 'rules-question', 'feedback'].includes(sev) ? sev : 'bug',
          category: 'wotr',
          clientBuild: typeof body?.clientBuild === 'string' ? body.clientBuild : undefined,
          createdAt: new Date().toISOString(),
        });
        return json({ ok: true, reportId: id }, 200, CORS);
      }
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
      // ?full=1 additionally includes the move log — but ONLY for 'wotr-gamelog'
      // entries (a finished game's public moves; safe to expose). Never for bug
      // reports, whose client log can carry the reporter's hidden game state.
      const full = url.searchParams.get('full') === '1';
      return json({ reports: reports.map((r) => summarizeReport(r, full)) });
    }
    // POST /api/reports/:id/resolve  { note }
    if (seg.length === 3 && seg[0] === 'reports' && seg[2] === 'resolve' && method === 'POST') {
      const body = await safeJson(request);
      await server.resolveReport(seg[1]!, String(body?.note ?? body?.resolution ?? '').slice(0, 2000));
      return json({ ok: true });
    }
    // GET /api/my-responses?reporterId=<id> — PUBLIC: a reporter polls for the
    // resolution notes on the reports THEY filed (tied by the <!-- reporter:ID -->
    // marker the client embeds in each message). Returns only RESOLVED reports —
    // the note + their original text, marker stripped — and no PII (never the
    // server snapshot, reporter view, or client log, which can carry hidden state).
    if (seg.length === 1 && seg[0] === 'my-responses' && method === 'GET') {
      const rid = (url.searchParams.get('reporterId') ?? '').trim();
      if (!/^[a-zA-Z0-9-]{4,64}$/.test(rid)) return json({ ok: false, error: 'bad-reporterId' }, 400, CORS);
      const marker = `<!-- reporter:${rid} -->`;
      const reports = await server.listReports({ category: 'wotr' });
      const responses = reports
        .filter((r) => r.resolution && typeof r.message === 'string' && r.message.includes(marker))
        .map((r) => ({
          reportId: r.reportId,
          message: r.message.replace(/\n*<!-- reporter:[a-zA-Z0-9-]{4,64} -->/g, '').trim().slice(0, 500),
          response: (r.resolution!.note ?? '').trim(),
          at: r.resolution!.at,
        }))
        .filter((r) => r.response.length > 0);
      return json({ ok: true, responses }, 200, CORS);
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
function summarizeReport(r: BugReportRow, full = false) {
  const base = {
    reportId: r.reportId, gameId: r.gameId, reporterSide: r.reporterSide,
    turnNumber: r.turnNumber, message: r.message, severity: r.severity,
    category: r.category, clientBuild: r.clientBuild,
    createdAt: r.createdAt, resolution: r.resolution,
  };
  // The move log is exposed (with ?full=1) for game-log uploads AND for LOCAL bug
  // reports (gameId 'local' = solo/AI/hotseat — no opponent's hidden state to leak),
  // so local reports are triage-driven. Online bug reports keep it token-gated.
  const localBug = r.category === 'wotr' && r.gameId === 'local';
  return full && (r.category === 'wotr-gamelog' || localBug) ? { ...base, clientLog: r.clientLog } : base;
}

async function safeJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return undefined; }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(a);
  return a[0]!;
}
