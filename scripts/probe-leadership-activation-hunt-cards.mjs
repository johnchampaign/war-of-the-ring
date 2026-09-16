#!/usr/bin/env vite-node
// probe-leadership-activation-hunt-cards.mjs — four rules fixes from player reports.
//
// 1. Leadership is NOT capped at 5; only the Leader re-roll is ("Leadership determines
//    the maximum number of dice that may be rolled in the Leader re-roll, up to a
//    maximum of five dice", p.28). Capping first made Leadership 6 with Gandalf the
//    White's forfeited point re-roll 4 dice instead of 5.
// 2. A Companion moving WITH an Army ends his movement too, so it activates a Nation
//    in its City/Stronghold (p.34) — Strider marched into The Shire and the North
//    stayed passive.
// 3. Orc Patrol's tile is drawn by the Shadow, so Wizard's Staff can prevent it and
//    Mithril Coat and Sting can redraw it (Almanac: "whether due to a Hunt or Event
//    card or any other reason").
// 4. Reducing a Free Peoples Elite takes the replacement Regular from the casualties
//    first, then the reinforcements; with neither, the Elite is simply eliminated (p.30).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, reduceElite, fpRegularCasualties } from '../src/engine/combat.ts';
import { forceLeadership, moveArmy } from '../src/engine/armies.ts';
import { extraHunt, resolveHuntPreventDraw } from '../src/engine/hunt.ts';
import { FP_NATIONS } from '../src/engine/types.ts';

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

// --- 1. Leadership ----------------------------------------------------------
{
  const s = bareBoard(1);
  const r = s.regions['bree'];
  r.units = { north: { regular: 5, elite: 0 } }; r.leaders = 6;
  check('Leadership is not capped at 5', forceLeadership(s, r, 'fp') === 6, `got ${forceLeadership(s, r, 'fp')}`);

  // 6 Leaders + Gandalf the White (Leadership 1) = 7; forfeiting his point leaves 6,
  // so every battle re-rolls min(5, misses) dice — never min(4, misses).
  let sawFive = false, bad = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const st = bareBoard(seed);
    st.nations.north.step = 0; st.nations.sauron.step = 0;
    st.regions['buckland'].units = { north: { regular: 5, elite: 0 } };
    st.regions['buckland'].leaders = 6;
    st.regions['buckland'].characters = ['gandalf-white'];
    st.regions['bree'].units = { sauron: { regular: 5, elite: 0 } };
    st.regions['bree'].nazgul = 1;
    startBattle(st, 'fp', 'buckland', 'bree');
    const pc = st.pendingCombat;
    pc.whiteRiderAsked = true; pc.whiteRiderForfeit = true;
    pc.step = 'beginRound';
    combatStep(st);
    const roll = (st.pendingCombat ?? {}).atkRoll ?? st.lastBattle?.atkRoll;
    if (!roll) continue;
    const misses = roll.dice.filter((d) => d !== 6 && (d === 1 || d < roll.target)).length;
    if (roll.rerolls.length !== Math.min(5, misses)) bad++;
    if (roll.rerolls.length === 5) sawFive = true;
  }
  check('Leadership 6 after a forfeit re-rolls up to 5 dice', bad === 0 && sawFive, `${bad} wrong re-roll counts; saw 5 re-rolls: ${sawFive}`);
}

// --- 2. Activation by an Army move ------------------------------------------
{
  const s = bareBoard(2);
  s.nations.north.active = false; s.nations.north.step = 2;
  s.regions['buckland'].units = { north: { regular: 1, elite: 0 } };
  s.regions['buckland'].characters = ['strider'];
  s.characters.inPlay['strider'] = 'buckland';
  const moved = moveArmy(s, 'buckland', 'the-shire', 'fp');
  check('Army with Strider moves into The Shire', moved);
  check('…and activates the North', s.nations.north.active === true);
}

// --- 3. Orc Patrol vs Wizard's Staff / Mithril Coat -------------------------
{
  const s = bareBoard(3);
  s.cards.fp.table = ['fp-char-08'];
  extraHunt(s, { source: 'Orc Patrol' });
  check("Wizard's Staff is offered against Orc Patrol's draw", s.pendingChoice?.kind === 'huntPreventDraw');
  resolveHuntPreventDraw(s, true);
  check("…and preventing it discards the Staff with no tile drawn", !s.cards.fp.table.includes('fp-char-08') && !s.pendingChoice);

  let offered = 0, eyes = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const st = bareBoard(seed);
    st.cards.fp.table = ['fp-char-05'];
    const before = (st.hunt.draws ?? []).length;
    extraHunt(st, { source: 'Orc Patrol' });
    if (st.pendingChoice?.kind === 'huntRedraw') offered++;
    else if ((st.hunt.draws ?? []).length > before && st.hunt.draws.at(-1).discarded) eyes++;
  }
  check('Mithril Coat is offered against every Orc Patrol tile that does something', offered > 0 && offered + eyes === 30, `offered ${offered}, discarded Eyes ${eyes}`);
}

// --- 4. Elite reduction replacements ----------------------------------------
{
  const s0 = startGame(createGame({ seed: 4 }));
  check('No Free Peoples casualties at setup', FP_NATIONS.every((n) => fpRegularCasualties(s0, n) === 0),
    FP_NATIONS.map((n) => `${n}:${fpRegularCasualties(s0, n)}`).join(' '));

  const s = startGame(createGame({ seed: 4 }));
  const region = Object.values(s.regions).find((r) => (r.units.gondor?.regular ?? 0) > 0);
  region.units.gondor.regular -= 1; // a Gondor Regular falls
  region.units.gondor.elite = (region.units.gondor.elite ?? 0) + 1;
  s.reinforcements.gondor.elite -= 1;
  const pool = s.reinforcements.gondor.regular;
  reduceElite(s, region, 'gondor', 'fp');
  check('FP reduction takes the Regular from the casualties first', s.reinforcements.gondor.regular === pool && fpRegularCasualties(s, 'gondor') === 0,
    `pool ${pool} -> ${s.reinforcements.gondor.regular}`);
  region.units.gondor.elite += 1; s.reinforcements.gondor.elite -= 1;
  reduceElite(s, region, 'gondor', 'fp');
  check('…then from the reinforcements', s.reinforcements.gondor.regular === pool - 1);

  const t = startGame(createGame({ seed: 5 }));
  const tr = Object.values(t.regions).find((r) => (r.units.gondor?.regular ?? 0) > 0);
  t.reinforcements.gondor.regular = 0;
  tr.units.gondor.elite = 1; // counted against no pool change, so casualties stay at 0
  const reg = tr.units.gondor.regular;
  // Park the pool's missing Regulars on the board so none reads as a casualty.
  tr.units.gondor.regular += s0.reinforcements.gondor.regular;
  check('(setup) no Gondor casualties to draw on', fpRegularCasualties(t, 'gondor') === 0);
  reduceElite(t, tr, 'gondor', 'fp');
  check('With no Regular anywhere the Elite is simply eliminated', tr.units.gondor.elite === 0 && tr.units.gondor.regular === reg + s0.reinforcements.gondor.regular);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nleadership/activation/hunt-card/elite probe OK');
