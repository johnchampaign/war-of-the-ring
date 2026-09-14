#!/usr/bin/env vite-node
// probe-event-recruit-no-done.mjs — an Event card that says "Recruit …" recruits to the
// maximum extent possible; it cannot stop early (player report 4f0y2f2r4k315b68, the
// Almanac: partial recruitment "is not permitted when playing an Event card"). Many
// Kings to the Service of Mordor offered a Done button after its first Settlement.
//
// Cards that print "up to" / "may" keep their Done (Rage of the Dunlendings' follow-up
// moves), and the loop must still END by itself when reinforcements run out — removing
// Done must never leave a player forced into picks that place nothing.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = (side) => {
  const s = startGame(createGame({ seed: 41 }));
  s.phase = 'actionResolution'; s.currentPlayer = side; s.pendingChoice = null;
  s.dice.shadow = side === 'shadow' ? ['event'] : []; s.dice.fp = side === 'fp' ? ['event'] : [];
  return s;
};
const play = (s, side, cardId) => {
  s.cards[side].hand = [cardId];
  const a = wotrAdapter.legalActions(s, side).find((x) => x.kind === 'playEvent' && x.cardId === cardId);
  return a ? wotrAdapter.applyAction(s, { ...a, die: 'event' }, side) : null;
};
const legal = (s, side) => wotrAdapter.legalActions(s, side);
const hasDone = (s, side) => legal(s, side).some((a) => a.kind === 'eventTarget' && a.done);
const pickFirst = (s, side, pred = () => true) => {
  const a = legal(s, side).find((x) => x.kind === 'eventTarget' && !x.done && pred(x));
  return a ? wotrAdapter.applyAction(s, a, side) : null;
};
const resolving = (s, cardId) => s.pendingChoice?.kind === 'eventTarget' && s.pendingChoice.data.card === cardId;
const seTotal = (s) => Object.values(s.regions).reduce((n, r) => n + (r.units.southrons?.regular ?? 0), 0);

console.log('\n=== Many Kings to the Service of Mordor: no Done, and it stops when the pool is dry ===');
{
  let s = board('shadow');
  s.reinforcements.southrons.regular = 3;           // enough for one pair and one more
  const before = seTotal(s);
  s = play(s, 'shadow', 'sh-str-17');
  check('the card asks for a Settlement', !!s && resolving(s, 'sh-str-17'), s?.pendingChoice?.kind ?? 'not playable');
  check('no Done before the first pick', !hasDone(s, 'shadow'));
  s = pickFirst(s, 'shadow');
  check('no Done after the first pick (the report)', resolving(s, 'sh-str-17') && !hasDone(s, 'shadow'));
  s = pickFirst(s, 'shadow');
  check('the pool is spent after the second pick', s.reinforcements.southrons.regular === 0, String(s.reinforcements.southrons.regular));
  check('so the card resolves by itself — no empty third pick', !resolving(s, 'sh-str-17'), s.pendingChoice?.kind ?? 'resolved');
  check('all three Regulars reached the board', seTotal(s) === before + 3, `${before} -> ${seTotal(s)}`);
}

console.log('\n=== Pits of Mordor: a lone Regular is still recruited ===');
{
  let s = board('shadow');
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  s.reinforcements.sauron.regular = 1;
  s = play(s, 'shadow', 'sh-str-24');
  check('the card asks for a Stronghold', !!s && resolving(s, 'sh-str-24'), s?.pendingChoice?.kind ?? 'not playable');
  const target = legal(s, 'shadow').find((a) => a.kind === 'eventTarget' && !a.done);
  const units = (st) => (st.regions[target.region].units.sauron?.regular ?? 0) + (st.regions[target.region].siegeBox?.units?.sauron?.regular ?? 0);
  const at0 = units(s);
  check('no Done while choosing', !hasDone(s, 'shadow'));
  s = wotrAdapter.applyAction(s, target, 'shadow');
  check('the one remaining Regular lands (it used to refuse the pair)', units(s) === at0 + 1, `${at0} -> ${units(s)} at ${target.region}`);
  check('and the card resolves', !resolving(s, 'sh-str-24'), s.pendingChoice?.kind ?? 'resolved');
}

console.log('\n=== a two-place named recruit (The Shire + Ered Luin): no Done between them ===');
{
  let s = board('fp');
  s = play(s, 'fp', 'fp-str-20');
  check('the card asks for the first unit', !!s && resolving(s, 'fp-str-20'), s?.pendingChoice?.kind ?? 'not playable');
  s = pickFirst(s, 'fp');
  check('the second place is still owed — and cannot be skipped', resolving(s, 'fp-str-20') && !hasDone(s, 'fp'));
}

console.log('\n=== Faramir\'s Rangers: after the strike, the recruit cannot be skipped ===');
{
  let s = board('fp');
  s.regions['north-ithilien'].units = { sauron: { regular: 2, elite: 0 } };
  s = play(s, 'fp', 'fp-str-06');
  check('the card asks for a strike', !!s && resolving(s, 'fp-str-06'), s?.pendingChoice?.kind ?? 'not playable');
  s = pickFirst(s, 'fp', (a) => a.region === 'north-ithilien' && !a.figure);
  check('the recruit follows with no Done beside it', resolving(s, 'fp-str-06') && !hasDone(s, 'fp')
    && legal(s, 'fp').some((a) => a.kind === 'eventTarget' && a.figure));
}

console.log('\n=== Rage of the Dunlendings keeps its Done — the moves after the recruit are "up to" ===');
{
  let s = board('shadow');
  s.nations.isengard.active = true; s.nations.isengard.step = 0;
  s.regions['north-dunland'].units = { isengard: { regular: 2, elite: 0 } };
  s.regions['south-dunland'].units = { isengard: { regular: 2, elite: 0 } };
  s = play(s, 'shadow', 'sh-str-11');
  check('the card asks for a recruit region', !!s && resolving(s, 'sh-str-11'), s?.pendingChoice?.kind ?? 'not playable');
  s = pickFirst(s, 'shadow', (a) => a.region === 'south-dunland' || a.region === 'north-dunland');
  check('after the recruit the optional moves offer Done', resolving(s, 'sh-str-11') && hasDone(s, 'shadow'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
