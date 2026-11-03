#!/usr/bin/env vite-node
// probe-ai-1101.mjs — Shadow AI reports of 2026-11-01.
//  - jwmzip9icferu71a: on the Mordor Track a card that adds a special Hunt tile comes first.
//  - ogkqsw8p1k3ygah3: Threats and Promises goes down while the Free Peoples can still
//    wake a passive Nation with a Muster die, and not otherwise.
//  - qrfbl7pj707a7w0e: Cruel Weather waits until the Free Peoples cannot move again.
//  - 2jgxdumh7qp76nzf: the Mouth of Sauron arrives with an Army.
//  - oqwst19crttqrf4p, 7yzh545b34c0eflm: a plain recruit is the Muster die's last resort.
//  - ceohaqegxw9j8mr9: A New Power is Rising waits for the pool to fill it.
//  - bxa5j7lysb5l9c80: the Palantír of Orthanc is paid with a Character die when one is free.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const turn = (side, seed = 1) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = side; s.pendingChoice = null;
  return s;
};
const decide = (s, side, only) => {
  const legal = wotrAdapter.legalActions(s, side);
  return chooseAction(s, side, only ? legal.filter(only) : legal, new Rng(3));
};
const show = (a) => JSON.stringify(a).slice(0, 120);
const allAtWar = (s) => { for (const n of ['dwarves', 'elves', 'gondor', 'north', 'rohan']) { s.nations[n].step = 0; s.nations[n].active = true; } };
const sarumanInPlay = (s) => { s.nations.isengard.step = 0; s.nations.isengard.active = true; s.characters.entered.push('saruman'); s.regions['orthanc'].characters.push('saruman'); };

console.log('\n=== A special Hunt tile card first on the Mordor Track ===');
{
  const s = turn('shadow');
  s.fellowship.mordor = 0; s.fellowship.location = 'minas-morgul'; allAtWar(s);
  s.dice.shadow = ['character', 'muster']; s.dice.fp = ['character']; s.cards.shadow.hand = ['sh-char-04'];
  const a = decide(s, 'shadow');
  check('Give it to Uss! is played', a.kind === 'playEvent' && a.cardId === 'sh-char-04', show(a));
}

console.log('\n=== Threats and Promises answers a Muster die ===');
for (const [die, want] of [['muster', true], ['army', false]]) {
  const s = turn('shadow');
  s.dice.shadow = ['event', 'army']; s.dice.fp = [die]; s.cards.shadow.hand = ['sh-str-05'];
  const a = decide(s, 'shadow');
  check(`Free Peoples hold ${die}: ${want ? 'played' : 'held'}`, (a.kind === 'playEvent' && a.cardId === 'sh-str-05') === want, show(a));
}

console.log('\n=== Cruel Weather waits ===');
{
  const s = turn('shadow');
  s.fellowship.location = 'north-ithilien'; s.fellowship.progress = 1;
  s.dice.shadow = ['event', 'event', 'army']; s.dice.fp = ['will']; s.cards.shadow.hand = ['sh-char-10'];
  const held = decide(s, 'shadow', (x) => x.kind === 'playEvent' || x.kind === 'drawEvent');
  check('held while a Will die can still move the Ring', !(held.kind === 'playEvent' && held.cardId === 'sh-char-10'), show(held));
  s.dice.fp = []; s.dice.shadow = ['event'];
  const a = decide(s, 'shadow');
  check('played once it cannot', a.kind === 'playEvent' && a.cardId === 'sh-char-10', show(a));
}

console.log('\n=== The Mouth of Sauron arrives with an Army ===');
{
  const s = turn('shadow');
  allAtWar(s); sarumanInPlay(s); s.characters.entered.push('witch-king');
  s.dice.shadow = ['muster']; s.dice.fp = []; s.cards.shadow.hand = [];
  s.regions['dol-guldur'].units = {};
  for (const r of ['minas-morgul', 'morannon', 'moria', 'mount-gundabad', 'orthanc']) s.regions[r].units = {};
  s.regions['minas-morgul'].units = { sauron: { regular: 2, elite: 0 } };
  const a = decide(s, 'shadow', (x) => x.kind === 'bringMinion' && x.minion === 'mouth-of-sauron');
  const u = s.regions[a.region].units;
  check('placed where a Shadow Army stands', Object.values(u).some((n) => n && n.regular + n.elite > 0), show(a));
}

console.log('\n=== A plain recruit is the Muster die\'s last resort ===');
{
  const s = turn('shadow');
  sarumanInPlay(s); s.nations.sauron.step = 0; s.nations.sauron.active = true;
  s.reinforcements.isengard.regular = 0; s.reinforcements.isengard.elite = 0;
  s.dice.shadow = ['muster', 'army']; s.dice.fp = []; s.cards.shadow.hand = [];
  const a = decide(s, 'shadow', (x) => x.kind === 'recruitUnit' || (x.kind === 'moveArmy' && x.from === 'barad-dur' && x.to === 'gorgoroth'));
  check('the Army die marches before the Muster die recruits', a.kind === 'moveArmy', show(a));
}

console.log('\n=== A New Power is Rising waits for the pool ===');
for (const [regular, want] of [[2, false], [8, true]]) {
  const s = turn('shadow');
  sarumanInPlay(s); s.reinforcements.isengard.regular = regular; s.reinforcements.isengard.elite = 0;
  s.dice.shadow = ['event', 'army']; s.dice.fp = []; s.cards.shadow.hand = ['sh-str-16'];
  const a = decide(s, 'shadow', (x) => x.kind === 'playEvent' || x.kind === 'drawEvent');
  check(`${regular} Regulars left: ${want ? 'played' : 'held'}`, (a.kind === 'playEvent' && a.cardId === 'sh-str-16') === want, show(a));
}

console.log('\n=== The Palantír of Orthanc goes down with a Character die ===');
for (const [dice, want] of [[['character', 'event'], 'character'], [['event', 'army'], 'event']]) {
  const s = turn('shadow');
  sarumanInPlay(s);
  s.dice.shadow = dice; s.dice.fp = []; s.cards.shadow.hand = ['sh-char-21'];
  const a = decide(s, 'shadow', (x) => (x.kind === 'playEvent' && x.cardId === 'sh-char-21') || x.kind === 'drawEvent');
  check(`${dice.join(' + ')}: paid with ${want}`, a.kind === 'playEvent' && a.die === want, show(a));
}

console.log(failures ? `\nFAIL: ${failures} failed` : '\nOK: all AI 11-01 checks pass');
process.exit(failures ? 1 : 0);
