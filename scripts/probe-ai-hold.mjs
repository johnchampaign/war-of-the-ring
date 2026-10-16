#!/usr/bin/env vite-node
// probe-ai-hold.mjs — local play against the AI: the AI waits while the human still has
// a result of their own action to see (player report 184z1h4c0v086i62: the Athelas roll
// popped up only after the Shadow had moved and asked about Stormcrow). The local client
// holds the AI after such an action, a poll does not release it, and resumeAI() does.
const mem = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.location = globalThis.window.location ?? { hostname: 'localhost', href: 'http://localhost/' };
globalThis.window.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
globalThis.fetch = async () => new Response(null, { status: 204 });

const { makeLocalClient } = await import('../src/online/localClient.ts');
const { wotrAdapter, startGame } = await import('../src/adapter/wotrAdapter.ts');
const { createGame } = await import('../src/engine/setup.ts');
const { EVENT_BY_ID } = await import('../src/engine/data.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const athelas = Object.keys(EVENT_BY_ID).find((k) => EVENT_BY_ID[k].name === 'Athelas');
const state = startGame(createGame({ seed: 9 }));
state.phase = 'actionResolution'; state.currentPlayer = 'fp'; state.pendingChoice = null;
state.dice.fp = ['character', 'army']; state.dice.shadow = ['army', 'muster', 'character'];
state.fellowship.corruption = 5; state.cards.fp.hand = [athelas];
const client = makeLocalClient(9, { resume: { format: 1, schemaVersion: wotrAdapter.schemaVersion, savedAt: Date.now(), state, aiSide: 'shadow', aiRng: 1, oppLogStart: 0, turn: state.turn } });

console.log('\n=== a result of your own action holds the AI ===');
await client.fetch();
let v = await client.submit({ kind: 'playEvent', cardId: athelas });
check('Athelas rolled: a notice for the player', (v.view.notices ?? []).some((n) => /Rolled \[/.test(n.msg)));
check('…and the AI is held', client.aiHeld() === true && v.view.dice.shadow.length === 3, `held ${client.aiHeld()}, Shadow dice ${v.view.dice.shadow.length}`);
v = await client.fetch();
check('a poll does not release it', client.aiHeld() === true && v.view.dice.shadow.length === 3);
v = await client.resumeAI();
check('resumeAI(): the Shadow takes its turn', client.aiHeld() === false && v.view.dice.shadow.length < 3, `Shadow dice ${v.view.dice.shadow.length}`);

console.log('\n=== an action with nothing to see does not hold it ===');
{
  const s2 = startGame(createGame({ seed: 9 }));
  s2.phase = 'actionResolution'; s2.currentPlayer = 'fp'; s2.pendingChoice = null;
  s2.dice.fp = ['muster', 'army']; s2.dice.shadow = ['army', 'muster'];
  const c2 = makeLocalClient(9, { resume: { format: 1, schemaVersion: wotrAdapter.schemaVersion, savedAt: Date.now(), state: s2, aiSide: 'shadow', aiRng: 1, oppLogStart: 0, turn: s2.turn } });
  await c2.fetch();
  const legal = await c2.legalActions();
  const quiet = legal.find((a) => a.kind === 'diplomaticAction') ?? legal.find((a) => a.kind === 'skipDie');
  const r = await c2.submit(quiet);
  check(`${quiet.kind}: the AI replies at once`, c2.aiHeld() === false && r.view.dice.shadow.length < 2, `Shadow dice ${r.view.dice.shadow.length}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
