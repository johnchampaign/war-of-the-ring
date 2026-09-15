#!/usr/bin/env vite-node
// probe-shadowfax-and-recruit-riders.mjs — two 2026-09-15 player reports.
//
// 1. "When there are other non-Hobbit Companions in the origin, Gandalf the White
//    cannot move 4 regions, when moving alone or with one Hobbit as his special
//    ability Shadowfax." (report 0s3m315p1k6m6d3u)
//    Shadowfax reads the company he keeps ON THE ROAD — the card says "if he is alone
//    or accompanied by only one Hobbit Companion" — not the Companions he leaves
//    standing in the region behind him.
//
// 2. "Kindred of Glorfindel can recruit in Rivendell" with the Stronghold besieged
//    (report 550r3w1c6s3v3b28). The besieged half of that rule was already right; what
//    actually kept the card in hand was an EMPTY Elven reinforcement pool. Almanac,
//    "Points common to all Free Peoples recruitment cards": "These cards may still be
//    played if recruitment is impossible (e.g., if the required Settlement has been
//    captured or if no units are left in reinforcements); just follow the other
//    instructions on the card in that case (such as the card draw for 'King Brand's
//    Men')."
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { characterDestinations, moveCompanionGroup } from '../src/engine/charMove.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = (seed = 11) => startGame(createGame({ seed }));

/** Put separated Companions in `region` (Gandalf the White enters play there). */
function standAt(state, region, chars) {
  for (const c of chars) {
    state.regions[region].characters.push(c);
    state.characters.inPlay[c] = region;
    if (!state.characters.entered.includes(c)) state.characters.entered.push(c);
  }
}

// --- 1. Shadowfax ------------------------------------------------------------------
{
  console.log('\n=== Shadowfax: the company on the road, not the company left behind ===');
  // Fangorn is where Gandalf the White enters play; Rohan/Anduin lie around it.
  const from = 'fangorn';
  const alone = board();
  standAt(alone, from, ['gandalf-white']);
  const soloDests = characterDestinations(alone, 'fp', 'gandalf-white', from);

  const crowded = board();
  standAt(crowded, from, ['gandalf-white', 'boromir', 'legolas']);
  const crowdedDests = characterDestinations(crowded, 'fp', 'gandalf-white', from);
  check('Gandalf rides just as far with Companions left standing in the region',
    crowdedDests.length === soloDests.length,
    `alone ${soloDests.length} regions, with company left behind ${crowdedDests.length}`);

  // Level 3 (the printed value) must reach strictly fewer regions than Shadowfax's 4,
  // or the check above proves nothing.
  const level3 = characterDestinations(crowded, 'fp', 'gandalf-white', from, { levelOverride: 3 });
  check('Shadowfax really is farther than his printed Level 3',
    soloDests.length > level3.length, `4 -> ${soloDests.length}, 3 -> ${level3.length}`);

  const withHobbit = characterDestinations(crowded, 'fp', 'gandalf-white', from, { group: ['gandalf-white', 'meriadoc'] });
  check('...and carrying ONE Hobbit keeps the four regions', withHobbit.length === soloDests.length,
    `${withHobbit.length} vs ${soloDests.length}`);

  const withBoromir = characterDestinations(crowded, 'fp', 'gandalf-white', from, { group: ['gandalf-white', 'boromir'] });
  check('but travelling WITH Boromir drops him back to Level 3', withBoromir.length === level3.length,
    `${withBoromir.length} vs ${level3.length}`);

  // The engine must refuse the four-region move for a group that isn't alone-or-Hobbit.
  const far = soloDests.find((r) => !level3.includes(r));
  check('a four-region destination exists to test against', !!far, String(far));
  if (far) {
    const a = board(); standAt(a, from, ['gandalf-white', 'boromir', 'legolas']);
    check('Gandalf alone may go there', moveCompanionGroup(a, 'fp', from, far, ['gandalf-white']));
    const b = board(); standAt(b, from, ['gandalf-white', 'boromir', 'legolas']);
    check('Gandalf + Boromir may NOT', !moveCompanionGroup(b, 'fp', from, far, ['gandalf-white', 'boromir']));
    const c = board(); standAt(c, from, ['gandalf-white', 'meriadoc']);
    check('Gandalf + one Hobbit may', moveCompanionGroup(c, 'fp', from, far, ['gandalf-white', 'meriadoc']));
  }
}

// --- 2. Kindred of Glorfindel over a besieged Rivendell -----------------------------
{
  console.log('\n=== recruitment cards with nothing to recruit still follow their other text ===');
  // The reporter's board: the Shadow has captured Rivendell, its Sauron garrison is
  // boxed, and a Free Peoples Army besieges it in the open field.
  const besieged = (state) => {
    const r = state.regions['rivendell'];
    r.control = 'shadow';
    r.besieged = true;
    r.units = { north: { regular: 3, elite: 1 }, elves: { regular: 0, elite: 3 } };
    r.leaders = 2; r.nazgul = 0; r.characters = [];
    r.siegeBox = { units: { sauron: { regular: 4, elite: 1 } }, leaders: 0, nazgul: 0, characters: [] };
    return state;
  };

  const stocked = besieged(board());
  stocked.reinforcements.elves = { regular: 2, elite: 2, leader: 1 };
  check('with Elves in reinforcements the besieged region recruits (p.10/p.33)',
    canPlayCard(stocked, 'fp-str-21', 'fp'));
  const slot = getHandler('fp-str-21').targets(stocked, 'fp', []);
  check('and Rivendell is the offered target', slot.length === 2 && slot.every((t) => t.region === 'rivendell'),
    JSON.stringify(slot));

  const empty = besieged(board());
  empty.reinforcements.elves = { regular: 0, elite: 0, leader: 0 };
  check('with the Elven pool empty the card is STILL playable for its draw',
    canPlayCard(empty, 'fp-str-21', 'fp'));
  const h = getHandler('fp-str-21');
  check('but there is no recruit to choose', (h.targets(empty, 'fp', []) ?? []).length === 0);
  const hand0 = empty.cards.fp.hand.length;
  h.finalize(empty, 'fp', []);          // playEvent's no-target path
  check('and the Strategy card is drawn', empty.cards.fp.hand.length === hand0 + 1,
    `${hand0} -> ${empty.cards.fp.hand.length}`);
  check('nothing was recruited into the besieged region',
    (empty.regions['rivendell'].units.elves?.elite ?? 0) === 3);

  // King Brand's Men is the Almanac's own worked example.
  const dale = board();
  dale.regions['dale'].control = 'shadow';
  dale.regions['dale'].units = {};
  check("King Brand's Men is playable with Dale captured", canPlayCard(dale, 'fp-str-19', 'fp'));
  const before = dale.cards.fp.hand.length;
  getHandler('fp-str-19').apply(dale, 'fp');
  check('...drawing its card', dale.cards.fp.hand.length === before + 1, `${before} -> ${dale.cards.fp.hand.length}`);
  check('...and recruiting nobody into the captured Settlement',
    (dale.regions['dale'].units.north?.regular ?? 0) === 0);

  // A Leader is not smuggled into a captured Settlement either.
  const amroth = board();
  amroth.regions['dol-amroth'].control = 'shadow';
  amroth.regions['dol-amroth'].units = {};
  const leaders0 = amroth.reinforcements.gondor.leader;
  getHandler('fp-str-18').finalize(amroth, 'fp', []);   // Imrahil of Dol Amroth
  check('Imrahil places no Leader in a captured Dol Amroth',
    amroth.reinforcements.gondor.leader === leaders0 && amroth.regions['dol-amroth'].leaders === 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
