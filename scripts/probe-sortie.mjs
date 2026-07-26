#!/usr/bin/env vite-node
// probe-sortie.mjs — SORTIE (rulebook p.32): "An Army inside a Stronghold under siege may
// attack the besieging Army by using an Action die for battle." It is a field battle, not
// a siege battle: the sortieing Army forfeits the Stronghold's protection, so BOTH sides
// hit on 5+. A rearguard may be left behind in the Stronghold. If the attacker ceases, it
// moves back inside. A winning sortie "cannot advance outside of the region".
//
// In this engine the besieger occupies the region's open field and the garrison sits in
// `region.siegeBox`, so a sortie has from === to with the ATTACKER boxed — the mirror of
// an assault. Cases:
//   1. the sortie is offered to the besieged side, and NOT to the besieger as a sortie;
//   2. it is a field battle (not fortified, not a capped siege assault);
//   3. sortie destroys the besiegers -> siege broken, garrison out, nothing captured;
//   4. sortie wiped with the besieger still in the region -> the Stronghold FALLS (p.32);
//   5. a surviving rearguard keeps the Stronghold (not all defenders were eliminated);
//   6. the attacker ceases -> back inside, siege carries on.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep, startBattle, attackTargets } from '../src/engine/combat.ts';
import { unitCount, settlementController, forceUnitCount } from '../src/engine/armies.ts';
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

