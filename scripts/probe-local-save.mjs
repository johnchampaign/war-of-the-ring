#!/usr/bin/env vite-node
// probe-local-save.mjs — a LOCAL game must survive a reload.
//
// Online games resume from the server; solo/hotseat games lived only in the tab, so a
// refresh destroyed them. This exercises the save/resume round-trip headlessly, with a
// localStorage stub, driving the real makeLocalClient rather than the storage module
// alone — the interesting failures are in what the client forgets to persist.
//
// Cases:
//   1. a vs-AI game round-trips: same board, same turn, same seat, and play continues;
//   2. the AI's tie-break RNG resumes on its own track rather than restarting;
//   3. hotseat round-trips (no AI side);
//   4. a finished game clears the slot instead of offering a dead game back;
//   5. a save from a different engine schema is discarded, not half-loaded;
//   6. corrupt JSON is discarded without throwing.

// --- localStorage stub, installed before anything imports the save module ----------
const mem = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.location = globalThis.window.location ?? { hostname: 'localhost', href: 'http://localhost/' };
globalThis.window.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const { makeLocalClient } = await import('../src/online/localClient.ts');
const { loadLocalGame, peekLocalGame, clearLocalGame, saveLocalGame } = await import('../src/online/localSave.ts');
const { wotrAdapter } = await import('../src/adapter/wotrAdapter.ts');
const SCHEMA = wotrAdapter.schemaVersion ?? 0;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Play `n` accepted actions through a client, always taking the first legal one. */
async function play(client, n) {
  let moved = 0;
  for (let i = 0; i < n * 8 && moved < n; i++) {
    const legal = await client.legalActions();
    if (!legal.length) break;
    const before = (await client.fetch()).turn;
    await client.submit(legal[0]);
    moved++;
    void before;
  }
  return moved;
}

// --- 1 & 2. vs-AI round-trip -------------------------------------------------------
{
  console.log('\n=== vs-AI game survives a reload ===');
  mem.clear();
  const a = makeLocalClient(4242, { aiSide: 'shadow' });
  await a.fetch();
  await play(a, 6);
  const beforeView = await a.fetch();
  const saved = loadLocalGame(SCHEMA);
  check('a save exists after playing', !!saved);
  check('it records the AI side', saved?.aiSide === 'shadow', `aiSide=${saved?.aiSide}`);
  check('it records the turn', saved?.turn === beforeView.turn, `${saved?.turn} vs ${beforeView.turn}`);
  check('it records the AI RNG cursor', typeof saved?.aiRng === 'number', `aiRng=${saved?.aiRng}`);

  // "Reload": a brand-new client built only from the slot.
  const b = makeLocalClient(0, { resume: loadLocalGame(SCHEMA) });
  const afterView = await b.fetch();
  check('same turn after resume', afterView.turn === beforeView.turn, `${afterView.turn} vs ${beforeView.turn}`);
  check('same seat', afterView.you === beforeView.you, `${afterView.you} vs ${beforeView.you}`);
  check('same board', JSON.stringify(afterView.view.regions) === JSON.stringify(beforeView.view.regions));
  check('same log length', afterView.view.log.length === beforeView.view.log.length,
    `${afterView.view.log.length} vs ${beforeView.view.log.length}`);
  const moved = await play(b, 3);
  check('play continues after resume', moved === 3, `${moved} of 3 moves accepted`);

  // The AI cursor must advance from where it was, not restart from the seed.
  const s2 = loadLocalGame(SCHEMA);
  check('AI RNG cursor advanced, not reset', s2.aiRng !== saved.aiRng, `${saved.aiRng} -> ${s2.aiRng}`);
}

// --- 3. hotseat --------------------------------------------------------------------
{
  console.log('\n=== hotseat game survives a reload ===');
  mem.clear();
  const a = makeLocalClient(77);
  await a.fetch();
  await play(a, 5);
  const beforeView = await a.fetch();
  const saved = loadLocalGame(SCHEMA);
  check('a save exists', !!saved);
  check('no AI side recorded', saved?.aiSide === null, `aiSide=${saved?.aiSide}`);
  const b = makeLocalClient(0, { resume: loadLocalGame(SCHEMA) });
  const afterView = await b.fetch();
  check('same turn', afterView.turn === beforeView.turn, `${afterView.turn} vs ${beforeView.turn}`);
  check('same board', JSON.stringify(afterView.view.regions) === JSON.stringify(beforeView.view.regions));
  check('whoever is up still controls the screen', afterView.yourTurn === true);
}

// --- 4. a finished game is never offered back ------------------------------------
{
  console.log('\n=== a finished game is not offered back ===');
  mem.clear();
  // (a) the live path: play a real game to its end and check the client drops the slot.
  const c = makeLocalClient(5, { aiSide: 'shadow' });
  let last = await c.fetch();
  check('slot populated at the start', !!peekLocalGame(SCHEMA));
  for (let i = 0; i < 4000 && !last.gameOver; i++) {
    const legal = await c.legalActions();
    if (!legal.length) { last = await c.fetch(); continue; }
    last = await c.submit(legal[0]);
  }
  check('the game reached an end', last.gameOver === true, `gameOver=${last.gameOver}`);
  check('slot cleared once the game is over', peekLocalGame(SCHEMA) === null);

  // (b) the belt-and-braces path: a decided game sitting in the slot (written by an
  //     older build, or ended by some other route) must still never load.
  mem.clear();
  const d = makeLocalClient(11, { aiSide: 'shadow' });
  await d.fetch();
  await play(d, 2);
  const save = loadLocalGame(SCHEMA);
  save.state.winner = 'fp';
  save.state.winReason = 'probe';
  saveLocalGame({ schemaVersion: SCHEMA, state: save.state, aiSide: save.aiSide, aiRng: save.aiRng, oppLogStart: save.oppLogStart, turn: save.turn });
  check('a decided save reads as nothing', loadLocalGame(SCHEMA) === null);
  check('and the slot was dropped', peekLocalGame(SCHEMA) === null);
}

// --- 5. schema mismatch is discarded ------------------------------------------------
{
  console.log('\n=== a save from a different engine schema is discarded ===');
  mem.clear();
  const e = makeLocalClient(9, { aiSide: 'fp' });
  await e.fetch();
  await play(e, 2);
  check('slot populated', !!peekLocalGame(SCHEMA));
  check('a mismatched schema reads as nothing', loadLocalGame(SCHEMA + 1) === null);
  check('and the bad slot was dropped', peekLocalGame(SCHEMA) === null);
}

// --- 6. corrupt data is survivable --------------------------------------------------
{
  console.log('\n=== corrupt save data ===');
  mem.clear();
  mem.set('wotr.localGame.v1', '{ this is not json');
  let threw = false;
  let got;
  try { got = loadLocalGame(SCHEMA); } catch { threw = true; }
  check('load did not throw', !threw);
  check('load returned null', got === null || got === undefined, `got=${JSON.stringify(got)}`);
  check('the corrupt slot was cleared', peekLocalGame(SCHEMA) === null);
  clearLocalGame();
}

console.log(failures ? `\nprobe-local-save: ${failures} FAILURE(S)` : '\nprobe-local-save OK');
process.exit(failures ? 1 : 0);
