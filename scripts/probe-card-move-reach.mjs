#!/usr/bin/env vite-node
// probe-card-move-reach.mjs — a card move that states a RANGE must have a legal ROUTE,
// and a card move that states none must not invent one.
//
//   Shadows Gather / The Shadow Lengthens: "the traversed regions must be free for the
//   purposes of Army movement."   Through a Day and a Night: "the regions must be free
//   for the purposes of Army movement."
//
// The enumerators measured a plain region-step DISTANCE over the bare map instead, so
// they offered moves whose route did not exist — Helm's Deep, whose only exits are the
// Fords of Isen and Westemnet, was listed as an origin for a hop to Orthanc while a
// Rohan Army held the Fords (player report 4e6f6u1a5y3q381q), and a Free Peoples Army
// walked Lórien → Moria straight through the Shadow units in Dimrill Dale (player
// report y1hvvsejg6wgibm0).
//
// The other half: Paths of the Woses moves an Army "directly to Minas Tirith" and
// Rage of the Dunlendings recruits "in a FREE region" — no route for the first, and no
// besieged Stronghold for the second (player reports 1u1f45154m472g67, 1q2j5e5y0c2l5q4q).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A bare board: every region emptied, so a card's own enumeration is all that shows. */
const bareBoard = (seed, side, card) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = side; s.pendingChoice = null;
  s.dice[side] = ['event']; s.dice[side === 'fp' ? 'shadow' : 'fp'] = [];
  for (const r of Object.values(s.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; r.besieged = false; delete r.siegeBox;
  }
  for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
  s.cards[side].hand = [card];
  return s;
};
const playCard = (s, side, card) => {
  const play = wotrAdapter.legalActions(s, side).find((a) => a.kind === 'playEvent' && a.cardId === card);
  return play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, side) : null;
};
const moveOffered = (s, side, from, to) =>
  wotrAdapter.legalActions(s, side).some((a) => a.kind === 'eventTarget' && a.from === from && a.to === to);

console.log('\n=== Shadows Gather: a walled-in Army is not an origin ===');
{
  // The reporter's board: the Shadow holds Helm's Deep, Saruman's Army sits in Orthanc,
  // and a Rohan Army blocks the Fords of Isen — the one region both routes must cross.
  const build = (blockTheFords) => {
    const s = bareBoard(131, 'shadow', 'sh-str-07');
    s.regions['helms-deep'].units = { sauron: { regular: 5, elite: 0 } };
    s.regions['orthanc'].units = { isengard: { regular: 3, elite: 5 } };
    if (blockTheFords) s.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
    // A reachable pair far away in Mordor, so the card stays PLAYABLE either way and
    // "not offered" is a statement about Helm's Deep rather than about the whole card.
    s.regions['nurn'].units = { sauron: { regular: 2, elite: 0 } };
    s.regions['gorgoroth'].units = { sauron: { regular: 2, elite: 0 } };
    return playCard(s, 'shadow', 'sh-str-07');
  };
  const blocked = build(true);
  check('Shadows Gather is playable and asks for a move', !!blocked && blocked.pendingChoice?.kind === 'eventTarget', blocked?.pendingChoice?.kind ?? 'not playable');
  if (blocked) {
    check('Helm\'s Deep → Orthanc is NOT offered while the Fords are held', !moveOffered(blocked, 'shadow', 'helms-deep', 'orthanc'));
    check('...and neither is the trip the other way', !moveOffered(blocked, 'shadow', 'orthanc', 'helms-deep'));
    check('...while a pair with a clear road between them still is', moveOffered(blocked, 'shadow', 'nurn', 'gorgoroth'));
  }
  const open = build(false);
  check('with the Fords clear, Helm\'s Deep → Orthanc IS offered', !!open && moveOffered(open, 'shadow', 'helms-deep', 'orthanc'));
  check('...and so is the trip the other way', !!open && moveOffered(open, 'shadow', 'orthanc', 'helms-deep'));
}

console.log('\n=== Through a Day and a Night: no walking through an Army ===');
{
  const build = (blockDimrill) => {
    const s = bareBoard(77, 'fp', 'fp-str-12');
    s.regions['lorien'].units = { elves: { regular: 2, elite: 1 } };
    s.regions['lorien'].characters = ['strider'];
    s.characters.inPlay = { ...(s.characters.inPlay ?? {}), strider: 'lorien' };
    if (blockDimrill) s.regions['dimrill-dale'].units = { sauron: { regular: 3, elite: 0 } };
    return playCard(s, 'fp', 'fp-str-12');
  };
  const blocked = build(true);
  check('the card is playable and asks for a move', !!blocked && blocked.pendingChoice?.kind === 'eventTarget', blocked?.pendingChoice?.kind ?? 'not playable');
  if (blocked) {
    check('Lórien → Moria is NOT offered with a Shadow Army in Dimrill Dale', !moveOffered(blocked, 'fp', 'lorien', 'moria'));
    // …and the engine refuses it even if a client asks for it by hand.
    let err = null;
    try {
      wotrAdapter.applyAction(blocked, { kind: 'eventTarget', card: 'fp-str-12', from: 'lorien', to: 'moria' }, 'fp');
    } catch (e) { err = e.message; }
    check('...and a hand-built action for it is refused', !!err, err ?? 'ACCEPTED');
  }
  const open = build(false);
  check('with Dimrill Dale clear, Lórien → Moria IS offered', !!open && moveOffered(open, 'fp', 'lorien', 'moria'));
}

