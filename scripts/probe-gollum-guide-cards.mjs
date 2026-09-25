#!/usr/bin/env vite-node
// probe-gollum-guide-cards.mjs — Lure of the Ring (sh-char-13) and The Breaking of the
// Fellowship (sh-char-14) with Gollum as the Guide need only a revealed Fellowship:
// no Companion has to be left, nothing is drawn, and each simply adds 1 Corruption
// (Almanac, C13/C14). Player report 2l3i6v046f3h241i: Gollum alone with the
// Ring-bearers, revealed at the Morannon, and Lure of the Ring was refused.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const setup = (cardId, hidden = false) => {
  const s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.dice.shadow = ['character']; s.dice.fp = []; s.pendingChoice = null;
  s.fellowship.location = 'morannon'; s.fellowship.hidden = hidden; s.fellowship.progress = 0; s.fellowship.mordor = null;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum'; s.fellowship.corruption = 4;
  s.cards.shadow.hand = [cardId];
  return s;
};

for (const [cardId, name] of [['sh-char-13', 'Lure of the Ring'], ['sh-char-14', 'The Breaking of the Fellowship']]) {
  console.log(`\n=== ${name}, Gollum guiding, no Companions ===`);
  const s = setup(cardId);
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === cardId);
  check('offered while the Fellowship is revealed', !!play);
  if (play) {
    const huntBefore = JSON.stringify(s.hunt);
    const t = wotrAdapter.applyAction(s, play, 'shadow');
    check('+1 Corruption', t.fellowship.corruption === 5, `corruption ${t.fellowship.corruption}`);
    check('no follow-up choice', !t.pendingChoice, JSON.stringify(t.pendingChoice));
    check('no Hunt tile drawn', JSON.stringify(t.hunt) === huntBefore);
  }
  const hidden = setup(cardId, true);
  check('still refused while the Fellowship is hidden',
    !wotrAdapter.legalActions(hidden, 'shadow').some((a) => a.kind === 'playEvent' && a.cardId === cardId));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
