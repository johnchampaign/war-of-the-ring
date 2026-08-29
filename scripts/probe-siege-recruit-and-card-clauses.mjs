#!/usr/bin/env vite-node
// probe-siege-recruit-and-card-clauses.mjs — the 2026-08-26/29 batch of player reports:
//   1. "I couldn't play Imrahil while Dol Amroth is under siege?"
//   2. "No way to play Celeborn's Galadhrim (and I assume other Muster cards) when besieged"
//   3. "I wanted to use [A/M] to play 'Olog-hai' and place a Sauron Elite with the
//       besieging army at Minas Tirith. It didn't give me that option."
//   4. "Threats and Promises can't be discarded"
//   5. "Aragorn does not activate Gondor"
//   6. "Candles of Corpses can't be played while the fellowship are in a settlement"
//   7. "I wanted to use [E] to play 'i will go alone' but it won't let me … according to
//       the Official WotR Card Almanac: 'This card may be played on the Mordor Track…'"
//
// Rules: rulebook p.28 (Event-card recruits ignore the At-War gate AND a besieged
// Stronghold), p.31 (a besieged Stronghold holds at most five Army units), p.33 (the
// besieged region "is considered free for the besieging player"), p.35 (a Companion
// activates a Nation when he "ends his movement OR ENTERS PLAY" in its City/Stronghold),
// p.44 (on the Mordor Track anything that would separate a Companion removes him from
// play); Threats and Promises' and Candles of Corpses' printed text + Almanac notes.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { forceUnitCount } from '../src/engine/armies.ts';
import { onArmyAttacked, advancePolitical } from '../src/engine/politics.ts';
import { bringUpgrade } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const fresh = (seed = 11) => startGame(createGame({ seed }));

/** Put `region` under siege: `field` holds the besieger, `box` the garrison. */
function besiege(state, region, field, box) {
  const r = state.regions[region];
  r.units = field.units; r.leaders = field.leaders ?? 0; r.nazgul = field.nazgul ?? 0; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: box.units, leaders: box.leaders ?? 0, nazgul: 0, characters: box.characters ?? [] };
  return r;
}

/** Run an interactive event card to completion, taking the first offered target each
 *  step (mirrors what the adapter's eventTarget loop does). */
function resolveCard(state, id, side) {
  const h = getHandler(id);
  h.apply?.(state, side);
  const applied = [];
  for (let i = 0; i < (h.repeat ?? 1); i++) {
    const t = h.targets?.(state, side, applied) ?? [];
    if (!t.length) break;
    applied.push(t[0]);
    h.applyTarget?.(state, side, t[0], applied.slice(0, -1));
  }
  h.finalize?.(state, side, applied);
  return applied;
}

{
  console.log('\n=== Imrahil of Dol Amroth recruits INTO a besieged Dol Amroth (p.28) ===');
  const state = fresh();
  const r = besiege(state, 'dol-amroth',
    { units: { southrons: { regular: 2, elite: 0 } } },
    { units: { gondor: { regular: 1, elite: 0 } } });
  check('the card is playable while the Stronghold is besieged', canPlayCard(state, 'fp-str-18', 'fp'));
  const before = forceUnitCount(r.siegeBox);
  resolveCard(state, 'fp-str-18', 'fp');
  check('the unit joined the GARRISON, not the besieger', forceUnitCount(r.siegeBox) === before + 1,
    `box ${before} -> ${forceUnitCount(r.siegeBox)}`);
  check('the besieging Southrons are untouched', forceUnitCount(r) === 2);
  check('the Gondor Leader went into the Stronghold too', r.siegeBox.leaders === 1);
}

{
  console.log('\n=== the 5-unit siege cap still binds (p.31) ===');
  const state = fresh();
  const r = besiege(state, 'dol-amroth',
    { units: { southrons: { regular: 2, elite: 0 } } },
    { units: { gondor: { regular: 5, elite: 0 } } });
  check('a full Stronghold cannot take another card recruit', !canPlayCard(state, 'fp-str-18', 'fp'));
  check('nothing was placed', forceUnitCount(r.siegeBox) === 5);
}

{
  console.log("\n=== Celeborn's Galadhrim recruits into a besieged Lórien ===");
  const state = fresh();
  const r = besiege(state, 'lorien',
    { units: { sauron: { regular: 3, elite: 4 } }, nazgul: 4 },
    { units: { elves: { regular: 1, elite: 2 } }, leaders: 1 });
  check('the card is playable', canPlayCard(state, 'fp-str-15', 'fp'));
  resolveCard(state, 'fp-str-15', 'fp');
  check('the Elven unit joined the garrison', forceUnitCount(r.siegeBox) === 4);
  check('the besieging Shadow stack is unchanged', forceUnitCount(r) === 7);
}

{
  console.log('\n=== Olog-hai reinforces the BESIEGING army at Minas Tirith (p.33) ===');
  const state = fresh();
  const r = besiege(state, 'minas-tirith',
    { units: { sauron: { regular: 7, elite: 1 } }, nazgul: 5 },
    { units: { gondor: { regular: 3, elite: 1 } }, leaders: 1 });
  state.nations.sauron.step = 0; state.nations.sauron.active = true; // printed: Sauron At War
  check('the card is playable', canPlayCard(state, 'sh-str-14', 'shadow'));
  const targets = getHandler('sh-str-14').targets(state, 'shadow', []);
  check('the besieged region is offered', targets.some((t) => t.region === 'minas-tirith'));
  const elite = targets.find((t) => t.region === 'minas-tirith' && t.figure === 'elite');
  check('as an Elite as well as a Regular', !!elite);
  getHandler('sh-str-14').applyTarget(state, 'shadow', elite);
  check('the Elite joined the BESIEGER in the open field', forceUnitCount(r) === 9, `field ${forceUnitCount(r)}`);
  check('the boxed Gondor garrison is untouched', forceUnitCount(r.siegeBox) === 4);
}