/** A Free Peoples Stronghold under siege: FP garrison boxed, Shadow besieging the field. */
function siegeSetup({ garrison = 2, besiegers = 2 } = {}) {
  const entry = Object.entries(REGIONS).find(([, d]) =>
    d.settlement === 'Stronghold' && d.nation && sideOfNation(d.nation) === 'fp' && d.vp > 0);
  if (!entry) throw new Error('no Free Peoples Stronghold in map data');
  const [id, def] = entry;
  const state = bareBoard();
  // Both nations At War (step 0) — otherwise their units are barred from attacking and
  // are forced into the rearguard, which would mask what this probe is testing.
  state.nations[def.nation].step = 0; state.nations[def.nation].active = true;
  state.nations.sauron.step = 0; state.nations.sauron.active = true;
  state.regions[id].siegeBox = { units: { [def.nation]: { regular: garrison, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[id].units = { sauron: { regular: besiegers, elite: 0 } };
  state.regions[id].besieged = true;
  return { state, id, def };
}

/** Park the sortie's sub-machine at the casualty step with the given hits pending. */
function armSortie(state, id, { atkHits = 0, defHits = 0, rearguard = null } = {}) {
  state.pendingCombat = {
    attacker: 'fp', defender: 'shadow', from: id, to: id, round: 0, fortified: false,
    step: 'attackerCasualties', attackerCard: null, defenderCard: null,
    atkHits, defHits, boxed: 'fp',
    atkUnits0: forceUnitCount(state.regions[id].siegeBox), defUnits0: unitCount(state, id),
    ...(rearguard ? { rearguard } : {}),
  };
}

const boxCount = (state, id) => (state.regions[id].siegeBox ? forceUnitCount(state.regions[id].siegeBox) : 0);

// --- 1. the sortie is offered to the besieged side only --------------------------
{
  console.log('\n=== the sortie is offered to the garrison, not to the besieger ===');
  const { state, id } = siegeSetup();
  const fpTargets = attackTargets(state, 'fp');
  const shTargets = attackTargets(state, 'shadow');
  check('garrison may attack in its own region', fpTargets.some(([f, t]) => f === id && t === id),
    JSON.stringify(fpTargets));
  check('besieger may still assault the box', shTargets.some(([f, t]) => f === id && t === id),
    JSON.stringify(shTargets));
  // With the besieger gone there is nothing to sortie against.
  const noEnemy = siegeSetup();
  noEnemy.state.regions[noEnemy.id].units = {};
  check('no sortie when no besieger stands in the field',
    !attackTargets(noEnemy.state, 'fp').some(([f, t]) => f === noEnemy.id && t === noEnemy.id));
}

// --- 2. a sortie is a field battle, not a siege assault ---------------------------
{
  console.log('\n=== a sortie is a field battle ===');
  const { state, id } = siegeSetup();
  startBattle(state, 'fp', id, id);
  const pc = state.pendingCombat;
  check('battle started', !!pc);
  check('attacker is the boxed garrison', pc?.boxed === 'fp', `boxed=${pc?.boxed}`);
  check('NOT fortified — both sides hit on 5+ (p.32)', pc?.fortified === false, `fortified=${pc?.fortified}`);
  check('not a round-capped siege assault', !pc?.siege, `siege=${pc?.siege}`);
  check('attacking force counted from the box', pc?.atkUnits0 === 2, `atkUnits0=${pc?.atkUnits0}`);
  check('defending force is the besieger in the field', pc?.defUnits0 === 2, `defUnits0=${pc?.defUnits0}`);
}

// --- 3. the sortie breaks the siege ----------------------------------------------
{
  console.log('\n=== sortie destroys the besiegers ===');
  const { state, id } = siegeSetup({ garrison: 2, besiegers: 1 });
  armSortie(state, id, { atkHits: 1 });
  combatStep(state);
  check('besiegers destroyed', unitCount(state, id) === 2, `${id} has ${unitCount(state, id)}`);
  check('siege lifted', state.regions[id].besieged === false && state.regions[id].siegeBox == null);
  check('garrison is out in the open field', unitCount(state, id) === 2);
  check('Stronghold still Free Peoples', settlementController(state, id) !== 'shadow',
    `controller=${settlementController(state, id)}`);
  check('nothing captured', state.lastBattle?.captured === false);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

// --- 4. the sortie is wiped and the Stronghold falls -----------------------------
{
  console.log('\n=== sortie wiped, besieger holds the region ===');
  const { state, id, def } = siegeSetup({ garrison: 1, besiegers: 2 });
  const vp0 = state.victoryPoints.shadow;
  armSortie(state, id, { defHits: 1 });
  combatStep(state);
  check('sortie force destroyed', boxCount(state, id) === 0, `box has ${boxCount(state, id)}`);
  check('Stronghold captured by the besieger (p.32)', settlementController(state, id) === 'shadow',
    `controller=${settlementController(state, id)}`);
  check('VP awarded to the besieger', state.victoryPoints.shadow === vp0 + def.vp,
    `${vp0} -> ${state.victoryPoints.shadow} (want +${def.vp})`);
  check('siege state cleared', state.regions[id].besieged === false && state.regions[id].siegeBox == null);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

// --- 5. a surviving rearguard keeps the Stronghold -------------------------------
{
  console.log('\n=== rearguard left behind holds the Stronghold ===');
  const { state, id, def } = siegeSetup({ garrison: 1, besiegers: 2 }); // box = the sortie force only
  const vp0 = state.victoryPoints.shadow;
  armSortie(state, id, {
    defHits: 1,
    rearguard: { units: { [def.nation]: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] },
  });
  combatStep(state);
  check('sortie force died but the rearguard remains', boxCount(state, id) === 1, `box has ${boxCount(state, id)}`);
  check('Stronghold NOT captured — not all defenders eliminated', settlementController(state, id) !== 'shadow',
    `controller=${settlementController(state, id)}`);
  check('no VP awarded', state.victoryPoints.shadow === vp0, `${vp0} -> ${state.victoryPoints.shadow}`);
  check('siege continues', state.regions[id].besieged === true);
  console.log(`  outcome: "${state.lastBattle?.outcome}"`);
}

// --- 6. the attacker ceases and goes back inside ---------------------------------
{
  console.log('\n=== the sortie ceases ===');
  const { state, id } = siegeSetup({ garrison: 2, besiegers: 2 });
  armSortie(state, id, {}); // nobody scores; the attacker will be asked to continue
  combatStep(state);
  check('attacker asked whether to press on', state.pendingChoice?.kind === 'combatContinue',
    `pendingChoice=${state.pendingChoice?.kind}`);
  const res = wotrAdapter.tryApplyAction(state, { kind: 'combatContinue', cont: false }, 'fp');
  check('cease accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('garrison back inside the Stronghold', boxCount(after, id) === 2, `box has ${boxCount(after, id)}`);
  check('besiegers still in the field', unitCount(after, id) === 2, `${id} has ${unitCount(after, id)}`);
  check('siege carries on', after.regions[id].besieged === true);
  check('nothing captured', after.lastBattle?.captured === false);
  console.log(`  outcome: "${after.lastBattle?.outcome}"`);
}

console.log(failures ? `\nprobe-sortie: ${failures} FAILURE(S)` : '\nprobe-sortie OK');
process.exit(failures ? 1 : 0);
