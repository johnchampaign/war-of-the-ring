#!/usr/bin/env vite-node
// probe-rules-batch-0923.mjs — the 2026-09-23 batch of printed-text reports:
//
//  * The Last Battle (fp-str-01) carries a discard clause the port never enforced:
//    "You must discard this card from the table as soon as the Fellowship is declared
//    or revealed." And since a play onto an already-revealed Fellowship would be swept
//    straight back off the table, the reveal state is a play condition too — as is an
//    already-active Rohan for Wormtongue (sh-char-22), whose own clause says it goes
//    the moment Rohan wakes (report 29253u1e62620w31).
//  * Captain of the West is CUMULATIVE: "Adds 1 to the Combat Strength of a Free
//    Peoples Army with this Companion (cumulative if more Captains of the West are in
//    the battle) up to a maximum of 5 Combat dice" (Almanac). It was a flat +1 for
//    "any Captain present" (report 3m4h5z6n0o395041).
//  * A card-recruited Nazgûl obeys the ordinary recruiting restrictions — nothing
//    musters into a Settlement the enemy controls, so The King is Revealed (sh-str-18)
//    conjures nothing into a captured Minas Morgul (report 33010827046r0g39).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { declareFellowship } from '../src/engine/fellowship.ts';
import { activateNation } from '../src/engine/politics.ts';
import { combatStep } from '../src/engine/combat.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
/** Run one no-op adapter action so advance() sweeps the table. */
const sweep = (s) => {
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.dice.shadow = ['eye']; s.dice.fp = [];
  return wotrAdapter.applyAction(s, { kind: 'pass' }, 'shadow');
};
/** Aragorn with a Free Peoples Army outside a Free Peoples Nation — The Last Battle's
 *  printed play condition, so only the NEW clauses can be what discards it. */
function lastBattleBoard(seed = 21) {
  const s = startGame(createGame({ seed }));
  s.regions['dagorlad'].units = { gondor: { regular: 2, elite: 0 } };
  s.regions['dagorlad'].characters = ['aragorn'];
  s.characters.inPlay['aragorn'] = 'dagorlad';
  s.characters.entered.push('aragorn');
  s.fellowship.hidden = true;
  return s;
}

{
  console.log('\n=== The Last Battle stays on the table while the Fellowship is hidden ===');
  let s = lastBattleBoard();
  s.cards.fp.table.push('fp-str-01');
  s = sweep(s);
  check('the card is still in play', s.cards.fp.table.includes('fp-str-01'), s.cards.fp.table.join(','));
}

{
  console.log('\n=== ...and leaves it as soon as the Fellowship is revealed ===');
  let s = lastBattleBoard();
  s.cards.fp.table.push('fp-str-01');
  s.fellowship.hidden = false;
  s = sweep(s);
  check('the card is off the table', !s.cards.fp.table.includes('fp-str-01'), s.cards.fp.table.join(','));
  check('...and in the Free Peoples Strategy discard', s.cards.fp.discard.strategy.includes('fp-str-01'));
  check('the log says WHY, in the card\'s own words', s.log.some((e) => e.msg.includes('The Last Battle is discarded') && e.msg.includes('revealed')),
    s.log.filter((e) => e.msg.includes('The Last Battle')).map((e) => e.msg).join(' | '));
}

{
  console.log('\n=== ...and on a declaration too, though that leaves it Hidden ===');
  const s = lastBattleBoard();
  s.cards.fp.table.push('fp-str-01');
  s.fellowship.location = 'hollin'; s.fellowship.progress = 0;
  declareFellowship(s, 'hollin');
  check('the Fellowship is still Hidden (so the reveal clause is not what fired)', s.fellowship.hidden === true);
  check('the card is off the table', !s.cards.fp.table.includes('fp-str-01'), s.cards.fp.table.join(','));
  check('...and in the Free Peoples Strategy discard', s.cards.fp.discard.strategy.includes('fp-str-01'));
}

{
  console.log('\n=== a declaration in a LATER turn does not block replaying the card ===');
  // The declare clause is a momentary trigger, not a state: a Fellowship that already
  // declared this turn may still take the card back to the table.
  const s = lastBattleBoard();
  s.fellowship.location = 'hollin'; s.fellowship.progress = 0;
  declareFellowship(s, 'hollin');
  check('playable again after the declaration', canPlayCard(s, 'fp-str-01', 'fp') === true);
}

{
  console.log('\n=== The Last Battle is not offered onto a revealed Fellowship ===');
  const s = lastBattleBoard();
  check('offered while Hidden', canPlayCard(s, 'fp-str-01', 'fp') === true);
  s.fellowship.hidden = false;
  check('refused once Revealed', canPlayCard(s, 'fp-str-01', 'fp') === false);
}

