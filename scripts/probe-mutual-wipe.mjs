#!/usr/bin/env vite-node
// probe-mutual-wipe.mjs — Combat hits are SIMULTANEOUS (rulebook p.29), and a wipe-out
// takes no ground (p.32, "Capturing a Settlement": both capture triggers require the
// attacker to still be there). This drives the combat sub-machine straight at the
// casualty step with both sides holding a hit, which random play almost never reaches:
//
//   1. field battle, mutual wipe — the defender MUST still take the dead attacker's
//      hits, and neither side captures anything (no marker, no VP);
//   2. field battle, attacker survives — the control marker and VP still land
//      (guards against "fix the wipe, break the ordinary capture");
//   3. siege assault, mutual wipe — the Stronghold does NOT fall (p.32 wants "at least
//      one unit remaining in the region"), and the siege ends (p.31).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep, resolveAdvanceChoice } from '../src/engine/combat.ts';
import { unitCount, settlementController } from '../src/engine/armies.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A board with every army swept off it, so only the units a case places exist. */
function bareBoard() {
  const state = startGame(createGame({ seed: 1 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return state;
}

/** A VP-worth Free Peoples Settlement plus an adjacent region to attack out of. */
function pickTarget(kind) {
  for (const [id, def] of Object.entries(REGIONS)) {
    if (def.settlement !== kind || !(def.vp > 0)) continue;
    if (!def.nation || sideOfNation(def.nation) !== 'fp') continue;
    const from = def.adjacency.find((a) => REGIONS[a]);
    if (from) return { to: id, from, def };
  }
  throw new Error(`no Free Peoples ${kind} with VP found in map data`);
}

const put = (state, id, nation, regular) => { state.regions[id].units = { [nation]: { regular, elite: 0 } }; };

/** Park the sub-machine one step short of casualties, with a hit pending each way. */
function armCasualtyStep(state, pc) {
  state.pendingCombat = {
    round: 0, fortified: false, step: 'attackerCasualties',
    attackerCard: null, defenderCard: null, ...pc,
  };
}

// --- 1. field battle, mutual wipe ------------------------------------------------
{
  console.log('\n=== field battle, mutual wipe ===');
  const { to, from, def } = pickTarget('City');
  const state = bareBoard();
  put(state, from, 'sauron', 1);
  put(state, to, def.nation, 1);
  const vp0 = state.victoryPoints.shadow;
  armCasualtyStep(state, {
    attacker: 'shadow', defender: 'fp', from, to,
    atkHits: 1, defHits: 1, atkUnits0: 1, defUnits0: 1,
  });
  combatStep(state);

  check('attacker is wiped', unitCount(state, from) === 0, `${from} has ${unitCount(state, from)}`);
  check("defender still took the dead attacker's hit (SIMULTANEOUS, p.29)",
    unitCount(state, to) === 0, `${to} has ${unitCount(state, to)}`);
  check('battle ended', state.pendingCombat === null);
  check('no capture claimed', state.lastBattle?.captured === false, `captured=${state.lastBattle?.captured}`);
  check('no Settlement Control marker', settlementController(state, to) !== 'shadow',
    `controller=${settlementController(state, to)}`);
  check('no VP awarded', state.victoryPoints.shadow === vp0,
    `${vp0} -> ${state.victoryPoints.shadow}`);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

// --- 2. field battle, attacker survives (ordinary capture still works) -----------
{
  console.log('\n=== field battle, attacker survives ===');
  const { to, from, def } = pickTarget('City');
  const state = bareBoard();
  put(state, from, 'sauron', 3);
  put(state, to, def.nation, 1);
  const vp0 = state.victoryPoints.shadow;
  armCasualtyStep(state, {
    attacker: 'shadow', defender: 'fp', from, to,
    atkHits: 1, defHits: 1, atkUnits0: 3, defUnits0: 1,
  });
  combatStep(state);

  const defLeft = (state.regions[to].units[def.nation]?.regular ?? 0) + (state.regions[to].units[def.nation]?.elite ?? 0);
  check('defender wiped', defLeft === 0, `${def.nation} units left: ${defLeft}`);
  // The advance is a CHOICE now (p.31 "may move all or part"; FFG FAQ: always
  // optional), so the win pauses on advanceChoice and the capture fires only when
  // units actually enter.
  check('the winner is asked to advance', state.pendingChoice?.kind === 'advanceChoice', state.pendingChoice?.kind ?? 'none');
  check('no capture before entry', settlementController(state, to) !== 'shadow', `controller=${settlementController(state, to)}`);
  resolveAdvanceChoice(state, { advance: true });
  check('Settlement Control marker placed on advance', settlementController(state, to) === 'shadow',
    `controller=${settlementController(state, to)}`);
  check('VP awarded', state.victoryPoints.shadow === vp0 + def.vp,
    `${vp0} -> ${state.victoryPoints.shadow} (want +${def.vp})`);
  check('attacker advanced in', unitCount(state, to) === 2, `${to} has ${unitCount(state, to)}`);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

// --- 3. siege assault, mutual wipe ----------------------------------------------
{
  console.log('\n=== siege assault, mutual wipe ===');
  const { to, def } = pickTarget('Stronghold');
  const state = bareBoard();
  // Besieger occupies the region's open field (from === to); garrison is in the box.
  put(state, to, 'sauron', 1);
  state.regions[to].siegeBox = { units: { [def.nation]: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[to].besieged = true;
  const vp0 = state.victoryPoints.shadow;
  armCasualtyStep(state, {
    attacker: 'shadow', defender: 'fp', from: to, to,
    atkHits: 1, defHits: 1, atkUnits0: 1, defUnits0: 1,
    siege: true, siegeRoundsLeft: 1, boxed: 'fp',
  });
  combatStep(state);

  // from === to in an assault, so the region holds the besieger AND (once the siege
  // lifts) whatever the box had left — count the garrison's nation to tell them apart.
  const boxUnits = state.regions[to].siegeBox;
  const garrison = boxUnits
    ? (boxUnits.units[def.nation]?.regular ?? 0) + (boxUnits.units[def.nation]?.elite ?? 0)
    : (state.regions[to].units[def.nation]?.regular ?? 0) + (state.regions[to].units[def.nation]?.elite ?? 0);
  check("garrison still took the dead besieger's hit (SIMULTANEOUS, p.29)",
    garrison === 0, `${def.nation} units left: ${garrison}`);
  check('region ends empty — both Armies gone', unitCount(state, to) === 0, `${to} has ${unitCount(state, to)}`);
  check('battle ended', state.pendingCombat === null);
  check('Stronghold NOT captured (p.32 needs a surviving besieger)',
    state.lastBattle?.captured === false, `captured=${state.lastBattle?.captured}`);
  check('no Settlement Control marker', settlementController(state, to) !== 'shadow',
    `controller=${settlementController(state, to)}`);
  check('no VP awarded', state.victoryPoints.shadow === vp0, `${vp0} -> ${state.victoryPoints.shadow}`);
  check('siege ended (p.31 — an Army was eliminated)', state.regions[to].besieged === false);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

console.log(failures ? `\nprobe-mutual-wipe: ${failures} FAILURE(S)` : '\nprobe-mutual-wipe OK');
process.exit(failures ? 1 : 0);
