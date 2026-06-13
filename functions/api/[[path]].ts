// Cloudflare Pages Function: the /api/* lobby for online async play. Routes map
// onto the framework GameServer (see _lib/server.ts). Token auth via ?as=TOKEN.
// Mirrors the integration-guide route table.
import { makeServer, type Env } from '../_lib/server';
import { ConflictError } from 'digital-boardgame-framework/server';
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

async function safeJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return undefined; }
}

function randomSeed(): number {
  const a = new Uint32Array(1);
  (globalThis.crypto ?? require('node:crypto').webcrypto).getRandomValues(a);
  return a[0]!;
}
