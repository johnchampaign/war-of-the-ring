#!/usr/bin/env vite-node
// probe-breaking-on-mordor-track.mjs — The Breaking of the Fellowship (sh-char-14)
// is playable on the Mordor Track: the Companions the FP picks are REMOVED FROM
// PLAY instead of placed (p.43 — separation "as the effect of ... Event cards"
// eliminates on the Track). Player report 2026-09-08: revealed on Mordor step 1,
// Character die in hand, and the card was refused.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const setup = (onTrack) => {
  const s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.dice.shadow = ['character']; s.dice.fp = []; s.pendingChoice = null;
  s.fellowship.location = 'morannon'; s.fellowship.hidden = false; s.fellowship.progress = 0;
  s.fellowship.mordor = onTrack ? 1 : null;
  s.fellowship.companions = ['legolas', 'meriadoc', 'peregrin']; s.fellowship.guide = 'legolas';
  s.cards.shadow.hand = ['sh-char-14'];
  // A tile bag with a known top: a plain "2" so two Companions must go.
  return s;
};

console.log('\n=== on the Mordor Track the card is offered ===');
{
  const s = setup(true);
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const play = legal.find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-14');
  check('playEvent sh-char-14 is legal on Mordor step 1', !!play, JSON.stringify(legal.filter((a) => a.kind === 'playEvent')));
  if (play) {
    let t = wotrAdapter.applyAction(s, play, 'shadow');
    const line = t.log.slice(-6).map((e) => e.msg).find((m) => m.startsWith('The Breaking of the Fellowship'));
    check('the card resolved (logged the tile)', !!line, line);
    if (t.pendingChoice?.kind === 'breakingSep') {
      const before = t.fellowship.companions.length;
      const pick = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'breakingSep');
      t = wotrAdapter.applyAction(t, pick, 'fp');
      check('the chosen Companion left the Fellowship', t.fellowship.companions.length === before - 1, t.fellowship.companions.join(','));
      check('...and is REMOVED FROM PLAY, not placed at the Morannon', t.characters.eliminated.includes(pick.companion) && !t.regions['morannon'].characters.includes(pick.companion), `eliminated: ${t.characters.eliminated.join(',')}; at morannon: ${t.regions['morannon'].characters.join(',')}`);
    } else {
      console.log('  (tile was an Eye / special / 0 — no separation this draw; the legality check is the point)');
    }
  }
}

console.log('\n=== off the Track the Companion is still PLACED in the region (unchanged) ===');
{
  let s = setup(false); s.fellowship.location = 'dagorlad';
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-14');
  check('legal off the Track', !!play);
  if (play) {
    s = wotrAdapter.applyAction(s, play, 'shadow');
    if (s.pendingChoice?.kind === 'breakingSep') {
      const pick = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'breakingSep');
      s = wotrAdapter.applyAction(s, pick, 'fp');
      check('placed at the Fellowship\'s region, not eliminated', s.regions['dagorlad'].characters.includes(pick.companion) && !s.characters.eliminated.includes(pick.companion), `at dagorlad: ${s.regions['dagorlad'].characters.join(',')}`);
    } else console.log('  (no separation this draw)');
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
