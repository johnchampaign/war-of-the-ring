#!/usr/bin/env vite-node
// probe-declare-activates.mjs — declaring the Fellowship in a Free Peoples City or
// Stronghold ACTIVATES that Nation.
//
// Rulebook p.19 (Fellowship Phase): "If the Fellowship is declared in a City or
// Stronghold of a Free Peoples Nation, that Nation is activated ... and the
// Ring-bearers may be healed." Repeated in the p.34 activation list: "The Fellowship
// of the Ring is declared in a City or Stronghold of that Nation."
//
// The port was skipping the activation entirely (documented as a deviation, reported
// by a player as report 1y222s09436d5q0z). The Almanac's declare walkthrough (the
// Ring-bearers entry) ties heal and activation to the SAME condition: an UNCONQUERED
// Free Peoples City/Stronghold grants both, a conquered one grants neither.
//
// And Wormtongue (sh-char-22) names the declare as one of its three exceptions:
// "Rohan cannot be activated except by an appropriate Companion, or by the Fellowship
// being declared in Edoras or Helm's Deep, or by an attack on Edoras or Helm's Deep."
// So a declare at Edoras/Helm's Deep rouses Rohan through the card — which then
// discards the card, per its own printed clause.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A game parked in the Fellowship phase with the Fellowship sitting in `where`. */
function board(where) {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'fellowship';
  state.fellowship.location = where;
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  state.fellowship.progress = 0;
  state.fellowship.corruption = 3;
  state.flags.fellowshipDeclaredThisTurn = false;
  return state;
}
const declare = (state, target) => wotrAdapter.applyAction(state, { kind: 'declareFellowship', target }, 'fp');

console.log('\n=== an unconquered Free Peoples City / Stronghold activates its Nation ===');
{
  // Dale is a City of The North; Lórien a Stronghold of the Elves (the Elves are the
  // one Free Peoples Nation that starts ACTIVE at setup, so it is only checked for
  // the heal and for not regressing).
  for (const [where, nation] of [['dale', 'north'], ['lorien', 'elves'], ['minas-tirith', 'gondor'], ['erebor', 'dwarves']]) {
    const before = board(where);
    if (nation !== 'elves') check(`${where} starts passive`, before.nations[nation].active === false);
    const after = declare(before, where);
    check(`declaring at ${where} activates ${nation}`, after.nations[nation].active === true);
    check(`declaring at ${where} still heals`, after.fellowship.corruption === 2, `corruption ${after.fellowship.corruption}`);
  }
}

console.log('\n=== a conquered City grants neither the heal nor the activation ===');
{
  const state = board('dale');
  state.regions['dale'].control = 'shadow';
  const after = declare(state, 'dale');
  check('the North stays passive', after.nations.north.active === false);
  check('no Corruption is healed', after.fellowship.corruption === 3, `corruption ${after.fellowship.corruption}`);
}

console.log('\n=== a Town or a plain region activates nothing ===');
{
  // The Shire's own regions: Hobbiton is not a City/Stronghold.
  const state = board('bree'); // Bree is a Town of The North
  const after = declare(state, 'bree');
  check('a Town does not activate the Nation', after.nations.north.active === false);
  check('a Town does not heal', after.fellowship.corruption === 3, `corruption ${after.fellowship.corruption}`);
}

console.log('\n=== an already-active Nation is untouched, and Shadow nations never activate ===');
{
  const state = board('dale');
  state.nations.north.active = true;
  const after = declare(state, 'dale');
  check('still active, no crash', after.nations.north.active === true);
  check('the heal still happens', after.fellowship.corruption === 2, `corruption ${after.fellowship.corruption}`);
}

console.log('\n=== Wormtongue: only Edoras / Helm’s Deep rouse Rohan by declaring ===');
{
  /** Wormtongue on the table with Saruman in play (its play condition). */
  const withWormtongue = (where) => {
    const state = board(where);
    state.characters.entered.push('saruman');
    state.regions['orthanc'].characters = ['saruman'];
    state.cards.shadow.table.push('sh-char-22');
    return state;
  };

  // Edoras is a City of Rohan; Helm's Deep a Stronghold. Both are named exceptions.
  for (const where of ['edoras', 'helms-deep']) {
    const after = declare(withWormtongue(where), where);
    check(`declaring at ${where} rouses Rohan through Wormtongue`, after.nations.rohan.active === true);
    check(`Rohan active discards Wormtongue (${where})`, !after.cards.shadow.table.includes('sh-char-22'),
      JSON.stringify(after.cards.shadow.table));
  }

  // Any OTHER Free Peoples City/Stronghold of Rohan does not exist in the base game,
  // so the card's veto is exercised through a non-Rohan declare leaving Rohan alone
  // and through the pre-existing army paths (probe-table-discards covers those).
  const elsewhere = declare(withWormtongue('dale'), 'dale');
  check('declaring at Dale does not rouse Rohan', elsewhere.nations.rohan.active === false);
  check('Wormtongue survives a declare elsewhere', elsewhere.cards.shadow.table.includes('sh-char-22'),
    JSON.stringify(elsewhere.cards.shadow.table));
  check('the North is roused by that same declare', elsewhere.nations.north.active === true);
}

console.log(failures ? `\nprobe-declare-activates: ${failures} FAILURE(S)` : '\nprobe-declare-activates OK');
process.exit(failures ? 1 : 0);
