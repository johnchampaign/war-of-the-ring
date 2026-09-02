#!/usr/bin/env vite-node
// probe-siege-card-preconditions.mjs — the 2026-09-01 player report:
//
//   "T14: FP attacks Minas Morgul (3r, 3e, 2l vs 1e). It says I didn't play a
//    card. Maybe I missed it, but I don't remember it asking (I could've played
//    'We come to kill')."
//
// They were right. A Combat card's "Play if…" precondition was checked against the
// battle's REGIONS, but in a siege assault (and in a sortie) one side's figures sit
// in `region.siegeBox` while the region itself holds the other side — and from ===
// to, so BOTH sides resolved to the same region and every check ran against the
// wrong army. The besieged garrison's Elites, Companions and Leaders were invisible,
// so their cards were silently never offered: the defender of a stormed Stronghold
// could not play 'We Come to Kill' off the Elite standing in the box.
//
// Checks, for an assault and for a sortie: the boxed side's own figures satisfy its
// preconditions; the enemy's figures standing in the same region do NOT; and the
// White Rider offer (same region-vs-box mistake) sees Gandalf inside the walls.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { playableCombatCards, whiteRiderApplicable } from '../src/engine/combat.ts';
import { REGIONS, sideOfNation } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Combat halves keyed by the precondition each one tests.
const WE_COME_TO_KILL = 'sh-str-14';  // "Play if a Shadow Elite unit is in the battle."
const CHARGE = 'fp-str-13';           // "Play if a Free Peoples Elite unit is in the battle."
const MIGHTY_ATTACK = 'fp-char-06';   // "Play if a Companion is in the battle."

