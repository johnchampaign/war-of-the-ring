#!/usr/bin/env vite-node
// probe-besieged-figures-cards.mjs — a batch of player reports from 2026-09-24, all one
// root cause: an Event card (or a movement rule) read a region's open field and never
// looked inside the siege box of a besieged Stronghold, where the garrison's figures
// actually stand (p.31).
//
//   1e14645k / 286a6b6x / 372s1b69 / 6w0e4122 — The Nazgûl Strike!, The Ringwraiths
//     Are Abroad, Nazgûl Search and The Black Captain Commands could not fly a Nazgûl
//     out of a besieged Shadow Stronghold (p.25 lets him).
//   3y2y1w09 — Return of the Witch-king left him in the box AND put one in Angmar.
//   485p4m2z — The Eagles are Coming!'s survivors landed with the besiegers instead of
//     inside the besieged Sauron Stronghold (Almanac C 18 allows that Stronghold).
//   043e6x3t — Challenge of the King refused Aragorn inside besieged Minas Tirith.
//   526j5e3b — The Spirit of Mordor could not target a besieged Shadow Army.
//   1u162l39 — Stormcrow ignored a Companion inside a besieged Stronghold.
//   3i1b184d — walking Companions must stop at a Shadow Stronghold even when a Free
//     Peoples Army besieges it (p.24; Almanac: the siege "does not override" the stop).
//   1j4q0730 / 1k2s521e — a Companion landing in / entering play in a besieged
//     Stronghold of a passive Nation activates it.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { forceUnitCount } from '../src/engine/armies.ts';
import { characterDestinations, moveCompanionGroup } from '../src/engine/charMove.ts';
import { bringUpgrade } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed = 11) => startGame(createGame({ seed }));
function besiege(state, region, field, box) {
  const r = state.regions[region];
  r.units = field.units ?? {}; r.leaders = field.leaders ?? 0; r.nazgul = field.nazgul ?? 0; r.characters = field.characters ?? [];
  r.besieged = true;
  r.siegeBox = { units: box.units ?? {}, leaders: box.leaders ?? 0, nazgul: box.nazgul ?? 0, characters: box.characters ?? [] };
  return r;
}
/** Strip every Nazgûl and the Witch-king off the board, so only the boxed ones remain. */
function clearNazgul(s) {
  for (const r of Object.values(s.regions)) {
    r.nazgul = 0; r.characters = r.characters.filter((c) => c !== 'witch-king');
    if (r.siegeBox) { r.siegeBox.nazgul = 0; r.siegeBox.characters = r.siegeBox.characters.filter((c) => c !== 'witch-king'); }
  }
}
/** The reporter's board: a Gondor Army besieges Minas Morgul, whose Shadow garrison
 *  holds two Nazgûl and the Witch-king. */
function morgulBesieged(s) {
  clearNazgul(s);
  if (!s.characters.entered.includes('witch-king')) s.characters.entered.push('witch-king');
  s.characters.inPlay['witch-king'] = 'minas-morgul';
  besiege(s, 'minas-morgul',
    { units: { gondor: { regular: 1, elite: 0 } }, leaders: 1 },
    { units: { sauron: { regular: 4, elite: 0 }, isengard: { regular: 0, elite: 1 } }, nazgul: 2, characters: ['witch-king'] });
}
const countWk = (s) => Object.values(s.regions).reduce((n, r) =>
  n + r.characters.filter((c) => c === 'witch-king').length + (r.siegeBox?.characters.filter((c) => c === 'witch-king').length ?? 0), 0);

for (const [id, name] of [['sh-char-08b', 'The Nazgûl Strike!'], ['sh-char-09', 'Nazgûl Search'], ['sh-char-23', 'The Ringwraiths Are Abroad'], ['sh-char-24', 'The Black Captain Commands']]) {
  console.log(`\n=== ${name}: fly a Nazgûl out of besieged Minas Morgul ===`);
  const s = fresh();
  morgulBesieged(s);
  s.fellowship.progress = 1;
  check('the card is playable with the only Nazgûl in the siege box', canPlayCard(s, id, 'shadow'));
  const h = getHandler(id);
  const picks = h.targets(s, 'shadow', []);
  const pick = picks.find((t) => t.companion === 'nazgul' && t.from === 'minas-morgul');
  check('the boxed Nazgûl are offered as a pick', !!pick, JSON.stringify(picks.filter((t) => t.companion).slice(0, 4)));
  if (!pick) continue;
  const dests = h.targets(s, 'shadow', [pick]);
  const one = dests.find((t) => t.region === 'gorgoroth' && t.count === 1);
  check('a destination for one of the two is offered', !!one, `${dests.length} destination target(s)`);
  if (!one) continue;
  h.applyTarget(s, 'shadow', one);
  check('one Nazgûl left the box, one stays', s.regions['minas-morgul'].siegeBox.nazgul === 1, `box=${s.regions['minas-morgul'].siegeBox.nazgul}`);
  check('it arrived in Gorgoroth', s.regions['gorgoroth'].nazgul >= 1);
  const again = h.targets(s, 'shadow', [pick, one]).find((t) => t.companion === 'nazgul' && t.from === 'minas-morgul');
  check('the one left behind may still fly', !!again);
}

