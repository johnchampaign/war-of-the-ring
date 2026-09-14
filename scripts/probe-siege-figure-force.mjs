#!/usr/bin/env vite-node
// probe-siege-figure-force.mjs — the 2026-09-14 siege-abstraction report batch.
//
// The reporter's framing (report 6o1e706u73203z1y): "figures inside a Stronghold
// under siege are in fact in the region containing the Stronghold for all observable
// purposes. The distinction of figures being inside or outside the Stronghold does not
// necessarily make so much sense, except for … visually displaying those figures."
//
// Our siege model keeps the GARRISON in `region.siegeBox` and the BESIEGER in the
// region's open field. Every site that reached past that split straight to
// `region.characters` / `region.nazgul` got the wrong force, which produced:
//   2t3k515i0j1f475j  Gwaihir / We Prove the Swifter drop Companions in with the
//                     besieging Shadow Army instead of the friendly garrison.
//   430p4i131f0v4o3n  Saruman mustered into a besieged friendly Orthanc "joined the
//                     Free Peoples Army".
//   0u1d480y5f594l6k  Characters could not enter play in a friendly besieged Stronghold
//                     (the Witch-king's "Shadow Army with a Sauron unit" read the field).
//   320f5f051w3n6p46  Nazgûl could not move OUT of a friendly besieged Stronghold —
//                     legal: p.25 makes the FP-Stronghold rule "the only restriction"
//                     on Nazgûl flight.
//   4x6i0i2x0g2c1r3k  A Nazgûl flying INTO a besieged friendly Orthanc did not join the
//                     boxed Army.
//   222n111y4x3p4u3j  Companions separating inside a friendly besieged Stronghold must
//                     join the garrison.
//   6b4j264z0p651015  Boxed Companions vanished from every move menu.
//
// `figureForce(state, region, side)` is now the one seal. Making boxed figures visible
// also means the p.24/p.25 "can never LEAVE a region containing a friendly Stronghold
// besieged by an enemy Army" half needs stating outright (`canLeave`) — it used to come
// free from the figures being invisible.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { figureForce, armyForceOf } from '../src/engine/armies.ts';
import { characterDestinations, moveCharacter, moveCompanionGroup, availableNazgul, movableCharsAt } from '../src/engine/charMove.ts';
import { entryRegions, bringMinion } from '../src/engine/minions.ts';
import { placeSeparatedCompanion, gandalfWhiteCandidates, bringUpgrade } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Orthanc: a SHADOW Stronghold besieged by a Free Peoples Army. The Isengard garrison
 *  (and whatever figures it holds) sits in the box; the FP besieger holds the field. */
function shadowBesieged({ nazgul = 0, chars = [] } = {}) {
  const state = startGame(createGame({ seed: 11 }));
  const r = state.regions['orthanc'];
  r.units = { rohan: { regular: 4, elite: 1 } };   // the FP besieger, in the open field
  r.leaders = 1; r.nazgul = 0; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: { isengard: { regular: 3, elite: 1 }, sauron: { regular: 1, elite: 0 } },
                 leaders: 0, nazgul, characters: [...chars] };
  // Minion entry has political preconditions of its own (Isengard / Sauron at War,
  // and for the Witch-king at least one FP Nation at War) — this probe is about WHERE
  // the figure lands, so clear them out of the way.
  for (const n of ['isengard', 'sauron', 'gondor', 'rohan']) state.nations[n].step = 0;
  return state;
}

/** Minas Tirith: a FREE PEOPLES Stronghold besieged by a Shadow Army. */
function fpBesieged({ chars = [] } = {}) {
  const state = startGame(createGame({ seed: 12 }));
  const r = state.regions['minas-tirith'];
  r.units = { sauron: { regular: 6, elite: 2 } };  // the Shadow besieger, in the field
  r.leaders = 0; r.nazgul = 1; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: 3, elite: 1 } }, leaders: 1, nazgul: 0, characters: [...chars] };
  return state;
}

{
  console.log('\n=== figureForce picks the side a figure actually stands with ===');
  const state = shadowBesieged();
  const r = state.regions['orthanc'];
  check('Shadow (the garrison) resolves to the siege box', figureForce(state, 'orthanc', 'shadow') === r.siegeBox);
  check('Free Peoples (the besieger) resolves to the open field', figureForce(state, 'orthanc', 'fp') === r);
  const fp = fpBesieged();
  const fr = fp.regions['minas-tirith'];
  check('and the mirror: FP garrison → box', figureForce(fp, 'minas-tirith', 'fp') === fr.siegeBox);
  check('                 Shadow besieger → field', figureForce(fp, 'minas-tirith', 'shadow') === fr);

  // A box emptied of units but still holding a Character must stay the garrison's side:
  // the Stronghold's controller decides when the units cannot.
  const lone = shadowBesieged({ chars: ['saruman'] });
  lone.regions['orthanc'].siegeBox.units = {};
  check('a unit-less box still belongs to the Stronghold holder', figureForce(lone, 'orthanc', 'shadow') === lone.regions['orthanc'].siegeBox);
  check('an unbesieged region is always its own field', figureForce(lone, 'fangorn', 'fp') === lone.regions['fangorn']);
}

