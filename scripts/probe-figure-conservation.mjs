#!/usr/bin/env vite-node
// probe-figure-conservation.mjs — two player reports from one game (2026-08-17):
//
//  1. "Where are all my trolls!" — reducing an Elite to a Regular (p.30) swapped the
//     board figures but never touched the reinforcement pool: the Elite figure did not
//     go back (Shadow) and the replacement Regular came from nowhere. Four siege
//     extensions left Sauron with 40 Regulars in play out of 36 and 4 Trolls that
//     existed nowhere. Every reduction path must now conserve figures:
//     board + pool (+ FP permanent losses) is constant.
//
//  2. "Leader attacked alone with 0 dice and died" — Help Unlooked For from an Army
//     whose only unit was not At War: the unit was forced into the rearguard and the
//     lone Leader "attacked". Card-driven attacks are gated on an At-War unit, and
//     startBattle refuses a zero-unit attacking force outright.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { applyCasualties, startBattle, resolveSiegeExtend, hasAtWarUnit } from '../src/engine/combat.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const bare = (seed = 3) => {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  return s;
};
/** Total Sauron figures: on the board (regions + siege boxes) + in the pool. */
const sauronTotal = (s) => {
  let R = s.reinforcements.sauron.regular, E = s.reinforcements.sauron.elite;
  for (const r of Object.values(s.regions)) {
    for (const f of [r, r.siegeBox]) { const u = f?.units?.sauron; if (u) { R += u.regular; E += u.elite; } }
  }
  return { R, E };
};

{
  console.log('\n=== batch plan: reducing a Shadow Elite conserves figures ===');
  const s = bare();
  s.regions['gorgoroth'].units = { sauron: { regular: 0, elite: 2 } };
  const before = sauronTotal(s);
  applyCasualties(s, 'gorgoroth', 'shadow', 1, 'regularsFirst'); // no Regular -> must reduce an Elite
  const after = sauronTotal(s);
  check('one Elite became a Regular on the board', s.regions['gorgoroth'].units.sauron.elite === 1 && s.regions['gorgoroth'].units.sauron.regular === 1);
  check('the Elite figure returned to the pool', s.reinforcements.sauron.elite === before.E - 2 + 1 || after.E === before.E, `pool E ${s.reinforcements.sauron.elite}`);
  check('total Elites conserved', after.E === before.E, `${before.E} -> ${after.E}`);
  check('total Regulars conserved (the replacement came FROM the pool)', after.R === before.R, `${before.R} -> ${after.R}`);
}

{
  console.log('\n=== pressing a siege assault: the spent Elite is not lost ===');
  const s = bare(5);
  s.regions['minas-tirith'].units = { sauron: { regular: 3, elite: 2 } };
  s.regions['minas-tirith'].besieged = true;
  s.regions['minas-tirith'].siegeBox = { units: { gondor: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['minas-tirith'].control = 'fp';
  s.nations.sauron.step = 0; s.nations.gondor.step = 0;
  const before = sauronTotal(s);
  startBattle(s, 'shadow', 'minas-tirith', 'minas-tirith');
  if (!s.pendingCombat) { console.log('  (assault did not start — skipped)'); }
  else {
    s.pendingChoice = { owner: 'shadow', kind: 'siegeExtend', data: {} };
    resolveSiegeExtend(s, true);
    const after = sauronTotal(s);
    check('an Elite was reduced on the board', s.regions['minas-tirith'].units.sauron.elite === 1 && s.regions['minas-tirith'].units.sauron.regular === 4);
    check('total Elites conserved', after.E === before.E, `${before.E} -> ${after.E}`);
    check('total Regulars conserved', after.R === before.R, `${before.R} -> ${after.R}`);
  }
}

{
  console.log('\n=== Help Unlooked For: an Army with no At-War unit may not attack ===');
  const s = bare(7);
  // Woodland Realm besieged by Sauron; Dale holds 1 North Regular + 1 Leader, North NOT At War.
  s.regions['woodland-realm'].units = { sauron: { regular: 4, elite: 0 } };
  s.regions['woodland-realm'].besieged = true;
  s.regions['woodland-realm'].siegeBox = { units: { elves: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['woodland-realm'].control = 'fp';
  s.regions['dale'].units = { north: { regular: 1, elite: 0 } }; s.regions['dale'].leaders = 1;
  s.nations.sauron.step = 0; s.nations.elves.step = 0; s.nations.north.step = 2; // North passive
  check('Dale has no At-War unit', !hasAtWarUnit(s, 'dale', 'fp'));
  const h = getHandler('fp-str-10');
  const targets = h.targets(s);
  check('the card offers no relief attack from Dale', !targets.some((t) => t.from === 'dale'), JSON.stringify(targets));
  // Belt and braces: even a direct startBattle refuses.
  startBattle(s, 'fp', 'dale', 'woodland-realm');
  check('startBattle starts nothing', s.pendingCombat === null);
  check('the Regular and the Leader are still in Dale', s.regions['dale'].units.north?.regular === 1 && s.regions['dale'].leaders === 1,
    `north=${s.regions['dale'].units.north?.regular}, leaders=${s.regions['dale'].leaders}`);
  s.nations.north.step = 0; // North At War -> the attack is legal again
  check('...and IS offered once the North is At War', h.targets(s).some((t) => t.from === 'dale'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
