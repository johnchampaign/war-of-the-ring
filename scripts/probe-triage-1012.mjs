#!/usr/bin/env vite-node
// probe-triage-1012.mjs — log wording from player reports 4b6h4x2t6e3a3e18 (Corruption
// changes read "(before → after)") and 1o362m1a3w0e5658 (a reveal gets its own line,
// naming where the Fellowship ends up, after the "Hunt resolved" line).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { shedCorruption, sufferCorruption } from '../src/engine/log.ts';
import { beginReveal } from '../src/engine/hunt.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const last = (s) => s.log[s.log.length - 1]?.msg ?? '';

console.log('\n=== Corruption changes read (before → after) ===');
{
  const s = startGame(createGame({ seed: 3 }));
  s.fellowship.corruption = 8;
  shedCorruption(s, 1);
  check('shed', last(s) === 'The Ring-bearers shed 1 Corruption (8 → 7)', last(s));
  sufferCorruption(s, 2, 'from a card');
  check('suffer', last(s) === 'The Ring-bearers suffer 2 Corruption from a card (7 → 9)', last(s));
}

console.log('\n=== a reveal in place is its own line ===');
{
  const s = startGame(createGame({ seed: 3 }));
  s.pendingChoice = null; s.fellowship.hidden = true; s.fellowship.progress = 0;
  beginReveal(s);
  check('revealed in place', last(s) === `The Fellowship is revealed in ${s.fellowship.location}`, last(s));
  const n = s.log.length; beginReveal(s);
  check('an already-revealed Fellowship logs nothing more', s.log.length === n);
}

console.log('\n=== a reveal that moves names where the figure lands ===');
{
  const s0 = startGame(createGame({ seed: 3 }));
  s0.pendingChoice = null; s0.fellowship.hidden = true; s0.fellowship.progress = 2;
  beginReveal(s0);
  check('the Free Peoples are asked where', s0.pendingChoice?.kind === 'revealMove');
  const mv = wotrAdapter.legalActions(s0, 'fp').find((a) => a.kind === 'revealMove' && a.target !== s0.fellowship.location);
  const s = wotrAdapter.applyAction(s0, mv, 'fp');
  check('revealed where it moved', s.log.some((e) => e.msg === `The Fellowship is revealed in ${s.fellowship.location}`),
    s.log.slice(-3).map((e) => e.msg).join(' | '));
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
