#!/usr/bin/env vite-node
// probe-ai-1018.mjs — AI reports of 2026-10-16..18.
//  - 6r6u185y1f516i25: Saruman's Muster die is kept even when a Character die is in
//    hand — with no plain Army die, an Army move spends the Army/Muster die.
//  - 504m0n0r2o0m4h4w, 5i2d2w166c672j1p: with Saruman in play a Muster die goes to the
//    Voice of Saruman, not to a single Regular in North Dunland or Orthanc.
//  - 4w6d6l484k5v0f5d: no second Nazgûl onto a Fellowship one already presses.
//  - 1b6t691n0q3m360v: a Free Peoples Army whose Nation is not At War stays home.
//  - 04291r2i296h5w1n: no Elven Ring just to re-hide a revealed Fellowship.
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
const decide = (s, side) => chooseAction(s, side, wotrAdapter.legalActions(s, side), new Rng(3));
const show = (a) => JSON.stringify(a).slice(0, 120);

console.log('\n=== Saruman keeps his die (Character die in hand) ===');
for (const seed of [1, 2, 3]) {
  const s = turn('shadow', seed);
  s.nations.isengard.step = 0;
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gandalf-grey');
  if (!s.characters.eliminated.includes('gandalf-grey')) s.characters.eliminated.push('gandalf-grey');
  s.dice.shadow = ['armyMuster', 'character']; s.dice.fp = ['will', 'character'];
  const a = decide(s, 'shadow');
  const after = wotrAdapter.applyAction(s, a, 'shadow');
  const forSaruman = a.kind === 'bringMinion' && a.minion === 'saruman';
  check(`seed ${seed}: the Army/Muster die is kept, or brings Saruman`, forSaruman || after.dice.shadow.includes('armyMuster'), show(a));
}

console.log('\n=== The Voice of Saruman ===');
for (const seed of [1, 2, 3]) {
  const s = turn('shadow', seed);
  s.nations.isengard.step = 0;
  s.characters.entered.push('saruman'); s.characters.inPlay['saruman'] = 'orthanc';
  s.dice.shadow = ['muster']; s.dice.fp = [];
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = decide(s, 'shadow');
  const offered = legal.some((x) => x.kind === 'sarumanMuster');
  check(`seed ${seed}: a Muster die with Saruman in play — the Voice of Saruman`, offered && a.kind === 'sarumanMuster', show(a));
}

console.log('\n=== One Nazgûl presses the Fellowship ===');
{
  const s = turn('shadow');
  s.dice.shadow = ['character']; s.dice.fp = [];
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.fellowship.location = 'eastern-brown-lands'; s.fellowship.hidden = false; s.fellowship.progress = 0;
  s.regions['eastern-brown-lands'].nazgul = 1;
  s.regions['north-ithilien'].nazgul = 2;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = decide(s, 'shadow');
  const onto = legal.some((x) => x.kind === 'moveCharacter' && x.char === 'nazgul' && x.to === 'eastern-brown-lands');
  check('a Nazgûl already there: no second one flies in', onto && !(a.kind === 'moveCharacter' && a.to === 'eastern-brown-lands'), show(a));
}

console.log('\n=== A Nation not At War stays home ===');
{
  // Only the Dwarves' Erebor Army on the Free Peoples side, so it is the one to move.
  const s = turn('fp');
  const FPN = ['dwarves', 'elves', 'gondor', 'north', 'rohan'];
  for (const [id, r] of Object.entries(s.regions)) if (id !== 'erebor') for (const n of FPN) delete r.units[n];
  s.dice.fp = ['army']; s.dice.shadow = [];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s, 'fp');
  const outOfErebor = legal.some((x) => x.kind === 'moveArmy' && x.from === 'erebor');
  check('Erebor (Dwarves passive): its Army does not walk out', outOfErebor && !(a.kind === 'moveArmy' && a.from === 'erebor'), show(a));
}

console.log('\n=== No Elven Ring just to hide ===');
{
  const s = turn('fp');
  s.dice.fp = ['army', 'muster']; s.dice.shadow = [];
  s.fellowship.hidden = false;
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s, 'fp');
  const offered = legal.some((x) => x.kind === 'useElvenRing' && x.to === 'character');
  check('revealed, no Character die: the Ring is kept', offered && a.kind !== 'useElvenRing', show(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
