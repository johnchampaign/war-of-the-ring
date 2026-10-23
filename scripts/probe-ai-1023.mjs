#!/usr/bin/env vite-node
// probe-ai-1023.mjs — AI report 63hl89a35stuc7as (2026-10-22): the Orthanc Army threw
// its Army die away rather than attack a Rohan Army in the Fords of Isen. Attacking an
// ACTIVE Nation only spares the Free Peoples the Muster die that would take it to War;
// waking a PASSIVE one still costs the whole pool.
// And the stalemate the A/B for it turned up: a Shadow Army one unit short of a
// Stronghold assault, with a full Army next door that would not join it because the
// move was priced as if the overflow were lost — the AI trims such a move to what fits.
// Also: k90pu3ftiq97aevx — Saruman held back firmly while Gandalf the White could
// answer him; m60xvxgtri6gz1ux — no Deadly Strife / Desperate Battle from a besieged
// Stronghold.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const setup = (active, seed) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.nations.isengard.step = 0;
  s.nations.rohan.step = 1; s.nations.rohan.active = active;
  // The Orthanc Army is the Shadow's only one, as in the report: no other move to make.
  for (const r of Object.values(s.regions)) for (const n of ['sauron', 'isengard', 'southrons']) delete r.units[n];
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.regions['orthanc'].units = { isengard: { regular: 5, elite: 2 } };
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.dice.shadow = ['army']; s.dice.fp = [];
  return s;
};
const isAttack = (a) => a.kind === 'attack' && a.from === 'orthanc' && a.to === 'fords-of-isen';

console.log('\n=== Attack the Rohan Army in the Fords of Isen? ===');
for (const seed of [1, 2, 3]) {
  const s = setup(true, seed);
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = chooseAction(s, 'shadow', legal, new Rng(3));
  check(`seed ${seed}: Rohan active, one step from War — the Orthanc Army attacks`, legal.some(isAttack) && isAttack(a), JSON.stringify(a).slice(0, 110));
}

console.log('\n=== Reinforce the Army at Dol Amroth\'s door ===');
for (const seed of [1, 2, 3]) {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.shadowPlanRoll = 59; // plan B: Minas Tirith, Pelargir, Dol Amroth…
  s.regions['minas-tirith'].units = { sauron: { regular: 1, elite: 0 } }; s.regions['minas-tirith'].control = 'shadow';
  s.regions['lamedon'].units = { sauron: { regular: 3, elite: 2 } };
  s.regions['pelargir'].units = { sauron: { regular: 8, elite: 2 } }; s.regions['pelargir'].control = 'shadow';
  s.regions['dol-amroth'].units = { gondor: { regular: 2, elite: 1 } };
  s.dice.shadow = ['army']; s.dice.fp = [];
  const a = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(3));
  const sent = a.move ? Object.values(a.move.units ?? {}).reduce((t, u) => t + (u.regular ?? 0) + (u.elite ?? 0), 0) : 10;
  check(`seed ${seed}: Pelargir sends what fits to Lamedon (${sent} onto 5)`, a.kind === 'moveArmy' && a.from === 'pelargir' && a.to === 'lamedon' && sent <= 5, JSON.stringify(a).slice(0, 140));
}

console.log('\n=== Saruman waits while Gandalf the White could answer ===');
for (const seed of [1, 2, 3]) {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const n of ['isengard', 'sauron', 'southrons']) s.nations[n].step = 0; // no diplomacy left to do
  // Gandalf the Grey is out of the Fellowship, on the board; the Free Peoples hold a Will.
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gandalf-grey');
  if (s.fellowship.guide === 'gandalf-grey') s.fellowship.guide = s.fellowship.companions[0];
  s.regions['rivendell'].characters.push('gandalf-grey'); s.characters.inPlay['gandalf-grey'] = 'rivendell';
  s.dice.shadow = ['muster', 'muster']; s.dice.fp = ['will'];
  const a = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(3));
  check(`seed ${seed}: Saruman does not come`, !(a.kind === 'bringMinion' && a.minion === 'saruman'), JSON.stringify(a).slice(0, 110));
}

console.log('\n=== No Deadly Strife from a besieged Stronghold ===');
{
  const STRIFE = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === 'Deadly Strife');
  const s = startGame(createGame({ seed: 11 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.regions['dol-guldur'].units = { elves: { regular: 2, elite: 0 } }; s.regions['dol-guldur'].leaders = 1;
  s.regions['dol-guldur'].characters = ['strider', 'legolas', 'gimli'];
  s.regions['dol-guldur'].besieged = true;
  s.regions['dol-guldur'].siegeBox = { units: { sauron: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.cards.shadow.hand = [STRIFE]; s.cards.fp.hand = [];
  startBattle(s, 'fp', 'dol-guldur', 'dol-guldur');
  let out = 'no prompt';
  for (let i = 0; i < 20 && s.pendingCombat; i++) {
    const ch = s.pendingChoice;
    if (ch?.kind === 'combatCard' && ch.owner === 'shadow') { const a = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(1)); out = a.cardId === STRIFE ? 'plays' : 'keeps'; break; }
    if (ch) { out = `stopped at ${ch.kind}`; break; }
    combatStep(s);
  }
  check('one besieged Regular against 2 units and 3 Captains: the card is kept', out === 'keeps', out);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
