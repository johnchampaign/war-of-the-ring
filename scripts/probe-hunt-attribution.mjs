#!/usr/bin/env vite-node
// probe-hunt-attribution.mjs — from player report wg37yx: "I declared in Lórien, then
// the Shadow made a Hunt roll it shouldn't have and I ended up with 3 Corruption."
//
// Declaring genuinely draws no Hunt tile — except for ONE card. Balrog of Moria says:
// "You may discard 'Balrog of Moria' to draw an additional Hunt tile if the Fellowship
// moves into, out of, or through Moria while being declared or revealed." A declaration
// in Lórien from Moria does exactly that, and the Hunt used to arrive with nothing in
// the log naming the card — indistinguishable, from the Free Peoples seat, from a Hunt
// out of nowhere. This checks that every extra Hunt says where it came from.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => {
  const s = startGame(createGame({ seed: 9 }));
  s.phase = 'fellowship';
  s.currentPlayer = 'fp';
  return s;
};
const apply = (s, a, side) => {
  const r = wotrAdapter.tryApplyAction(s, a, side);
  if (!r.ok) throw new Error(`${JSON.stringify(a)} rejected: ${r.reason}`);
  return r.state;
};
const msgs = (s, from = 0) => s.log.slice(from).map((e) => e.msg);

console.log('\n=== Balrog of Moria on a declaration through Moria ===');
{
  let s = board();
  s.fellowship.location = 'moria';
  s.fellowship.progress = 2;
  s.cards.shadow.table.push('sh-char-17');
  const before = s.log.length;
  s = apply(s, { kind: 'declareFellowship', target: 'lorien' }, 'fp');
  check('the Shadow is asked whether to spend the Balrog', s.pendingChoice?.kind === 'balrog' && s.pendingChoice?.owner === 'shadow',
    JSON.stringify(s.pendingChoice));
  s = apply(s, { kind: 'balrog', use: true }, 'shadow');
  const lines = msgs(s, before);
  check('the log names the card', lines.some((m) => /Balrog of Moria/.test(m)), lines.join(' | '));
  check('the Hunt line says what caused it',
    lines.some((m) => /Balrog of Moria/.test(m) && /(Hunt|tile|Corruption)/.test(m)), lines.join(' | '));
  check('the card left the table', !s.cards.shadow.table.includes('sh-char-17'));
}

console.log('\n=== …and nothing at all without Moria on the path ===');
{
  let s = board();
  s.fellowship.location = 'rivendell';
  s.fellowship.progress = 1;
  s.cards.shadow.table.push('sh-char-17');
  const before = s.log.length;
  s = apply(s, { kind: 'declareFellowship', target: 'fords-of-bruinen' }, 'fp');
  check('no Balrog prompt', s.pendingChoice?.kind !== 'balrog', JSON.stringify(s.pendingChoice));
  check('no Hunt tile drawn', !msgs(s, before).some((m) => /Hunt/i.test(m)), msgs(s, before).join(' | '));
  check('no Corruption taken', s.fellowship.corruption === 0);
}

console.log('\n=== declaring is Hunt-free with no Balrog in play ===');
{
  let s = board();
  s.fellowship.location = 'moria';
  s.fellowship.progress = 2;
  const before = s.log.length;
  s = apply(s, { kind: 'declareFellowship', target: 'lorien' }, 'fp');
  check('no prompt, no Hunt', s.pendingChoice === null && !msgs(s, before).some((m) => /Hunt/i.test(m)),
    msgs(s, before).join(' | '));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
