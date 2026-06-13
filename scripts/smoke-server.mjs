#!/usr/bin/env vite-node
// smoke-server.mjs — Exercise the framework GameServer + wotrAdapter end-to-end
// locally (node FsStore, no Supabase/Cloudflare needed). Validates the Phase-2
// wiring: create a game, both seats submit by token, fetch per-seat REDACTED
// views, confirm secret isolation (opponent hand + RNG hidden; opponent's pending
// choice stripped), and play to game over driven through the server.
import { GameServer, NoopNotifier } from 'digital-boardgame-framework/server';
import { FsStore } from 'digital-boardgame-framework/server/node';
import { Rng, jsonCodec } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { rmSync } from 'node:fs';

let fails = 0;
const check = (name, cond, extra = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + extra}`); if (!cond) fails++; };

rmSync('./.dev-store', { recursive: true, force: true });
const server = new GameServer({
  adapter: wotrAdapter,
  codec: jsonCodec(),
  store: new FsStore('./.dev-store'),
  notifier: new NoopNotifier(),
  gameUrl: (id, tok) => `http://localhost:5173/play/${id}?as=${tok}`,
});

const created = await server.createGame({
  initialState: startGame(createGame({ seed: 1 })),
  players: ['fp', 'shadow'],
});
const gameId = created.gameId;
// Invites are share URLs (gameUrl); the bare token is the `as` query param.
const tokenOf = (u) => new URL(u).searchParams.get('as');
const invites = { fp: tokenOf(created.invites.fp), shadow: tokenOf(created.invites.shadow) };
check('createGame returns a gameId', typeof gameId === 'string' && gameId.length > 0);
check('createGame returns both seat invites', !!invites.fp && !!invites.shadow && invites.fp !== invites.shadow);

// --- per-seat redacted views + secret isolation ---
const fpView = await server.fetch(gameId, invites.fp);
const shView = await server.fetch(gameId, invites.shadow);
check('fp token authenticates as fp seat', fpView.you === 'fp', `got ${fpView.you}`);
check('shadow token authenticates as shadow seat', shView.you === 'shadow', `got ${shView.you}`);
check('RNG hidden in fp view', fpView.view.rngState === 0);
check('Shadow hand hidden from FP', fpView.view.cards.shadow.hand.every((c) => c === 'hidden'));
check('FP hand hidden from Shadow', shView.view.cards.fp.hand.every((c) => c === 'hidden'));
check('FP sees its OWN hand', fpView.view.cards.fp.hand.every((c) => c !== 'hidden'));
check('Shadow sees its OWN hand', shView.view.cards.shadow.hand.every((c) => c !== 'hidden'));

// --- play to game over, driven through the server by token ---
const rng = new Rng(98765);
let moves = 0, gameOver = false, lastTurn = 0;
for (; moves < 20000; moves++) {
  // Find whose turn it is via a redacted fetch, then act as that seat.
  const fv = await server.fetch(gameId, invites.fp);
  if (fv.gameOver) { gameOver = true; lastTurn = fv.turn; break; }
  const actor = fv.yourTurn ? 'fp' : 'shadow';
  const token = invites[actor];
  const view = actor === 'fp' ? fv : await server.fetch(gameId, token);
  const legal = await server.legalActions(gameId, token);
  if (legal.length === 0) { check('no stall mid-game', false, `actor ${actor} has no legal actions`); break; }
  const action = chooseAction(view.view, actor, legal, rng); // AI runs on the REDACTED view (honest)
  const res = await server.submit(gameId, token, action);
  if (res.gameOver) { gameOver = true; lastTurn = res.turn; break; }
}
check('game reached game over via the server', gameOver, `after ${moves} moves`);

// --- reveal-at-game-over: hands no longer hidden once decided ---
if (gameOver) {
  const finalFp = await server.fetch(gameId, invites.fp);
  check('hands revealed at game over', !finalFp.view.cards.shadow.hand.includes('hidden') || finalFp.view.cards.shadow.hand.length === 0);
}

console.log(`\nPlayed ${moves} server moves to turn ${lastTurn}.`);
rmSync('./.dev-store', { recursive: true, force: true });
console.log(fails === 0 ? 'smoke-server OK' : `smoke-server FAILED (${fails})`);
process.exit(fails === 0 ? 0 : 1);
