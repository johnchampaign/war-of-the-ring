#!/usr/bin/env vite-node
// probe-nazgul-strike.mjs — The Nazgûl Strike!'s printed CHOICE (John's call D, the
// last D13 residual): "if at least one Nazgûl is in the region with the Fellowship,
// you may either discard one Free Peoples Character Event card from the table or
// roll for the Hunt." The choice is offered only when both branches are live.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { resolveNazgulStrike } from '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function board(withTableCard) {
  const s = startGame(createGame({ seed: 8 }));
  s.fellowship.progress = 2;
  s.regions[s.fellowship.location].nazgul = 1;        // a Nazgûl already shares the region
  s.hunt.box = 2;                                      // give the Hunt something to roll
  if (withTableCard) s.cards.fp.table.push('fp-char-07'); // Horn of Gondor (Character deck)
  return s;
}
/** Drive the card with NO moves (the "move none" path) so finalize fires. */
function playIt(s) {
  const h = getHandler('sh-char-08b');
  h.finalize(s, 'shadow', []);
  return s;
}

{
  console.log('\n=== an FP Character card on the table -> the choice is offered ===');
  const s = playIt(board(true));
  check('the Shadow is asked', s.pendingChoice?.kind === 'nazgulStrike', s.pendingChoice?.kind ?? 'none');
  check('no Hunt fired yet', (s.hunt.draws ?? []).length === 0);
  resolveNazgulStrike(s, 'fp-char-07');
  check('the card is torn from the table', !s.cards.fp.table.includes('fp-char-07'));
  check('...into the Character discard', s.cards.fp.discard.character.includes('fp-char-07'));
  check('and NO Hunt happens (the card was the price)', (s.hunt.draws ?? []).length === 0);
}

{
  console.log('\n=== choosing the Hunt instead leaves the table alone ===');
  const s = playIt(board(true));
  resolveNazgulStrike(s, undefined);
  check('the table card survives', s.cards.fp.table.includes('fp-char-07'));
  check('the Hunt fired', (s.hunt.draws ?? []).length > 0 || s.pendingChoice != null,
    `draws=${(s.hunt.draws ?? []).length}, pending=${s.pendingChoice?.kind ?? 'none'}`);
}

{
  console.log('\n=== no FP Character table card -> auto-Hunt, no one-answer question ===');
  const s = playIt(board(false));
  check('no choice raised', s.pendingChoice?.kind !== 'nazgulStrike', s.pendingChoice?.kind ?? 'none');
  check('the Hunt fired directly', (s.hunt.draws ?? []).length > 0 || s.pendingChoice != null);
}

{
  console.log('\n=== no Nazgûl with the Fellowship -> nothing at all ===');
  const s = board(true);
  s.regions[s.fellowship.location].nazgul = 0;
  playIt(s);
  check('no choice', s.pendingChoice == null, s.pendingChoice?.kind ?? 'none');
  check('no Hunt', (s.hunt.draws ?? []).length === 0);
  check('the table card is untouched', s.cards.fp.table.includes('fp-char-07'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
