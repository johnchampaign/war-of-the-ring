#!/usr/bin/env vite-node
// probe-lift-siege-merge.mjs — UNITS MUST NOT VANISH WHEN A SIEGE LIFTS.
//
// When a siege ends, the boxed garrison returns to the open field (p.31: "When a siege
// ends, move any surviving defenders from the Stronghold Box to its region on the map
// again"). Both lift paths used to do that by ASSIGNMENT — `r.units = box.units` — which
// is only safe if the field is empty. It is not always empty: the besieger can leave
// while friendly figures stand there, or a `besieged` flag can outlive its besieger with
// friendly units walked back in. In that state the assignment silently deleted every
// figure already in the field.
//
// Caught in the wild by the tournament's `vanished-units` counter: a split move that
// left a one-unit garrison behind in a stale-besieged Stronghold had that unit
// overwritten by the returning box (seeds 170 and 256, 1 unit each), along with a Leader.
//
// Cases:
//   1. liftSiegeIfAbandoned (armies.ts) via a split move out of the region — the
//      historical reproducer;
//   2. the same, via a whole-army move that vacates entirely (field genuinely empty);
//   3. liftSiege (combat.ts) reached through a battle, with friendly figures in the field.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { moveArmySplit, moveArmy, unitCount, liftSiegeIfAbandoned } from '../src/engine/armies.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Every Army unit anywhere: regions, siege boxes, reinforcements. Move-family actions
 *  only relocate units, so this total must never drop across one. */
function armyTotal(s) {
  let n = 0;
  for (const r of Object.values(s.regions)) {
    for (const u of Object.values(r.units)) n += u.regular + u.elite;
    if (r.siegeBox) for (const u of Object.values(r.siegeBox.units)) n += u.regular + u.elite;
  }
  for (const p of Object.values(s.reinforcements)) n += (p.regular ?? 0) + (p.elite ?? 0);
  return n;
}
const leaderTotal = (s) => Object.values(s.regions)
  .reduce((n, r) => n + r.leaders + (r.siegeBox?.leaders ?? 0), 0);

function bareBoard() {
  const state = startGame(createGame({ seed: 1 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return state;
}

/** A Free Peoples Stronghold whose `besieged` flag has outlived its besieger, with
 *  friendly figures standing in the open field beside the boxed garrison. */
function staleSiege({ field = 2, box = 3, fieldLeaders = 1, boxLeaders = 2 } = {}) {
  const entry = Object.entries(REGIONS).find(([, d]) =>
    d.settlement === 'Stronghold' && d.nation && sideOfNation(d.nation) === 'fp');
  const [id, def] = entry;
  const to = def.adjacency.find((a) => REGIONS[a]);
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations[def.nation].active = true;
  state.regions[id].units = { [def.nation]: { regular: field, elite: 0 } };
  state.regions[id].leaders = fieldLeaders;
  state.regions[id].siegeBox = { units: { [def.nation]: { regular: box, elite: 0 } }, leaders: boxLeaders, nazgul: 0, characters: [] };
  state.regions[id].besieged = true;
  return { state, id, to, def };
}

// --- 1. split move out of a stale-besieged Stronghold (the historical repro) --------
{
  console.log('\n=== split move out of a stale-besieged Stronghold ===');
  const { state, id, to, def } = staleSiege();
  const before = armyTotal(state), beforeLdr = leaderTotal(state);
  const ok = moveArmySplit(state, id, to, 'fp', { units: { [def.nation]: { regular: 1 } }, leaders: 1 });
  check('the split move applied', ok === true);
  check('no unit vanished', armyTotal(state) === before, `${before} -> ${armyTotal(state)}`);
  check('no Leader vanished', leaderTotal(state) === beforeLdr, `${beforeLdr} -> ${leaderTotal(state)}`);
  check('siege lifted', state.regions[id].besieged === false && state.regions[id].siegeBox == null);
  // 2 in the field - 1 moved out + 3 returning from the box = 4 left behind.
  check('garrison merged with the unit left behind', unitCount(state, id) === 4,
    `${id} has ${unitCount(state, id)} (want 4)`);
  check('the mover arrived', unitCount(state, to) === 1, `${to} has ${unitCount(state, to)}`);
}

// --- 2. whole-army move that vacates the field entirely ----------------------------
{
  console.log('\n=== whole-army move vacating the field ===');
  const { state, id, to } = staleSiege({ field: 2, box: 3 });
  const before = armyTotal(state);
  const ok = moveArmy(state, id, to, 'fp');
  check('the move applied', ok === true);
  check('no unit vanished', armyTotal(state) === before, `${before} -> ${armyTotal(state)}`);
  check('the box returned to an empty field', unitCount(state, id) === 3, `${id} has ${unitCount(state, id)}`);
  check('the whole army arrived', unitCount(state, to) === 2, `${to} has ${unitCount(state, to)}`);
}

// --- 3. lifting directly, with friendly figures already in the field ---------------
{
  console.log('\n=== liftSiegeIfAbandoned with friendly figures in the field ===');
  const { state, id } = staleSiege({ field: 4, box: 5, fieldLeaders: 3, boxLeaders: 1 });
  const before = armyTotal(state), beforeLdr = leaderTotal(state);
  liftSiegeIfAbandoned(state, id);
  check('no unit vanished', armyTotal(state) === before, `${before} -> ${armyTotal(state)}`);
  check('no Leader vanished', leaderTotal(state) === beforeLdr, `${beforeLdr} -> ${leaderTotal(state)}`);
  check('field and box merged', unitCount(state, id) === 9, `${id} has ${unitCount(state, id)} (want 4+5)`);
  check('Leaders merged', state.regions[id].leaders === 4, `leaders=${state.regions[id].leaders} (want 3+1)`);
  check('siege cleared', state.regions[id].besieged === false && state.regions[id].siegeBox == null);
}

// --- 4. a live siege must NOT lift (the besieger still holds the field) ------------
{
  console.log('\n=== a live siege is left alone ===');
  const { state, id, def } = staleSiege({ field: 0, box: 3 });
  state.regions[id].units = { sauron: { regular: 2, elite: 0 } }; // besieger in the open
  state.regions[id].leaders = 0;
  const before = armyTotal(state);
  liftSiegeIfAbandoned(state, id);
  check('siege still standing', state.regions[id].besieged === true && state.regions[id].siegeBox != null);
  check('nothing moved or vanished', armyTotal(state) === before, `${before} -> ${armyTotal(state)}`);
  check('besieger untouched in the field', unitCount(state, id) === 2, `${id} has ${unitCount(state, id)}`);
  void def;
}

console.log(failures ? `\nprobe-lift-siege-merge: ${failures} FAILURE(S)` : '\nprobe-lift-siege-merge OK');
process.exit(failures ? 1 : 0);
