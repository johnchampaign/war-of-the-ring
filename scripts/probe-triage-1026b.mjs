#!/usr/bin/env vite-node
// probe-triage-1026b.mjs — player report 4p541q1s710v204k: an Event card whose draw is
// its only live clause must not be playable with that deck empty (an empty deck is not
// reshuffled, p.22, so the draw does nothing). The other clause still makes it playable.
//   fp-char-23 House of the Stewards, fp-char-24 The Grey Company,
//   fp-str-15/20/21/24 (recruit-then-draw), fp-str-19 King Brand's Men.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { canPlayCard } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => startGame(createGame({ seed: 11 }));
const place = (s, who, where) => {
  s.characters.inPlay[who] = where;
  if (!s.regions[where].characters.includes(who)) s.regions[where].characters.push(who);
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== who);
};
const emptyDeck = (s) => { s.cards.fp.draw.strategy = []; };

console.log('\n=== House of the Stewards ===');
{
  const s = board(); place(s, 'boromir', 'minas-tirith');
  s.reinforcements.gondor.regular = 0; s.reinforcements.gondor.elite = 0;
  check('no Gondor unit to recruit, deck full: playable for the draw', canPlayCard(s, 'fp-char-23', 'fp'));
  emptyDeck(s);
  check('no Gondor unit, deck empty: not playable', !canPlayCard(s, 'fp-char-23', 'fp'));
  s.reinforcements.gondor.regular = 1;
  check('a Gondor unit to recruit, deck empty: playable', canPlayCard(s, 'fp-char-23', 'fp'));
}

console.log('\n=== The Grey Company ===');
{
  const s = board(); place(s, 'strider', 'minas-tirith');
  s.regions['minas-tirith'].units = { gondor: { regular: 0, elite: 2 } };
  check('nothing to upgrade, deck full: playable', canPlayCard(s, 'fp-char-24', 'fp'));
  emptyDeck(s);
  check('nothing to upgrade, deck empty: not playable', !canPlayCard(s, 'fp-char-24', 'fp'));
  s.regions['minas-tirith'].units = { gondor: { regular: 1, elite: 2 } };
  check('a Regular to upgrade, deck empty: playable', canPlayCard(s, 'fp-char-24', 'fp'));
}

console.log('\n=== Recruit-then-draw Strategy cards ===');
for (const [id, nation] of [['fp-str-15', 'elves'], ['fp-str-21', 'elves'], ['fp-str-24', 'elves'], ['fp-str-20', 'north']]) {
  const s = board();
  s.reinforcements.elves.regular = 0; s.reinforcements.elves.elite = 0;
  s.reinforcements.north.regular = 0; s.reinforcements.north.elite = 0;
  s.reinforcements.dwarves.regular = 0; s.reinforcements.dwarves.elite = 0;
  check(`${id}: nothing to recruit, deck full: playable`, canPlayCard(s, id, 'fp'));
  emptyDeck(s);
  check(`${id}: nothing to recruit, deck empty: not playable`, !canPlayCard(s, id, 'fp'));
  s.reinforcements[nation].regular = 1;
  check(`${id}: a unit to recruit, deck empty: playable`, canPlayCard(s, id, 'fp'));
}
{
  const s = board();
  s.reinforcements.north.regular = 0;
  check('King Brand\'s Men: no North Regular, deck full: playable', canPlayCard(s, 'fp-str-19', 'fp'));
  emptyDeck(s);
  check('King Brand\'s Men: no North Regular, deck empty: not playable', !canPlayCard(s, 'fp-str-19', 'fp'));
  s.reinforcements.north.regular = 2;
  check('King Brand\'s Men: Regulars to recruit, deck empty: playable', canPlayCard(s, 'fp-str-19', 'fp'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
