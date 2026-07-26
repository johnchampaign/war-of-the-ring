#!/usr/bin/env vite-node
// probe-tohit.mjs — WHO HITS ON WHAT. Three separate rules that are easy to conflate:
//
//   p.31 ATTACKING A CITY OR FORTIFICATION — "during the first round of combat ONLY the
//        attacker hits on a result of '6' or higher (instead of '5' or higher). After the
//        first Combat round is resolved, normal rules apply."
//   p.31 ATTACKING A STRONGHOLD / Fighting a Field Battle — "A field battle is resolved
//        NORMALLY as described before." A Stronghold grants NO to-hit penalty in a field
//        battle; its protection is the retreat-into-siege option.
//   p.32 CONDUCTING A SIEGE — "During a siege battle, the attacker hits only on a result
//        of '6' or higher, while the defender hits on a '5' or higher as normal" — every
//        round, not just the first.
//
// The engine folded Stronghold into the same `fortified` flag as City/Fortification, so a
// Stronghold field battle wrongly gave the attacker a 6+ round 0 — and so did a RELIEF
// battle fought against a besieger standing in the open outside one.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle } from '../src/engine/combat.ts';
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

/** The attacker's to-hit for a battle into `to`, as combatStep computes it. */
const atkTarget = (pc, round) => (pc.siege || (pc.fortified && round === 0)) ? 6 : 5;

function findSettlement(kind) {
  const e = Object.entries(REGIONS).find(([, d]) =>
    d.settlement === kind && d.nation && sideOfNation(d.nation) === 'fp');
  if (!e) throw new Error(`no Free Peoples ${kind}`);
  return e;
}

function fieldBattleAt(kind) {
  const [to, def] = findSettlement(kind);
  const from = def.adjacency.find((a) => REGIONS[a]);
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations.sauron.step = 0;
  state.regions[to].units = { [def.nation]: { regular: 2, elite: 0 } };
  state.regions[from].units = { sauron: { regular: 2, elite: 0 } };
  startBattle(state, 'shadow', from, to);
  // Stand and fight, so this stays a field battle rather than becoming a siege.
  if (state.pendingCombat.step === 'siegeWithdraw') state.pendingCombat.step = 'attackerCard';
  return { state, pc: state.pendingCombat, to, from, def };
}

// --- City: 6+ in round 0, 5+ after ------------------------------------------------
{
  console.log('\n=== City field battle (p.31) ===');
  const { pc } = fieldBattleAt('City');
  check('flagged fortified', pc.fortified === true);
  check('round 0: attacker hits on 6+', atkTarget(pc, 0) === 6, `target=${atkTarget(pc, 0)}`);
  check('round 1: back to 5+',          atkTarget(pc, 1) === 5, `target=${atkTarget(pc, 1)}`);
}

// --- Stronghold field battle: 5+ EVERY round --------------------------------------
{
  console.log('\n=== Stronghold field battle (p.31 "resolved normally") ===');
  const { pc } = fieldBattleAt('Stronghold');
  check('NOT flagged fortified — a Stronghold grants no to-hit penalty', pc.fortified === false,
    `fortified=${pc.fortified}`);
  check('round 0: attacker hits on 5+', atkTarget(pc, 0) === 5, `target=${atkTarget(pc, 0)}`);
  check('round 1: still 5+',            atkTarget(pc, 1) === 5, `target=${atkTarget(pc, 1)}`);
}

// --- Siege assault: 6+ EVERY round ------------------------------------------------
{
  console.log('\n=== siege assault (p.32) ===');
  const [to, def] = findSettlement('Stronghold');
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations.sauron.step = 0;
  state.regions[to].siegeBox = { units: { [def.nation]: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[to].units = { sauron: { regular: 3, elite: 0 } };
  state.regions[to].besieged = true;
  startBattle(state, 'shadow', to, to);
  const pc = state.pendingCombat;
  check('flagged as a siege battle', pc.siege === true);
  check('round 0: attacker hits on 6+', atkTarget(pc, 0) === 6, `target=${atkTarget(pc, 0)}`);
  check('round 1: STILL 6+ (every round, not just the first)', atkTarget(pc, 1) === 6,
    `target=${atkTarget(pc, 1)}`);
}

// --- Relief battle: the besieger is in the open, so 5+ ----------------------------
{
  console.log('\n=== relief battle vs a besieger in the open (p.32) ===');
  const [to, def] = findSettlement('Stronghold');
  const from = def.adjacency.find((a) => REGIONS[a]);
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations.sauron.step = 0;
  state.regions[to].siegeBox = { units: { [def.nation]: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[to].units = { sauron: { regular: 2, elite: 0 } };   // besieger in the field
  state.regions[to].besieged = true;
  state.regions[from].units = { [def.nation]: { regular: 3, elite: 0 } }; // relieving army
  startBattle(state, 'fp', from, to);
  const pc = state.pendingCombat;
  check('not a siege battle for the reliever', !pc.siege, `siege=${pc.siege}`);
  check('the Stronghold does not shield the besieger', pc.fortified === false, `fortified=${pc.fortified}`);
  check('round 0: reliever hits on 5+', atkTarget(pc, 0) === 5, `target=${atkTarget(pc, 0)}`);
}

// --- Sortie: both on 5+ -----------------------------------------------------------
{
  console.log('\n=== sortie (p.32 "both Armies scoring hits on a 5 or higher") ===');
  const [to, def] = findSettlement('Stronghold');
  const state = bareBoard();
  state.nations[def.nation].step = 0; state.nations.sauron.step = 0;
  state.regions[to].siegeBox = { units: { [def.nation]: { regular: 3, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  state.regions[to].units = { sauron: { regular: 2, elite: 0 } };
  state.regions[to].besieged = true;
  startBattle(state, 'fp', to, to);
  const pc = state.pendingCombat;
  check('not fortified', pc.fortified === false);
  check('not a siege battle', !pc.siege, `siege=${pc.siege}`);
  check('sortieing army hits on 5+', atkTarget(pc, 0) === 5, `target=${atkTarget(pc, 0)}`);
}

console.log(failures ? `\nprobe-tohit: ${failures} FAILURE(S)` : '\nprobe-tohit OK');
process.exit(failures ? 1 : 0);