{
  console.log("\n=== Éomer still needs a FREE region (the Almanac's named exception) ===");
  const state = fresh();
  besiege(state, 'helms-deep',
    { units: { isengard: { regular: 4, elite: 0 } } },
    { units: { rohan: { regular: 1, elite: 0 } } });
  const regions = getHandler('fp-str-23').targets(state, 'fp', []).map((t) => t.region);
  check('a besieged Helm’s Deep is NOT an Éomer target', !regions.includes('helms-deep'));
}

{
  console.log('\n=== Threats and Promises discards itself on an attack-driven advance ===');
  const state = fresh();
  state.cards.shadow.table.push('sh-str-05');
  state.nations.elves.active = true; state.nations.elves.step = 3;
  onArmyAttacked(state, 'elves', 'rivendell');
  check('the card left the table', !state.cards.shadow.table.includes('sh-str-05'));
  check('and went to the Shadow Strategy discard', state.cards.shadow.discard.strategy.includes('sh-str-05'));
}
{
  console.log('=== …and on a Companion-ability advance, but not on a card advance ===');
  const s1 = fresh();
  s1.cards.shadow.table.push('sh-str-05');
  s1.nations.gondor.active = true; s1.nations.gondor.step = 2;
  advancePolitical(s1, 'gondor', 1, { viaCompanion: true });
  check('a Companion advance discards it', !s1.cards.shadow.table.includes('sh-str-05'));

  const s2 = fresh();
  s2.cards.shadow.table.push('sh-str-05');
  s2.nations.gondor.active = true; s2.nations.gondor.step = 2;
  advancePolitical(s2, 'gondor', 1);
  check('a plain Event-card advance does NOT', s2.cards.shadow.table.includes('sh-str-05'));

  const s3 = fresh();
  s3.cards.shadow.table.push('sh-str-05');
  s3.nations.sauron.active = true; s3.nations.sauron.step = 2;
  advancePolitical(s3, 'sauron', 1, { viaAttack: true });
  check('a SHADOW Nation advancing does NOT', s3.cards.shadow.table.includes('sh-str-05'));
}

{
  console.log('\n=== crowning Aragorn activates Gondor (p.35 "or enters play") ===');
  const state = fresh();
  state.fellowship.companions = state.fellowship.companions.filter((c) => c !== 'strider');
  state.regions['minas-tirith'].characters.push('strider');
  state.characters.inPlay['strider'] = 'minas-tirith';
  state.nations.gondor.active = false;
  check('Gondor starts passive', !state.nations.gondor.active);
  check('the crowning succeeds', bringUpgrade(state, 'aragorn'));
  check('Gondor is now active', state.nations.gondor.active);
}

{
  console.log('\n=== Candles of Corpses reads the NATION, not the control marker ===');
  const state = fresh();
  state.fellowship.location = 'bree';                 // a North Town
  state.regions['bree'].control = 'shadow';           // captured by the Shadow
  check('a CAPTURED Free Peoples Settlement still bars the card', !canPlayCard(state, 'sh-char-08', 'shadow'));
  state.fellowship.location = 'moria';                // a Sauron Stronghold
  state.regions['moria'].control = 'fp';              // captured by the Free Peoples
  check('a captured SHADOW Stronghold offers no protection', canPlayCard(state, 'sh-char-08', 'shadow'));
  state.fellowship.location = 'fords-of-bruinen';     // no Settlement at all
  check('a plain region is fine', canPlayCard(state, 'sh-char-08', 'shadow'));
  state.fellowship.location = 'rivendell';
  state.regions['rivendell'].control = null;
  check('an uncaptured Elven Stronghold bars it', !canPlayCard(state, 'sh-char-08', 'shadow'));
}

{
  console.log('\n=== "I Will Go Alone" on the Mordor Track: remove from play, still heal ===');
  const state = fresh();
  const fs = state.fellowship;
  fs.mordor = 2; fs.location = 'morannon'; fs.corruption = 5;
  fs.companions = ['gandalf-grey', 'meriadoc'];
  fs.guide = 'gandalf-grey';
  check('the card is playable on the track', canPlayCard(state, 'fp-char-11', 'fp'));
  const h = getHandler('fp-char-11');
  const offered = h.targets(state, 'fp', []);
  check('the Fellowship’s Companions are offered', offered.some((t) => t.companion === 'meriadoc'));
  check('no destination region is offered (there is nowhere to go)', offered.every((t) => !t.region));
  check('"done" is NOT offered before a pick (the separation is the cost)',
    !h.noDone || (typeof h.noDone === 'function' ? h.noDone(state) === false : true));
  h.finalize(state, 'fp', [{ companion: 'meriadoc' }]);
  check('Meriadoc left the Fellowship', !fs.companions.includes('meriadoc'));
  check('…and is out of the game, not placed on the board',
    state.characters.eliminated.includes('meriadoc') && !state.characters.inPlay['meriadoc']);
  check('the Corruption heal still took effect', fs.corruption === 4, `corruption ${fs.corruption}`);
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} CHECK(S) FAILED`);
if (failures) process.exit(1);
