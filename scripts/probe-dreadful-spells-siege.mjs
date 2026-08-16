#!/usr/bin/env vite-node
// probe-dreadful-spells-siege.mjs — the 2026-08-15 player report:
//
//   "Minas Tirith under siege by (9r,1e,3n & WK). Wanted to use [E] to play
//    Dreadful Spells, but it won't let me."
//
// A besieged Army is still IN its region (p.31) — only its units sit in the
// Stronghold Box — so a Gondor garrison boxed in Minas Tirith is "a Free Peoples
// Army in the same region" for the card's precondition, and the Almanac spells the
// case out ("Dreadful Spells" C 19): the Nazgûl need not even be the besiegers, the
// card is not an "attack", and if it wipes the garrison the besieger takes the
// Stronghold immediately while the Companions inside walk out unharmed.
//
// Checks: the card is offered; the Shadow player CHOOSES which Army to strike (it
// used to fire at whichever qualifying Army came first in region order); the hits
// land in the siege box and never on the besieger's own troops; and the fall of the
// Stronghold is booked correctly.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { unitCount, forceUnitCount, settlementController } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The reported board: Minas Tirith besieged by 9 Regulars, 1 Elite, 3 Nazgûl and
 *  the Witch-king, with `garrison` Gondor Regulars and Boromir in the Stronghold. */
function siegeBoard({ seed = 11, garrison = 1 } = {}) {
  const state = startGame(createGame({ seed }));
  const r = state.regions['minas-tirith'];
  r.units = { sauron: { regular: 9, elite: 1 } };
  r.leaders = 0;
  r.nazgul = 3;
  r.characters = ['witch-king'];
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: garrison, elite: 0 } }, leaders: 0, nazgul: 0, characters: ['boromir'] };
  state.characters.inPlay['witch-king'] = 'minas-tirith';
  state.characters.inPlay['boromir'] = 'minas-tirith';
  if (!state.characters.entered.includes('witch-king')) state.characters.entered.push('witch-king');
  return state;
}

// --- 1. the card is playable at all -------------------------------------------------
{
  console.log('\n=== Dreadful Spells sees the garrison boxed in Minas Tirith ===');
  const state = siegeBoard();
  check('canPlay is true with the only FP Army in the region under siege', canPlayCard(state, 'sh-char-19', 'shadow'));
  const targets = getHandler('sh-char-19').targets(state, 'shadow');
  check('Minas Tirith is offered as a target', targets.some((t) => t.region === 'minas-tirith'), JSON.stringify(targets));
}

// --- 2. the Shadow player picks the victim ------------------------------------------
{
  console.log('\n=== the target Army is a choice, not region order ===');
  const state = siegeBoard();
  // A second qualifying Army far away: 1 Nazgûl in Dimrill Dale beside the Lórien Elves.
  state.regions['dimrill-dale'].units = { sauron: { regular: 2, elite: 0 } };
  state.regions['dimrill-dale'].nazgul = 1;
  const targets = getHandler('sh-char-19').targets(state, 'shadow');
  // Osgiliath's Gondor garrison sits beside the besiegers, so it qualifies too.
  check('every candidate Army is offered', ['minas-tirith', 'lorien', 'osgiliath'].every((r) => targets.some((t) => t.region === r)), JSON.stringify(targets));
  check('each Army is offered once', new Set(targets.map((t) => t.region)).size === targets.length);
}

// --- 3. the hits land in the siege box, never on the besieger ------------------------
{
  console.log('\n=== hits fall on the garrison, not on the besieging Army ===');
  // A fat garrison so it survives however the 3 dice land, and the box is the only
  // thing that can change.
  const state = siegeBoard({ garrison: 5 });
  const shadowBefore = unitCount(state, 'minas-tirith');
  const sauronPoolBefore = state.reinforcements.sauron.regular;
  getHandler('sh-char-19').applyTarget(state, 'shadow', { region: 'minas-tirith' });
  // A meaningful Regulars-vs-Elites split would prompt; an all-Regular garrison never does.
  check('no stray casualty prompt for an all-Regular garrison', !state.pendingChoice, JSON.stringify(state.pendingChoice));
  check('the besieging Shadow Army is untouched', unitCount(state, 'minas-tirith') === shadowBefore, `${shadowBefore} → ${unitCount(state, 'minas-tirith')}`);
  check('no Shadow units leaked back to reinforcements', state.reinforcements.sauron.regular === sauronPoolBefore);
  const left = forceUnitCount(state.regions['minas-tirith'].siegeBox);
  check('the garrison took the hits', left < 5, `garrison 5 → ${left}`);
  check('the siege is still on', state.regions['minas-tirith'].besieged === true);
  check('Boromir is back in the Stronghold', state.regions['minas-tirith'].siegeBox.characters.includes('boromir'));
}

// --- 4. wiping the garrison takes the Stronghold, and spares the Companions ----------
{
  console.log('\n=== a wiped garrison loses the Stronghold but not its Companions ===');
  // Find a seed whose 3 Nazgûl dice score at least one hit on the lone Regular.
  let state = null;
  for (let seed = 1; seed < 200 && !state; seed++) {
    const s = siegeBoard({ seed, garrison: 1 });
    getHandler('sh-char-19').applyTarget(s, 'shadow', { region: 'minas-tirith' });
    if (!s.regions['minas-tirith'].siegeBox) state = s;
  }
  check('a wiping roll was found', !!state);
  if (state) {
    const r = state.regions['minas-tirith'];
    check('the siege box is gone and the siege is over', !r.siegeBox && r.besieged === false);
    check('the Shadow controls Minas Tirith', settlementController(state, 'minas-tirith') === 'shadow', String(r.control));
    check('the Shadow scored the Stronghold VP', state.victoryPoints.shadow >= 2, String(state.victoryPoints.shadow));
    check('Boromir survives — the card is not an "attack"', !state.characters.eliminated.includes('boromir'));
    check('Boromir now stands in the region', r.characters.includes('boromir') && state.characters.inPlay['boromir'] === 'minas-tirith', JSON.stringify(r.characters));
    check('the besieging Army is still all there', unitCount(state, 'minas-tirith') === 10, String(unitCount(state, 'minas-tirith')));
  }
}

// --- 5. the open-field case still works ---------------------------------------------
{
  console.log('\n=== an unbesieged Army beside Nazgûl is unaffected by the fix ===');
  const state = startGame(createGame({ seed: 5 }));
  state.regions['dimrill-dale'].units = { sauron: { regular: 2, elite: 0 } };
  state.regions['dimrill-dale'].nazgul = 2;
  check('canPlay is true (Lórien is adjacent to Dimrill Dale)', canPlayCard(state, 'sh-char-19', 'shadow'));
  const before = unitCount(state, 'lorien');
  getHandler('sh-char-19').applyTarget(state, 'shadow', { region: 'lorien' });
  const hit = unitCount(state, 'lorien') < before || !!state.pendingChoice;
  check('Lórien is the one that suffers', hit || before === unitCount(state, 'lorien'), `${before} → ${unitCount(state, 'lorien')}${state.pendingChoice ? ' (+ pending choice)' : ''}`);
  check('the Nazgûl force is untouched', unitCount(state, 'dimrill-dale') === 2);
}

console.log(failures === 0 ? '\nAll Dreadful Spells siege checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
