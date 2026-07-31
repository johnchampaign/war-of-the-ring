#!/usr/bin/env vite-node
// probe-stacking-leaders-victory.mjs — THREE BUGS FROM A PLAYER REPORT.
//
// A player reported three things after a run of matches. All three reproduced:
//
//   1. "winning conditions are not regarded. Last match I played shadow, Free People
//      reached 4 VP in the last round but I managed to get 11 VP in the same round.
//      Victory Check favoured him while I should have won."
//      Rulebook p.44 numbers the Victory conditions and says "lower-numbered Victory
//      conditions take precedence over higher-numbered Victory conditions, if two or
//      more are achieved on the same turn". Shadow's "Conquers Middle-earth" (>=10 VP)
//      is condition 3; the FP "Sauron is Banished" (>=4 VP) is condition 4. So the
//      SHADOW wins a simultaneous pair. checkMilitaryVictory tested the FP first.
//
//   2. "In some cases Nazgul can be moved as part of Free People armies."
//      Leaders/Nazgul are not Army units, so a region holding only Nazgul is still
//      "free" (p.10) and an FP Army may march in. Every whole-stack mover then did
//      `dst.leaders += src.leaders; dst.nazgul += src.nazgul` — merging BOTH pools
//      regardless of who was moving — so the FP Army carried the Nazgul out with it.
//
//   3. "army limit is not regarded in every case, sometimes enemy attacks with way
//      more than 10 units." Voluntary moves prompt for the over-stack removal via
//      afterMove, but involuntary growth did not: a defender RETREATING (p.31) into a
//      region already holding a friendly Army merged straight past the 10-unit limit
//      with nothing to trim it, and the oversized Army went on to attack at full
//      strength. p.26: "If, at the end of any action ... more than 10 units are in the
//      same region, the excess units must be removed ... by the controlling player."
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { checkMilitaryVictory } from '../src/engine/victory.ts';
import { moveArmy, moveArmySplit, unitCount, overStack, STACKING_LIMIT } from '../src/engine/armies.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function bareBoard() {
  const state = startGame(createGame({ seed: 7 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return state;
}

/** An adjacent pair of regions belonging to the SAME nation, so the not-At-War border
 *  rule (p.27) never interferes with the move under test. */
function samePair(nation) {
  for (const [id, def] of Object.entries(REGIONS)) {
    if (def.nation !== nation) continue;
    const to = def.adjacency.find((a) => REGIONS[a]?.nation === nation);
    if (to) return [id, to];
  }
  throw new Error(`no same-nation adjacent pair for ${nation}`);
}

// --- 1. Victory Check precedence (p.44) --------------------------------------------
{
  console.log('\n=== Victory Check: Shadow (cond 3) outranks Free Peoples (cond 4) ===');
  const both = bareBoard();
  both.victoryPoints = { fp: 4, shadow: 11 }; // the reported match, exactly
  check('a simultaneous check ends the game', checkMilitaryVictory(both) === true);
  check('the SHADOW wins it', both.winner === 'shadow', `winner=${both.winner} (${both.winReason})`);

  const fpOnly = bareBoard();
  fpOnly.victoryPoints = { fp: 4, shadow: 9 };
  checkMilitaryVictory(fpOnly);
  check('FP still wins at 4 VP when Shadow is short', fpOnly.winner === 'fp', `winner=${fpOnly.winner}`);

  const shOnly = bareBoard();
  shOnly.victoryPoints = { fp: 3, shadow: 10 };
  checkMilitaryVictory(shOnly);
  check('Shadow still wins at 10 VP', shOnly.winner === 'shadow', `winner=${shOnly.winner}`);

  const neither = bareBoard();
  neither.victoryPoints = { fp: 3, shadow: 9 };
  check('nobody wins below both thresholds', checkMilitaryVictory(neither) === false);
  check('no winner recorded', neither.winner == null, `winner=${neither.winner}`);
}

// --- 2. Nazgul never travel with a Free Peoples Army --------------------------------
{
  console.log('\n=== a Free Peoples Army leaves Nazgul behind ===');
  const [from, to] = samePair('gondor');
  const state = bareBoard();
  state.regions[from].units = { gondor: { regular: 3, elite: 0 } };
  state.regions[from].leaders = 1;
  state.regions[from].nazgul = 2; // a lone Nazgul stack the FP Army marched in on

  const ok = moveArmy(state, from, to, 'fp');
  check('the FP move applied', ok === true);
  check('the Army arrived', unitCount(state, to) === 3, `${to} has ${unitCount(state, to)}`);
  check('its own Leader came along', state.regions[to].leaders === 1, `leaders=${state.regions[to].leaders}`);
  check('NO Nazgul rode along', state.regions[to].nazgul === 0, `${to} nazgul=${state.regions[to].nazgul}`);
  check('the Nazgul stayed put', state.regions[from].nazgul === 2, `${from} nazgul=${state.regions[from].nazgul}`);
}

{
  console.log('\n=== a Shadow Army leaves Free Peoples Leaders behind ===');
  const [from, to] = samePair('sauron');
  const state = bareBoard();
  state.regions[from].units = { sauron: { regular: 3, elite: 0 } };
  state.regions[from].nazgul = 2;
  state.regions[from].leaders = 1; // a stranded FP Leader

  const ok = moveArmy(state, from, to, 'shadow');
  check('the Shadow move applied', ok === true);
  check('its Nazgul came along', state.regions[to].nazgul === 2, `nazgul=${state.regions[to].nazgul}`);
  check('NO FP Leader was dragged off', state.regions[to].leaders === 0, `${to} leaders=${state.regions[to].leaders}`);
  check('the FP Leader stayed put', state.regions[from].leaders === 1, `${from} leaders=${state.regions[from].leaders}`);
}

{
  console.log('\n=== a split move cannot name the enemy’s Leader figures ===');
  const [from, to] = samePair('gondor');
  const state = bareBoard();
  state.regions[from].units = { gondor: { regular: 3, elite: 0 } };
  state.regions[from].nazgul = 2;

  const grab = moveArmySplit(state, from, to, 'fp', { units: { gondor: { regular: 1 } }, nazgul: 1 });
  check('an FP split naming Nazgul is refused', grab === false);
  check('nothing moved', unitCount(state, to) === 0 && state.regions[from].nazgul === 2,
    `${to}=${unitCount(state, to)} units, ${from} nazgul=${state.regions[from].nazgul}`);

  const clean = moveArmySplit(state, from, to, 'fp', { units: { gondor: { regular: 1 } } });
  check('the same split without them is allowed', clean === true);
  check('still no Nazgul at the destination', state.regions[to].nazgul === 0);
}

// --- 3. The 10-unit stacking limit is enforced at the end of every action -----------
{
  console.log('\n=== an over-stacked region is caught at the end of an action ===');
  // Stand in for a retreat merge: a friendly Army already held the region, the
  // retreating one piled in on top, and the total blew past the limit.
  const state = startGame(createGame({ seed: 11 }));
  const actor = wotrAdapter.currentActor(state);
  const victim = Object.keys(state.regions).find((id) => {
    const r = state.regions[id];
    if (r.besieged || r.siegeBox) return false;
    return Object.keys(r.units).length > 0;
  });
  const nation = Object.keys(state.regions[victim].units)[0];
  state.regions[victim].units[nation] = { regular: 14, elite: 0 };
  check('the board really is over-stacked', overStack(state, victim) > 0,
    `${victim} has ${unitCount(state, victim)} (limit ${STACKING_LIMIT})`);

  const legal = wotrAdapter.legalActions(state, actor);
  check('the actor has something to do', legal.length > 0);
  const res = wotrAdapter.tryApplyAction(state, legal[0], actor);
  check('the action was accepted', res.ok, res.ok ? '' : res.reason);
  const after = res.ok ? res.state : state;

  check('a removeExcess prompt was raised', after.pendingChoice?.kind === 'removeExcess',
    `pendingChoice=${after.pendingChoice?.kind ?? 'none'}`);
  check('it points at the over-stacked region', after.pendingChoice?.data?.region === victim,
    `region=${after.pendingChoice?.data?.region}`);
  check('the controlling player owns the removal', after.pendingChoice?.owner === 'shadow' || after.pendingChoice?.owner === 'fp',
    `owner=${after.pendingChoice?.owner}`);

  // And the prompt must actually be answerable down to the limit, not just raised.
  let s = after, guard = 0;
  while (s.pendingChoice?.kind === 'removeExcess' && guard++ < 30) {
    const owner = s.pendingChoice.owner;
    const opts = wotrAdapter.legalActions(s, owner).filter((a) => a.kind === 'removeExcess');
    if (opts.length === 0) break;
    const step = wotrAdapter.tryApplyAction(s, opts[0], owner);
    if (!step.ok) break;
    s = step.state;
  }
  check('the removals bring it back inside the limit', overStack(s, victim) === 0,
    `${victim} ends with ${unitCount(s, victim)}`);
}

console.log(failures ? `\nprobe-stacking-leaders-victory: ${failures} FAILURE(S)` : '\nprobe-stacking-leaders-victory OK');
process.exit(failures ? 1 : 0);
