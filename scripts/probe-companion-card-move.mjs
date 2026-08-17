#!/usr/bin/env vite-node
// probe-companion-card-move.mjs — two player reports about cards that move figures
// already on the map:
//
//  1. Gwaihir the Windlord / We Prove the Swifter print "Separate from the Fellowship,
//     OR MOVE, one Companion or one group of Companions". The "or move" branch was
//     missing, so with an empty Fellowship the cards were unplayable even with
//     Companions standing on the board (report 4964174f: "wanted to spend [E] to play
//     Gwaihir, but was not allowed").
//  2. "The Ringwraiths Are Abroad" / "The Black Captain Commands" say "move any or all
//     of the Nazgûl" — a stack of three may send one. Both cards flew the whole stack
//     (report 0j1x6h3r: "didn't let me choose how many of them to move").
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { characterDestinations } from '../src/engine/charMove.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Empty the Fellowship of Companions and strand two of them on the map together. */
function emptyFellowship(seed = 5) {
  const state = startGame(createGame({ seed }));
  for (const c of [...state.fellowship.companions]) {
    state.characters.inPlay[c] = 'lorien';
    state.regions['lorien'].characters.push(c);
  }
  state.fellowship.companions = [];
  state.fellowship.guide = 'gollum';
  return state;
}

// --- Gwaihir is playable with an empty Fellowship, and moves a map group ----------
{
  console.log('\n=== Gwaihir the Windlord: the "or move" branch ===');
  const state = emptyFellowship();
  const h = getHandler('fp-char-15');
  check('canPlay with no Companions in the Fellowship', h.canPlay(state) === true);

  const picks = h.targets(state, 'fp');
  const gimli = picks.find((t) => t.companion === 'gimli' && t.from === 'lorien');
  check('Gimli is offered as an on-map pick', !!gimli, JSON.stringify(gimli));

  // Pick Gimli, then Legolas (same region — a legal travelling group), then a
  // destination. Gwaihir moves them "as if their Level were 4".
  const step2 = h.targets(state, 'fp', [gimli]);
  const legolas = step2.find((t) => t.companion === 'legolas' && t.from === 'lorien' && !t.region);
  check('Legolas (same region) may join the group', !!legolas);
  const offMap = step2.find((t) => t.companion && t.region && !t.from);
  check('no Fellowship-separation destination leaks into the map branch', !offMap, JSON.stringify(offMap));

  const dests = h.targets(state, 'fp', [gimli, legolas]).filter((t) => t.region);
  check('destinations are offered for the group', dests.length > 0, `${dests.length} regions`);
  // "As if their Level were 4" must beat what the pair could walk unaided (Gimli 2,
  // Legolas 3 → a group range of 3 on a plain Character die).
  const unaided = characterDestinations(state, 'fp', 'legolas', 'lorien');
  check('the card widens the group\'s reach beyond its own Level',
    dests.length > unaided.length, `${dests.length} with the card vs ${unaided.length} without`);
  const far = dests.find((t) => t.region === 'minas-tirith');   // 4 regions from Lórien
  check('range 4 is honoured (Minas Tirith reachable)', !!far);
  check('every destination carries the source region', dests.every((t) => t.from === 'lorien'));

  h.finalize(state, 'fp', [gimli, legolas, { ...far, companion: 'gimli' }]);
  check('Gimli arrived', state.characters.inPlay['gimli'] === 'minas-tirith');
  check('Legolas travelled with him', state.characters.inPlay['legolas'] === 'minas-tirith');
  check('Lórien no longer holds them', !state.regions['lorien'].characters.includes('gimli'));
  check('the Fellowship is untouched', state.fellowship.companions.length === 0);
}

// --- We Prove the Swifter carries its +2 on the map branch too --------------------
{
  console.log('\n=== We Prove the Swifter: +2 regions on the map branch ===');
  const state = emptyFellowship(9);
  const h = getHandler('fp-char-16');
  check('canPlay with an empty Fellowship', h.canPlay(state) === true);
  const pip = h.targets(state, 'fp').find((t) => t.companion === 'peregrin' && t.from === 'lorien');
  check('Pippin is offered on the map', !!pip);
  // Pippin is Level 1; the card grants +2, so exactly 3 regions of reach.
  const dests = new Set(h.targets(state, 'fp', [pip]).filter((t) => t.region).map((t) => t.region));
  check('3 regions away is in range (Fangorn)', dests.has('fangorn'));
  check('4 regions away is out of range (North Dunland)', !dests.has('north-dunland'));
}

// --- the separation branch still works, and is still the only branch for I Will Go Alone
{
  console.log('\n=== the separation branch is unchanged ===');
  const state = startGame(createGame({ seed: 11 }));
  const h = getHandler('fp-char-15');
  const sep = h.targets(state, 'fp').find((t) => t.companion === 'gandalf-grey' && !t.from);
  check('a Fellowship Companion is still offered (no `from` tag)', !!sep);
  const dest = h.targets(state, 'fp', [sep]).find((t) => t.region);
  check('a separation destination is offered', !!dest && !dest.from, JSON.stringify(dest));
  h.finalize(state, 'fp', [sep, dest]);
  check('Gandalf left the Fellowship', !state.fellowship.companions.includes('gandalf-grey'));
  check('Gandalf stands in the destination', state.characters.inPlay['gandalf-grey'] === dest.region);

  const alone = getHandler('fp-char-11');
  const mapPick = alone.targets(state, 'fp').find((t) => t.from);
  check('I Will Go Alone offers NO map branch (its text has no "or move")', !mapPick, JSON.stringify(mapPick));
}

// --- "any or all of the Nazgûl": a stack of three offers 1, 2 and 3 ---------------
for (const card of ['sh-char-23', 'sh-char-24']) {
  console.log(`\n=== ${card}: move a SUBSET of a Nazgûl stack ===`);
  const state = startGame(createGame({ seed: 7 }));
  state.regions['minas-morgul'].nazgul = 3;
  if (card === 'sh-char-24') { // The Black Captain Commands needs the Witch-king in play
    state.characters.inPlay['witch-king'] = 'minas-morgul';
    state.regions['minas-morgul'].characters.push('witch-king');
  }
  const h = getHandler(card);
  const pick = h.targets(state, 'shadow').find((t) => t.companion === 'nazgul' && t.from === 'minas-morgul');
  check('the Minas Morgul Nazgûl are offered', !!pick);
  const dests = h.targets(state, 'shadow', [pick]).filter((t) => t.region === 'osgiliath');
  check('Osgiliath is offered once per count (1, 2, 3)',
    new Set(dests.map((t) => t.count)).size === 3, JSON.stringify(dests.map((t) => t.count)));

  const one = dests.find((t) => t.count === 1);
  h.applyTarget(state, 'shadow', one, [pick]);
  check('exactly one Nazgûl flew', state.regions['osgiliath'].nazgul === 1,
    `osgiliath=${state.regions['osgiliath'].nazgul}`);
  check('two stayed behind', state.regions['minas-morgul'].nazgul === 2,
    `minas-morgul=${state.regions['minas-morgul'].nazgul}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll companion/Nazgûl card-move checks passed.');
process.exit(failures ? 1 : 0);
