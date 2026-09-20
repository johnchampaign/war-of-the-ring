#!/usr/bin/env vite-node
// probe-rage-of-the-dunlendings.mjs — Rage of the Dunlendings runs on the MAP, both
// halves, and moves at most the four Isengard units the card allows.
//
// Player reports 0g40604w245d6w3q and 4z4d6h18592c546r: "Rage of the Dunlendings should
// use the map interface both for the recruitment and for the move portion of the card."
// The recruit pick carried no `mode`, so it stayed a panel button; the move picks
// carried `region` instead of `to`, so they were not card Army moves either and the
// card walked ONE unit per pick with no say over Regular vs Elite.
//
// Card text: "Recruit two Isengard Regular units in a free region adjacent to North or
// South Dunland. You may also move to this region up to four Isengard units (Regular or
// Elite) from North Dunland and/or South Dunland."
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { isCardRecruitTarget, isCardArmyMoveTarget } from '../src/play/actionText.ts';
import { panelShowsAction } from '../src/play/panelFilter.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const units = (s, r, n) => `${s.regions[r].units[n]?.regular ?? 0}R/${s.regions[r].units[n]?.elite ?? 0}E`;

// Isengard At War, the card in hand, a Muster die to pay for it, and both Dunlands
// holding Isengard troops to consolidate.
const base = () => {
  const s = startGame(createGame({ seed: 5 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['muster']; s.dice.fp = [];
  s.nations.isengard.active = true; s.nations.isengard.step = 0;
  s.cards.shadow.hand = ['sh-str-11'];
  s.reinforcements.isengard.regular = 6; s.reinforcements.isengard.elite = 4;
  s.regions['north-dunland'].units = { isengard: { regular: 2, elite: 1 } };
  s.regions['south-dunland'].units = { isengard: { regular: 1, elite: 2 } };
  return s;
};
const play = (s) => wotrAdapter.applyAction(s, { kind: 'playEvent', cardId: 'sh-str-11', die: 'muster' }, 'shadow');

console.log('\n=== the recruit pick is on the map, not a panel button ===');
{
  const s = play(base());
  const acts = wotrAdapter.legalActions(s, 'shadow');
  const picks = acts.filter((a) => a.kind === 'eventTarget' && !a.done);
  check('every recruit pick is a board muster', picks.length > 0 && picks.every(isCardRecruitTarget), JSON.stringify(picks.slice(0, 2)));
  check('none of them is a panel button', picks.every((a) => !panelShowsAction(a, acts, s)));
  const dunlandAdj = new Set([...REGIONS['north-dunland'].adjacency, ...REGIONS['south-dunland'].adjacency]);
  check('every offered region is adjacent to a Dunland', picks.every((a) => !!a.region && dunlandAdj.has(a.region)), picks.map((a) => a.region).join(','));
}

console.log('\n=== the consolidation move is a card ARMY MOVE, capped at four ===');
let after;
{
  const s = play(base());
  const target = 'enedwaith';
  const recruit = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.region === target);
  check(`${target} is offered as the recruit region`, !!recruit);
  const s2 = wotrAdapter.applyAction(s, recruit, 'shadow');
  check('two Isengard Regulars arrived', units(s2, target, 'isengard') === '2R/0E', units(s2, target, 'isengard'));
  const moves = wotrAdapter.legalActions(s2, 'shadow').filter((a) => a.kind === 'eventTarget' && !a.done);
  check('both Dunlands are offered as sources', moves.length === 2 && moves.every((a) => a.from && a.to === target), JSON.stringify(moves));
  check('each is a board Army move', moves.every(isCardArmyMoveTarget));
  check('none of them is a panel button', moves.every((a) => !panelShowsAction(a, wotrAdapter.legalActions(s2, 'shadow'), s2)));
  check('each names Isengard and the four-unit budget', moves.every((a) => a.nation === 'isengard' && a.count === 4), JSON.stringify(moves.map((a) => [a.nation, a.count])));
  check('the move is DIRECT (no route to trace)', moves.every((a) => a.direct === true));

  // Take 1 Regular + 1 Elite out of North Dunland...
  const north = moves.find((a) => a.from === 'north-dunland');
  const s3 = wotrAdapter.applyAction(s2, { ...north, move: { units: { isengard: { regular: 1, elite: 1 } } } }, 'shadow');
  check('the chosen figures marched', units(s3, target, 'isengard') === '3R/1E', units(s3, target, 'isengard'));
  check('the rest of North Dunland stayed', units(s3, 'north-dunland', 'isengard') === '1R/0E', units(s3, 'north-dunland', 'isengard'));
  const left = wotrAdapter.legalActions(s3, 'shadow').filter((a) => a.kind === 'eventTarget' && !a.done);
  check('only South Dunland is left as a source', left.length === 1 && left[0].from === 'south-dunland', JSON.stringify(left.map((a) => a.from)));
  check('the budget is down to two', left[0].count === 2, String(left[0].count));

  // ...then ask South Dunland for its whole stack (3 units) — the card allows two more.
  const s4 = wotrAdapter.applyAction(s3, { ...left[0], move: { units: { isengard: { regular: 1, elite: 2 } } } }, 'shadow');
  check('only two more arrived', units(s4, target, 'isengard') === '4R/2E', units(s4, target, 'isengard'));
  check('the overflow stayed in South Dunland', units(s4, 'south-dunland', 'isengard') === '0R/1E', units(s4, 'south-dunland', 'isengard'));
  check('the card is spent', s4.cards.shadow.discard.strategy.includes('sh-str-11'));
  after = s4;
}

console.log('\n=== a bare move (no selection) takes as many as the card allows ===');
{
  const s = play(base());
  const recruit = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.region === 'enedwaith');
  const s2 = wotrAdapter.applyAction(s, recruit, 'shadow');
  const north = wotrAdapter.legalActions(s2, 'shadow').find((a) => a.kind === 'eventTarget' && a.from === 'north-dunland');
  const s3 = wotrAdapter.applyAction(s2, north, 'shadow'); // no `move`: everything it may take
  check('all three North Dunland units marched', units(s3, 'enedwaith', 'isengard') === '4R/1E', units(s3, 'enedwaith', 'isengard'));
  check('North Dunland is empty', units(s3, 'north-dunland', 'isengard') === '0R/0E', units(s3, 'north-dunland', 'isengard'));
  const left = wotrAdapter.legalActions(s3, 'shadow').filter((a) => a.kind === 'eventTarget' && !a.done);
  check('one unit of budget remains', left.length === 1 && left[0].count === 1, JSON.stringify(left.map((a) => a.count)));
  const s4 = wotrAdapter.applyAction(s3, left[0], 'shadow');
  check('and exactly one more arrived', units(s4, 'enedwaith', 'isengard') === '5R/1E', units(s4, 'enedwaith', 'isengard'));
}

console.log('\n=== figures are conserved ===');
{
  const s = base();
  const total = (st) => ['north-dunland', 'south-dunland', 'enedwaith'].reduce((n, r) => n + (st.regions[r].units.isengard?.regular ?? 0) + (st.regions[r].units.isengard?.elite ?? 0), 0)
    + st.reinforcements.isengard.regular + st.reinforcements.isengard.elite;
  check('nothing was created or lost beyond the two recruits', total(after) === total(s) + 0, `${total(s)} -> ${total(after)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
