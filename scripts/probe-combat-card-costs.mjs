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

// --- the three "up to N, your choice" costs ---------------------------------------
{
  console.log('\n=== variable costs are paid, not free ===');
  const { variableCostFor } = await import('../src/engine/combatCards.ts');
  const RA = 'sh-str-04', ONS = 'sh-str-02', DND = 'sh-char-08';

  check('Relentless Assault: up to 2 self-hits, before the roll',
    JSON.stringify(variableCostFor(RA)) === JSON.stringify({ kind: 'selfHits', timing: 'preRoll', cap: 2, min: 0 }),
    JSON.stringify(variableCostFor(RA)));
  check('Onslaught: up to 4 self-hits, AFTER casualties',
    variableCostFor(ONS)?.timing === 'postCasualty' && variableCostFor(ONS)?.cap === 4,
    JSON.stringify(variableCostFor(ONS)));
  check('Dread and Despair: Leadership, at least one point ("one or more")',
    variableCostFor(DND)?.kind === 'nazgulLeadership' && variableCostFor(DND)?.min === 1,
    JSON.stringify(variableCostFor(DND)));

  // Unpaid, each must do NOTHING — that is what stops an unanswered prompt from
  // leaking the old free effect.
  check('Relentless Assault unpaid gives no roll bonus', !combatModsFor(RA)?.rollBonus);
  check('Relentless Assault paid 2 gives +2', combatModsFor(RA, { cost: 2 })?.rollBonus === 2);
  check('Dread and Despair unpaid removes no enemy dice', !combatModsFor(DND)?.enemyDiceReduction);
  check('Dread and Despair paid 3 removes 3 dice and costs 3 Leadership',
    combatModsFor(DND, { cost: 3 })?.enemyDiceReduction === 3 && combatModsFor(DND, { cost: 3 })?.ownLeadershipPenalty === 3);
  check('Onslaught is no longer a free 4-dice extra attack', !combatModsFor(ONS)?.extraAttackDice);
}

// --- the prompt actually fires, and charges ---------------------------------------
{
  console.log('\n=== the owner is prompted, and pays ===');
  const { createGame } = await import('../src/engine/setup.ts');
  const { startGame, wotrAdapter } = await import('../src/adapter/wotrAdapter.ts');
  const { combatStep, startBattle } = await import('../src/engine/combat.ts');
  const { REGIONS } = await import('../src/engine/data.ts');
  const { unitCount } = await import('../src/engine/armies.ts');

  function battleWith(card, { shadowUnits = 6, nazgul = 3 } = {}) {
    const state = startGame(createGame({ seed: 3 }));
    for (const r of Object.values(state.regions)) {
      r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
      delete r.siegeBox; r.besieged = false;
    }
    const to = 'osgiliath', from = REGIONS[to].adjacency.find((a) => REGIONS[a]);
    state.nations.gondor.step = 0; state.nations.sauron.step = 0;
    state.regions[to].units = { gondor: { regular: 5, elite: 0 } };
    state.regions[from].units = { sauron: { regular: shadowUnits, elite: 0 } };
    state.regions[from].nazgul = nazgul;
    startBattle(state, 'shadow', from, to);
    const pc = state.pendingCombat;
    pc.attackerCard = card; pc.defenderCard = null;
    pc.step = 'cardCost';
    combatStep(state);
    return { state, from, to };
  }

  { // Relentless Assault — pre-roll, costs the Shadow its own units.
    const { state, from } = battleWith('sh-str-04');
    check('RA: prompted before the roll', state.pendingChoice?.kind === 'combatCardCost',
      `kind=${state.pendingChoice?.kind}`);
    check('RA: the Shadow owns the prompt', state.pendingChoice?.owner === 'shadow');
    const d = state.pendingChoice?.data ?? {};
    check('RA: offered 0..2', d.min === 0 && d.max === 2, JSON.stringify(d));
    const before = unitCount(state, from);
    const res = wotrAdapter.tryApplyAction(state, { kind: 'combatCardCost', amount: 2 }, 'shadow');
    check('RA: paying is accepted', res.ok, res.ok ? '' : res.error);
    const after = res.ok ? res.state : state;
    check('RA: two of its own units died for it', unitCount(after, from) === before - 2,
      `${before} -> ${unitCount(after, from)}`);
    // atkCardCost is a PER-ROUND field, cleared when the round's cards are, so by now
    // the round has resolved and it is undefined again. The durable evidence is the log.
    const paidLine = after.log.filter((e) => /inflict 2 hits on their own units/.test(e.msg ?? ''));
    check('RA: the payment is recorded in the log', paidLine.length === 1,
      JSON.stringify(paidLine.map((e) => e.msg)));
    check('RA: no cost prompt is left hanging', after.pendingChoice?.kind !== 'combatCardCost',
      `kind=${after.pendingChoice?.kind}`);
  }

  { // Dread and Despair — mandatory minimum of one point, capped by Leadership held.
    const { state } = battleWith('sh-char-08', { nazgul: 3 });
    check('DnD: prompted', state.pendingChoice?.kind === 'combatCardCost');
    const d = state.pendingChoice?.data ?? {};
    check('DnD: at least 1, at most the Leadership held (3)', d.min === 1 && d.max === 3, JSON.stringify(d));
    const res = wotrAdapter.tryApplyAction(state, { kind: 'combatCardCost', amount: 0 }, 'shadow');
    check('DnD: paying 0 is accepted', res.ok, res.ok ? '' : res.error);
    const after = res.ok ? res.state : state;
    // "One or more" — 0 is not a legal answer and is clamped up to the mandatory 1.
    const forfeit = after.log.filter((e) => /forfeit 1 point of Nazgûl Leadership/.test(e.msg ?? ''));
    check('DnD: clamped up to the mandatory 1 point', forfeit.length === 1,
      JSON.stringify(after.log.filter((e) => /forfeit/.test(e.msg ?? '')).map((e) => e.msg)));
  }

  { // Onslaught is asked after casualties, so the pre-roll step must skip it.
    const { state } = battleWith('sh-str-02');
    check('Onslaught: NOT asked before the roll', state.pendingChoice?.kind !== 'combatCardCost',
      `kind=${state.pendingChoice?.kind}`);
  }
}

console.log(failures ? `\nprobe-combat-card-costs: ${failures} FAILURE(S)` : '\nprobe-combat-card-costs OK');
process.exit(failures ? 1 : 0);
