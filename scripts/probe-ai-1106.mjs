#!/usr/bin/env vite-node
// probe-ai-1106.mjs — Shadow AI reports of 2026-11-06.
//  - qvbtrxo6p0jag62o: Cruel Weather is not played from Rivendell, where both neighbours
//    are nearer Mordor; it still is from Hollin, where it can set the Fellowship back.
//  - xy4mcfzfpp6ut5i6: The Day Without Dawn goes down while the Free Peoples hold Will of
//    the West dice, and waits while they hold none.
//  - fy8fvfwd0jgqrrom: Stormcrow waits while every Nation it could target is already at
//    its farthest step, and sets back the Nation nearest war when it can.
//  - Through a Day and a Night (soak, seed 101423 human-like): the out-and-back move is not
//    offered to an Army that could step out but never back in — a passive North Regular
//    besieging Dol Guldur cannot re-enter Sauron's region — and every target it offers applies.
//  - cgvz3xaorxeczwjb: the Free Peoples pass rather than spend a die on a weak action while
//    no Shadow Army stands beside one of their Victory-Point Settlements, and act when one does.
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
const cardOrDraw = (x) => x.kind === 'playEvent' || x.kind === 'drawEvent';

console.log('\n=== Cruel Weather only where it sets the Fellowship back ===');
for (const [loc, want] of [['rivendell', false], ['hollin', true]]) {
  const s = turn('shadow');
  s.fellowship.location = loc; s.fellowship.progress = 1;
  s.dice.shadow = ['event']; s.dice.fp = []; s.cards.shadow.hand = ['sh-char-10'];
  const a = decide(s, 'shadow', cardOrDraw);
  check(`${loc}: ${want ? 'played' : 'held'}`, (a.kind === 'playEvent' && a.cardId === 'sh-char-10') === want, show(a));
}

console.log('\n=== The Day Without Dawn while Will of the West dice are unused ===');
for (const [fp, want] of [[['will', 'will', 'muster'], true], [['muster', 'character'], false]]) {
  const s = turn('shadow');
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.dice.shadow = ['event', 'army']; s.dice.fp = fp; s.cards.shadow.hand = ['sh-str-04'];
  const a = decide(s, 'shadow');
  check(`Free Peoples hold ${fp.join(', ')}: ${want ? 'played' : 'held'}`, (a.kind === 'playEvent' && a.cardId === 'sh-str-04') === want, show(a));
}

console.log('\n=== Stormcrow only where it can set a Nation back ===');
const stormcrow = (elvesStep, boromirAt) => {
  const s = turn('shadow');
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.nations.elves.step = elvesStep; s.nations.gondor.step = 1;
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'boromir');
  if (boromirAt) s.regions[boromirAt].characters.push('boromir');
  s.dice.shadow = ['event', 'army']; s.dice.fp = []; s.cards.shadow.hand = ['sh-str-06'];
  return s;
};
for (const [step, want] of [[3, false], [2, true]]) {
  const s = stormcrow(step, null);
  const a = decide(s, 'shadow', cardOrDraw);
  check(`only the Elves (step ${step}) in reach: ${want ? 'played' : 'held'}`, (a.kind === 'playEvent' && a.cardId === 'sh-str-06') === want, show(a));
}
{
  const s = stormcrow(3, 'minas-tirith');
  const play = wotrAdapter.legalActions(s, 'shadow').find((x) => x.kind === 'playEvent' && x.cardId === 'sh-str-06');
  check('Boromir in Gondor (step 1): playable', !!play);
  if (play) {
    const t = wotrAdapter.applyAction(s, play, 'shadow');
    const a = decide(t, 'shadow');
    check('targets Gondor, not the Elves at step 3', a.kind === 'eventTarget' && a.nation === 'gondor', show(a));
  }
}

console.log('\n=== Through a Day and a Night: no round trip without a way back ===');
for (const [northAtWar, want] of [[false, false], [true, true]]) {
  const s = turn('fp');
  const dg = s.regions['dol-guldur'];
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'legolas');
  Object.assign(dg, { units: { dwarves: { regular: 3, elite: 2 }, north: { regular: 1, elite: 0 } }, leaders: 2, nazgul: 0, characters: ['legolas'], besieged: true,
    siegeBox: { units: { sauron: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 1, characters: [] } });
  s.nations.dwarves.step = 0; s.nations.dwarves.active = true;
  s.nations.north.step = northAtWar ? 0 : 2; s.nations.north.active = true;
  s.dice.fp = ['event']; s.dice.shadow = []; s.cards.fp.hand = ['fp-str-12'];
  const play = wotrAdapter.legalActions(s, 'fp').find((x) => x.kind === 'playEvent' && x.cardId === 'fp-str-12');
  check(`North ${northAtWar ? 'at war' : 'passive'}: card playable`, !!play);
  if (!play) continue;
  const t = wotrAdapter.applyAction(s, play, 'fp');
  const targets = wotrAdapter.legalActions(t, 'fp').filter((x) => x.kind === 'eventTarget' && x.from === 'dol-guldur');
  check(`North ${northAtWar ? 'at war' : 'passive'}: round trip ${want ? 'offered' : 'not offered'}`, targets.some((x) => x.to === 'dol-guldur') === want);
  const refused = targets.filter((x) => !wotrAdapter.tryApplyAction(t, x, 'fp').ok);
  check(`North ${northAtWar ? 'at war' : 'passive'}: every offered target applies`, refused.length === 0, refused.map(show).join(' '));
}

console.log('\n=== The Free Peoples pass until something presses them ===');
for (const pressed of [false, true]) {
  const s = turn('fp');
  s.dice.fp = ['event']; s.dice.shadow = ['army', 'army', 'army']; s.cards.fp.hand = [];
  if (pressed) s.regions['westemnet'].units.isengard = { regular: 3, elite: 0 };
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s, 'fp');
  check(`${pressed ? 'Isengard Army beside Edoras' : 'nothing near'}: ${pressed ? 'acts' : 'passes'}`,
    legal.some((x) => x.kind === 'pass') && (a.kind === 'pass') === !pressed, show(a));
}

console.log(failures ? `\nFAIL: ${failures} failed` : '\nOK: all AI 11-06 checks pass');
process.exit(failures ? 1 : 0);
