#!/usr/bin/env vite-node
// probe-table-discards.mjs — two on-table Shadow cards whose PRINTED discard
// clauses were missing (the TTS-mod transcription in assets/event-cards.json
// omits them; player reports 2026-08-24 + card scans confirm):
//
//  - Wormtongue (sh-char-22): "You must discard this card from the table as soon
//    as Rohan is activated, or if Saruman is eliminated."
//  - Worn with Sorrow and Toil (sh-char-15): "discard this card from the table if
//    the Fellowship is declared in a City or Stronghold controlled by the Free
//    Peoples."
//
// Plus the AI half of the same report batch: the Nazgûl-move card chain stops
// after ONE Ringwraith reaches the Fellowship (presence is what matters; a second
// adds nothing and costs an Army its Leadership).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { declareFellowship } from '../src/engine/fellowship.ts';
import { activateNation } from '../src/engine/politics.ts';
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
/** Run one no-op adapter action so advance() sweeps the table. */
const sweepViaAction = (s) => {
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.dice.shadow = ['eye']; s.dice.fp = [];
  return wotrAdapter.applyAction(s, { kind: 'pass' }, 'shadow');
};

{
  console.log('\n=== Wormtongue leaves the table as soon as Rohan is activated ===');
  let s = startGame(createGame({ seed: 11 }));
  s.characters.inPlay['saruman'] = 'orthanc';
  s.cards.shadow.table.push('sh-char-22');
  activateNation(s, 'rohan', { viaCompanion: true });
  check('Rohan is active', s.nations.rohan.active === true);
  s = sweepViaAction(s);
  check('Wormtongue is off the table', !s.cards.shadow.table.includes('sh-char-22'), s.cards.shadow.table.join(','));
  check('...and in the Shadow Character discard', s.cards.shadow.discard.character.includes('sh-char-22'));
}

{
  console.log('\n=== ...and still discards when Saruman is eliminated (existing rule) ===');
  let s = startGame(createGame({ seed: 11 }));
  s.characters.inPlay['saruman'] = 'orthanc';
  s.cards.shadow.table.push('sh-char-22');
  s.characters.eliminated.push('saruman');
  s = sweepViaAction(s);
  check('Wormtongue is off the table', !s.cards.shadow.table.includes('sh-char-22'));
}

{
  console.log('\n=== Worn with Sorrow and Toil discards on a declare in an FP haven ===');
  const s = startGame(createGame({ seed: 12 }));
  s.cards.shadow.table.push('sh-char-15');
  s.fellowship.location = 'lorien'; s.fellowship.progress = 0; s.fellowship.corruption = 3;
  declareFellowship(s, 'lorien');
  check('the declare healed (sanity: it WAS an FP haven)', s.fellowship.corruption === 2, `corruption ${s.fellowship.corruption}`);
  check('the card is off the table', !s.cards.shadow.table.includes('sh-char-15'), s.cards.shadow.table.join(','));
  check('...and in the Shadow Character discard', s.cards.shadow.discard.character.includes('sh-char-15'));
}

{
  console.log('\n=== ...but a declare in open country leaves it in play ===');
  const s = startGame(createGame({ seed: 12 }));
  s.cards.shadow.table.push('sh-char-15');
  s.fellowship.location = 'hollin'; s.fellowship.progress = 0;
  declareFellowship(s, 'hollin');
  check('the card stays', s.cards.shadow.table.includes('sh-char-15'));
}

{
  console.log('\n=== AI: the Nazgûl chain sends ONE Ringwraith, not the whole flight ===');
  const s = startGame(createGame({ seed: 13 }));
  s.fellowship.location = 'fords-of-bruinen';
  // A Nazgûl already sits with the (declared) Fellowship; four more wait at Barad-dûr.
  s.regions['fords-of-bruinen'].nazgul = 1;
  s.regions['barad-dur'].nazgul = 4;
  const legal = [
    { kind: 'eventTarget', companion: 'nazgul', from: 'barad-dur', region: 'fords-of-bruinen', count: 1 },
    { kind: 'eventTarget', companion: 'nazgul', from: 'barad-dur', region: 'fords-of-bruinen', count: 4 },
    { kind: 'eventTarget', done: true },
  ];
  s.pendingChoice = { owner: 'shadow', kind: 'eventTarget', data: {} };
  const pick = chooseAction(s, 'shadow', legal, new Rng(7));
  check('with a Nazgûl already there, the AI stops the chain', pick.done === true, JSON.stringify(pick));
  s.regions['fords-of-bruinen'].nazgul = 0; // empty square: the first move IS worth it
  const pick2 = chooseAction(s, 'shadow', legal, new Rng(7));
  check('with none there, it sends exactly one', pick2.count === 1 && pick2.region === 'fords-of-bruinen', JSON.stringify(pick2));
}

{
  console.log('\n=== AI: the CHARACTER-DIE Nazgûl chain also sends one, and never strips a siege ===');
  // The die-driven twin of the card-chain fix (player report: '[C] to move 5(!)
  // Nazgul to F&S (including the 1 besieging WR)').
  const s = startGame(createGame({ seed: 14 }));
  s.fellowship.location = 'fords-of-bruinen'; s.fellowship.hidden = false;
  s.regions['fords-of-bruinen'].nazgul = 1;                       // one wraith already on the Fellowship
  s.regions['woodland-realm'].units = { sauron: { regular: 4, elite: 0 } };
  s.regions['woodland-realm'].nazgul = 1;                         // the one besieging WR
  s.regions['woodland-realm'].besieged = true;
  s.regions['woodland-realm'].siegeBox = { units: { elves: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['woodland-realm'].control = 'fp';
  s.pendingChoice = { owner: 'shadow', kind: 'charMove2', data: { chars: [], movedNazgul: {} } };
  const legal = [
    { kind: 'moveCharacter', char: 'nazgul', from: 'woodland-realm', to: 'fords-of-bruinen', count: 1 },
    { kind: 'charMove2', done: true },
  ];
  const pick = chooseAction(s, 'shadow', legal, new Rng(3));
  check('with a wraith already on the Fellowship and this one holding a siege, the chain stops', pick.done === true, JSON.stringify(pick));
  s.regions['fords-of-bruinen'].nazgul = 0; s.regions['woodland-realm'].siegeBox = undefined; s.regions['woodland-realm'].besieged = false;
  const pick2 = chooseAction(s, 'shadow', legal, new Rng(3));
  check('with none there and no siege to hold, it pounces', pick2.kind === 'moveCharacter', JSON.stringify(pick2));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
