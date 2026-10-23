#!/usr/bin/env vite-node
// probe-triage-1023.mjs — the 2026-10-23 reports.
//  62274m0f58415m1o: Wizard's Staff on the Mordor Track prevents the draw but the
//    Fellowship still steps forward — "an effective free move" (Almanac).
//  5g2c5e5s721x2r3f: the Corruption line states the damage, not the clamped difference.
//  0g0v1k2w0y3h2o5b: a special tile is named like a card in its draw line.
//  2u035b681r620p72: Worn with Sorrow and Toil goes in a trailing parenthetical.
//  ju2xnzxbx5f5cnr5: a capture's Victory Points read "(0 → 2 Victory Points)".
//  5l6v2x3z0e0o1s25: There Is Another Way's buttons name the action, not Yes / No.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { resolveMordorStep, resolveHuntPreventDraw, resolveHuntDamage } from '../src/engine/hunt.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';
import { describeAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => startGame(createGame({ seed: 11 }));
const msgs = (s) => s.log.map((e) => e.msg);
const onlyTile = (s, pred) => {
  s.hunt.pool = [STANDARD_TILE_LIST.findIndex(pred)];
  s.hunt.specialsInPool = []; s.hunt.drawn = []; s.hunt.specialsDrawn = [];
};
const onMordor = (s) => {
  s.fellowship.mordor = 1; s.fellowship.hidden = true;
  s.hunt.box = 2; s.hunt.fpDiceInBox = 0;
};

console.log('\n=== Wizard\'s Staff on the Mordor Track ===');
{
  const s = fresh();
  onMordor(s);
  s.cards.fp.table.push('fp-char-08');
  resolveMordorStep(s);
  check('the blind prevent choice is offered', s.pendingChoice?.kind === 'huntPreventDraw');
  resolveHuntPreventDraw(s, true);
  check('the Fellowship still steps forward', s.fellowship.mordor === 2, `step ${s.fellowship.mordor}`);
  check('the step is logged', msgs(s).at(-1) === 'Fellowship advances to Mordor step 2', msgs(s).at(-1));
  check('the Staff is discarded', !s.cards.fp.table.includes('fp-char-08'));
  check('no choice left open', s.pendingChoice === null);
}
{
  const s = fresh();
  s.fellowship.hidden = true;
  s.cards.fp.table.push('fp-char-08');
  const progress = s.fellowship.progress;
  // Off the Mordor Track the Staff only stops the draw.
  s.pendingChoice = { owner: 'fp', kind: 'huntPreventDraw', data: { successes: 1, onMordor: false } };
  resolveHuntPreventDraw(s, true);
  check('off the Track nothing else moves', s.fellowship.mordor === null && s.fellowship.progress === progress);
}

console.log('\n=== Corruption past 12 states the damage ===');
{
  const s = fresh();
  onMordor(s);
  s.fellowship.hidden = false; s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.fellowship.corruption = 8;
  onlyTile(s, (t) => t.value === 3 && !t.reveal);
  s.hunt.box = 5;
  resolveMordorStep(s);
  if (s.pendingChoice?.kind === 'huntDamage') resolveHuntDamage(s, 'corruption');
  const line = msgs(s).find((m) => m.startsWith('The Ring-bearers suffer'));
  check('3 damage at 8 → 11', line === 'The Ring-bearers suffer 3 Corruption for using the Ring (8 → 11)', line);
}
{
  const s = fresh();
  onMordor(s);
  s.fellowship.hidden = false; s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.fellowship.corruption = 8;
  onlyTile(s, (t) => t.value === 'eye');
  s.hunt.box = 5;
  resolveMordorStep(s);
  if (s.pendingChoice?.kind === 'huntDamage') resolveHuntDamage(s, 'corruption');
  const line = msgs(s).find((m) => m.startsWith('The Ring-bearers suffer'));
  check('5 damage at 8 reads 5, not 4', line === 'The Ring-bearers suffer 5 Corruption for using the Ring (8 → 12)', line);
}

console.log('\n=== a special tile is named plainly ===');
{
  const s = fresh();
  onMordor(s);
  s.hunt.pool = []; s.hunt.drawn = []; s.hunt.specialsDrawn = [];
  s.hunt.specialsInPool = ['sh-char-01'];
  const before = s.log.length;
  resolveMordorStep(s);
  const m = msgs(s).slice(before);
  check('"Shadow draws Shelob\'s Lair"', m.some((x) => /^Shadow draws Shelob's Lair\b/.test(x)) && !m.some((x) => x.includes('tile')), m.join(' | '));
}

console.log('\n=== There Is Another Way buttons ===');
{
  const hide = describeAction({ kind: 'eventTarget', card: 'fp-char-10', mode: 'hide' });
  const no = describeAction({ kind: 'eventTarget', card: 'fp-char-10', mode: 'none' });
  check('hide names the action', /Hide the Fellowship$/.test(hide), hide);
  check('decline is "Skip"', /Skip$/.test(no), no);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
