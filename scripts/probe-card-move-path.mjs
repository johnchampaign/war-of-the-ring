#!/usr/bin/env vite-node
// probe-card-move-path.mjs — a multi-region card move TRAVERSES its route. Entering an
// enemy Settlement free of enemy units captures it and wakes its Nation (p.27, p.32),
// so the route is a decision: through Dale takes Dale and rouses the North, round by
// the Old Forest Road does neither (player report 384n5a5y63480b3g). The move used to
// jump straight from origin to destination and nothing en route ever happened.
//
// With no route traced, the QUIET way round is taken — nobody's Nation is woken by a
// choice nobody made.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { settlementController } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// Shadows Gather: move one Shadow Army up to three regions, ending with another
// Shadow Army. Woodland Realm → Northern Rhovanion is the reporter's own example:
// through Dale (an FP Settlement) or round through the Old Forest Road.
const setup = () => {
  const s = startGame(createGame({ seed: 131 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.sauron.active = true; s.nations.sauron.step = 0;      // the movers must be At War
  s.nations.north.active = true; s.nations.north.step = 2;        // awake but NOT At War, so a capture can rouse it
  s.regions['woodland-realm'].units = { sauron: { regular: 5, elite: 1 } };
  s.regions['woodland-realm'].besieged = false; delete s.regions['woodland-realm'].siegeBox;
  s.regions['northern-rhovanion'].units = { sauron: { regular: 2, elite: 0 } }; // the required friendly Army
  s.regions['dale'].units = {};                                                 // FP Settlement, no defenders
  s.cards.shadow.hand = ['sh-str-07'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-07');
  return play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'shadow') : null;
};
const northStep = (s) => s.nations.north.step;

console.log('\n=== the reporter\'s example: two routes, two different outcomes ===');
const s0 = setup();
check('Shadows Gather is playable and asks for a move', !!s0 && s0.pendingChoice?.kind === 'eventTarget', s0?.pendingChoice?.kind ?? 'not playable');
if (s0) {
  const move = wotrAdapter.legalActions(s0, 'shadow').find((a) => a.kind === 'eventTarget' && a.from === 'woodland-realm' && a.to === 'northern-rhovanion');
  check('the move is offered', !!move, JSON.stringify(move ?? null));
  if (move) {
    const daleBefore = settlementController(s0, 'dale'), northBefore = northStep(s0);
    check('Dale starts Free Peoples, the North asleep', daleBefore !== 'shadow', `${daleBefore}, north step ${northBefore}`);

    const through = wotrAdapter.applyAction(s0, { ...move, path: ['dale', 'northern-rhovanion'] }, 'shadow');
    check('routed THROUGH Dale: Dale is captured in passing', settlementController(through, 'dale') === 'shadow');
    check('...the North is roused by it', northStep(through) !== northBefore, `north step ${northBefore} → ${northStep(through)}`);
    check('...and the Army still ends where it was going', (through.regions['northern-rhovanion'].units.sauron?.regular ?? 0) > 2);

    const around = wotrAdapter.applyAction(s0, { ...move, path: ['old-forest-road', 'northern-rhovanion'] }, 'shadow');
    check('routed AROUND: Dale is untouched', settlementController(around, 'dale') === daleBefore, String(settlementController(around, 'dale')));
    check('...the North sleeps on', northStep(around) === northBefore);
    check('...and the Army still arrives', (around.regions['northern-rhovanion'].units.sauron?.regular ?? 0) > 2);

    const quiet = wotrAdapter.applyAction(s0, move, 'shadow');
    check('with NO route traced, the quiet way is taken (Dale untouched)', settlementController(quiet, 'dale') === daleBefore && northStep(quiet) === northBefore);
  }
}

console.log('\n=== an illegal route is refused, not straightened ===');
if (s0) {
  const move = wotrAdapter.legalActions(s0, 'shadow').find((a) => a.kind === 'eventTarget' && a.from === 'woodland-realm' && a.to === 'northern-rhovanion');
  const bad = (path, label) => {
    let err = null;
    try { wotrAdapter.applyAction(s0, { ...move, path }, 'shadow'); } catch (e) { err = e.message; }
    check(label, !!err, err ?? 'ACCEPTED');
  };
  bad(['minas-tirith'], 'a jump to a far region is rejected');
  bad(['dale', 'dale', 'northern-rhovanion'], 'a route that doubles back is rejected');
  bad(['dale'], 'a route that stops somewhere else is rejected');
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
