#!/usr/bin/env vite-node
// probe-retreat-losses.mjs — A RETREATING ARMY IS NOT A DEAD ARMY.
//
// Player report: "After the battle between armies, if the defender army retreats from
// the region, the prompt says that the defender lost all units, instead of actual
// losses from the dice rolls." Their battle at Westemnet: 4 Regulars defending, 2 hits
// taken, the survivors marched off — and the recap read "Units lost — Defender: 4".
//
// The end-of-battle tally diffs each side's start count against what is still STANDING
// IN THE BATTLE REGION. A retreat empties that region without killing anyone, so the
// whole stack was booked as casualties. Units that leave alive are now tracked and
// credited back, and the outcome line says the defender retreated rather than letting
// "Free Peoples take Westemnet" + a full-strength loss count read as an annihilation.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolveRetreat, resolveRetreatTo } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const count = (s, id) => Object.values(s.regions[id].units).reduce((a, u) => a + u.regular + u.elite, 0);

function board() {
  const s = startGame(createGame({ seed: 9 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  // Both Nations At War, or fullRearguard holds the not-yet-mobilized attacker out of
  // its own battle and there is nothing to advance with.
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  return s;
}

/** The reporter's shape: FP attack Westemnet out of Edoras, Shadow defend, then run.
 *  `killed` figures are removed from the defender first, standing in for the dice. */
function battleThenRetreat(killed, pick) {
  const s = board();
  s.regions['edoras'].units = { rohan: { regular: 1, elite: 4 } };
  s.regions['edoras'].leaders = 1;
  s.regions['westemnet'].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'fp', 'edoras', 'westemnet');
  // Stand in for the round's dice: the defender is down `killed` Regulars when the
  // retreat decision comes round.
  s.regions['westemnet'].units.sauron.regular -= killed;
  s.pendingChoice = { owner: 'shadow', kind: 'combatRetreat' };
  resolveRetreat(s, true);
  if (s.pendingChoice?.kind === 'retreatTo') resolveRetreatTo(s, pick ?? s.pendingChoice.region ?? 'westemnet');
  return s;
}

// --- the reporter's case: 4 defenders, 2 killed, 2 marched away --------------------
{
  console.log("\n=== the reporter's battle: 2 dead is not 4 dead ===");
  const s = battleThenRetreat(2, 'gap-of-rohan');
  const b = s.lastBattle;
  check('the battle is over', !!b && s.pendingCombat === null);
  check('the defender is charged 2 losses, not 4', b.defLosses === 2, `defLosses=${b.defLosses}`);
  check('the attacker lost nobody', b.atkLosses === 0, `atkLosses=${b.atkLosses}`);
  check('2 Regulars actually left the board', s.reinforcements.sauron.regular >= 2);
  check('the survivors are somewhere else, alive', Object.values(s.regions).some((r) => (r.units.sauron?.regular ?? 0) === 2));
  check('the recap says they retreated', /retreat/i.test(b.outcome), b.outcome);
  check('and that the attacker took the ground', b.captured === true, b.outcome);
}

// --- a clean getaway costs nothing ------------------------------------------------
{
  console.log('\n=== an Army that retreats untouched loses NOTHING ===');
  const s = battleThenRetreat(0, 'gap-of-rohan');
  check('no losses booked at all', s.lastBattle.defLosses === 0, `defLosses=${s.lastBattle.defLosses}`);
  check('all 4 Regulars are still on the map', Object.values(s.regions).reduce((a, r) => a + (r.units.sauron?.regular ?? 0), 0) === 4);
  check('not reported as a wipe-out', !/destroyed/i.test(s.lastBattle.outcome), s.lastBattle.outcome);
}

// --- an Army wiped out in the region is still fully counted ------------------------
{
  console.log('\n=== standing and dying still reports every loss ===');
  const s = board();
  s.regions['edoras'].units = { rohan: { regular: 1, elite: 4 } };
  s.regions['westemnet'].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'fp', 'edoras', 'westemnet');
  s.regions['westemnet'].units = {};                 // the whole defending Army dies
  combatStep(s);                                     // the empty-region check ends it
  check('the battle is over', !!s.lastBattle && s.pendingCombat === null);
  check('all 4 defenders are counted as lost', s.lastBattle.defLosses === 4, `defLosses=${s.lastBattle.defLosses}`);
  check('no retreat is claimed', !/retreat/i.test(s.lastBattle.outcome), s.lastBattle.outcome);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll retreat-loss checks passed.');
process.exit(failures ? 1 : 0);
