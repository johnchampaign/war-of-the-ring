#!/usr/bin/env vite-node
// probe-server-ai-stall.mjs — Play games the way the online server does: each AI
// seat decides from its REDACTED view through the server controller, and the move is
// applied to the real state. The server stops driving an AI seat on a refused move,
// and the same move recurs on every refresh, so any refusal here is a game stuck on
// "Waiting for other player" (player report yzb5la09aq34yd70: the garrison split sent
// not-yet-At-War Dwarves from Erebor into Dale, seed 28 of this probe's family).
//
// Run: vite-node scripts/probe-server-ai-stall.mjs [--games N]
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { wotrControllers } from '../src/ai/wotrControllers.ts';

const i = process.argv.indexOf('--games');
const GAMES = i >= 0 ? Number(process.argv[i + 1]) : 6;
const SEEDS = [28, ...Array.from({ length: Math.max(0, GAMES - 1) }, (_, k) => k + 1)];
let fails = 0;
for (const seed of SEEDS) {
  let s = startGame(createGame({ seed }));
  let n = 0;
  while (!wotrAdapter.result(s) && n < 20000) {
    const actor = wotrAdapter.currentActor(s);
    if (actor === null) { console.error(`  FAIL seed ${seed}: no actor mid-game`); fails++; break; }
    const view = wotrAdapter.viewFor(s, actor);
    let a;
    try { a = await wotrControllers.standard.selectAction({ state: view, actor, adapter: wotrAdapter, rng: new Rng(seed * 7919 + n) }); }
    catch (e) { console.error(`  FAIL seed ${seed} step ${n}: AI threw ${e.message}`); fails++; break; }
    const r = wotrAdapter.tryApplyAction(s, a, actor);
    if (!r.ok) { console.error(`  FAIL seed ${seed} step ${n}: ${actor} AI move refused (${r.reason}) ${JSON.stringify(a)}`); fails++; break; }
    s = r.state; n++;
  }
  if (!wotrAdapter.result(s) && n >= 20000) { console.error(`  FAIL seed ${seed}: no result in 20000 moves`); fails++; }
}
console.log(`probe-server-ai-stall: ${SEEDS.length} server-style games, ${fails} stalls`);
if (fails) process.exit(1);
