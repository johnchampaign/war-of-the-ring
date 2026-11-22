#!/usr/bin/env vite-node
// probe-triage-1122.mjs — report ngqb3corp8eecwqf: "there is nowhere for me to retreat
// or withdraw to, but the game is still allowing me to play Scouts."
//
// Scouts reads "Play if the Free Peoples Army is defending in a field battle. Before
// the Combat roll, retreat your Army to an adjacent free region or withdraw into a
// siege." (Card Text Reference). Its "Play if" says nothing about having somewhere to
// go, so the card stays playable — the UI labels it as doing nothing
// (`preCombatRetreatBlocked`). Checking the report found the card's second half
// missing: the Army could not "withdraw into a siege" (Almanac, Scouts: "The Free
// Peoples Army may play this card to retreat into a Stronghold instead of to a
// different region").
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { REGIONS } from '../src/engine/data.ts';
import { unitCount, forceUnitCount } from '../src/engine/armies.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolvePreCombatRetreat, preCombatRetreatDestinations,
  preCombatRetreatBlocked, resolveSiegeWithdraw, resolveBesiegerAdvance } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const SCOUTS = 'fp-str-05';             // The Spirit of Mordor — combat half "Scouts", ini 1
const DREAD_AND_DESPAIR = 'sh-char-08'; // combat half "Dread and Despair", ini 3

function bareBoard(seed = 11) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0; s.nations.isengard.active = true; s.nations.rohan.active = true;
  return s;
}
/** Shadow attacks `to` from `from`; every OTHER region next to `to` is filled with
 *  Shadow troops when `surround` is set, so the defender has no free region. */
function battle({ from, to, surround, shadowCard = null }) {
  const s = bareBoard();
  s.regions[from].units = { isengard: { regular: 3, elite: 2 } };
  s.regions[from].nazgul = 2;
  s.regions[to].units = { rohan: { regular: 2, elite: 1 } };
  if (surround) for (const adj of REGIONS[to].adjacency) if (adj !== from) s.regions[adj].units = { isengard: { regular: 1, elite: 0 } };
  s.cards.fp.hand = [SCOUTS];
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  startBattle(s, 'shadow', from, to);
  return s;
}
/** Run to the first prompt that is not one of the answered ones. */
function run(s, { shadowCard = null, retreatTo = null, advance = true } = {}) {
  const asked = [];
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    if (!s.pendingChoice) combatStep(s); // a prompt left open by an earlier run() is answered first
    const ch = s.pendingChoice;
    if (!ch) continue;
    asked.push(`${ch.kind}:${ch.owner}`);
    if (ch.kind === 'siegeWithdraw') { resolveSiegeWithdraw(s, false); continue; } // stand in the field first
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard : SCOUTS); continue; }
    if (ch.kind === 'preCombatRetreat' && retreatTo) { resolvePreCombatRetreat(s, retreatTo); continue; }
    if (ch.kind === 'besiegerAdvance') { resolveBesiegerAdvance(s, advance); continue; }
    break;
  }
  return asked;
}

{
  console.log('\n=== Scouts in front of the Army\'s own Stronghold: "or withdraw into a siege" ===');
  const s = battle({ from: 'fords-of-isen', to: 'helms-deep', surround: true });
  const asked = run(s);
  check('the Free Peoples are asked where Scouts takes them', asked.at(-1) === 'preCombatRetreat:fp', asked.join(', '));
  const dests = preCombatRetreatDestinations(s);
  check("the only place offered is Helm's Deep itself", dests.length === 1 && dests[0] === 'helms-deep', JSON.stringify(dests));
  check('so Scouts is not flagged as doing nothing', !preCombatRetreatBlocked(s, 'fp'));
  const asked2 = run(s, { retreatTo: 'helms-deep' });
  check('the Shadow is asked whether to advance and besiege', asked2.includes('besiegerAdvance:shadow'), asked2.join(', '));
  const hd = s.regions['helms-deep'];
  check('the battle is over without a roll', !s.pendingCombat && !(s.lastBattle?.atkRoll?.dice?.length));
  check('the Rohan Army sits in the siege box, whole', !!hd.siegeBox && forceUnitCount(hd.siegeBox) === 3 && hd.besieged === true,
    JSON.stringify(hd.siegeBox ?? null));
  check('the Shadow Army besieges from the open field', (hd.units.isengard?.regular ?? 0) + (hd.units.isengard?.elite ?? 0) === 5, JSON.stringify(hd.units));
}

{
  console.log('\n=== with a free region as well, both are offered; the region still works ===');
  const s = battle({ from: 'fords-of-isen', to: 'helms-deep', surround: false });
  run(s);
  const dests = preCombatRetreatDestinations(s);
  check("Helm's Deep and Westemnet are both offered", dests.includes('helms-deep') && dests.includes('westemnet'), JSON.stringify(dests));
  run(s, { retreatTo: 'westemnet' });
  check('retreating to Westemnet moves the Army and ends the battle', !s.pendingCombat && unitCount(s, 'westemnet') === 3 && !s.regions['helms-deep'].siegeBox);
}

{
  console.log('\n=== the Shadow may decline to advance: no siege, the Army comes back out ===');
  const s = battle({ from: 'fords-of-isen', to: 'helms-deep', surround: true });
  run(s);
  run(s, { retreatTo: 'helms-deep', advance: false });
  const hd = s.regions['helms-deep'];
  check('no siege, and the Rohan Army is back in the region', !s.pendingCombat && !hd.siegeBox && !hd.besieged && unitCount(s, 'helms-deep') === 3);
}

{
  console.log('\n=== a withdrawal into the Stronghold outruns a slower Shadow card too ===');
  const s = battle({ from: 'fords-of-isen', to: 'helms-deep', surround: true, shadowCard: DREAD_AND_DESPAIR });
  const asked = run(s, { shadowCard: DREAD_AND_DESPAIR });
  check('Dread and Despair is never sized', !asked.some((a) => a.startsWith('combatCardCost')), asked.join(', '));
  check('the retreat question still comes', asked.at(-1) === 'preCombatRetreat:fp', asked.join(', '));
}

{
  console.log('\n=== the reported case: nowhere to retreat and no Stronghold ===');
  const s = battle({ from: 'orthanc', to: 'fords-of-isen', surround: true });
  check('Scouts is flagged as doing nothing', preCombatRetreatBlocked(s, 'fp'));
  const asked = run(s);
  check('playing it anyway asks for no destination', !asked.some((a) => a.startsWith('preCombatRetreat')), asked.join(', '));
  check('the log says there was nowhere to go', s.log.some((e) => typeof e.msg === 'string' && e.msg.includes('no free region to retreat to')),
    s.log.slice(-5).map((e) => e.msg).join(' | '));
  check('and the round is fought', unitCount(s, 'fords-of-isen') > 0 || !s.pendingCombat);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
