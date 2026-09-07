#!/usr/bin/env vite-node
// probe-siege-destination-and-initiative.mjs — two player reports from 2026-09-06:
//
//  1. "Shadow Lengthens: I cannot use it to move an army from Moria to Lorien. I have
//     an army in Lorien besieging the elves. I am not under siege myself, so it should
//     be legal."
//     The card reads "each movement must end in a region already occupied by another
//     Shadow Army (that must not be under siege)". The engine's RAW siege model keeps
//     the GARRISON in `siegeBox` and leaves the BESIEGER in the region's open field, so
//     a Shadow Army found in a besieged region is always the besieging one — legal to
//     join, exactly as a plain Army move may join it. Both this card and Shadows Gather
//     tested `regions[to].besieged` instead, which banned precisely the legal case.
//
//  2. "Scouts resolves at initiative 1. This immediately ends the battle … thus the
//     Shadow player doesn't get a chance to resolve the effects of their Combat card
//     (at initiative 1+). That's the expected behavior, but now Dread and Despair
//     resolved first."
//     Combat cards resolve in initiative order, lower first (the rulebook's own example
//     is Scouts at 1 beating Durin's Bane at 2). Dread and Despair is initiative 3, and
//     its "forfeit one or more points of Nazgûl Leadership" is collected in the
//     `cardCost` step — which ran BEFORE the pre-combat pipeline, so the slower card was
//     sized, announced and applied before the faster one retreated the Army.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { forceUnitCount, unitCount, armySide, settlementController } from '../src/engine/armies.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolvePreCombatRetreat } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function bareBoard(seed = 11) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  return s;
}

/** The reported position: a Shadow Army in Moria, and another Shadow Army in Lórien
 *  besieging the Elven garrison (which sits in the siege box). */
function moriaAndTheSiegeOfLorien() {
  const s = bareBoard();
  s.regions['moria'].units = { sauron: { regular: 3, elite: 1 } };
  s.regions['moria'].nazgul = 1;
  const lorien = s.regions['lorien'];
  lorien.units = { sauron: { regular: 2, elite: 1 } };   // the BESIEGER, in the open field
  lorien.besieged = true;
  lorien.siegeBox = { units: { elves: { regular: 1, elite: 2 } }, leaders: 1, nazgul: 0, characters: [] };
  return s;
}

const offers = (s, id, side = 'shadow') => (getHandler(id).targets?.(s, side, []) ?? []);
const has = (list, from, to) => list.some((t) => t.from === from && t.to === to);

{
  console.log('\n=== The Shadow Lengthens: Moria → a Lórien our own Army is besieging ===');
  const s = moriaAndTheSiegeOfLorien();
  check('Lórien is flagged besieged with the Elves boxed', s.regions['lorien'].besieged && forceUnitCount(s.regions['lorien'].siegeBox) === 3);
  check('the Army standing in Lórien is the Shadow BESIEGER', armySide(s, 'lorien') === 'shadow');
  check('the card is playable', canPlayCard(s, 'sh-str-08', 'shadow'));
  const targets = offers(s, 'sh-str-08');
  check('Moria → Lórien is offered (the reported refusal)', has(targets, 'moria', 'lorien'),
    `${targets.length} moves offered`);
  check('Shadows Gather offers it too', has(offers(s, 'sh-str-07'), 'moria', 'lorien'));

  // ...and taking it reinforces the siege without ending it.
  getHandler('sh-str-08').applyTarget(s, 'shadow', { from: 'moria', to: 'lorien' }, []);
  check('the besieging stack grew to 7', unitCount(s, 'lorien') === 7, `field=${unitCount(s, 'lorien')}`);
  check('Moria is empty', unitCount(s, 'moria') === 0);
  check('the siege still stands', s.regions['lorien'].besieged === true);
  check('the Elven garrison is untouched in its box', forceUnitCount(s.regions['lorien'].siegeBox) === 3);
  check('and Lórien is still held by the Free Peoples (no early capture)',
    settlementController(s, 'lorien') === 'fp', String(settlementController(s, 'lorien')));
}

{
  console.log('\n=== ...and marching the besieger OUT with the card lifts the siege ===');
  const s = moriaAndTheSiegeOfLorien();
  const targets = offers(s, 'sh-str-08');
  check('Lórien → Moria is offered as well', has(targets, 'lorien', 'moria'));
  getHandler('sh-str-08').applyTarget(s, 'shadow', { from: 'lorien', to: 'moria' }, []);
  check('the siege is lifted', s.regions['lorien'].besieged === false && !s.regions['lorien'].siegeBox);
  check('the Elves are back in the open field', unitCount(s, 'lorien') === 3 && armySide(s, 'lorien') === 'fp',
    `${unitCount(s, 'lorien')} units, side=${armySide(s, 'lorien')}`);
}

