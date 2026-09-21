#!/usr/bin/env vite-node
// probe-own-deck-order.mjs — a player's view never shows the ORDER of their own draw piles.
//
// Redaction hid the opponent's hand and piles but skipped the viewer entirely, so each
// seat's own two Event decks arrived in draw order: anyone reading the view (devtools,
// the network tab in an online game) could see exactly which cards they would draw next.
// On the tabletop your own deck is shuffled face down. Which cards remain is knowable
// (the deck minus what you've seen), so the view keeps them — sorted, not in draw order.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { redactStateForViewer } from '../src/adapter/redact.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sorted = (a) => [...a].sort();
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

let orderDiffered = 0, piles = 0, ownOk = true, oppOk = true, handOk = true;
for (let seed = 1; seed <= 25; seed++) {
  const state = startGame(createGame({ seed }));
  for (const viewer of ['fp', 'shadow']) {
    const opp = viewer === 'fp' ? 'shadow' : 'fp';
    for (const view of [redactStateForViewer(state, viewer), wotrAdapter.viewFor(state, viewer)]) {
      for (const deck of ['character', 'strategy']) {
        const real = state.cards[viewer].draw[deck], shown = view.cards[viewer].draw[deck];
        piles++;
        if (!same(shown, sorted(real))) ownOk = false;              // same cards, sorted
        if (!same(real, sorted(real))) orderDiffered++;             // the shuffle really differs from sorted
        if (!view.cards[opp].draw[deck].every((c) => c === 'hidden') || view.cards[opp].draw[deck].length !== state.cards[opp].draw[deck].length) oppOk = false;
      }
      if (!same(view.cards[viewer].hand, state.cards[viewer].hand)) handOk = false;  // your hand is yours to see
    }
  }
}
console.log('\n=== your own draw piles ===');
check('they hold exactly the cards left, sorted — not in draw order', ownOk);
check('and the real shuffle differs from sorted, so this hides something', orderDiffered > piles / 2, `${orderDiffered}/${piles} piles`);
console.log('\n=== unchanged ===');
check("the opponent's piles stay fully hidden, same size", oppOk);
check('your own hand is still shown', handOk);
{
  const state = startGame(createGame({ seed: 3 })); state.winner = 'fp';
  const v = redactStateForViewer(state, 'fp');
  check('at game over everything is revealed as before (draw order included)', same(v.cards.fp.draw.character, state.cards.fp.draw.character));
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