function bareBoard() {
  const state = startGame(createGame({ seed: 5 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  state.cards.fp.hand = []; state.cards.shadow.hand = [];
  return state;
}

const strongholdOf = (side) => Object.entries(REGIONS).find(([, d]) =>
  d.settlement === 'Stronghold' && d.nation && sideOfNation(d.nation) === side)[0];

/** A besieged Stronghold: `boxed` side's figures in the siege box, the other side's
 *  army standing in the region's open field. */
function siege(id, box, field) {
  const state = bareBoard();
  const r = state.regions[id];
  r.siegeBox = { units: {}, leaders: 0, nazgul: 0, characters: [], ...box };
  r.units = field.units ?? {};
  r.leaders = field.leaders ?? 0; r.nazgul = field.nazgul ?? 0;
  r.characters = field.characters ?? [];
  r.besieged = true;
  return state;
}

const assault = (state, id, { attacker, defender }) => {
  state.pendingCombat = {
    attacker, defender, from: id, to: id, round: 0, fortified: false, step: 'defenderCard',
    attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0, siege: true,
    siegeRoundsLeft: 1, boxed: defender,
  };
  return state;
};
const sortie = (state, id, { attacker, defender }) => {
  state.pendingCombat = {
    attacker, defender, from: id, to: id, round: 0, fortified: false, step: 'attackerCard',
    attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0, boxed: attacker,
  };
  return state;
};

// --- 1. the reported battle: a boxed Shadow garrison with one Elite ------------------
{
  console.log('\n=== siege assault: the boxed defender sees its OWN Elite ===');
  const id = strongholdOf('shadow');
  const state = assault(siege(id,
    { units: { sauron: { regular: 0, elite: 1 } } },                 // garrison: 1 Elite
    { units: { gondor: { regular: 3, elite: 3 } }, leaders: 2 }),    // besieger: the FP army
    id, { attacker: 'fp', defender: 'shadow' });
  state.cards.shadow.hand = [WE_COME_TO_KILL];
  check("'We Come to Kill' is offered off the Elite in the siege box",
    playableCombatCards(state, 'shadow').includes(WE_COME_TO_KILL));

  // …and is NOT offered when the garrison holds no Elite. The besieging FP army's
  // three Elites stand in the same region, so a region-keyed check would say yes.
  const noElite = assault(siege(id,
    { units: { sauron: { regular: 2, elite: 0 } } },
    { units: { gondor: { regular: 3, elite: 3 } }, leaders: 2 }),
    id, { attacker: 'fp', defender: 'shadow' });
  noElite.cards.shadow.hand = [WE_COME_TO_KILL];
  check('an all-Regular garrison is not handed the enemy Elites',
    !playableCombatCards(noElite, 'shadow').includes(WE_COME_TO_KILL));
}

// --- 2. the mirror: a boxed FP garrison's Elite and Companion -----------------------
{
  console.log('\n=== siege assault: the boxed FP garrison sees its Elite and Companion ===');
  const id = strongholdOf('fp');
  const nation = REGIONS[id].nation;
  const state = assault(siege(id,
    { units: { [nation]: { regular: 1, elite: 1 } }, characters: ['boromir'] },
    { units: { sauron: { regular: 5, elite: 0 } }, nazgul: 1 }),
    id, { attacker: 'shadow', defender: 'fp' });
  state.cards.fp.hand = [CHARGE, MIGHTY_ATTACK];
  const offered = playableCombatCards(state, 'fp');
  check("'Charge' is offered off the garrison's Elite", offered.includes(CHARGE), JSON.stringify(offered));
  check("'Mighty Attack' is offered off the Companion in the box", offered.includes(MIGHTY_ATTACK), JSON.stringify(offered));
}

// --- 3. a sortie: it is the ATTACKER who is boxed (p.32) ----------------------------
{
  console.log('\n=== sortie: the boxed attacker sees its own Elite ===');
  const id = strongholdOf('shadow');
  const state = sortie(siege(id,
    { units: { sauron: { regular: 1, elite: 1 } } },                 // the sortieing garrison
    { units: { gondor: { regular: 4, elite: 0 } }, leaders: 1 }),    // the besiegers it charges
    id, { attacker: 'shadow', defender: 'fp' });
  state.cards.shadow.hand = [WE_COME_TO_KILL];
  check("'We Come to Kill' is offered to the sortieing army",
    playableCombatCards(state, 'shadow').includes(WE_COME_TO_KILL));
}

// --- 4. the White Rider offer reads the box too -------------------------------------
{
  console.log('\n=== the White Rider offer sees Gandalf inside the walls ===');
  const id = strongholdOf('fp');
  const nation = REGIONS[id].nation;
  const state = assault(siege(id,
    { units: { [nation]: { regular: 2, elite: 0 } }, characters: ['gandalf-white'] },
    { units: { sauron: { regular: 5, elite: 0 } }, nazgul: 2 }),
    id, { attacker: 'shadow', defender: 'fp' });
  check('Gandalf the White in the siege box still offers the forfeit',
    whiteRiderApplicable(state, state.pendingCombat));

  const noNazgul = assault(siege(id,
    { units: { [nation]: { regular: 2, elite: 0 } }, characters: ['gandalf-white'] },
    { units: { sauron: { regular: 5, elite: 0 } } }),
    id, { attacker: 'shadow', defender: 'fp' });
  check('…and not when there is no Nazgûl Leadership to negate',
    !whiteRiderApplicable(noNazgul, noNazgul.pendingCombat));
}

// --- 5. an ordinary field battle is untouched ---------------------------------------
{
  console.log('\n=== a field battle still reads the two regions ===');
  const state = bareBoard();
  state.regions['osgiliath'].units = { sauron: { regular: 2, elite: 1 } };
  state.regions['minas-tirith'].units = { gondor: { regular: 2, elite: 0 } };
  state.pendingCombat = {
    attacker: 'shadow', defender: 'fp', from: 'osgiliath', to: 'minas-tirith', round: 0,
    fortified: true, step: 'attackerCard', attackerCard: null, defenderCard: null,
    atkHits: 0, defHits: 0,
  };
  state.cards.shadow.hand = [WE_COME_TO_KILL];
  state.cards.fp.hand = [CHARGE];
  check("the attacker's Elite still satisfies 'We Come to Kill'",
    playableCombatCards(state, 'shadow').includes(WE_COME_TO_KILL));
  check("the defender with no Elite still cannot play 'Charge'",
    !playableCombatCards(state, 'fp').includes(CHARGE));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