{
  console.log('\n=== a Shadow Army that IS under siege is no destination ===');
  const s = bareBoard();
  s.regions['moria'].units = { sauron: { regular: 2, elite: 0 } };
  const mg = s.regions['minas-morgul'];               // Shadow Stronghold, besieged by the FP
  mg.units = { gondor: { regular: 3, elite: 1 } };    // the FP besieger holds the field
  mg.besieged = true;
  mg.siegeBox = { units: { sauron: { regular: 2, elite: 1 } }, leaders: 0, nazgul: 1, characters: [] };
  const targets = offers(s, 'sh-str-08');
  check('the boxed Shadow garrison is not offered as a destination', !targets.some((t) => t.to === 'minas-morgul'),
    JSON.stringify(targets.filter((t) => t.to === 'minas-morgul')));
  check('nor may it be the Army that moves', !targets.some((t) => t.from === 'minas-morgul'));
}

// ---------------------------------------------------------------------------------
// 2. Scouts (initiative 1) outruns Dread and Despair (initiative 3).
// ---------------------------------------------------------------------------------
const SCOUTS = 'fp-str-05';            // The Spirit of Mordor — combat half "Scouts", ini 1
const DREAD_AND_DESPAIR = 'sh-char-08'; // Candles of Corpses — combat half "Dread and Despair", ini 3

/** Shadow (with Nazgûl, so Dread and Despair is playable) attacks a Rohan Army in the
 *  Fords of Isen — a field battle with the Free Peoples defending, so Scouts is playable. */
function fordsOfIsen({ shadowCard = null, fpCard = null, seed = 4 } = {}) {
  const s = bareBoard(seed);
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 2, elite: 3 } };
  s.regions['orthanc'].nazgul = 2;                     // Nazgûl Leadership 2 ≥ 1
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.regions['fords-of-isen'].leaders = 1;
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  s.cards.fp.hand = fpCard ? [fpCard] : [];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  return s;
}

/** Play the battle out, answering every prompt, and record what we were asked. */
function playOut(s, { shadowCard, fpCard }) {
  const asked = [];
  for (let i = 0; i < 60 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    asked.push(`${ch.kind}:${ch.owner}`);
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard ?? null : fpCard ?? null); continue; }
    if (ch.kind === 'preCombatRetreat') {
      const dest = s.regions['fords-of-isen'] && (s.pendingCombat?.preCombatRetreatFrom ?? null);
      resolvePreCombatRetreat(s, dest ? (s.regions['gap-of-rohan'] ? 'gap-of-rohan' : null) : null);
      continue;
    }
    break; // any other prompt ends the probe — the caller inspects `asked`
  }
  return asked;
}

{
  console.log('\n=== Scouts (1) vs Dread and Despair (3): the slower card never resolves ===');
  const s = fordsOfIsen({ shadowCard: DREAD_AND_DESPAIR, fpCard: SCOUTS });
  const asked = playOut(s, { shadowCard: DREAD_AND_DESPAIR, fpCard: SCOUTS });
  check('the Shadow was NOT asked to forfeit Nazgûl Leadership for a card that never resolves',
    !asked.some((a) => a.startsWith('combatCardCost')), asked.join(', '));
  check('the Free Peoples retreated before the roll', unitCount(s, 'fords-of-isen') === 0,
    `${unitCount(s, 'fords-of-isen')} units left at the Fords`);
  check('nobody rolled — the battle ended in the pre-combat step',
    !s.pendingCombat && !(s.lastBattle?.atkRoll?.dice?.length),
    JSON.stringify(s.lastBattle?.atkRoll ?? null));
  const outrun = s.log.some((e) => typeof e.msg === 'string' && e.msg.includes('TOO SLOW'));
  check('the log says the Shadow card was too slow', outrun,
    s.log.slice(-6).map((e) => e.msg).join(' | '));
}

{
  console.log('\n=== ...but Dread and Despair is still sized normally when nobody outruns it ===');
  const s = fordsOfIsen({ shadowCard: DREAD_AND_DESPAIR });
  const asked = playOut(s, { shadowCard: DREAD_AND_DESPAIR });
  check('the Shadow IS asked to forfeit Nazgûl Leadership', asked.some((a) => a === 'combatCardCost:shadow'),
    asked.join(', '));
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
