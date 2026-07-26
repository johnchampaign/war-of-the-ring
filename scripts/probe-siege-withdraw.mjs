#!/usr/bin/env vite-node
// probe-siege-withdraw.mjs — RETREATING INTO A SIEGE (rulebook p.31). "When attacking an
// enemy defending a region containing a Stronghold, BEFORE EVERY COMBAT ROUND the
// defender must choose to either fight a field battle or retreat into a siege", and an
// Army defending a region with a friendly Stronghold "may retreat into the Stronghold
// itself at the beginning of ANY Combat round". The engine used to offer that choice once,
// pre-battle, so a defender who fought round 1 and lost it could never fall back.
//
// Cases:
//   1. the choice is offered in round 0, and declining fights the round;
//   2. it is offered AGAIN at the start of round 1 (the regression this probe exists for);
//   3. withdrawing mid-battle boxes the garrison, establishes the siege and ends the
//      battle, recording the rounds actually fought;
//   4. it is NOT offered where RAW forbids it: a besieged Army cannot retreat (assault),
//      nor in a sortie, nor when the Stronghold isn't the defender's.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep, startBattle } from '../src/engine/combat.ts';
import { unitCount, forceUnitCount } from '../src/engine/armies.ts';
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

/** A Free Peoples Stronghold defended in the open, with Shadow attacking from next door. */
function strongholdSetup({ defenders = 3, attackers = 3 } = {}) {
  const entry = Object.entries(REGIONS).find(([, d]) =>
    d.settlement === 'Stronghold' && d.nation && sideOfNation(d.nation) === 'fp' && d.vp > 0);
  if (!entry) throw new Error('no Free Peoples Stronghold in map data');
  const [to, def] = entry;
  const from = def.adjacency.find((a) => REGIONS[a]);
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations[def.nation].active = true;
  state.nations.sauron.step = 0; state.nations.sauron.active = true;
  state.regions[to].units = { [def.nation]: { regular: defenders, elite: 0 } };
  state.regions[from].units = { sauron: { regular: attackers, elite: 0 } };
  return { state, to, from, def };
}

const boxCount = (state, id) => (state.regions[id].siegeBox ? forceUnitCount(state.regions[id].siegeBox) : 0);

