#!/usr/bin/env vite-node
// probe-relief-advance.mjs — Relieving a siege (rulebook p.32): an outside Army attacks
// the force besieging a friendly Stronghold. "The attacking Army cannot advance into the
// region containing the Stronghold unless the besieging Army is destroyed or retreats" —
// so once it IS destroyed, the End of Battle advance (p.31, "may immediately move") opens
// up. It is a real choice: the region is friendly already, so nothing is captured, and
// piling onto the freed garrison can breach the 10-unit stacking limit (p.26).
//
// Cases:
//   1. the choice is offered to the reliever, and declining leaves everyone in place;
//   2. accepting merges the relieving Army into the freed region;
//   3. a rearguard (p.28) never advances — it stays behind either way;
//   4. an advance that breaches the stacking limit chains into the removeExcess prompt.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep } from '../src/engine/combat.ts';
import { unitCount, settlementController } from '../src/engine/armies.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function bareBoard() {
  const state = startGame(createGame({ seed: 1 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return state;
}

/** A Free Peoples Stronghold under siege, plus an adjacent region to relieve from. */
function reliefSetup({ garrison = 1, relievers = 2, rearguardRegulars = 0 } = {}) {
  let picked = null;
  for (const [id, def] of Object.entries(REGIONS)) {
    if (def.settlement !== 'Stronghold' || !def.nation || sideOfNation(def.nation) !== 'fp') continue;
    const from = def.adjacency.find((a) => REGIONS[a]);
    if (from) { picked = { to: id, from, def }; break; }
  }
  if (!picked) throw new Error('no Free Peoples Stronghold with an adjacent region');
  const { to, from, def } = picked;
  const state = bareBoard();
  // Garrison boxed inside the Stronghold; Shadow besieging in the open field.
  state.regions[to].siegeBox = { units: { [def.nation]: { regular: garrison, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[to].units = { sauron: { regular: 1, elite: 0 } };
  state.regions[to].besieged = true;
  // The relieving Free Peoples Army next door.
  state.regions[from].units = { [def.nation]: { regular: relievers, elite: 0 } };
  // A rearguard (p.28) is held aside from `from` for the battle's duration.
  const rearguard = rearguardRegulars
    ? { units: { [def.nation]: { regular: rearguardRegulars, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] }
    : null;
  // One attacker hit pending, none the other way: the besieger dies, the reliever lives.
  state.pendingCombat = {
    attacker: 'fp', defender: 'shadow', from, to, round: 0, fortified: true,
    step: 'attackerCasualties', attackerCard: null, defenderCard: null,
    atkHits: 1, defHits: 0, atkUnits0: relievers, defUnits0: 1,
    ...(rearguard ? { rearguard } : {}),
  };
  return { state, to, from, def };
}

// --- 1. the choice is offered; declining holds position ---------------------------
{
  console.log('\n=== siege relieved: the advance is offered, and declined ===');
  const { state, to, from } = reliefSetup();
  combatStep(state);

  check('besieger destroyed', unitCount(state, to) === 1, `${to} has ${unitCount(state, to)} (the freed garrison)`);
  check('siege lifted', state.regions[to].besieged === false && state.regions[to].siegeBox == null);
  check('battle over', state.pendingCombat === null);
  check('reliever is asked to advance', state.pendingChoice?.kind === 'relieveAdvance',
    `pendingChoice=${state.pendingChoice?.kind}`);
  check('the reliever owns the choice', state.pendingChoice?.owner === 'fp');
  check('it is the reliever to act', wotrAdapter.currentActor(state) === 'fp');
  const legal = wotrAdapter.legalActions(state, 'fp').filter((a) => a.kind === 'relieveAdvance');
  check('both options offered', legal.length === 2, JSON.stringify(legal));

  const res = wotrAdapter.tryApplyAction(state, { kind: 'relieveAdvance', advance: false }, 'fp');
  check('decline accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('reliever held position', unitCount(after, from) === 2, `${from} has ${unitCount(after, from)}`);
  check('freed garrison alone in the Stronghold', unitCount(after, to) === 1, `${to} has ${unitCount(after, to)}`);
  check('no lingering choice', after.pendingChoice === null);
}

// --- 2. accepting advances the Army --------------------------------------------
{
  console.log('\n=== siege relieved: the advance is accepted ===');
  const { state, to, from, def } = reliefSetup();
  combatStep(state);
  const res = wotrAdapter.tryApplyAction(state, { kind: 'relieveAdvance', advance: true }, 'fp');
  check('advance accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('origin vacated', unitCount(after, from) === 0, `${from} has ${unitCount(after, from)}`);
  check('reliever joined the garrison', unitCount(after, to) === 3, `${to} has ${unitCount(after, to)}`);
  check('Settlement still friendly, nothing captured', settlementController(after, to) !== 'shadow',
    `controller=${settlementController(after, to)}`);
  check('no lingering choice', after.pendingChoice === null);
  check('siege stays lifted', after.regions[to].besieged === false);
}

// --- 3. a rearguard never advances (p.28) ---------------------------------------
{
  console.log('\n=== rearguard stays behind ===');
  const { state, to, from } = reliefSetup({ relievers: 2, rearguardRegulars: 1 });
  combatStep(state);
  check('rearguard held aside during the battle', unitCount(state, from) === 2,
    `${from} has ${unitCount(state, from)} (battle force only)`);
  const res = wotrAdapter.tryApplyAction(state, { kind: 'relieveAdvance', advance: true }, 'fp');
  check('advance accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('rearguard restored and left behind', unitCount(after, from) === 1, `${from} has ${unitCount(after, from)}`);
  check('only the battle force advanced', unitCount(after, to) === 3, `${to} has ${unitCount(after, to)}`);
}

// --- 4. an over-stacking advance chains into removeExcess -------------------------
{
  console.log('\n=== advance breaching the 10-unit limit ===');
  // Garrison 5 (the siege cap) + 8 relievers = 13 in one region.
  const { state, to } = reliefSetup({ garrison: 5, relievers: 8 });
  combatStep(state);
  const res = wotrAdapter.tryApplyAction(state, { kind: 'relieveAdvance', advance: true }, 'fp');
  check('advance accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('over the limit before removal', unitCount(after, to) === 13, `${to} has ${unitCount(after, to)}`);
  check('removeExcess prompted', after.pendingChoice?.kind === 'removeExcess',
    `pendingChoice=${after.pendingChoice?.kind}`);
  check('the reliever owns the removal', after.pendingChoice?.owner === 'fp');
}

console.log(failures ? `\nprobe-relief-advance: ${failures} FAILURE(S)` : '\nprobe-relief-advance OK');
process.exit(failures ? 1 : 0);
