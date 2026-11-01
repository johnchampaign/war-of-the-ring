#!/usr/bin/env vite-node
// probe-ai-1028.mjs — AI reports of 2026-10-28.
//  - a0n0nqq2ahfk33c2: no Nazgûl flies onto a hidden Fellowship that already has a
//    Mordor entrance within its Progress (South Ithilien, Progress 1) — it declares
//    there next and never moves through the region again.
//  - cca118k2smx6lk2j: The Black Captain Commands recruits its Nazgûl but does not send
//    2 Elites and the Witch-king against 6 units in Edoras.
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

console.log('\n=== No press once Minas Morgul is within the Progress banked ===');
for (const [progress, want] of [[1, false], [0, true]]) {
  const s = turn('shadow');
  s.dice.shadow = ['character']; s.dice.fp = [];
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.fellowship.location = 'south-ithilien'; s.fellowship.hidden = true; s.fellowship.progress = progress;
  s.regions['morannon'].nazgul = 2;
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const offered = legal.some((x) => x.kind === 'moveCharacter' && x.char === 'nazgul' && x.to === 'south-ithilien');
  const a = decide(s, 'shadow');
  const pressed = a.kind === 'moveCharacter' && a.char === 'nazgul' && a.to === 'south-ithilien';
  check(`Progress ${progress}: ${want ? 'a Nazgûl presses' : 'no Nazgûl flies in'}`, offered && pressed === want, show(a));
}

console.log('\n=== The Black Captain Commands does not attack uphill ===');
for (const [elites, defenders, want] of [[2, 5, false], [8, 2, true]]) {
  const s = turn('shadow');
  s.nations.sauron.step = 0; s.nations.rohan.step = 0; s.nations.rohan.active = true;
  s.regions['folde'].units = { sauron: { regular: 0, elite: elites } };
  s.regions['folde'].characters.push('witch-king');
  s.characters.entered.push('witch-king'); s.characters.inPlay['witch-king'] = 'folde';
  s.regions['edoras'].units = { rohan: { regular: 1, elite: defenders } }; s.regions['edoras'].leaders = 1;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.cards.shadow.hand = ['sh-char-24'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((x) => x.kind === 'playEvent' && x.cardId === 'sh-char-24');
  check(`${elites} Elites: the card can be played`, !!play);
  if (!play) continue;
  let st = wotrAdapter.applyAction(s, play, 'shadow');
  const chosen = [];
  for (let i = 0; i < 12 && st.pendingChoice && st.pendingChoice.owner === 'shadow'; i++) {
    const a = decide(st, 'shadow'); chosen.push(a);
    st = wotrAdapter.applyAction(st, a, 'shadow');
  }
  const attacked = chosen.some((a) => a.kind === 'eventTarget' && a.mode === 'attack' && a.to === 'edoras');
  const recruited = chosen.some((a) => a.kind === 'eventTarget' && a.mode === 'recruit');
  check(`${elites} Elites vs ${defenders + 1} in Edoras: ${want ? 'attacks' : 'no attack'} (Nazgûl recruited)`, attacked === want && recruited, chosen.map(show).join(' | '));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
