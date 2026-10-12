#!/usr/bin/env vite-node
// probe-ai-fp-reports-1012.mjs — Free Peoples AI reports (2026-10-12). (Report 415m002c653z0n5m,
// sparing Strider as a Hunt casualty, was measured and NOT shipped — see wotrAI.ts huntDamage.)
//  - 5m626h2p5p42263l / 1s5v3a38234y721v: standing at the Morannon, the FP moved the
//    Fellowship on (a Hunt for nothing — entering Mordor zeroes Progress) and was
//    revealed back into Dagorlad. It no longer moves from a Mordor entrance.
//  - 6o494h2s1b105k71: Heroic Death spends a Level-2 Companion on two or more hits,
//    else a Leader, else a Hobbit, and never the Level-3 figures (unless that saves
//    the Army).
//  - 0a3n2s6h3m2p2d3x: a separated Companion no longer wanders into an already-active
//    Nation's City, or from one Army to another, as if that gained something.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fpTurn = () => {
  const s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  return s;
};
const decide = (s) => chooseAction(s, 'fp', wotrAdapter.legalActions(s, 'fp'), new Rng(3));

console.log('\n=== At the Morannon, the Fellowship waits to enter Mordor ===');
{
  const s = fpTurn();
  s.fellowship.location = 'morannon'; s.fellowship.progress = 0; s.fellowship.hidden = true;
  s.dice.fp = ['character']; s.dice.shadow = ['army'];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s);
  check('it does not move the Fellowship', legal.some((x) => x.kind === 'moveFellowship') && a.kind !== 'moveFellowship', JSON.stringify(a));
}

console.log('\n=== Heroic Death ===');
const heroic = (hits, leaders, companions, units = 6) => {
  const s = fpTurn();
  const r = s.regions['osgiliath'];
  r.units = { gondor: { regular: units, elite: 0 } }; r.leaders = leaders; r.characters = [...companions];
  s.regions['south-ithilien'].units = { sauron: { regular: 8, elite: 0 } };
  s.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'south-ithilien', to: 'osgiliath', round: 0, fortified: false,
    step: 'heroicDeath', attackerCard: null, defenderCard: 'x', atkHits: hits, defHits: 0, heroicDeath: { side: 'fp', max: hits } };
  s.pendingChoice = { owner: 'fp', kind: 'heroicDeath', data: { hits, leaders, companions } };
  return decide(s).sacrifice ?? 'no one';
};
check('2 hits, a Leader and Legolas: Legolas (cancels both)', heroic(2, 1, ['legolas', 'strider']) === 'legolas');
check('1 hit, a Leader and Legolas: the Leader', heroic(1, 1, ['legolas']) === 'leader');
check('1 hit, no Leader, Merry: Merry', heroic(1, 0, ['meriadoc']) === 'meriadoc');
check('2 hits, a Leader and Strider: the Leader, never Strider', heroic(2, 1, ['strider']) === 'leader');
check('2 hits, only Aragorn: no one', heroic(2, 0, ['aragorn']) === 'no one');
check('3 hits on 2 units, only Aragorn: Aragorn saves the Army', heroic(3, 0, ['aragorn'], 2) === 'aragorn');

console.log('\n=== A separated Companion moves only for a reason ===');
{
  const s = fpTurn();
  s.dice.fp = ['character']; s.dice.shadow = ['army'];
  s.fellowship.location = 'morannon'; s.fellowship.progress = 0; // nothing better to do with the die
  for (const n of ['gondor', 'rohan', 'elves', 'dwarves', 'north']) s.nations[n].active = true; // nobody left to rouse
  s.regions['minas-tirith'].characters.push('gandalf-white');
  if (!s.characters.entered.includes('gandalf-white')) s.characters.entered.push('gandalf-white');
  const legal = wotrAdapter.legalActions(s, 'fp');
  const into = legal.filter((x) => x.kind === 'moveCharacter' && x.char === 'gandalf-white');
  const a = decide(s);
  check('with every Nation already active, Gandalf the White stays with his Army', into.length > 0 && !(a.kind === 'moveCharacter' && a.char === 'gandalf-white'), `${into.length} moves on offer; chose ${JSON.stringify(a)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
