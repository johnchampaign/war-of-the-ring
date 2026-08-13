#!/usr/bin/env vite-node
// probe-advance-holdback.mjs — END OF BATTLE, "all or part" (rulebook p.31).
//
//   "If the defending Army is eliminated or retreats, the attacker may immediately
//    move all or part of the attacking Army into the embattled region."
//
// The engine used to march the WHOLE force in with no say (player report). It now
// advances everything — so the capture, the outcome text and any resulting siege are
// settled exactly as before — and then offers to hold figures BACK, which reaches the
// same end states without making the capture hang on an unanswered question.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolveAdvanceHoldBack, advanceHoldBackAvailable } from '../src/engine/combat.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const units = (s, id) => Object.values(s.regions[id].units).reduce((a, u) => a + u.regular + u.elite, 0);

function bare(seed = 2) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  return s;
}
/** Shadow beats a lone Free Peoples defender, then is asked about holding back.
 *  `open: true` picks a region with NO Settlement, so nothing is captured and the
 *  winner may legally bring the whole Army back (p.31's advance is optional). */
function won(open = false) {
  const e = Object.entries(REGIONS).find(([, d]) => (open ? !d.settlement : d.settlement === 'Town')
    && d.nation && sideOfNation(d.nation) === 'fp' && d.adjacency.some((a) => REGIONS[a]));
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
  console.log('\n=== after a win the whole Army is forward, and holding back is offered ===');
  const { s, from, to } = won();
  if (s.pendingCombat) { console.log('  (battle did not resolve on this seed — skipped)'); }
  else {
    check('the region was taken', units(s, to) > 0, `${to}=${units(s, to)}`);
    check('the origin is empty (whole Army advanced, as before)', units(s, from) === 0, `${from}=${units(s, from)}`);
    check('the winner is asked about holding back', s.pendingChoice?.kind === 'advanceHoldBack', s.pendingChoice?.kind ?? 'none');

    // Declining keeps everyone forward — identical to the old behaviour.
    const fwd = units(s, to);
    resolveAdvanceHoldBack(s, null);
    check('declining leaves the Army forward', units(s, to) === fwd && units(s, from) === 0);
    check('the choice is cleared', s.pendingChoice === null);
  }
}

{
  console.log('\n=== holding part back returns exactly those figures ===');
  const { s, from, to } = won();
  if (s.pendingCombat || s.pendingChoice?.kind !== 'advanceHoldBack') { console.log('  (no hold-back choice on this seed — skipped)'); }
  else {
    const fwd = units(s, to);
    resolveAdvanceHoldBack(s, { units: { sauron: { regular: 2, elite: 0 } } });
    check('2 units marched back', units(s, from) === 2, `${from}=${units(s, from)}`);
    check('the rest hold the captured region', units(s, to) === fwd - 2, `${to}=${units(s, to)}`);
    check('conservation: nothing created or lost', units(s, from) + units(s, to) === fwd);
  }
}

{
  console.log('\n=== a captured Settlement is never left empty ===');
  const { s, from, to } = won();
  if (s.pendingCombat || s.pendingChoice?.kind !== 'advanceHoldBack') { console.log('  (skipped)'); }
  else {
    const fwd = units(s, to);
    check('the advance did put the Settlement under our Control', s.regions[to].control === 'shadow');
    resolveAdvanceHoldBack(s, { units: { sauron: { regular: 99, elite: 0 } } }); // ask for everything
    check('at least one unit stays to hold the ground', units(s, to) >= 1, `${to}=${units(s, to)}`);
    check('conservation holds', units(s, from) + units(s, to) === fwd);
  }
}

{
  // p.31: "the attacker MAY immediately move all or part of the attacking Army into
  // the embattled region" — so declining the advance outright is legal. The engine used
  // to force one unit forward everywhere, and the picker's only button was "keep the
  // whole Army forward" (player report: "my choice would've been to hold all of them
  // back, but I didn't have that option").
  console.log('\n=== an open region may be won and then left alone ===');
  const { s, from, to } = won(true);
  if (s.pendingCombat || s.pendingChoice?.kind !== 'advanceHoldBack') { console.log('  (skipped)'); }
  else {
    const fwd = units(s, to);
    check('nothing was captured, so nothing must be held', s.regions[to].control !== 'shadow');
    resolveAdvanceHoldBack(s, { units: { sauron: { regular: 99, elite: 0 } } }); // bring everyone back
    check('the whole Army came back', units(s, from) === fwd, `${from}=${units(s, from)}`);
    check('the won region is left empty', units(s, to) === 0, `${to}=${units(s, to)}`);
  }
}

{
  console.log('\n=== when a question has only one answer, it is not asked ===');
  const s = bare(5);
  // A lone unit holding a Settlement it just captured has nowhere to go — no prompt.
  s.regions['moria'].units = { sauron: { regular: 1, elite: 0 } };
  s.regions['moria'].control = 'shadow';
  check('no hold-back offered for a lone unit on captured ground', !advanceHoldBackAvailable(s, 'moria', 'shadow'));
  s.regions['moria'].units = { sauron: { regular: 2, elite: 0 } };
  check('offered once there are two', advanceHoldBackAvailable(s, 'moria', 'shadow'));
  // On ground that was not captured, even a lone unit may decline the advance.
  s.regions['moria'].units = { sauron: { regular: 1, elite: 0 } };
  s.regions['moria'].control = null;
  check('a lone unit may still decline to advance', advanceHoldBackAvailable(s, 'moria', 'shadow'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
