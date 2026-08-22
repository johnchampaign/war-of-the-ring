#!/usr/bin/env vite-node
// probe-nazgul-to-siege.mjs — the 2026-08-21 player report:
//   "I think there was an issue with Ringwraiths are Abroad. I wasn't able to move
//    a Nazgûl to an army that is conducting a siege."
// A Nazgûl flies anywhere (p.25); the only landing bar for a Shadow figure is an
// FP Stronghold that is NOT under siege (p.24). A Stronghold our own Army is
// besieging is exactly the exception, so the fly-in must be offered.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { characterDestinations, moveCharacter } from '../src/engine/charMove.ts';
import { separationDestinations } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function siegeBoard() {
  const state = startGame(createGame({ seed: 7 }));
  const r = state.regions['minas-tirith'];
  r.units = { sauron: { regular: 9, elite: 1 } };
  r.leaders = 0;
  r.nazgul = 1;
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  // A lone Nazgûl far away, in Minas Morgul, that wants to join the siege.
  state.regions['minas-morgul'].nazgul = 2;
  return state;
}

{
  console.log('\n=== characterDestinations: a Nazgûl may land on a besieged Stronghold ===');
  const state = siegeBoard();
  const dests = characterDestinations(state, 'shadow', 'nazgul', 'minas-morgul');
  check('minas-tirith (besieged by us) is a legal landing', dests.includes('minas-tirith'));
  check('dol-amroth (FP Stronghold, unbesieged) is NOT', !dests.includes('dol-amroth'));
}

{
  console.log('\n=== The Ringwraiths Are Abroad offers the fly-in ===');
  const state = siegeBoard();
  check('card is playable', canPlayCard(state, 'sh-char-23', 'shadow'));
  const h = getHandler('sh-char-23');
  const first = h.targets(state, 'shadow', []);
  const pick = first.find((t) => t.companion === 'nazgul' && t.from === 'minas-morgul');
  check('the Minas Morgul Nazgûl group is offered as a mover', !!pick, JSON.stringify(first.slice(0, 8)));
  if (pick) {
    const dests = h.targets(state, 'shadow', [pick]);
    check('minas-tirith is offered as a destination',
      dests.some((t) => t.region === 'minas-tirith'),
      JSON.stringify(dests.filter((t) => t.region === 'minas-tirith')));
  }
}

{
  console.log('\n=== and the Witch-king too ===');
  const state = siegeBoard();
  state.regions['barad-dur'].characters.push('witch-king');
  state.characters.inPlay['witch-king'] = 'barad-dur';
  if (!state.characters.entered.includes('witch-king')) state.characters.entered.push('witch-king');
  const h = getHandler('sh-char-23');
  const first = h.targets(state, 'shadow', []);
  const pick = first.find((t) => t.companion === 'witch-king');
  check('the Witch-king is offered as a mover', !!pick);
  if (pick) {
    const dests = h.targets(state, 'shadow', [pick]);
    check('minas-tirith is offered for the Witch-king', dests.some((t) => t.region === 'minas-tirith'));
  }
}

// --- the mirror-image rule the report sent us looking for ----------------------------
// p.24: Companions (and the Mouth of Sauron) "can never leave or enter a region
// containing a friendly Stronghold besieged by an enemy Army". The engine used to let
// an FP Companion walk into a Stronghold the Shadow was besieging — landing him in the
// open field, which in this siege model belongs to the BESIEGER.
{
  console.log('\n=== a Companion may not walk into his own besieged Stronghold ===');
  const state = siegeBoard();
  // Gandalf the Grey (Level 3) two regions away in Lossarnach.
  state.regions['lossarnach'].characters.push('gandalf-grey');
  state.characters.inPlay['gandalf-grey'] = 'lossarnach';
  const dests = characterDestinations(state, 'fp', 'gandalf-grey', 'lossarnach');
  check('besieged Minas Tirith is NOT offered', !dests.includes('minas-tirith'));
  check('neighbouring Pelargir still is', dests.includes('pelargir'));
  check('the move is refused if submitted anyway', !moveCharacter(state, 'fp', 'gandalf-grey', 'lossarnach', 'minas-tirith'));
  // ...and once the siege lifts, he can walk in again.
  state.regions['minas-tirith'].besieged = false;
  delete state.regions['minas-tirith'].siegeBox;
  state.regions['minas-tirith'].units = { gondor: { regular: 2, elite: 0 } };
  check('with the siege lifted the Stronghold is open again',
    characterDestinations(state, 'fp', 'gandalf-grey', 'lossarnach').includes('minas-tirith'));
}

{
  console.log('\n=== nor separate into it — unless the card says otherwise ===');
  const state = siegeBoard();
  state.fellowship.location = 'lossarnach';
  check('separation destinations exclude the besieged Stronghold',
    !separationDestinations(state, 'lossarnach', 3).includes('minas-tirith'));
  check('Gwaihir / We Prove the Swifter waive it ("allowed to end in a Stronghold under siege")',
    separationDestinations(state, 'lossarnach', 3, { siegeOk: true }).includes('minas-tirith'));
  check('and the card-range move waives it too',
    characterDestinations(state, 'fp', 'gandalf-grey', 'lossarnach', { levelOverride: 4, siegeOk: true }).includes('minas-tirith'));
}

{
  console.log('\n=== the Mouth of Sauron obeys the same seal; the Nazgûl do not ===');
  const state = siegeBoard();
  // FP besiege Shadow-held Orthanc: the box holds the Isengard garrison.
  const o = state.regions['orthanc'];
  o.units = { rohan: { regular: 4, elite: 0 } };
  o.besieged = true;
  o.siegeBox = { units: { isengard: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions['fords-of-isen'].characters.push('mouth-of-sauron');
  state.characters.inPlay['mouth-of-sauron'] = 'fords-of-isen';
  check('the Mouth may not enter friendly Orthanc while it is besieged',
    !characterDestinations(state, 'shadow', 'mouth-of-sauron', 'fords-of-isen').includes('orthanc'));
  check('a Nazgûl still may (p.25: the FP-Stronghold rule is "the only restriction")',
    characterDestinations(state, 'shadow', 'nazgul', 'minas-morgul').includes('orthanc'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