{
  console.log('\n=== 320f5f051w3n6p46: a Nazgûl flies OUT of a friendly besieged Stronghold ===');
  const state = shadowBesieged({ nazgul: 2 });
  check('boxed Nazgûl are counted as available', availableNazgul(state, 'orthanc') === 2,
    `got ${availableNazgul(state, 'orthanc')}`);
  const dests = characterDestinations(state, 'shadow', 'nazgul', 'orthanc');
  check('destinations are offered', dests.length > 0, `${dests.length} regions`);
  check('moving out succeeds', moveCharacter(state, 'shadow', 'nazgul', 'orthanc', 'fangorn', 1));
  check('one Nazgûl left the BOX, not the field', state.regions['orthanc'].siegeBox.nazgul === 1 && state.regions['orthanc'].nazgul === 0,
    `box=${state.regions['orthanc'].siegeBox.nazgul} field=${state.regions['orthanc'].nazgul}`);
  check('and arrived in Fangorn', state.regions['fangorn'].nazgul === 1);
}

{
  console.log('\n=== 4x6i0i2x0g2c1r3k: a Nazgûl flying IN joins the garrison, not the besieger ===');
  const state = shadowBesieged();
  state.regions['moria'].nazgul = 1;
  check('the flight is legal', moveCharacter(state, 'shadow', 'nazgul', 'moria', 'orthanc', 1));
  check('it landed in the siege box', state.regions['orthanc'].siegeBox.nazgul === 1,
    `box=${state.regions['orthanc'].siegeBox.nazgul}`);
  check('NOT in the open field with the FP besieger', state.regions['orthanc'].nazgul === 0,
    `field=${state.regions['orthanc'].nazgul}`);
}

{
  console.log('\n=== 430p4i131f0v4o3n / 0u1d480y5f594l6k: Minions enter play with the garrison ===');
  const state = shadowBesieged();
  check('Saruman may still enter a besieged friendly Orthanc', entryRegions(state, 'saruman').includes('orthanc'));
  check('bringMinion succeeds', bringMinion(state, 'saruman', 'orthanc'));
  check('Saruman is INSIDE, with his own troops', state.regions['orthanc'].siegeBox.characters.includes('saruman'));
  check('he did not join the Free Peoples Army', !state.regions['orthanc'].characters.includes('saruman'));

  // The Witch-king's condition is "a region with a Shadow Army including a Sauron unit".
  // The boxed garrison has one; the open field is the FP besieger's.
  const wk = shadowBesieged();
  check('armyForceOf sees the boxed Shadow Army', !!armyForceOf(wk, 'orthanc', 'shadow'));
  check('the Witch-king may enter the besieged Orthanc', entryRegions(wk, 'witch-king').includes('orthanc'));
  check('bringMinion places him in the box', bringMinion(wk, 'witch-king', 'orthanc') && wk.regions['orthanc'].siegeBox.characters.includes('witch-king'));
}

{
  console.log('\n=== 0u1d480y5f594l6k: Gandalf the White enters a BESIEGED Elven Stronghold ===');
  // Card text: "place Gandalf the White in Fangorn or in an UNCONQUERED Elven
  // Stronghold" — unconquered, not "free of enemy units". A besieged Lorien is still
  // unconquered, and the region's open field holds the Shadow besieger, so the old
  // no-Shadow-army test fired on exactly the case the card allows.
  const state = startGame(createGame({ seed: 21 }));
  const r = state.regions['lorien'];
  r.units = { sauron: { regular: 5, elite: 1 } };   // the Shadow besieger, in the field
  r.leaders = 0; r.nazgul = 0; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: { elves: { regular: 2, elite: 1 } }, leaders: 1, nazgul: 0, characters: [] };
  // Gandalf the Grey is gone and a Minion is in play — the card's preconditions.
  state.fellowship.companions = state.fellowship.companions.filter((c) => c !== 'gandalf-grey');
  state.characters.eliminated.push('gandalf-grey');
  state.characters.entered.push('saruman');
  check('besieged Lorien is still an offered destination', gandalfWhiteCandidates(state).includes('lorien'));
  check('a CONQUERED Elven Stronghold is not', (() => {
    const conq = { ...state, regions: { ...state.regions } };
    state.regions['grey-havens'].control = 'shadow';
    return !gandalfWhiteCandidates(state).includes('grey-havens') && !!conq;
  })());
  check('he arrives INSIDE, with the Elven garrison', bringUpgrade(state, 'gandalf-white', 'lorien')
    && state.regions['lorien'].siegeBox.characters.includes('gandalf-white'));
  check('not in the field with the besiegers', !state.regions['lorien'].characters.includes('gandalf-white'));
}

