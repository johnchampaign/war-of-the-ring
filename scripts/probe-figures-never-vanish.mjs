#!/usr/bin/env vite-node
// probe-figures-never-vanish.mjs — two ways Companions went missing (player reports
// t605mrj7yuywqjij, 1wfqbieamocul425, fdx2xl3oo40orw9h):
//
//  1. Book of Mazarbul / Fear! Fire! Foes! move "any or all" separated Companions. A
//     group was offered destinations at the group's range (its highest Level, p.24) but
//     then moved member by member at each one's OWN Level, so the slower ones silently
//     stayed behind: "only Gandalf the White and Strider moved".
//  2. A card that moves part of a besieged garrison out (Paths of the Woses marches out
//     of a Stronghold under siege) could take every unit and leave Companions inside.
//     The siege then lifted with "nothing to return" and deleted the box — Companions
//     and all. They stayed listed as in play, held by nothing: "my Companions in Moria
//     disappeared into The Backrooms".
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { liftSiegeIfAbandoned } from '../src/engine/armies.ts';
import { characterDestinations } from '../src/engine/charMove.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
/** Every figure listed in play stands in a force on the board. */
const lost = (s) => Object.keys(s.characters.inPlay).filter((c) => !s.characters.eliminated.includes(c)
  && !Object.values(s.regions).some((r) => r.characters.includes(c) || (r.siegeBox?.characters ?? []).includes(c)));
const at = (s, c) => Object.entries(s.regions).find(([, r]) => r.characters.includes(c) || (r.siegeBox?.characters ?? []).includes(c))?.[0];

console.log('\n=== 1. a card group move takes the whole group (the report) ===');
for (const card of ['fp-str-04', 'fp-str-07']) {
  const s = startGame(createGame({ seed: 5 }));
  // Strider (3) with Merry and Pippin (1) standing together, separated, in Lórien.
  const from = 'lorien';
  for (const c of ['strider', 'meriadoc', 'peregrin']) {
    s.fellowship.companions = s.fellowship.companions.filter((x) => x !== c);
    s.characters.inPlay[c] = from; s.regions[from].characters.push(c);
  }
  const h = getHandler(card);
  let applied = [];
  const pick = (t) => { h.applyTarget(s, 'fp', t, applied); applied = [...applied, t]; };
  pick({ companion: 'strider' });
  pick({ companion: 'meriadoc' });
  pick({ companion: 'peregrin' });
  // A destination at the group's range (Strider's 3) that the Hobbits could not reach alone.
  const dests = h.targets(s, 'fp', applied).filter((t) => t.region);
  // What Merry could reach on his own (Level 1): the group must be offered, and move to,
  // somewhere outside that.
  const hobbitReach = new Set(characterDestinations(s, 'fp', 'meriadoc', from));
  const far = dests.find((t) => !hobbitReach.has(t.region));
  check(`${card}: a destination beyond the Hobbits' own reach is offered`, !!far, far?.region ?? 'none');
  if (far) {
    pick(far);
    const where = ['strider', 'meriadoc', 'peregrin'].map((c) => `${c}@${at(s, c)}`).join(' ');
    check(`${card}: all three arrive together`, ['strider', 'meriadoc', 'peregrin'].every((c) => at(s, c) === far.region && s.characters.inPlay[c] === far.region), where);
  }
}

console.log('\n=== 2. a besieged garrison marched out by a split card move leaves no one in limbo ===');
{
  const s = startGame(createGame({ seed: 7 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = [];
  s.nations.rohan.active = true; s.nations.rohan.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  // Helm's Deep besieged: a Rohan garrison with Gimli inside, a Shadow Army in the field.
  const hd = s.regions['helms-deep'];
  hd.units = { isengard: { regular: 4, elite: 0 } }; hd.leaders = 0; hd.characters = [];
  hd.besieged = true;
  hd.siegeBox = { units: { rohan: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: ['gimli'] };
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gimli');
  s.characters.inPlay['gimli'] = 'helms-deep';
  s.regions['minas-tirith'].units = {};
  s.cards.fp.hand = ['fp-str-11'];
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-11');
  check('Paths of the Woses is playable from the besieged Stronghold', !!play);
  if (play) {
    let t = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
    const target = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'eventTarget' && a.from === 'helms-deep');
    check('the garrison can march out', !!target, target ? `→ ${target.to}` : 'no target');
    if (target) {
      // Every unit goes; Gimli is left out of the selection.
      t = wotrAdapter.applyAction(t, { ...target, move: { units: { rohan: { regular: 2 } } } }, 'fp');
      check('no figure is left held by nothing', lost(t).length === 0, lost(t).join(', ') || 'none lost');
      check('Gimli is still on the board, in Helm\'s Deep', at(t, 'gimli') === 'helms-deep', String(at(t, 'gimli')));
      check('the undefended Stronghold falls to the besieger', t.regions['helms-deep'].control === 'shadow' && !t.regions['helms-deep'].besieged,
        `control=${t.regions['helms-deep'].control} besieged=${t.regions['helms-deep'].besieged}`);
    }
  }
}

console.log('\n=== 3. the siege lift itself, directly ===');
{
  const s = startGame(createGame({ seed: 7 }));
  const r = s.regions['helms-deep'];
  r.units = { isengard: { regular: 3, elite: 0 } }; r.characters = []; r.besieged = true;
  r.siegeBox = { units: {}, leaders: 0, nazgul: 0, characters: ['legolas'] };
  s.characters.inPlay['legolas'] = 'helms-deep';
  liftSiegeIfAbandoned(s, 'helms-deep');
  check('a unitless box with a Companion inside returns him to the region', r.characters.includes('legolas') && !r.siegeBox, JSON.stringify(r.characters));
  const e = s.regions['edoras'];
  e.besieged = true; e.siegeBox = { units: {}, leaders: 0, nazgul: 0, characters: [] };
  liftSiegeIfAbandoned(s, 'edoras');
  check('a truly empty box is still simply removed', !e.siegeBox && !e.besieged);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
