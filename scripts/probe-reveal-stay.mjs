#!/usr/bin/env vite-node
// probe-reveal-stay.mjs — a revealed Fellowship moves "as described" for a declaration:
// "equal to or less than" its Progress, and it "may choose to leave the Ring-bearers
// figure in its current position" (rulebook p.38). Staying put used to be missing from
// the reveal choice, so a Fellowship caught in Morannon had to step back out
// (player report 5n1h4h4b3p2b3b32). Staying may never end in an FP-held City/Stronghold.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function revealSetup(at, progress) {
  const s = startGame(createGame({ seed: 7 }));
  Object.assign(s.fellowship, { location: at, progress, hidden: true, mordor: null });
  s.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  return s;
}
const targets = (s) => wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'revealMove').map((a) => a.target);

{
  console.log('\n=== revealed in Morannon with Progress 2: staying is offered ===');
  const s = revealSetup('morannon', 2);
  const t = targets(s);
  check('Morannon itself is a target', t.includes('morannon'), t.join(','));
  check('and so are the regions around it', t.length > 1);
  const r = wotrAdapter.tryApplyAction(s, { kind: 'revealMove', target: 'morannon' }, 'fp');
  const n = r.ok ? r.state : s;
  check('the reveal in place is accepted', r.ok, r.ok ? '' : r.error);
  check('the figure stays in Morannon', n.fellowship.location === 'morannon');
  check('revealed, Progress reset', !n.fellowship.hidden && n.fellowship.progress === 0);
}

{
  console.log('\n=== revealed in Rivendell (FP Stronghold): staying is NOT offered ===');
  const t = targets(revealSetup('rivendell', 2));
  check('Rivendell is not a target', !t.includes('rivendell'), t.join(','));
  check('other regions are', t.length > 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