{
  console.log('\n=== 2t3k515i0j1f475j: Gwaihir / We Prove the Swifter land inside the walls ===');
  // Minas Tirith is besieged; Boromir stands outside in Lossarnach and flies in.
  const state = fpBesieged();
  state.regions['lossarnach'].characters = ['boromir'];
  state.characters.inPlay['boromir'] = 'lossarnach';
  const ok = moveCompanionGroup(state, 'fp', 'lossarnach', 'minas-tirith', ['boromir'], { levelOverride: 4, siegeOk: true });
  check('the card move succeeds (siegeOk)', ok);
  check('Boromir is in the siege box with the Gondor garrison', state.regions['minas-tirith'].siegeBox.characters.includes('boromir'));
  check('NOT in the field with the besieging Shadow Army', !state.regions['minas-tirith'].characters.includes('boromir'));

  // Without the card's exception the landing stays sealed (p.24).
  const plain = fpBesieged();
  plain.regions['lossarnach'].characters = ['boromir'];
  plain.characters.inPlay['boromir'] = 'lossarnach';
  check('a plain Character-die move may NOT enter', !moveCharacter(plain, 'fp', 'boromir', 'lossarnach', 'minas-tirith'));
}

{
  console.log('\n=== 222n111y4x3p4u3j: a Companion separating inside joins the garrison ===');
  const state = fpBesieged();
  state.fellowship.location = 'minas-tirith';
  placeSeparatedCompanion(state, 'legolas', 'minas-tirith');
  check('Legolas is in the siege box', state.regions['minas-tirith'].siegeBox.characters.includes('legolas'));
  check('not with the besiegers', !state.regions['minas-tirith'].characters.includes('legolas'));
}

{
  console.log('\n=== 6b4j264z0p651015 / 1a3800000w2k534x: boxed Companions are visible but SEALED IN ===');
  const state = fpBesieged({ chars: ['gandalf-white', 'gimli'] });
  state.characters.inPlay['gandalf-white'] = 'minas-tirith';
  state.characters.inPlay['gimli'] = 'minas-tirith';
  // p.24: they "can never leave … a region containing a friendly Stronghold besieged by
  // an enemy Army", so the honest answer is that they have no move at all — they are
  // still on the board (and now drawn there), they are simply not offered. The modal
  // used to list them and light up destinations, then the engine refused the move.
  const at = movableCharsAt(state, 'fp', 'minas-tirith');
  check('a sealed-in Companion is NOT offered as movable', !at.includes('gandalf-white') && !at.includes('gimli'), at.join(',') || '(none)');
  check('no destinations are OFFERED', characterDestinations(state, 'fp', 'gandalf-white', 'minas-tirith').length === 0);
  check('and the move is REFUSED', !moveCharacter(state, 'fp', 'gandalf-white', 'minas-tirith', 'lossarnach'));
  check('the group move is refused too', !moveCompanionGroup(state, 'fp', 'minas-tirith', 'lossarnach', ['gandalf-white', 'gimli']));

  // The Nazgûl exemption cuts the other way: they are NOT sealed in.
  const sh = shadowBesieged({ nazgul: 1 });
  check('a boxed Nazgûl still has destinations', characterDestinations(sh, 'shadow', 'nazgul', 'orthanc').length > 0);
  check('and is still offered as a movable piece', movableCharsAt(sh, 'shadow', 'orthanc').includes('nazgul'));
  // The Mouth of Sauron moves like a Companion (p.25), so he IS sealed in.
  const mouth = shadowBesieged({ chars: ['mouth-of-sauron'] });
  mouth.characters.inPlay['mouth-of-sauron'] = 'orthanc';
  check('the Mouth of Sauron is sealed in too', !movableCharsAt(mouth, 'shadow', 'orthanc').includes('mouth-of-sauron'));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nall siege-figure checks passed\n');
process.exit(failures ? 1 : 0);
