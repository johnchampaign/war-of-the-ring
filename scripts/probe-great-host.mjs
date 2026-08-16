#!/usr/bin/env vite-node
// probe-great-host.mjs — Great Host's automatic hit resolves at its PRINTED time:
// "If, after removing casualties from the Combat roll and Leader re-roll, your Army
// units are at least twice as many as the enemy Army units, score one automatic hit."
// It used to be evaluated mid-roll against PRE-casualty counts, which was wrong in
// both directions (own losses can drop the owner below 2:1; enemy losses can bring
// them within it).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const units = (s, id) => Object.values(s.regions[id].units).reduce((a, u) => a + u.regular + u.elite, 0);

/** Arm the ONSLAUGHT step directly with chosen post-casualty force sizes. */
function armed(atk, def) {
  const s = startGame(createGame({ seed: 6 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.regions['dale'].units = { sauron: { regular: atk, elite: 0 } };       // attacker (Shadow), post-casualty
  s.regions['erebor'].units = { dwarves: { regular: def, elite: 0 } };    // defender, post-casualty
  s.pendingCombat = {
    attacker: 'shadow', defender: 'fp', from: 'dale', to: 'erebor', round: 0,
    fortified: false, step: 'onslaught', attackerCard: 'sh-str-06' /* Stormcrow -> Great Host */,
    defenderCard: null, atkHits: 0, defHits: 0,
  };
  return s;
}

{
  console.log('\n=== 2:1 after casualties -> one automatic hit lands ===');
  const s = armed(4, 2);
  combatStep(s);
  check('the defender lost exactly one unit', units(s, 'erebor') === 1, `erebor=${units(s, 'erebor')}`);
  check('logged as the card\'s hit', s.log.some((e) => e.msg.includes('Great Host')), 'log line present');
}

{
  console.log('\n=== short of 2:1 after casualties -> no hit (mid-roll would have granted it) ===');
  const s = armed(3, 2); // 3 v 2 is under 2:1 — imagine the attacker lost a unit this round
  combatStep(s);
  check('the defender is untouched', units(s, 'erebor') === 2, `erebor=${units(s, 'erebor')}`);
}

{
  console.log('\n=== the latch: re-entering the step does not award a second hit ===');
  const s = armed(6, 3);
  combatStep(s);
  const after = units(s, 'erebor');
  s.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'dale', to: 'erebor', round: 0,
    fortified: false, step: 'onslaught', attackerCard: 'sh-str-06', defenderCard: null, atkHits: 0, defHits: 0, greatHostDone: true };
  combatStep(s);
  check('a latched round grants nothing further', units(s, 'erebor') === after, `erebor=${units(s, 'erebor')}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
