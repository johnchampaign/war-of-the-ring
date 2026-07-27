#!/usr/bin/env vite-node
// probe-combat-card-costs.mjs — combat cards whose SIZE is not a flat constant.
//
// Andúril (fp-char-09): "forfeit Strider's Leadership to automatically change one
// missed die roll to a hit, OR forfeit Aragorn's Leadership to change UP TO TWO."
// Which figure is in the battle decides it. There is no real choice in the second
// case — forfeiting Aragorn costs his whole Leadership (2) whether you convert one
// die or two, so converting two is never worse. The engine only ever modelled
// Strider's single hit, so an Aragorn player was silently short-changed a hit AND
// under-charged a point of Leadership.
//
// Foul Stench (sh-char-09/22/24): "IF the Nazgûl Leadership equals or exceeds the
// total Free Peoples Leadership, the Free Peoples Leader re-roll is cancelled." That
// is a condition, not a cost, and it was applied unconditionally — the Shadow got a
// free re-roll cancel no matter how outmatched its Nazgûl were.
import { combatModsFor } from '../src/engine/combatCards.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const ANDURIL = 'fp-char-09';
const FOUL_STENCH = 'sh-char-09';

// --- Andúril scales with the figure present ---------------------------------------
{
  console.log('\n=== Andúril: Strider vs Aragorn ===');
  const strider = combatModsFor(ANDURIL, { ownCharacters: ['strider', 'gandalf-grey'] });
  check('Strider converts one die', strider?.guaranteedHits === 1, `hits=${strider?.guaranteedHits}`);
  check("Strider's Leadership (1) is the cost", strider?.ownLeadershipPenalty === 1,
    `penalty=${strider?.ownLeadershipPenalty}`);

  const aragorn = combatModsFor(ANDURIL, { ownCharacters: ['aragorn', 'gandalf-grey'] });
  check('Aragorn converts up to two', aragorn?.guaranteedHits === 2, `hits=${aragorn?.guaranteedHits}`);
  check("Aragorn's Leadership (2) is the cost", aragorn?.ownLeadershipPenalty === 2,
    `penalty=${aragorn?.ownLeadershipPenalty}`);

  // No context (the AI's card valuation) must still get a sane baseline, not a crash.
  const bare = combatModsFor(ANDURIL);
  check('no-context call returns the Strider baseline', bare?.guaranteedHits === 1 && bare?.ownLeadershipPenalty === 1,
    JSON.stringify(bare));
  // The shared table must not be mutated by the Aragorn upgrade.
  const again = combatModsFor(ANDURIL, { ownCharacters: ['strider'] });
  check('the Aragorn case did not poison the shared table', again?.guaranteedHits === 1,
    `hits=${again?.guaranteedHits}`);
}

// --- Foul Stench is conditional ----------------------------------------------------
{
  console.log('\n=== Foul Stench: conditional, not automatic ===');
  const m = combatModsFor(FOUL_STENCH);
  check('no unconditional re-roll negation', !m?.negateEnemyReroll, `negateEnemyReroll=${m?.negateEnemyReroll}`);
  check('it is flagged as conditional instead', m?.negateEnemyRerollIfNazgulDominant === true,
    JSON.stringify(m));
}

// --- the condition itself, through a real battle roll ------------------------------
{
  console.log('\n=== the condition decides whether the FP re-rolls ===');
  const { createGame } = await import('../src/engine/setup.ts');
  const { startGame } = await import('../src/adapter/wotrAdapter.ts');
  const { combatStep, startBattle } = await import('../src/engine/combat.ts');
  const { REGIONS } = await import('../src/engine/data.ts');

  /** Run one round of a field battle with the Shadow holding Foul Stench, and report
   *  whether the FP's Leader re-roll happened. `shadowNazgul` vs `fpLeaders` is the
   *  comparison the card turns on. */
  function fpRerolled({ shadowNazgul, fpLeaders }) {
    const state = startGame(createGame({ seed: 3 }));
    for (const r of Object.values(state.regions)) {
      r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
      delete r.siegeBox; r.besieged = false;
    }
    const to = 'osgiliath', from = REGIONS[to].adjacency.find((a) => REGIONS[a]);
    state.nations.gondor.step = 0; state.nations.sauron.step = 0;
    state.regions[to].units = { gondor: { regular: 4, elite: 0 } };
    state.regions[to].leaders = fpLeaders;
    state.regions[from].units = { sauron: { regular: 4, elite: 0 } };
    state.regions[from].nazgul = shadowNazgul;
    startBattle(state, 'shadow', from, to);
    const pc = state.pendingCombat;
    pc.attackerCard = FOUL_STENCH;      // Shadow attacks holding Foul Stench
    pc.defenderCard = null;
    pc.step = 'beginRound';
    combatStep(state);
    // defRoll.rerolls is non-empty only if the FP actually got its Leader re-roll.
    return (state.lastBattle?.defRoll ?? state.pendingCombat?.defRoll)?.rerolls?.length > 0;
  }

  check('Nazgûl 3 vs FP Leadership 1 — re-roll cancelled',
    fpRerolled({ shadowNazgul: 3, fpLeaders: 1 }) === false);
  check('Nazgûl 1 vs FP Leadership 3 — FP still re-rolls',
    fpRerolled({ shadowNazgul: 1, fpLeaders: 3 }) === true);
  check('equal Leadership cancels (RAW says "equals or exceeds")',
    fpRerolled({ shadowNazgul: 2, fpLeaders: 2 }) === false);
}

console.log(failures ? `\nprobe-combat-card-costs: ${failures} FAILURE(S)` : '\nprobe-combat-card-costs OK');
process.exit(failures ? 1 : 0);
