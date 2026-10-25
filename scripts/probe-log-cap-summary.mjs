#!/usr/bin/env vite-node
// probe-log-cap-summary.mjs — the "while your opponent played" summary must survive
// the log cap.
//
// The in-state log keeps its newest 500 entries (engine/log.ts). The local client used
// to mark where the summary starts by log INDEX; once a game reached the cap, the log
// stopped growing in length, the summary's start sat at the end of the log, and late in
// a long game against the AI the summary never appeared again. The boundary is now the
// `seq` of the last entry before it. (Found while triaging report jag3mymgg4tqwute,
// "full game log please, it cuts off at Turn 4".)
//
// Plays a vs-AI game past the cap, with the AI choosing for the human too, and checks:
//   1. the log really is at its cap (the case being tested is reached);
//   2. after the cap, the summary still shows the AI's entries after the human's moves;
//   3. those entries are exactly the ones after the human's action, nothing older;
//   4. the save carries the seq boundary, and resuming keeps it.

const mem = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.location = globalThis.window.location ?? { hostname: 'localhost', href: 'http://localhost/' };
globalThis.window.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.fetch = async () => new Response(null, { status: 204 });

const { Rng } = await import('digital-boardgame-framework');
const { makeLocalClient } = await import('../src/online/localClient.ts');
const { wotrAdapter } = await import('../src/adapter/wotrAdapter.ts');
const { loadLocalGame } = await import('../src/online/localSave.ts');
const { chooseAction } = await import('../src/ai/wotrAI.ts');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('probe-log-cap-summary');
// Not every game runs long enough to fill the log; take the first seed that does.
// Searched widely: a stronger AI ends more games early, and with seeds 1-12 only the
// probe ran out of long games once the Shadow got sharper (2026-10-25).
let client, v, seed, reached = false, afterCap = 0, exact = 0;
for (seed = 1; seed <= 60 && afterCap < 15; seed++) {
  mem.clear();
  client = makeLocalClient(seed, { aiSide: 'shadow' });
  const rng = new Rng(seed * 31 + 5);
  v = await client.fetch();
  afterCap = 0; exact = 0;
  for (let i = 0; i < 6000 && !v.gameOver && afterCap < 15; i++) {
    const legal = await client.legalActions();
    if (!legal.length) { if (client.aiHeld?.()) v = await client.resumeAI(); else break; continue; }
    const beforeSeq = v.view.log[v.view.log.length - 1]?.seq ?? 0;
    const atCap = (v.view.log[0]?.seq ?? 0) > 50;
    v = await client.submit(chooseAction(v.view, 'fp', legal, rng));
    if (client.aiHeld?.()) v = await client.resumeAI();
    if (!atCap || v.gameOver) continue;
    reached = true;
    const items = v.view.log.slice(v.view.oppLogStart);
    // Only replies that hand control back count: that is when the summary pops.
    if (!v.yourTurn || !items.some((e) => e.actor === 'shadow')) continue;
    afterCap++;
    // Nothing from before the human's own action may leak into the summary.
    if (items.every((e) => e.seq > beforeSeq)) exact++;
  }
}
console.log(`  (seed ${seed - 1}: stopped at turn ${v.turn}, game over ${v.gameOver}, log tail seq ${v.view.log[v.view.log.length - 1]?.seq})`);
check('a game reached the log cap', reached);
check('the summary shows the AI\'s moves after the cap', afterCap >= 15, `${afterCap} summaries`);
check('the summary starts after the human\'s action', afterCap > 0 && exact === afterCap, `${exact}/${afterCap}`);

const save = loadLocalGame(wotrAdapter.schemaVersion ?? 0);
const tail = save?.state.log[save.state.log.length - 1]?.seq ?? 0;
check('the save carries the seq boundary', typeof save?.oppLogSeq === 'number' && save.oppLogSeq <= tail && save.oppLogSeq > 500, `oppLogSeq ${save?.oppLogSeq}, tail ${tail}`);
const resumed = makeLocalClient(seed, { resume: save });
const rv = await resumed.fetch();
check('resuming keeps the summary boundary', rv.view.oppLogStart === v.view.oppLogStart, `${rv.view.oppLogStart} vs ${v.view.oppLogStart}`);

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
