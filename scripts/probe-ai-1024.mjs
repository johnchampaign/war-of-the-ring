#!/usr/bin/env vite-node
// probe-ai-1024.mjs — AI report kz0zb6v5xhdvy7my (2026-10-23): a Nazgûl card places its
// Ringwraiths where the hidden Fellowship will END its next declare or reveal — at the
// full Progress it has banked (or the Mordor entrance, if nearer) — never one step short
// of it, which the Free Peoples would never stop at. Fellowship in Rivendell with
// Progress 2: Hollin, not the Fords of Bruinen or the Trollshaws.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== Nazgûl Search, the Fellowship hidden in Rivendell with Progress 2 ===');
for (const seed of [1, 2, 3]) {
  let s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.regions['morannon'].nazgul = 1; s.regions['osgiliath'].nazgul = 2;
  s.fellowship.location = 'rivendell'; s.fellowship.hidden = true; s.fellowship.progress = 2;
  s.dice.shadow = ['character']; s.dice.fp = [];
  s.cards.shadow.hand = ['sh-char-09'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-09');
  if (!play) { check(`seed ${seed}: Nazgûl Search is playable (setup)`, false); continue; }
  s = wotrAdapter.applyAction(s, play, 'shadow');
  const moves = [];
  for (let i = 0; i < 20 && s.pendingChoice?.owner === 'shadow'; i++) {
    const a = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(seed));
    if (a.kind === 'eventTarget' && a.region) moves.push(`${a.from ?? '?'}→${a.region}`);
    s = wotrAdapter.applyAction(s, a, 'shadow');
  }
  const short = ['fords-of-bruinen', 'trollshaws'].filter((r) => s.regions[r].nazgul > 0);
  check(`seed ${seed}: no Nazgûl one step short of the Fellowship's reach`, short.length === 0, `${moves.join(', ')}${short.length ? ` — in ${short.join(', ')}` : ''}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
