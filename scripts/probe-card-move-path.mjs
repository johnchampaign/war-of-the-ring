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
  bad(['dale', 'dale', 'northern-rhovanion'], 'a route through a region twice over is rejected (Dale is not adjacent to itself)');
  // What bounds a route is the CARD'S REACH, not a no-revisits rule: "move one Army up
  // to three regions" means at most three steps, however they are walked.
  bad(['dale', 'old-forest-road', 'dale', 'northern-rhovanion'], 'a FOUR-region route is rejected — this card moves up to three');
  bad(['dale'], 'a route that stops somewhere else is rejected');
}

// A route may WALK BACK through a region it has already entered. Only ENDING where it
// started is barred (Almanac, "Shadows Gather": "An Army cannot end movement in the
// region that it started from"), and the engine never offers that destination anyway.
// The UI used to bar revisits outright, so legal detours could not be traced at all
// (player report 306c5v2g003c6332).
console.log('\n=== a route may walk back through a region it came from ===');
{
  const s = startGame(createGame({ seed: 131 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  s.regions['dale'].units = { sauron: { regular: 4, elite: 0 } };            // the movers
  s.regions['old-forest-road'].units = { sauron: { regular: 1, elite: 0 } }; // the friendly Army it must end with
  s.regions['woodland-realm'].units = {};
  s.regions['woodland-realm'].besieged = false; delete s.regions['woodland-realm'].siegeBox;
  s.cards.shadow.hand = ['sh-str-07'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-07');
  const s1 = play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'shadow') : null;
  const move = s1 && wotrAdapter.legalActions(s1, 'shadow').find((a) => a.kind === 'eventTarget' && a.from === 'dale' && a.to === 'old-forest-road');
  check('the move is offered', !!move, JSON.stringify(move ?? null));
  if (move) {
    let err = null, out = null;
    try { out = wotrAdapter.applyAction(s1, { ...move, path: ['woodland-realm', 'dale', 'old-forest-road'] }, 'shadow'); } catch (e) { err = e.message; }
    check('Dale → Woodland Realm → back through Dale → Old Forest Road is accepted', !err, err ?? '');
    if (out) check('...and the Army arrives', (out.regions['old-forest-road'].units.sauron?.regular ?? 0) === 5, String(out.regions['old-forest-road'].units.sauron?.regular ?? 0));
  }
}
// Stacking is NOT a gate on what the card offers. p.28: "If an Army moves through
// regions containing other friendly Armies, stacking limits are checked only after all
// the multiple movements have been completed." The old pre-filter (from + to <= 10)
// hid a full 10-unit Army as BOTH a source and a destination, so two big Armies
// vanished from the card entirely (player report 57650y0x71235d5f).
console.log('\n=== a full Army is still offered — over-stacking is resolved afterwards ===');
{
  const s = startGame(createGame({ seed: 131 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  s.regions['dale'].units = { sauron: { regular: 10, elite: 0 } };           // at the limit
  s.regions['old-forest-road'].units = { sauron: { regular: 10, elite: 0 } }; // and so is the partner
  s.cards.shadow.hand = ['sh-str-07'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-07');
  const s1 = play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'shadow') : null;
  const move = s1 && wotrAdapter.legalActions(s1, 'shadow').find((a) => a.kind === 'eventTarget' && a.from === 'dale' && a.to === 'old-forest-road');
  check('a 10-unit Army may still move onto another 10-unit Army', !!move, JSON.stringify(move ?? null));
  if (move) {
    const out = wotrAdapter.applyAction(s1, move, 'shadow');
    check('the merged stack raises the remove-excess prompt', out.pendingChoice?.kind === 'removeExcess', out.pendingChoice?.kind ?? 'none');
    check('...pointed at the over-stacked region', out.pendingChoice?.data?.region === 'old-forest-road', String(out.pendingChoice?.data?.region));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
