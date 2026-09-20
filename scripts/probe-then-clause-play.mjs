#!/usr/bin/env vite-node
// probe-then-clause-play.mjs — player report 476n3s6q0c1i2c2w: this port "strengthens"
// Event-card play conditions (a card that can do nothing is not offered), which the
// reporter prefers to the strict reading — but several cards are built as TWO
// independent clauses joined by "Then, …", and a strengthened condition has to be the
// OR of them, not the AND. Rulebook p.23: a card "can still be played, and its effects
// are applied to the maximum extent possible."
//
// The reporter listed nine cards to review as a coherent whole. Six were already
// right — Faramir's Rangers (fp-str-06), Book of Mazarbul (fp-str-04), Fear! Fire!
// Foes! (fp-str-07), The Red Arrow (fp-str-09), I Will Go Alone (fp-char-11, whose
// printed "Play if a Companion is in the Fellowship" IS the first clause) and
// Stormcrow (sh-str-06, whose forced loss survives a Nation already at the top of the
// track). This probe pins the three that were not:
//
//   fp-char-10  There Is Another Way — was unconditionally playable, so it could be
//               spent on nothing at all: no Corruption to heal and no Gollum.
//   fp-char-24  The Grey Company — demanded an upgradeable Regular, although "Then,
//               draw two Strategy Event cards" is reason enough on its own.
//   fp-char-17  There and Back Again — the rouse reads where Gimli and Legolas ARE,
//               so it must fire (and make the card playable) with an empty Fellowship.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => startGame(createGame({ seed: 11 }));
/** Put a Character on the board: both the inPlay index and the region's own list. */
const place = (s, who, where) => {
  s.characters.inPlay[who] = where;
  if (!s.regions[where].characters.includes(who)) s.regions[where].characters.push(who);
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== who);
};

console.log('\n=== There Is Another Way needs a heal or Gollum ===');
{
  const s = board();
  s.fellowship.corruption = 0;
  s.fellowship.guide = 'gandalf-grey';
  check('no Corruption and no Gollum: not playable', canPlayCard(s, 'fp-char-10', 'fp') === false);
  s.fellowship.corruption = 1;
  check('one Corruption: playable for the heal', canPlayCard(s, 'fp-char-10', 'fp') === true);
  s.fellowship.corruption = 0;
  s.fellowship.companions = ['gollum'];
  s.fellowship.guide = 'gollum';
  check('Gollum guiding with nothing to heal: still playable', canPlayCard(s, 'fp-char-10', 'fp') === true);
}

console.log('\n=== The Grey Company is worth playing for the two draws alone ===');
{
  const s = board();
  place(s, 'strider', 'minas-tirith');
  // Strip the Regulars out from under him: nothing left to upgrade.
  s.regions['minas-tirith'].units = { gondor: { regular: 0, elite: 2 } };
  check('with no Regular to eliminate, it is STILL playable', canPlayCard(s, 'fp-char-24', 'fp') === true);
  const h = getHandler('fp-char-24');
  check('...and it offers no upgrade target', h.targets(s, 'fp', []).length === 0);
  const hand0 = s.cards.fp.hand.length;
  h.finalize(s, 'fp', []);
  check('...but still draws two Strategy cards', s.cards.fp.hand.length === hand0 + 2, `${hand0} -> ${s.cards.fp.hand.length}`);

  const alone = board();
  place(alone, 'strider', 'bree');                       // no Free Peoples Army with him
  alone.regions['bree'].units = {};
  check('Strider without an Army: not playable', canPlayCard(alone, 'fp-char-24', 'fp') === false);
}

console.log('\n=== There and Back Again rouses from where Gimli already stands ===');
{
  const s = board();
  s.fellowship.companions = [];                          // nobody left to separate
  place(s, 'gimli', 'erebor');
  check('the rouse clause alone makes it playable', canPlayCard(s, 'fp-char-17', 'fp') === true);
  const north0 = s.nations.north.step, dwarves0 = s.nations.dwarves.step, elves0 = s.nations.elves.step;
  getHandler('fp-char-17').finalize(s, 'fp', []);
  check('the Dwarves are activated', s.nations.dwarves.active === true);
  check('the North is activated', s.nations.north.active === true);
  check('Dwarves / Elves / North each advance ONE step',
    s.nations.dwarves.step === dwarves0 - 1 && s.nations.elves.step === elves0 - 1 && s.nations.north.step === north0 - 1,
    `${dwarves0}/${elves0}/${north0} -> ${s.nations.dwarves.step}/${s.nations.elves.step}/${s.nations.north.step}`);
}
{
  const s = board();
  s.fellowship.companions = [];
  place(s, 'gimli', 'erebor');
  s.regions['erebor'].control = 'shadow';                // a captured Erebor rouses nobody
  check('a captured trigger region: not playable', canPlayCard(s, 'fp-char-17', 'fp') === false);
}
{
  const s = board();
  s.fellowship.companions = [];
  place(s, 'legolas', 'bree');                           // nowhere near a trigger region
  check('Legolas elsewhere: not playable', canPlayCard(s, 'fp-char-17', 'fp') === false);
}
{
  // The separation half still works, and the rouse fires exactly ONCE when the card's
  // own move is what puts Gimli in the trigger region.
  const s = board();
  place(s, 'gimli', 'erebor');
  check('with a Fellowship to separate from, it is playable', canPlayCard(s, 'fp-char-17', 'fp') === true);
  const dwarves0 = s.nations.dwarves.step;
  const h = getHandler('fp-char-17');
  h.finalize(s, 'fp', [{ companion: 'merry' }, { companion: 'merry', region: s.fellowship.location }]);
  check('the Dwarves advanced exactly one step, not two', s.nations.dwarves.step === dwarves0 - 1,
    `${dwarves0} -> ${s.nations.dwarves.step}`);
  check('Merry really separated', !s.fellowship.companions.includes('merry'));
}

console.log(failures ? `\nprobe-then-clause-play: ${failures} FAILURE(S)` : '\nprobe-then-clause-play OK');
process.exit(failures ? 1 : 0);
