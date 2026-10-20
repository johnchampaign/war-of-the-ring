#!/usr/bin/env vite-node
// probe-triage-1020.mjs — player report 5n6s1s281a4k4g65: "Dreadful Spells & company
// should also display the card in the decision modal." The question a direct-damage
// Event card asks — which units absorb its hits — now carries the card, so the prompt
// and the "Resolving:" badge on the map can both show it.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { queueOrApplyEventCasualties, runEventStrikes } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => {
  const state = startGame(createGame({ seed: 7 }));
  state.regions['minas-tirith'].units = { gondor: { regular: 2, elite: 2 } };
  state.regions['minas-tirith'].besieged = false;
  delete state.regions['minas-tirith'].siegeBox;
  return state;
};

console.log('\n=== the casualty question names the card dealing the hits ===');
{
  const state = board();
  queueOrApplyEventCasualties(state, 'fp', 'minas-tirith', 1, undefined, { spare: true, card: 'sh-char-19' });
  check('Dreadful Spells raises the casualty question', state.pendingChoice?.kind === 'eventCasualties');
  check('…carrying the card', state.pendingChoice?.data?.card === 'sh-char-19', JSON.stringify(state.pendingChoice?.data));
}
{
  const state = board();
  runEventStrikes(state, [{ side: 'fp', region: 'minas-tirith', hits: 1, nation: 'gondor', spare: true, card: 'sh-str-01' }]);
  check('a strike list carries its card too', state.pendingChoice?.data?.card === 'sh-str-01', JSON.stringify(state.pendingChoice?.data));
}
{
  const state = board();
  queueOrApplyEventCasualties(state, 'fp', 'minas-tirith', 1);
  check('no card given → no card field', state.pendingChoice?.data?.card === undefined);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nprobe-triage-1020 OK');
