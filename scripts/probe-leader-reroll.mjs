#!/usr/bin/env vite-node
// probe-leader-reroll.mjs — THE LEADER RE-ROLL COUNT (rulebook p.30).
//
//   "…re-roll a number of dice equal to the Army's Leadership, up to the number of
//    dice that failed to score a hit."
//
// The allowance is fixed BEFORE any re-roll die is thrown. The engine used to write
// it as the loop condition — `for (i = 0; i < Math.min(lead, failed); i++)` — while
// the body did `failed--` on every re-roll that HIT. Because a `for` condition is
// re-evaluated each pass, every successful re-roll silently stole one of the
// re-rolls still owed. A player reported exactly that: 3 misses with plenty of
// Leadership, but only 2 re-roll dice thrown.
//
// The invariant: with Leadership >= dice, re-rolls thrown == misses, ALWAYS —
// regardless of how many of those re-rolls happen to hit.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function bareBoard(seed) {
  const state = startGame(createGame({ seed }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return state;
}

/** A Fortification held by the Free Peoples, plus somewhere to attack out of. */
function fortTarget() {
  const e = Object.entries(REGIONS).find(([, d]) =>
    d.settlement === 'Fortification' && d.nation && sideOfNation(d.nation) === 'fp');
  if (!e) throw new Error('no Free Peoples Fortification in map data');
  const [to, def] = e;
  const from = def.adjacency.find((a) => REGIONS[a]);
  return { to, from, def };
}

/** Attack a Fortification with 5 Regulars + `nazgul` Leadership; return the roll. */
function rollOnce(seed, nazgul) {
  const { to, from, def } = fortTarget();
  const state = bareBoard(seed);
  state.nations[def.nation].step = 0; state.nations.sauron.step = 0;
  state.regions[to].units = { [def.nation]: { regular: 3, elite: 0 } };
  state.regions[from].units = { sauron: { regular: 5, elite: 0 } };
  state.regions[from].nazgul = nazgul;
  startBattle(state, 'shadow', from, to);
  const pc = state.pendingCombat;
  if (pc.step === 'siegeWithdraw') pc.step = 'attackerCard';
  pc.step = 'beginRound';                 // both sides have passed on Combat cards
  combatStep(state);
  return (state.pendingCombat ?? {}).atkRoll ?? state.lastBattle?.atkRoll;
}

// --- Leadership 5 vs 5 dice: every miss MUST be re-rolled -------------------------
{
  console.log('\n=== Leadership >= dice: re-rolls thrown == misses, every time ===');
  let checked = 0, hitInReroll = 0, worstShort = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollOnce(seed, 5);
    if (!roll || !roll.dice.length) continue;
    const t = roll.target, rt = roll.rerollTarget ?? t;
    const isHit = (d, tt) => d === 6 || (d !== 1 && d >= tt);
    const misses = roll.dice.filter((d) => !isHit(d, t)).length;
    checked++;
    if (roll.rerolls.some((d) => isHit(d, rt))) hitInReroll++;
    worstShort = Math.max(worstShort, misses - roll.rerolls.length);
    if (roll.rerolls.length !== misses) {
      check(`seed ${seed}: dice [${roll.dice}] (hit on ${t}) → ${misses} misses, ${roll.rerolls.length} re-rolls [${roll.rerolls}]`, false);
      break;
    }
  }
  check(`all ${checked} rolls re-rolled every miss`, worstShort === 0, `worst shortfall ${worstShort}`);
  // Guard the guard: if no re-roll ever HIT, the old bug couldn't have shown up here
  // and this probe would pass vacuously.
  check(`the sample exercises the bug (${hitInReroll} rolls had a re-roll that hit)`, hitInReroll > 0);
}

// --- Leadership below the miss count still caps at Leadership ---------------------
{
  console.log('\n=== Leadership < misses: capped at Leadership (never more) ===');
  let checked = 0, over = 0, atCap = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const roll = rollOnce(seed, 1); // Leadership 1
    if (!roll || !roll.dice.length) continue;
    const t = roll.target;
    const misses = roll.dice.filter((d) => !(d === 6 || (d !== 1 && d >= t))).length;
    const want = Math.min(1, misses);
    checked++;
    if (roll.rerolls.length > want) over++;
    if (roll.rerolls.length === want && want === 1) atCap++;
  }
  check(`all ${checked} rolls capped at Leadership`, over === 0, `${over} exceeded the cap`);
  check(`the cap was actually reached (${atCap} rolls)`, atCap > 0);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
