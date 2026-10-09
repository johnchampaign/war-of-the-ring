#!/usr/bin/env vite-node
// probe-mirror-galadriel.mjs — Mirror of Galadriel's strengthened play condition
// (player report 1254046v376z4x4o): playable for the Lórien heal alone, and never
// pays with the last Character die it is meant to convert.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { canPlayCard } from '../src/engine/handlers/registry.ts';
import '../src/engine/handlers/index.ts';
import { wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const MIRROR = 'fp-char-13';
function state(dice, { lorien = false, corruption = 0 } = {}) {
  const s = startGame(createGame({ seed: 7 }));
  s.dice.fp = [...dice];
  if (lorien) s.fellowship.location = 'lorien';
  s.fellowship.corruption = corruption;
  return s;
}
check('one Character die only: not playable', !canPlayCard(state(['character', 'army']), MIRROR, 'fp'));
check('two Character dice: playable', canPlayCard(state(['character', 'character']), MIRROR, 'fp'));
check('one Character + Event die: playable', canPlayCard(state(['character', 'event']), MIRROR, 'fp'));
check('no Character die, in Lórien with Corruption: playable', canPlayCard(state(['event'], { lorien: true, corruption: 2 }), MIRROR, 'fp'));
check('no Character die, in Lórien with no Corruption: not playable', !canPlayCard(state(['event'], { lorien: true, corruption: 0 }), MIRROR, 'fp'));
{
  const s = state(['character', 'event']);
  s.cards.fp.hand = [MIRROR]; s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  const acts = wotrAdapter.legalActions(s, 'fp');
  const play = acts.find((a) => a.kind === 'playEvent' && a.cardId === MIRROR);
  check('offered as a legal action', !!play);
  if (play) {
    const r = wotrAdapter.applyAction(s, play, 'fp');
    const n = r;
    check('paid with the Event die, Character converted to Will', JSON.stringify(n.dice.fp) === '["will"]', JSON.stringify(n.dice.fp));
  }
}
// Reports 3r1l6z5k6v3s3o23 / 52056m29415s3q6f: a die CHOSEN by the player that is the
// last Character die is refused (it used to play the card for nothing), and the picker
// offers only the dice that leave a Character die to convert.
import { dieOptions } from '../src/play/actionText.ts';
{
  const s = state(['character', 'will']);
  s.cards.fp.hand = [MIRROR]; s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  const r = wotrAdapter.tryApplyAction(s, { kind: 'playEvent', cardId: MIRROR, die: 'character' }, 'fp');
  check('the last Character die, chosen, is refused', !r.ok, r.ok ? 'accepted' : r.reason);
  check('the picker offers only the Will die (no choice to make)', JSON.stringify(dieOptions({ kind: 'playEvent', cardId: MIRROR }, s, 'fp')) === '["will"]', JSON.stringify(dieOptions({ kind: 'playEvent', cardId: MIRROR }, s, 'fp')));
  const t = state(['character', 'character', 'event']);
  check('two Character dice + Event: both offered', JSON.stringify(dieOptions({ kind: 'playEvent', cardId: MIRROR }, t, 'fp')) === '["character","event"]');
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
