#!/usr/bin/env vite-node
// probe-forfeit.mjs — abandoned ranked games forfeit (John, 2026-10-11; player report
// a05cialu8jn3as70: a losing player could leave a ranked game and never take the loss).
//  - The engine: `forfeit` ends the game for the seat whose turn it is (the other side
//    wins); it is refused out of turn and never offered as a legal action.
//  - The sweep (functions/_lib/forfeit.ts) on a throwaway FsStore: a ranked game idle
//    past the limit is forfeited by its idle HUMAN seat; a recent one, an unranked one,
//    and a dry run are left alone.
import { GameServer, NoopNotifier } from 'digital-boardgame-framework/server';
import { FsStore } from 'digital-boardgame-framework/server/node';
import { jsonCodec } from 'digital-boardgame-framework';
import { rmSync } from 'node:fs';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { wotrControllers } from '../src/ai/wotrControllers.ts';
import { forfeitIdle, FORFEIT_IDLE_DAYS } from '../functions/_lib/forfeit.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== the forfeit action ===');
{
  const s = startGame(createGame({ seed: 3 }));
  const actor = wotrAdapter.currentActor(s), other = actor === 'fp' ? 'shadow' : 'fp';
  check('never offered as a legal action', !wotrAdapter.legalActions(s, actor).some((a) => a.kind === 'forfeit'));
  check('refused out of turn', !wotrAdapter.tryApplyAction(s, { kind: 'forfeit' }, other).ok);
  const t = wotrAdapter.applyAction(s, { kind: 'forfeit', days: FORFEIT_IDLE_DAYS }, actor);
  const r = wotrAdapter.result(t);
  check('the other side wins', r?.winners?.[0] === other, JSON.stringify(r));
  check('the reason says so', /forfeit/.test(r?.reason ?? ''), r?.reason);
  check('nothing is left to play', wotrAdapter.currentActor(t) === null);
}

console.log('\n=== the sweep ===');
const DIR = './.dev-store-forfeit';
rmSync(DIR, { recursive: true, force: true });
const store = new FsStore(DIR);
const server = new GameServer({
  adapter: wotrAdapter, codec: jsonCodec(), store, notifier: new NoopNotifier(),
  gameUrl: (id, tok) => `http://localhost/play/${id}?as=${tok}`,
  aiControllers: wotrControllers,
  verifyIdentity: async (t) => ({ playerId: t, displayName: t, kind: 'anon', expiresAt: Date.now() + 3600_000 }),
});
const make = async (opts) => server.createGame({ initialState: startGame(createGame({ seed: 5 })), players: ['fp', 'shadow'], ...opts });
const ranked = await make({ ai: { shadow: 'standard' }, identities: { fp: 'human-1' } });
const casual = await make({ ai: { shadow: 'standard' } });
const DAY = 86_400_000;
const later = (d) => Date.now() + d * DAY;

const soon = await forfeitIdle(server, store, { nowMs: later(FORFEIT_IDLE_DAYS - 3) });
check(`before ${FORFEIT_IDLE_DAYS} days nothing is forfeited`, soon.forfeited.length === 0 && soon.candidates === 0, JSON.stringify(soon));
const dry = await forfeitIdle(server, store, { nowMs: later(FORFEIT_IDLE_DAYS + 1), dryRun: true });
check('a dry run names the ranked game only', dry.forfeited.length === 1 && dry.forfeited[0].gameId === ranked.gameId && dry.forfeited[0].seat === 'fp', JSON.stringify(dry));
check('…and changes nothing', (await server.result(ranked.gameId)) === null);
const run = await forfeitIdle(server, store, { nowMs: later(FORFEIT_IDLE_DAYS + 1) });
check('past the limit the idle human seat forfeits', run.forfeited.length === 1 && run.forfeited[0].seat === 'fp' && run.errors.length === 0, JSON.stringify(run));
const res = await server.result(ranked.gameId);
check('…the AI side is the winner', res?.winners?.[0] === 'shadow', JSON.stringify(res));
check('…and the game is closed for good', !(await store.listActiveGames()).some((m) => m.gameId === ranked.gameId));
check('an unranked game is left alone', (await server.result(casual.gameId)) === null);
const again = await forfeitIdle(server, store, { nowMs: later(FORFEIT_IDLE_DAYS + 2) });
check('a second run finds nothing more', again.forfeited.length === 0, JSON.stringify(again));
rmSync(DIR, { recursive: true, force: true });

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
