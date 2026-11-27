#!/usr/bin/env vite-node
// probe-triage-1126.mjs — report 441a4f2t1o0y3d1q: "The Witch King should have
// activated all Free Peoples nations when coming into play, but Rohan was not
// activated."
//
// The log shows the Shadow had played Wormtongue the turn before: "Rohan cannot be
// activated except by a Companion's ability, the Fellowship being declared in Edoras
// or Helm's Deep, or an attack on Edoras or Helm's Deep" (Card Text Reference). So
// Rohan staying passive is the card working — but the game said nothing, which read
// as a bug. The veto now logs and pops a notice naming Wormtongue.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { activateNation } from '../src/engine/politics.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const WORMTONGUE = 'sh-char-22';
const FP = ['dwarves', 'elves', 'gondor', 'north', 'rohan'];
const fresh = () => { const s = startGame(createGame({ seed: 5 })); s.notices = []; return s; };
const witchKing = (s) => { for (const n of FP) activateNation(s, n, { by: 'The Witch-king' }); };
const veto = (s) => (s.notices ?? []).filter((n) => n.title === 'Wormtongue Holds Rohan');
const vetoLog = (s) => s.log.filter((e) => /Rohan is not activated \(Wormtongue\)/.test(e.msg));

console.log('Witch-king, no Wormtongue: every Free Peoples Nation is activated');
{
  const s = fresh();
  witchKing(s);
  check('all five active', FP.every((n) => s.nations[n].active));
  check('no Wormtongue notice', veto(s).length === 0 && vetoLog(s).length === 0);
}

console.log('Witch-king with Wormtongue on the table: Rohan stays passive, and the game says why');
{
  const s = fresh();
  s.cards.shadow.table = [...(s.cards.shadow.table ?? []), WORMTONGUE];
  witchKing(s);
  check('the other four are active', ['dwarves', 'elves', 'gondor', 'north'].every((n) => s.nations[n].active));
  check('Rohan is still passive', s.nations.rohan.active === false);
  check('one notice names Wormtongue and the Witch-king', veto(s).length === 1 && /Witch-king cannot activate Rohan/.test(veto(s)[0].msg), veto(s)[0]?.msg);
  check('the log records it', vetoLog(s).length === 1);
  activateNation(s, 'rohan', { viaCompanion: true, by: 'Gandalf the White' });
  check('a Companion still activates Rohan', s.nations.rohan.active === true);
  const before = veto(s).length;
  activateNation(s, 'rohan', { by: 'The Witch-king' });
  check('nothing is said once Rohan is already active', veto(s).length === before);
}

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
