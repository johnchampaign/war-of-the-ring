#!/usr/bin/env vite-node
// probe-triage-1008c.mjs — fixes from the afternoon 2026-10-08 report batch:
//
//  - The King is Revealed and Musterings of Long-planned War need something they can
//    actually place (reports 632u6l2z0v0w5669, 0n0p2x0n3u6o0b6i).
//  - Event-card Army moves log in the die-move format "Shadow Army moves A → B"
//    (reports 0r3b1z3b5l4w1i4k, 236b25494w2z3s68, 1e36350n6l21072d, …).
//  - Card Nazgûl recruits log "Shadow musters …" (report 4b1j6j591j6i5e53).
//  - Button wording: "Recruit Nazgûl", "Replace a Sauron Regular with an Elite",
//    "Reveal Aragorn, Heir to Isildur" (reports 480b6l0b57445w2z, 4y4l1y015l3h451u,
//    58351p1w035o6a1f).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import '../src/engine/handlers/index.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { describeAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed) => startGame(createGame({ seed }));
const lastSeq = (s) => s.log.at(-1)?.seq ?? -1;
const since = (s, seq) => s.log.filter((e) => e.seq > seq).map((e) => e.msg);

console.log('\n=== Recruit cards need a placeable figure ===');
{
  const s = fresh(7);
  if (!s.characters.entered.includes('aragorn')) s.characters.entered.push('aragorn');
  check('The King is Revealed playable with a pool', getHandler('sh-str-18').canPlay(s, 'shadow'));
  s.reinforcements.sauron.regular = 0;
  check('…still playable for the Nazgûl alone', getHandler('sh-str-18').canPlay(s, 'shadow'));
  s.reinforcements.sauron.nazgul = 0;
  check('…blocked with no Regular and no Nazgûl', !getHandler('sh-str-18').canPlay(s, 'shadow'));
  for (const n of ['sauron', 'isengard', 'southrons']) s.nations[n].step = 0;
  s.reinforcements.sauron.regular = 0; s.reinforcements.southrons.regular = 0;
  check('Musterings blocked with no Regulars', !getHandler('sh-str-23').canPlay(s, 'shadow'));
  s.reinforcements.southrons.regular = 1;
  check('Musterings playable with one Southron Regular', getHandler('sh-str-23').canPlay(s, 'shadow'));
}

console.log('\n=== Card Army moves log like die moves ===');
{
  const s = fresh(8);
  for (const n of ['sauron', 'isengard', 'southrons']) s.nations[n].step = 0;
  const t = getHandler('sh-str-09').targets(s, 'shadow', [])[0];
  const before = lastSeq(s);
  getHandler('sh-str-09').applyTarget(s, 'shadow', t);
  const added = since(s, before);
  check('one standard move line', added[0] === `Shadow Army moves ${t.from} → ${t.to}`, JSON.stringify(added));
  check('no card-prefixed line', !added.some((m) => /The Shadow is Moving:/.test(m)), JSON.stringify(added));
}

console.log('\n=== Nazgûl recruit logs ===');
{
  const s = fresh(9);
  s.characters.entered.push('aragorn');
  const before = lastSeq(s);
  getHandler('sh-str-18').apply(s, 'shadow');
  const added = since(s, before);
  check('King is Revealed logs its Nazgûl', added.includes('Shadow musters a Nazgûl in minas-morgul'), JSON.stringify(added));
}

console.log('\n=== Button labels ===');
const naz = describeAction({ kind: 'recruitUnit', nation: 'sauron', nazgul: true, region: 'dol-guldur' });
check('Recruit Nazgûl', /^Recruit Nazgûl in /.test(naz), naz);
const up = describeAction({ kind: 'eventTarget', card: 'sh-str-02', figure: 'elite', region: 'western-brown-lands' });
check('Replace a Sauron Regular', /eplace a Sauron Regular with an Elite in /.test(up), up);
check('Reveal Aragorn', describeAction({ kind: 'bringUpgrade', which: 'aragorn' }) === 'Reveal Aragorn, Heir to Isildur');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
