#!/usr/bin/env vite-node
// probe-decline-advance.mjs — END OF BATTLE, the full p.31 right (John's call C):
//
//   "If the defending Army is eliminated or retreats, the attacker MAY immediately
//    move all or part of the attacking Army into the embattled region."
//   FFG FAQ: "advance after combat is always optional."
//
// The winner now gets a real choice BEFORE anyone moves: advance everything,
// advance a chosen part, or decline entirely — and the CAPTURE happens only when
// units actually enter (a region no one enters is not captured). This replaces the
// interim hold-back model (advance all, then send some back), which could not
// express "advance nobody" because the capture was already resolved.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolveAdvanceChoice, resolveAdvanceHoldBack } from '../src/engine/combat.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const units = (s, id) => Object.values(s.regions[id].units).reduce((a, u) => a + u.regular + u.elite, 0);
const ctrl = (s, id) => s.regions[id].control ?? (REGIONS[id].nation ? sideOfNation(REGIONS[id].nation) : null);

function bare(seed = 2) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  return s;
}
/** Shadow destroys the garrison of an FP Town; battle ends awaiting the advance choice. */
function won() {
  const e = Object.entries(REGIONS).find(([, d]) => d.settlement === 'Town' && d.nation && sideOfNation(d.nation) === 'fp');
  const [to, def] = e;
  const from = def.adjacency.find((a) => REGIONS[a]);
  const s = bare();
  s.nations[def.nation].step = 0; s.nations.sauron.step = 0;
  s.regions[to].units = { [def.nation]: { regular: 1, elite: 0 } };
  s.regions[from].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'shadow', from, to);
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { s.pendingChoice = null; s.pendingCombat.step = s.pendingCombat.step === 'attackerCard' ? 'defenderCard' : 'cardCost'; continue; }
    break;
  }
  return { s, from, to };
}

{
  console.log('\n=== the win pauses on an advance CHOICE; nothing has moved or been captured ===');
  const { s, from, to } = won();
  if (s.pendingCombat) { console.log('  (battle did not resolve — skipped)'); }
  else {
    check('the choice is offered', s.pendingChoice?.kind === 'advanceChoice', s.pendingChoice?.kind ?? 'none');
    check('the attackers still stand in their region', units(s, from) > 0, `${from}=${units(s, from)}`);
    check('the embattled region is empty, not entered', units(s, to) === 0, `${to}=${units(s, to)}`);
    check('and NOT yet captured', ctrl(s, to) === 'fp', `control=${ctrl(s, to)}`);
  }
}

{
  console.log('\n=== advance ALL: everyone enters, capture fires ===');
  const { s, from, to } = won();
  if (s.pendingChoice?.kind !== 'advanceChoice') { console.log('  (skipped)'); }
  else {
    const total = units(s, from);
    resolveAdvanceChoice(s, { advance: true });
    check('the whole force entered', units(s, to) === total && units(s, from) === 0, `${to}=${units(s, to)}, ${from}=${units(s, from)}`);
    check('the Settlement is captured', ctrl(s, to) === 'shadow', `control=${ctrl(s, to)}`);
  }
}

{
  console.log('\n=== advance PART: the chosen units enter, the rest hold the origin ===');
  const { s, from, to } = won();
  if (s.pendingChoice?.kind !== 'advanceChoice') { console.log('  (skipped)'); }
  else {
    const total = units(s, from);
    resolveAdvanceChoice(s, { advance: true, move: { units: { sauron: { regular: 2 } } } });
    check('2 units advanced', units(s, to) === 2, `${to}=${units(s, to)}`);
    check('the rest stayed', units(s, from) === total - 2, `${from}=${units(s, from)}`);
    check('capture still fires (units entered)', ctrl(s, to) === 'shadow');
    check('conservation', units(s, from) + units(s, to) === total);
  }
}

{
  console.log('\n=== DECLINE: nobody moves, and the region is NOT captured ===');
  const { s, from, to } = won();
  if (s.pendingChoice?.kind !== 'advanceChoice') { console.log('  (skipped)'); }
  else {
    const total = units(s, from);
    resolveAdvanceChoice(s, { advance: false });
    check('the army holds its ground', units(s, from) === total, `${from}=${units(s, from)}`);
    check('the embattled region stays empty', units(s, to) === 0);
    check('no capture without entry (p.32: captured when an enemy Army ENTERS)', ctrl(s, to) === 'fp', `control=${ctrl(s, to)}`);
    check('the choice is cleared', s.pendingChoice === null);
  }
}

{
  console.log('\n=== legacy: an in-flight advanceHoldBack save still resolves ===');
  const s = bare(9);
  s.regions['dale'].units = { sauron: { regular: 3, elite: 0 } };
  s.regions['erebor'].units = {};
  s.pendingChoice = { owner: 'shadow', kind: 'advanceHoldBack', data: { from: 'erebor', to: 'dale' } };
  resolveAdvanceHoldBack(s, { units: { sauron: { regular: 1 } } });
  check('one unit marched back under the old semantics', units(s, 'erebor') === 1 && units(s, 'dale') === 2,
    `erebor=${units(s, 'erebor')}, dale=${units(s, 'dale')}`);
  check('legacy choice cleared', s.pendingChoice === null);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
