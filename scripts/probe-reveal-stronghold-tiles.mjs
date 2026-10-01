#!/usr/bin/env vite-node
// probe-reveal-stronghold-tiles.mjs — a Reveal draws one Hunt tile for EACH Shadow
// Stronghold its traced path crosses (rulebook p.39). The first tile that asked the FP
// how to absorb its damage used to drop every tile behind it, so at most one was ever
// drawn (player report 3o0b353o6j735w53). The rest now wait and draw in turn.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const s0 = startGame(createGame({ seed: 7 }));
Object.assign(s0.fellowship, { location: 'morannon', progress: 2, hidden: true, mordor: null, corruption: 0 });
// Only plain numbered tiles in the bag, so every draw deals damage the FP must assign.
s0.hunt.pool = STANDARD_TILE_LIST.map((t, i) => [t, i]).filter(([t]) => typeof t.value === 'number' && t.value > 0).map(([, i]) => i);
s0.hunt.drawn = [];
s0.pendingChoice = { owner: 'fp', kind: 'revealMove' };
const drawsBefore = (s0.hunt.draws ?? []).length;

console.log('\n=== revealed from Morannon through Gorgoroth into Minas Morgul ===');
let r = wotrAdapter.tryApplyAction(s0, { kind: 'revealMove', target: 'minas-morgul' }, 'fp');
check('the reveal move is accepted', r.ok, r.ok ? '' : r.error);
let s = r.state;
check('the first tile asks the FP to assign damage', s.pendingChoice?.kind === 'huntDamage', s.pendingChoice?.kind);
check('one tile drawn so far', (s.hunt.draws ?? []).length - drawsBefore === 1);
r = wotrAdapter.tryApplyAction(s, { kind: 'huntDamage', mode: 'corruption' }, 'fp');
check('taking it as Corruption is accepted', r.ok, r.ok ? '' : r.error);
s = r.state;
check('the second Stronghold\'s tile is drawn', (s.hunt.draws ?? []).length - drawsBefore === 2, String((s.hunt.draws ?? []).length - drawsBefore));
check('and asks for its own damage', s.pendingChoice?.kind === 'huntDamage', s.pendingChoice?.kind);
const src = (s.hunt.draws ?? []).slice(-2).map((d) => d.source);
check('each tile names its Stronghold', /Morannon/.test(src[0] ?? '') && /Minas Morgul/.test(src[1] ?? ''), src.join(' | '));
r = wotrAdapter.tryApplyAction(s, { kind: 'huntDamage', mode: 'corruption' }, 'fp');
s = r.ok ? r.state : s;
check('no third tile (only two Strongholds)', (s.hunt.draws ?? []).length - drawsBefore === 2);
check('nothing left owed', !s.flags.owedStrongholdTiles);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
