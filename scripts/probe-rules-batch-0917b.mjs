#!/usr/bin/env vite-node
// probe-rules-batch-0917b.mjs — two more rules fixes from player reports.
//
// A. BRAVE STAND is sized by the battle. Card text: "Play if a Companion is in the
//    battle. The Shadow player rolls one die less in his Combat roll FOR EACH
//    Companion in the battle (to a minimum of one)." It was modelled as a flat cap of
//    three Shadow dice, which is a different card (report 640i6h2s51023q4w).
// B. THE VOICE OF SARUMAN does as much as it can. Replacing "two Isengard Regulars in
//    Orthanc with two Elites" needed two of each to be offered at all; a Muster action
//    recruits to the extent possible, so one Regular and one spare Elite is enough
//    (report 476j5r1l0m093n25). The recruit half already worked this way.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { combatModsFor } from '../src/engine/combatCards.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const BRAVE_STAND = 'fp-char-23'; // House of the Stewards, combat half "Brave Stand"

// --- A. Brave Stand counts the Companions present --------------------------------
{
  console.log('\n=== Brave Stand: one fewer Shadow die per Companion ===');
  const dice = (chars) => combatModsFor(BRAVE_STAND, { ownCharacters: chars })?.enemyDiceReduction;
  check('one Companion → one die', dice(['boromir']) === 1, `${dice(['boromir'])}`);
  check('three Companions → three dice', dice(['boromir', 'gimli', 'legolas']) === 3, `${dice(['boromir', 'gimli', 'legolas'])}`);
  check('the Aragorn / Gandalf the White upgrades count', dice(['aragorn', 'gandalf-white']) === 2, `${dice(['aragorn', 'gandalf-white'])}`);
  check('Gollum is not a Companion in a battle', dice(['gollum', 'meriadoc']) === 1, `${dice(['gollum', 'meriadoc'])}`);
  check('the old flat three-dice cap is gone', combatModsFor(BRAVE_STAND, { ownCharacters: ['boromir'] })?.maxDiceEnemy === undefined);
  // With no force context (card valuation, "is this a combat card at all") the card
  // still reads as its own minimum rather than as nothing.
  check('no context → the card still has an effect', (combatModsFor(BRAVE_STAND)?.enemyDiceReduction ?? 0) >= 1);
}

// --- B. The Voice of Saruman upgrades as far as it can ---------------------------
{
  console.log('\n=== The Voice of Saruman: a partial Elite upgrade is allowed ===');
  /** Saruman in play, Orthanc held and unbesieged, with `regular` Isengard Regulars
   *  in Orthanc and `elite` Elites left in the Isengard reinforcements. */
  const setup = ({ regular, elite }) => {
    const state = startGame(createGame({ seed: 11 }));
    state.phase = 'actionResolution';
    state.characters.entered.push('saruman');
    state.regions['orthanc'].characters = ['saruman'];
    state.regions['orthanc'].units.isengard = { regular, elite: 0 };
    state.regions['orthanc'].besieged = false;
    state.reinforcements.isengard.elite = elite;
    state.dice.shadow = ['muster'];
    state.dice.fp = ['muster'];
    state.currentPlayer = 'shadow';
    return state;
  };
  const upgrades = (state) => wotrAdapter.legalActions(state, 'shadow')
    .filter((a) => a.kind === 'sarumanMuster' && a.mode === 'upgrade');

  const two = setup({ regular: 2, elite: 2 });
  check('two and two is still offered', upgrades(two).length === 1, `${upgrades(two).length} option(s)`);
  const full = wotrAdapter.tryApplyAction(two, { kind: 'sarumanMuster', mode: 'upgrade' }, 'shadow');
  check('two Regulars become two Elites', full.ok
    && full.state.regions['orthanc'].units.isengard.regular === 0
    && full.state.regions['orthanc'].units.isengard.elite === 2,
  full.ok ? JSON.stringify(full.state.regions['orthanc'].units.isengard) : full.error);

  const oneElite = setup({ regular: 2, elite: 1 });
  check('one spare Elite is enough to be offered', upgrades(oneElite).length === 1, `${upgrades(oneElite).length} option(s)`);
  const partial = wotrAdapter.tryApplyAction(oneElite, { kind: 'sarumanMuster', mode: 'upgrade' }, 'shadow');
  check('exactly one Regular is replaced', partial.ok
    && partial.state.regions['orthanc'].units.isengard.regular === 1
    && partial.state.regions['orthanc'].units.isengard.elite === 1,
  partial.ok ? JSON.stringify(partial.state.regions['orthanc'].units.isengard) : partial.error);
  check('the Elite pool is spent, not overdrawn', partial.ok && partial.state.reinforcements.isengard.elite === 0,
    partial.ok ? `${partial.state.reinforcements.isengard.elite}` : 'n/a');
  check('the replaced Regular goes back to the reinforcements', partial.ok
    && partial.state.reinforcements.isengard.regular === oneElite.reinforcements.isengard.regular + 1);

  const oneRegular = setup({ regular: 1, elite: 2 });
  check('one Regular in Orthanc is enough too', upgrades(oneRegular).length === 1, `${upgrades(oneRegular).length} option(s)`);

  const nothing = setup({ regular: 0, elite: 2 });
  check('no Regulars in Orthanc, no option', upgrades(nothing).length === 0, `${upgrades(nothing).length} option(s)`);
  const noElites = setup({ regular: 2, elite: 0 });
  check('no Elites in the pool, no option', upgrades(noElites).length === 0, `${upgrades(noElites).length} option(s)`);
}

console.log(failures ? `\nprobe-rules-batch-0917b: ${failures} FAILURE(S)` : '\nprobe-rules-batch-0917b OK');
process.exit(failures ? 1 : 0);
