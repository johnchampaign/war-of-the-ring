#!/usr/bin/env vite-node
// probe-ai-1015.mjs — Shadow AI reports of 2026-10-14/15.
//  - 412b503z4a554d3w: with two Muster dice the Shadow takes Isengard to War and brings
//    Saruman — Sauron's bigger Army used to win the diplomacy die every time.
//  - 2i1u3w2d3x5g1j3z: no Character-die Nazgûl move onto a Fellowship at a Mordor entrance.
//  - 3g4w2o173k4h3061: pressing a revealed Fellowship takes ONE Nazgûl, not the stack.
//  - 1z006a1e11730v2p: Dreadful Spells waits for three or more Nazgûl.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const shadowTurn = (seed = 1) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  return s;
};
const decide = (s) => chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(3));

console.log('\n=== Isengard to War, then Saruman ===');
for (const seed of [1, 2, 3]) {
  let s = shadowTurn(seed);
  s.dice.shadow = ['muster', 'muster']; s.dice.fp = [];
  const picks = [];
  for (let i = 0; i < 2; i++) {
    const a = decide(s); picks.push(a.kind === 'diplomaticAction' ? `${a.nation} toward War` : a.kind === 'bringMinion' ? a.minion : a.kind);
    s = wotrAdapter.applyAction(s, a, 'shadow');
    for (let g = 0; g < 10 && s.pendingChoice?.owner === 'shadow'; g++) s = wotrAdapter.applyAction(s, decide(s), 'shadow');
    s.currentPlayer = 'shadow';
  }
  check(`seed ${seed}: Isengard to War, then Saruman`, picks[0] === 'isengard toward War' && picks[1] === 'saruman', picks.join(', '));
}

console.log('\n=== Nazgûl and a revealed Fellowship ===');
{
  const s = shadowTurn();
  s.dice.shadow = ['character']; s.dice.fp = [];
  s.fellowship.location = 'morannon'; s.fellowship.hidden = false; s.fellowship.progress = 0;
  s.regions['dagorlad'].nazgul = 2;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = decide(s);
  const onto = legal.some((x) => x.kind === 'moveCharacter' && x.char === 'nazgul' && x.to === 'morannon');
  check('at the Morannon: no Nazgûl flies onto it', onto && !(a.kind === 'moveCharacter' && a.char === 'nazgul' && a.to === 'morannon'), JSON.stringify(a).slice(0, 110));
}
{
  const s = shadowTurn();
  s.dice.shadow = ['character']; s.dice.fp = [];
  s.fellowship.location = 'eastern-brown-lands'; s.fellowship.hidden = false; s.fellowship.progress = 0;
  s.regions['north-ithilien'].nazgul = 2;
  const a = decide(s);
  if (a.kind === 'moveCharacter' && a.char === 'nazgul' && a.to === 'eastern-brown-lands') check('a press on a revealed Fellowship sends one Nazgûl', a.count === 1, JSON.stringify(a));
  else check('the AI presses the revealed Fellowship (setup)', false, JSON.stringify(a).slice(0, 110));
}

console.log('\n=== Dreadful Spells ===');
{
  const s = shadowTurn();
  s.dice.shadow = ['character', 'event']; s.dice.fp = [];
  s.cards.shadow.hand = ['sh-char-19'];
  // One Nazgûl beside the Free Peoples Army in Osgiliath.
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.regions['osgiliath'].units = { gondor: { regular: 2, elite: 0 } };
  s.regions['south-ithilien'].units = { sauron: { regular: 3, elite: 0 } };
  s.regions['south-ithilien'].nazgul = 1;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const offered = legal.some((x) => x.kind === 'playEvent' && x.cardId === 'sh-char-19');
  const a = decide(s);
  check('one Nazgûl: Dreadful Spells waits', offered && !(a.kind === 'playEvent' && a.cardId === 'sh-char-19'), JSON.stringify(a).slice(0, 110));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
