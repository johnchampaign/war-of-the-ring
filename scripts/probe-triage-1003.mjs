#!/usr/bin/env vite-node
// probe-triage-1003.mjs — fixes from the 2026-10-03 report batch:
//
//  1. The Lidless Eye: "Change up to three unused Shadow Action dice results into
//     'Eye' results" — the Shadow player picks WHICH dice. It used to convert the
//     last dice in the pool with no choice (reports h0udzn1tyv34r81e, 090q0d2o3a3n480u).
//  2. Two Hobbits leaving the Fellowship in one Hunt (the Hobbit Guide separating for
//     −1, then the other taken alive) are BOTH placed. One pending slot let the second
//     overwrite the first, who vanished from the game (report 1huuhkxza7mpp4r5).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

{
  console.log('\n=== The Lidless Eye lets the Shadow choose which dice become Eyes ===');
  let s = startGame(createGame({ seed: 41 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.dice.shadow = ['event', 'army', 'army', 'muster', 'eye'];
  s.cards.shadow.hand = ['sh-char-18'];
  const box0 = s.hunt.box;
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-18');
  check('The Lidless Eye is playable', !!play);
  s = wotrAdapter.applyAction(s, play, 'shadow');
  const eyeOpts = () => wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'eventTarget' && a.eye);
  const faces = eyeOpts().map((a) => a.face).sort();
  check('one option per distinct non-Eye face left', JSON.stringify(faces) === JSON.stringify(['army', 'muster']), JSON.stringify(faces));
  s = wotrAdapter.applyAction(s, eyeOpts().find((a) => a.face === 'muster'), 'shadow');
  check('the chosen Muster die is the one converted', !s.dice.shadow.includes('muster') && s.dice.shadow.filter((f) => f === 'army').length === 2, JSON.stringify(s.dice.shadow));
  check('it went to the Hunt Box', s.hunt.box === box0 + 1, `${box0} → ${s.hunt.box}`);
  const done = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.done);
  check('the Shadow may stop after one', !!done);
  s = wotrAdapter.applyAction(s, eyeOpts().find((a) => a.face === 'army'), 'shadow');
  s = wotrAdapter.applyAction(s, eyeOpts().find((a) => a.face === 'army'), 'shadow');
  check('three conversions at most, and the card ends', !(s.pendingChoice?.kind === 'eventTarget'), JSON.stringify(s.pendingChoice));
  check('both Army dice converted, the Eye remains', JSON.stringify(s.dice.shadow) === '["eye"]', JSON.stringify(s.dice.shadow));
}

{
  console.log('\n=== two Hobbits leaving in one Hunt are both placed ===');
  let s = startGame(createGame({ seed: 42 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp';
  s.fellowship.mordor = null; s.fellowship.progress = 2; s.fellowship.hidden = false;
  s.fellowship.companions = ['meriadoc', 'peregrin']; s.fellowship.guide = 'meriadoc';
  s.fellowship.corruption = 0;
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 3, reveal: false } };
  const pick = (mode) => wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'huntDamage' && a.mode === mode);
  const sep = pick('reduceSeparate');
  check('the Hobbit Guide may separate for −1', !!sep, JSON.stringify(wotrAdapter.legalActions(s, 'fp').map((a) => a.mode)));
  s = wotrAdapter.applyAction(s, sep, 'fp');
  check('Peregrin is the new Guide', s.fellowship.guide === 'peregrin', s.fellowship.guide);
  const g = pick('guide');
  check('the Guide can be taken as the casualty', !!g, JSON.stringify(wotrAdapter.legalActions(s, 'fp').map((a) => a.mode ?? a.kind)));
  s = wotrAdapter.applyAction(s, g, 'fp');
  // Absorb anything left, then place each Hobbit wherever is offered.
  const placed = [];
  for (let i = 0; i < 12 && s.pendingChoice; i++) {
    const legal = wotrAdapter.legalActions(s, 'fp');
    if (s.pendingChoice.kind === 'separateMove') {
      placed.push(...s.pendingChoice.data.companions);
      s = wotrAdapter.applyAction(s, legal.find((a) => a.kind === 'separateMove' && a.target) ?? legal[0], 'fp');
    } else if (s.pendingChoice.owner === 'fp') s = wotrAdapter.applyAction(s, legal.find((a) => a.mode === 'corruption') ?? legal[0], 'fp');
    else break;
  }
  check('both Hobbits were offered a landing', placed.includes('meriadoc') && placed.includes('peregrin'), JSON.stringify(placed));
  const onBoard = (id) => Object.values(s.regions).some((r) => r.characters.includes(id) || r.siegeBox?.characters.includes(id));
  check('Meriadoc is on the board', onBoard('meriadoc'));
  check('Peregrin is on the board', onBoard('peregrin'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