// --- 1. offered in round 0; declining fights ------------------------------------
{
  console.log('\n=== round 0: the choice is offered, and declined ===');
  const { state, to, from } = strongholdSetup();
  startBattle(state, 'shadow', from, to);
  combatStep(state);
  check('defender is asked', state.pendingChoice?.kind === 'siegeWithdraw', `kind=${state.pendingChoice?.kind}`);
  check('the DEFENDER owns the choice', state.pendingChoice?.owner === 'fp');
  check('round is still 0', state.pendingCombat?.round === 0);
  const res = wotrAdapter.tryApplyAction(state, { kind: 'siegeWithdraw', withdraw: false }, 'fp');
  check('stand-and-fight accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('nobody was boxed', boxCount(after, to) === 0 && after.regions[to].besieged === false);
  check('the battle continues', after.pendingCombat !== null);
  check('round 0 is latched as answered', after.pendingCombat?.siegeWithdrawAsked === 0,
    `asked=${after.pendingCombat?.siegeWithdrawAsked}`);
}

// --- 2. offered AGAIN at the start of round 1 -----------------------------------
{
  console.log('\n=== round 1: the choice comes back (p.31 "before every combat round") ===');
  const { state, to, from } = strongholdSetup();
  startBattle(state, 'shadow', from, to);
  // Answer round 0 with "stand", then hand-advance the sub-machine to the next round the
  // way resolveRetreat does, and re-drive it.
  combatStep(state);
  let s = wotrAdapter.tryApplyAction(state, { kind: 'siegeWithdraw', withdraw: false }, 'fp');
  s = s.ok ? s.state : state;
  s.pendingCombat.round = 1;
  s.pendingCombat.step = 'attackerCard';
  s.pendingChoice = null;
  combatStep(s);
  check('defender is asked again in round 1', s.pendingChoice?.kind === 'siegeWithdraw',
    `kind=${s.pendingChoice?.kind}`);
  check('still the defender', s.pendingChoice?.owner === 'fp');
  check('the round-0 latch did not silence round 1', s.pendingCombat?.siegeWithdrawAsked === 0,
    `asked=${s.pendingCombat?.siegeWithdrawAsked}`);
}

// --- 3. withdrawing mid-battle -------------------------------------------------
{
  console.log('\n=== withdrawing at the start of round 2 ===');
  const { state, to, from } = strongholdSetup({ defenders: 3, attackers: 4 });
  startBattle(state, 'shadow', from, to);
  combatStep(state);
  let s = wotrAdapter.tryApplyAction(state, { kind: 'siegeWithdraw', withdraw: false }, 'fp');
  s = s.ok ? s.state : state;
  s.pendingCombat.round = 2;                    // two rounds fought
  s.pendingCombat.step = 'attackerCard';
  s.pendingChoice = null;
  combatStep(s);
  check('offered at the start of round 2', s.pendingChoice?.kind === 'siegeWithdraw');
  const res = wotrAdapter.tryApplyAction(s, { kind: 'siegeWithdraw', withdraw: true }, 'fp');
  check('withdraw accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : s;
  check('garrison is in the siege box', boxCount(after, to) === 3, `box has ${boxCount(after, to)}`);
  check('region flagged besieged', after.regions[to].besieged === true);
  check('besieger occupies the open field', unitCount(after, to) === 4, `${to} has ${unitCount(after, to)}`);
  check('origin vacated', unitCount(after, from) === 0, `${from} has ${unitCount(after, from)}`);
  check('battle is over', after.pendingCombat === null);
  check('rounds fought recorded, not 0', after.lastBattle?.rounds === 2, `rounds=${after.lastBattle?.rounds}`);
  check('nothing captured — the garrison still holds it', after.lastBattle?.captured === false);
  console.log(`  outcome: "${after.lastBattle?.outcome}"`);
}

// --- 4. not offered where RAW forbids it ---------------------------------------
{
  console.log('\n=== not offered when RAW forbids it ===');
  // (a) a besieged Army cannot retreat — an assault on the box.
  const a = strongholdSetup({ defenders: 2, attackers: 2 });
  a.state.regions[a.to].siegeBox = { units: { [a.def.nation]: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  a.state.regions[a.to].units = { sauron: { regular: 2, elite: 0 } };
  a.state.regions[a.to].besieged = true;
  startBattle(a.state, 'shadow', a.to, a.to);
  combatStep(a.state);
  check('assault: besieged Army is NOT offered a retreat',
    a.state.pendingChoice?.kind !== 'siegeWithdraw', `kind=${a.state.pendingChoice?.kind}`);

  // (b) a sortie is already a siege battle.
  const b = strongholdSetup({ defenders: 2, attackers: 2 });
  b.state.regions[b.to].siegeBox = { units: { [b.def.nation]: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  b.state.regions[b.to].units = { sauron: { regular: 2, elite: 0 } };
  b.state.regions[b.to].besieged = true;
  startBattle(b.state, 'fp', b.to, b.to);
  combatStep(b.state);
  check('sortie: no retreat-into-siege offer',
    b.state.pendingChoice?.kind !== 'siegeWithdraw', `kind=${b.state.pendingChoice?.kind}`);

  // (c) the Stronghold is the ATTACKER's, not the defender's — a Shadow army caught in
  //     an FP Stronghold region it doesn't control cannot duck inside.
  const c = strongholdSetup({ defenders: 2, attackers: 2 });
  c.state.regions[c.to].units = { sauron: { regular: 2, elite: 0 } };   // Shadow now holds the field
  c.state.regions[c.from].units = { [c.def.nation]: { regular: 2, elite: 0 } };
  startBattle(c.state, 'fp', c.from, c.to);
  combatStep(c.state);
  check('defender not controlling the Stronghold gets no offer',
    c.state.pendingChoice?.kind !== 'siegeWithdraw', `kind=${c.state.pendingChoice?.kind}`);
}

console.log(failures ? `\nprobe-siege-withdraw: ${failures} FAILURE(S)` : '\nprobe-siege-withdraw OK');
process.exit(failures ? 1 : 0);