{
  console.log('\n=== Wormtongue is not offered once Rohan is already active ===');
  const s = startGame(createGame({ seed: 22 }));
  s.characters.inPlay['saruman'] = 'orthanc'; s.characters.entered.push('saruman');
  check('offered while Rohan is passive', canPlayCard(s, 'sh-char-22', 'shadow') === true);
  activateNation(s, 'rohan', { viaCompanion: true });
  check('refused once Rohan is awake', canPlayCard(s, 'sh-char-22', 'shadow') === false);
}

// --- Captain of the West ------------------------------------------------------
/** A Free Peoples attack with `units` Army units and the named Captains present. */
function captainRoll(captains, units = 1) {
  const s = startGame(createGame({ seed: 23 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.regions['dagorlad'].units = { gondor: { regular: units, elite: 0 } };
  s.regions['dagorlad'].characters = [...captains];
  s.regions['gorgoroth'].units = { sauron: { regular: 5, elite: 0 } };
  s.pendingCombat = {
    attacker: 'fp', defender: 'shadow', from: 'dagorlad', to: 'gorgoroth', round: 0,
    fortified: false, step: 'beginRound', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0,
  };
  combatStep(s);
  // Read the round's log entry, not pendingCombat: a one-unit Army is often wiped out
  // in the same round, and finishCombat clears the live record.
  const round = s.log.find((e) => e.payload?.attacker?.dice);
  return round ? round.payload.attacker.dice.length : null;
}

{
  console.log('\n=== Captain of the West adds one die PER Captain, not one in total ===');
  check('one unit alone rolls one die', captainRoll([]) === 1, `${captainRoll([])}`);
  check('one unit + Gimli rolls two', captainRoll(['gimli']) === 2, `${captainRoll(['gimli'])}`);
  const three = captainRoll(['gimli', 'legolas', 'boromir']);
  check('one unit + three Captains rolls four', three === 4, `${three}`);
  const capped = captainRoll(['gimli', 'legolas', 'boromir', 'aragorn'], 3);
  check('and the five-dice cap still bites', capped === 5, `${capped}`);
  const hobbits = captainRoll(['meriadoc', 'peregrin']);
  check('the Hobbits are not Captains of the West', hobbits === 1, `${hobbits}`);
}

// --- Card-recruited Nazgûl ----------------------------------------------------
function kingIsRevealed(mutate) {
  const s = startGame(createGame({ seed: 24 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.characters.entered.push('aragorn');
  mutate?.(s);
  const before = s.reinforcements.sauron.nazgul ?? 0;
  getHandler('sh-str-18').apply(s, 'shadow');
  return { s, before, placed: before - (s.reinforcements.sauron.nazgul ?? 0) };
}

{
  console.log('\n=== The King is Revealed musters into a Shadow-held Minas Morgul ===');
  const { s, placed } = kingIsRevealed();
  check('a Nazgûl arrived', placed === 1 && s.regions['minas-morgul'].nazgul === 1, `placed ${placed}, on the board ${s.regions['minas-morgul'].nazgul}`);
  check('and the five Sauron Regulars with him', (s.regions['minas-morgul'].units.sauron?.regular ?? 0) === 5);
}

{
  console.log('\n=== ...but nothing at all into one the Free Peoples have captured ===');
  const { s, placed } = kingIsRevealed((st) => { st.regions['minas-morgul'].control = 'fp'; });
  check('no Nazgûl is conjured there', placed === 0 && s.regions['minas-morgul'].nazgul === 0, `placed ${placed}, on the board ${s.regions['minas-morgul'].nazgul}`);
  check('and no Regulars either', (s.regions['minas-morgul'].units.sauron?.regular ?? 0) === 0);
}

{
  console.log('\n=== ...nor into one a Free Peoples Army is standing in ===');
  const { s, placed } = kingIsRevealed((st) => { st.regions['minas-morgul'].units = { gondor: { regular: 2, elite: 0 } }; });
  check('no Nazgûl is conjured there', placed === 0 && s.regions['minas-morgul'].nazgul === 0, `placed ${placed}`);
}

{
  console.log('\n=== ...and under siege the garrison gets them, in the Stronghold ===');
  const { s, placed } = kingIsRevealed((st) => {
    st.regions['minas-morgul'].besieged = true;
    st.regions['minas-morgul'].units = { gondor: { regular: 4, elite: 0 } };            // the besieger, in the open field
    st.regions['minas-morgul'].siegeBox = { units: { sauron: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  });
  check('the Nazgûl joins the boxed garrison', placed === 1 && s.regions['minas-morgul'].siegeBox.nazgul === 1,
    `placed ${placed}, box ${s.regions['minas-morgul'].siegeBox.nazgul}, field ${s.regions['minas-morgul'].nazgul}`);
  check('not the besieger in the open field', s.regions['minas-morgul'].nazgul === 0);
  check('and the Regulars fill the box to its five-unit cap', (s.regions['minas-morgul'].siegeBox.units.sauron?.regular ?? 0) === 5,
    `${s.regions['minas-morgul'].siegeBox.units.sauron?.regular ?? 0}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