console.log('\n=== Paths of the Woses moves DIRECTLY — no route to trace ===');
{
  const s = bareBoard(311, 'fp', 'fp-str-11');
  s.regions['edoras'].units = { rohan: { regular: 3, elite: 1 } };
  s.regions['minas-tirith'].units = { gondor: { regular: 1, elite: 0 } };
  const played = playCard(s, 'fp', 'fp-str-11');
  check('the card is playable', !!played && played.pendingChoice?.kind === 'eventTarget', played?.pendingChoice?.kind ?? 'not playable');
  if (played) {
    const leg = wotrAdapter.legalActions(played, 'fp').find((a) => a.kind === 'eventTarget' && a.from === 'edoras' && a.to === 'minas-tirith');
    check('Edoras → Minas Tirith is offered', !!leg);
    check('...and it is marked DIRECT, so the map asks for no path', !!leg?.direct, JSON.stringify(leg ?? null));
    if (leg) {
      const after = wotrAdapter.applyAction(played, leg, 'fp');
      check('...the Army arrives', (after.regions['minas-tirith'].units.rohan?.regular ?? 0) === 3);
      check('...and Edoras is left empty behind it', (after.regions['edoras'].units.rohan?.regular ?? 0) === 0);
    }
  }
}

console.log('\n=== Rage of the Dunlendings recruits in a FREE region only ===');
{
  const build = (besiegeMoria) => {
    const s = bareBoard(909, 'shadow', 'sh-str-11');
    s.regions['south-dunland'].units = { isengard: { regular: 2, elite: 0 } };
    if (besiegeMoria) {
      // A Free Peoples Army camped in Moria's open field, the Isengard garrison boxed.
      s.regions['moria'].units = { elves: { regular: 1, elite: 2 } };
      s.regions['moria'].besieged = true;
      s.regions['moria'].siegeBox = { units: { isengard: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
    }
    return playCard(s, 'shadow', 'sh-str-11');
  };
  const besieged = build(true);
  check('the card is playable', !!besieged && besieged.pendingChoice?.kind === 'eventTarget', besieged?.pendingChoice?.kind ?? 'not playable');
  if (besieged) {
    const moria = wotrAdapter.legalActions(besieged, 'shadow').some((a) => a.kind === 'eventTarget' && a.region === 'moria');
    check('a besieged Moria is NOT a free region for the Shadow', !moria);
  }
  const free = build(false);
  check('an unbesieged Moria IS offered', !!free && wotrAdapter.legalActions(free, 'shadow').some((a) => a.kind === 'eventTarget' && a.region === 'moria'));
}

console.log('\n=== a ranged card move is offered only where the WHOLE Army may go ===');
{
  // The soak's 2026-09-20 board: an FP stack at Trollshaws holding units of a Nation
  // that is At War AND of one that is not, with North Dunland (Isengard's) two regions
  // away. The not-At-War half cannot cross into another Nation's borders, and the card
  // is submitted as a whole-Army move — so the destination must not be offered at all,
  // or the engine refuses a move it had just offered.
  const build = (northAtWar, elvesAtWar) => {
    const s = bareBoard(131, 'fp', 'fp-str-12');
    for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 3; }
    s.nations.north.step = northAtWar ? 0 : 3;
    s.nations.elves.step = elvesAtWar ? 0 : 3;
    s.regions['trollshaws'].units = { north: { regular: 2, elite: 0 }, elves: { regular: 1, elite: 0 } };
    s.regions['trollshaws'].characters = ['strider'];
    s.characters.inPlay['strider'] = 'trollshaws';
    s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'strider');
    return playCard(s, 'fp', 'fp-str-12');
  };
  const mixed = build(true, false);   // the North may cross into Isengard, the Elves may not
  check('the card is playable', !!mixed && mixed.pendingChoice?.kind === 'eventTarget', mixed?.pendingChoice?.kind ?? 'not playable');
  check('North Dunland is NOT offered while part of the stack is barred',
    !moveOffered(mixed, 'fp', 'trollshaws', 'north-dunland'));
  // ...and every ranged move it DOES offer really is applicable as submitted.
  for (const a of wotrAdapter.legalActions(mixed, 'fp')) {
    if (a.kind !== 'eventTarget' || !a.from || !a.to) continue;
    const res = wotrAdapter.tryApplyAction(mixed, a, 'fp');
    if (!res.ok) { check(`offered ${a.from}→${a.to} is applicable`, false, res.reason); break; }
  }
  check('every offered whole-Army move is applicable', true);

  const both = build(true, true);     // both Nations At War: the trip is on again
  check('with the whole stack At War, North Dunland IS offered',
    moveOffered(both, 'fp', 'trollshaws', 'north-dunland'));
}

console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