{
  console.log('\n=== Return of the Witch-king: he is MOVED out of the siege box, not copied ===');
  const s = fresh();
  morgulBesieged(s);
  check('the card is playable', canPlayCard(s, 'sh-str-12', 'shadow'));
  getHandler('sh-str-12').apply(s, 'shadow');
  check('exactly one Witch-king on the board', countWk(s) === 1, `${countWk(s)}`);
  check('he is in Angmar', s.regions['angmar'].characters.includes('witch-king'));
  check('the box no longer holds him', !s.regions['minas-morgul'].siegeBox.characters.includes('witch-king'));
  check('the index follows him', s.characters.inPlay['witch-king'] === 'angmar', s.characters.inPlay['witch-king']);
}

{
  console.log('\n=== The Eagles are Coming!: survivors may flee into a besieged Sauron Stronghold ===');
  const s = fresh(5);
  clearNazgul(s);
  // Minas Morgul is the only unconquered Sauron Stronghold left for the survivors.
  for (const id of ['barad-dur', 'dol-guldur', 'morannon', 'mount-gundabad']) if (s.regions[id]) s.regions[id].control = 'fp';
  besiege(s, 'minas-morgul', { units: { gondor: { regular: 2, elite: 0 } } }, { units: { sauron: { regular: 2, elite: 0 } } });
  // A Shadow Army with 5 Nazgûl next to a Free Peoples Army with a Companion.
  const sh = 'north-ithilien', fp = 'osgiliath';
  Object.assign(s.regions[sh], { units: { sauron: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 5, characters: [] });
  Object.assign(s.regions[fp], { units: { gondor: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: ['boromir'] });
  s.characters.inPlay['boromir'] = fp;
  check('the card is playable', canPlayCard(s, 'fp-char-18', 'fp'));
  getHandler('fp-char-18').apply(s, 'fp');
  const box = s.regions['minas-morgul'].siegeBox;
  const kills = 5 - (box?.nazgul ?? 0);
  check('the survivors joined the garrison in the box', (box?.nazgul ?? 0) > 0 || kills === 5, `box=${box?.nazgul}`);
  check('none landed among the Free Peoples besiegers', s.regions['minas-morgul'].nazgul === 0, `field=${s.regions['minas-morgul'].nazgul}`);
  check('none stayed behind', s.regions[sh].nazgul === 0);
}

{
  console.log('\n=== Challenge of the King: Aragorn besieged in Minas Tirith ===');
  const s = fresh();
  s.characters.entered.push('aragorn'); s.characters.inPlay['aragorn'] = 'minas-tirith';
  besiege(s, 'minas-tirith', { units: { sauron: { regular: 5, elite: 0 } } }, { units: { gondor: { regular: 0, elite: 2 } }, characters: ['aragorn'] });
  check('the card is playable', canPlayCard(s, 'fp-char-14', 'fp'));
  // Aragorn alone in the box with no garrison is not "with a Free Peoples Army".
  s.regions['minas-tirith'].siegeBox.units = {};
  check('...but not once the garrison is gone', !canPlayCard(s, 'fp-char-14', 'fp'));
}

{
  console.log('\n=== The Spirit of Mordor: a besieged two-Nation Shadow Army ===');
  const s = fresh();
  // No other two-Nation Shadow Army on the board.
  for (const r of Object.values(s.regions)) { if (r.units.isengard) r.units.isengard = { regular: 0, elite: 0 }; if (r.units.southrons) r.units.southrons = { regular: 0, elite: 0 }; }
  morgulBesieged(s);
  s.regions['minas-morgul'].siegeBox.units = { sauron: { regular: 4, elite: 0 }, isengard: { regular: 0, elite: 1 } };
  check('the card is playable', canPlayCard(s, 'fp-str-05', 'fp'));
  const t = getHandler('fp-str-05').targets(s, 'fp').find((x) => x.region === 'minas-morgul');
  check('the besieged Army is a target', !!t);
  const fieldBefore = forceUnitCount(s.regions['minas-morgul']);
  const boxBefore = forceUnitCount(s.regions['minas-morgul'].siegeBox);
  // Roll until the dice score (the seeded RNG is deterministic per state).
  let tries = 0;
  while (forceUnitCount(s.regions['minas-morgul'].siegeBox ?? { units: {} }) === boxBefore && tries++ < 20) getHandler('fp-str-05').applyTarget(s, 'fp', t);
  check('the hits land on the garrison', forceUnitCount(s.regions['minas-morgul'].siegeBox ?? { units: {} }) < boxBefore);
  check('the Free Peoples besiegers are untouched', forceUnitCount(s.regions['minas-morgul']) === fieldBefore);
}

{
  console.log('\n=== Stormcrow: a Companion inside a besieged Stronghold of a passive Nation ===');
  const s = fresh();
  // Keep the Fellowship and every other Companion out of the Dwarves' borders.
  s.fellowship.location = 'rivendell';
  for (const r of Object.values(s.regions)) r.characters = r.characters.filter((c) => c !== 'gimli');
  s.nations.dwarves = { step: 2, active: true };
  s.characters.inPlay['gimli'] = 'erebor';
  besiege(s, 'erebor', { units: { sauron: { regular: 3, elite: 0 } } }, { units: { dwarves: { regular: 1, elite: 0 } }, leaders: 1, characters: ['gimli'] });
  const h = getHandler('sh-str-06');
  const nations = h.targets(s, 'shadow', []).map((t) => t.nation);
  check('the Dwarves qualify', nations.includes('dwarves'), JSON.stringify(nations));
  s.pendingChoice = { owner: 'fp', kind: 'stormcrowLoss', data: { nation: 'dwarves' } };
  const acts = wotrAdapter.legalActions(s, 'fp');
  const boxed = acts.find((a) => a.kind === 'stormcrowLoss' && a.region === 'erebor' && a.figure === 'regular');
  check('the boxed Dwarven Regular may be chosen', !!boxed, JSON.stringify(acts.slice(0, 3)));
  if (boxed) {
    const s2 = wotrAdapter.applyAction(s, boxed, 'fp');
    const r = s2.regions['erebor'];
    check('the garrison lost its last unit, so Erebor falls to the besieger', !r.besieged && r.control === 'shadow', `besieged=${r.besieged} control=${r.control}`);
    check('Gimli survives, now in the open region', r.characters.includes('gimli'));
    check('the besiegers were not touched', forceUnitCount(r) === 3);
  }
}

{
  console.log('\n=== Companions stop at a Shadow Stronghold even when it is besieged (p.24) ===');
  const s = fresh();
  s.characters.inPlay['legolas'] = 'north-ithilien';
  s.regions['north-ithilien'].characters.push('legolas');
  const open = new Set(characterDestinations(s, 'fp', 'legolas', 'north-ithilien'));
  besiege(s, 'minas-morgul', { units: { gondor: { regular: 2, elite: 0 } } }, { units: { sauron: { regular: 2, elite: 0 } } });
  const sieged = new Set(characterDestinations(s, 'fp', 'legolas', 'north-ithilien'));
  const extra = [...sieged].filter((r) => !open.has(r));
  check('the siege opens no road through Minas Morgul', extra.length === 0, extra.join(', '));
  check('Minas Morgul itself is still reachable', sieged.has('minas-morgul'));
}

{
  console.log('\n=== Passive Nation: a Companion flown into its besieged Stronghold activates it ===');
  const s = fresh();
  s.nations.dwarves = { step: 3, active: false };
  for (const r of Object.values(s.regions)) r.characters = r.characters.filter((c) => c !== 'gimli');
  s.regions['dale'].characters.push('gimli'); s.characters.inPlay['gimli'] = 'dale';
  besiege(s, 'erebor', { units: { sauron: { regular: 3, elite: 0 } } }, { units: { dwarves: { regular: 1, elite: 0 } } });
  const ok = moveCompanionGroup(s, 'fp', 'dale', 'erebor', ['gimli'], { levelOverride: 4, siegeOk: true });
  check('Gwaihir lands Gimli in the besieged Erebor', ok);
  check('he joins the garrison', s.regions['erebor'].siegeBox.characters.includes('gimli'));
  check('the Dwarves are activated', s.nations.dwarves.active);
}

{
  console.log('\n=== Passive Nation: Gandalf the White entering play in a besieged Elven Stronghold ===');
  const s = fresh();
  s.nations.elves = { step: 3, active: false };
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gandalf-grey');
  for (const r of Object.values(s.regions)) { r.characters = r.characters.filter((c) => c !== 'gandalf-grey'); if (r.siegeBox) r.siegeBox.characters = r.siegeBox.characters.filter((c) => c !== 'gandalf-grey'); }
  delete s.characters.inPlay['gandalf-grey'];
  if (!s.characters.eliminated.includes('gandalf-grey')) s.characters.eliminated.push('gandalf-grey');
  s.characters.entered.push('saruman');
  besiege(s, 'lorien', { units: { sauron: { regular: 3, elite: 0 } } }, { units: { elves: { regular: 1, elite: 0 } } });
  const ok = bringUpgrade(s, 'gandalf-white', 'lorien');
  check('he enters play in besieged Lórien', ok && s.regions['lorien'].siegeBox.characters.includes('gandalf-white'));
  check('the Elves are activated', s.nations.elves.active);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall besieged-figure card checks pass');
if (failures) process.exit(1);
