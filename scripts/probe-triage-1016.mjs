#!/usr/bin/env vite-node
// probe-triage-1016.mjs — player report 1a734v6p0b484w16: an Army of six units withdrew
// into the siege at Minas Tirith and lost one Regular with no prompt. The garrison cap is
// 5 (p.31), but "the excess units must be removed from the game by the controlling
// player" (p.26), so the owner now picks which unit goes.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { combatStep, startBattle } from '../src/engine/combat.ts';
import { forceUnitCount } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const state = startGame(createGame({ seed: 1 }));
for (const r of Object.values(state.regions)) {
  r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
  delete r.siegeBox; r.besieged = false;
}
state.phase = 'actionResolution';
state.nations.gondor.step = 0; state.nations.gondor.active = true;
state.nations.rohan.step = 0; state.nations.rohan.active = true;
state.nations.sauron.step = 0; state.nations.sauron.active = true;
state.regions['minas-tirith'].units = { gondor: { regular: 3, elite: 2 }, rohan: { regular: 1, elite: 0 } };
state.regions['minas-tirith'].leaders = 2;
state.regions['osgiliath'].units = { sauron: { regular: 6, elite: 3 } };
startBattle(state, 'shadow', 'osgiliath', 'minas-tirith');
combatStep(state);
check('the defender is asked to withdraw', state.pendingChoice?.kind === 'siegeWithdraw', state.pendingChoice?.kind);
let s = wotrAdapter.applyAction(state, { kind: 'siegeWithdraw', withdraw: true }, 'fp');
check('the attacker is asked to advance', s.pendingChoice?.kind === 'besiegerAdvance', s.pendingChoice?.kind);
s = wotrAdapter.applyAction(s, { kind: 'besiegerAdvance', advance: true }, 'shadow');
const box = () => s.regions['minas-tirith'].siegeBox;
check('the siege is on', s.regions['minas-tirith'].besieged === true);
check('all six units went into the box', forceUnitCount(box()) === 6, `${forceUnitCount(box())}`);
check('the Free Peoples are asked to remove the excess', s.pendingChoice?.kind === 'removeExcess' && s.pendingChoice.owner === 'fp' && s.pendingChoice.data?.boxed === true,
  JSON.stringify(s.pendingChoice));
check('it is the Free Peoples\' move', wotrAdapter.currentActor(s) === 'fp', wotrAdapter.currentActor(s));
const offers = wotrAdapter.legalActions(s, 'fp');
check('Elites are offered too', offers.some((a) => a.kind === 'removeExcess' && a.nation === 'gondor' && a.figure === 'elite'), JSON.stringify(offers));
check('the Rohan Regular is offered', offers.some((a) => a.kind === 'removeExcess' && a.nation === 'rohan' && a.figure === 'regular'));
s = wotrAdapter.applyAction(s, { kind: 'removeExcess', nation: 'gondor', figure: 'elite' }, 'fp');
check('the chosen Elite went', box().units.gondor.elite === 1 && box().units.gondor.regular === 3 && box().units.rohan.regular === 1, JSON.stringify(box().units));
check('down to five', forceUnitCount(box()) === 5);
check('no prompt left', s.pendingChoice === null, JSON.stringify(s.pendingChoice));
check('Leaders are untouched', box().leaders === 2);

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
