#!/usr/bin/env vite-node
// probe-combat-card-cost-prompt.mjs — the Fords of Isen report (2026-08-23), two
// bugs in one battle:
//
//  1. A VARIABLE-SIZE combat card was played, discarded, and did nothing.
//     resolvePlayCombatCard sent the round straight from 'defenderCard' to
//     'beginRound', skipping the 'cardCost' step that asks the owner how big the
//     card is. The step was only ever reached through combatStep's own
//     'defenderCard' fall-through — i.e. when the defender had NO playable card —
//     so Relentless Assault / Dread and Despair silently fizzled whenever the
//     defender actually answered. ("It never asked me how many hits I wanted.")
//
//  2. CONFUSION was modelled as a to-hit penalty (that is Advantageous Position).
//     Its real text: "Every unmodified die result of '1' in the Shadow player's
//     Combat roll scores one hit against the Shadow Army. Any such result cannot be
//     rolled again during the Shadow player's Leader re-roll."
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveCombatCardCost } from '../src/engine/combat.ts';
import { combatModsFor } from '../src/engine/combatCards.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The reported battle: Shadow (2R,3E + Saruman) out of Orthanc into the Fords. */
function fordsOfIsen({ shadowCard = null, fpCard = null, seed = 4 } = {}) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 2, elite: 3 } };
  s.regions['orthanc'].characters = ['saruman']; // Leadership 4, as in the report — so
                                                 // re-rolls actually happen and the
                                                 // "1s cannot be re-rolled" clause bites
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.regions['fords-of-isen'].leaders = 1;
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  s.cards.fp.hand = fpCard ? [fpCard] : [];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  return s;
}
/** Step until a choice of `kind` is raised (playing the queued cards on the way). */
function runTo(s, kind, { shadowCard, fpCard } = {}) {
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === kind) return ch;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard ?? null : fpCard ?? null); continue; }
    return null; // some other choice got there first
  }
  return null;
}

{
  console.log("\n=== Relentless Assault is SIZED even when the defender also plays a card ===");
  const shadowCard = 'sh-str-18', fpCard = 'fp-str-12'; // The King is Revealed / Through a Day and a Night
  const s = fordsOfIsen({ shadowCard, fpCard });
  const ch = runTo(s, 'combatCardCost', { shadowCard, fpCard });
  check('the Shadow is asked how many hits to inflict', ch?.kind === 'combatCardCost' && ch.owner === 'shadow',
    ch ? `${ch.kind} owner=${ch.owner}` : 'no prompt (the reported bug)');
  if (ch) {
    check('up to 2 (the card text), at least 0', ch.data.max === 2 && ch.data.min === 0, JSON.stringify(ch.data));
    const before = s.regions['orthanc'].units.isengard.regular + s.regions['orthanc'].units.isengard.elite;
    resolveCombatCardCost(s, 2);
    const after = s.regions['orthanc'].units.isengard.regular + s.regions['orthanc'].units.isengard.elite;
    check('paying 2 costs 2 of our own units', before - after === 2, `${before} -> ${after}`);
    check('and buys +2 on the Combat roll', combatModsFor(shadowCard, { cost: 2 })?.rollBonus === 2,
      JSON.stringify(combatModsFor(shadowCard, { cost: 2 })));
  }
}

{
  console.log('\n=== ...and it was ALREADY sized when the defender had no card (the path that worked) ===');
  const shadowCard = 'sh-str-18';
  const s = fordsOfIsen({ shadowCard });
  const ch = runTo(s, 'combatCardCost', { shadowCard });
  check('still prompted', ch?.kind === 'combatCardCost', ch?.kind ?? 'none');
}

{
  console.log('\n=== Confusion: unmodified 1s wound the roller, and are not re-rolled ===');
  const mods = combatModsFor('fp-str-12');
  check('modelled as a backfire, NOT a to-hit penalty', mods?.enemyOnesBackfire === true && mods?.enemyRollPenalty == null,
    JSON.stringify(mods));
  const adv = combatModsFor('fp-str-03'); // Advantageous Position — the card that IS a to-hit penalty
  check('Advantageous Position is still the to-hit penalty', adv?.enemyRollPenalty === 1 && !adv?.enemyOnesBackfire, JSON.stringify(adv));

  // Play the battle out and audit the dice actually rolled. Hunt for a seed whose
  // attacker roll actually CONTAINS a 1 — otherwise the assertions below pass
  // vacuously and would not have caught the original modelling.
  const fpCard = 'fp-str-12';
  let s = null, atk = null;
  for (let seed = 1; seed <= 60; seed++) {
    const t = fordsOfIsen({ fpCard, seed });
    for (let i = 0; i < 40 && t.pendingCombat; i++) {
      combatStep(t);
      const ch = t.pendingChoice;
      if (!ch) continue;
      if (ch.kind === 'combatCard') { resolvePlayCombatCard(t, ch.owner === 'fp' ? fpCard : null); continue; }
      break;
    }
    const r = t.pendingCombat?.atkRoll ?? t.lastBattle?.atkRoll;
    if (r && r.dice.includes(1)) { s = t; atk = r; break; }
    if (r && !atk) { s = t; atk = r; }
  }
  check('found a roll containing an unmodified 1 to audit', !!atk && atk.dice.includes(1),
    atk ? `dice [${atk.dice.join(' ')}]` : 'no roll');
  if (!atk) { console.log('  (no roll recorded — skipped)'); }
  else {
    const ones = atk.dice.filter((d) => d === 1).length;
    check(`each unmodified 1 is recorded as a backfire (${ones} rolled)`, (atk.backfire ?? 0) === ones,
      `dice [${atk.dice.join(' ')}] backfire=${atk.backfire ?? 0}`);
    check('the to-hit is untouched by the card (5+ field battle, 6+ only from the Fortification)',
      atk.target === 5 || atk.target === 6, `target ${atk.target}`);
    // With Leadership present the re-roll allowance is min(Leadership, misses) — and
    // the misses it may draw from EXCLUDE the 1s. Before the fix the 1s counted as
    // ordinary misses and were re-rolled like any other.
    const nonOneMisses = atk.dice.filter((d) => d !== 1 && d !== 6 && d < atk.target).length;
    const allMisses = atk.dice.filter((d) => d !== 6 && d < atk.target).length;
    check('re-rolls never exceed the non-1 misses', atk.rerolls.length <= nonOneMisses,
      `re-rolled ${atk.rerolls.length}, re-rollable misses ${nonOneMisses}`);
    check('...and that pool really is smaller than the raw miss count (so the clause bites)',
      nonOneMisses < allMisses, `${nonOneMisses} re-rollable vs ${allMisses} total misses`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
