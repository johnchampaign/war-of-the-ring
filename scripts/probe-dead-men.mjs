#!/usr/bin/env vite-node
// probe-dead-men.mjs — Dead Men of Dunharrow, as printed (Card Text Reference + Almanac):
//  - playable with Strider/Aragorn inside a besieged Helm's Deep (report 0k5q531m3c4d3x5z:
//    the siege box was never looked in, so the card sat dead in hand);
//  - the player chooses which other Companions go with him (report 4r2y2p2l2e3g3p1h),
//    on the map, then clicks the destination (report 6d31266k0u535r11);
//  - "You MAY then recruit UP TO three" is a 0–3 choice, and recruiting none takes no
//    control of a Shadow-held Settlement (report 2s1q5z4f2d0j2y16);
//  - striking a Shadow Army there is an attack, so the Political Track reacts (Almanac).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { panelShowsAction } from '../src/play/panelFilter.ts';
import { describeAction, eventChoiceInModal } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const isCardCharPick = (a) => a.kind === 'eventTarget' && !!a.from && !!a.companion && !a.region && !a.done;
const ets = (s) => wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'eventTarget');

/** Aragorn + Legolas + Gimli garrison a besieged Helm's Deep; Pelargir holds a Shadow Army. */
function setup({ pelargirShadow = false } = {}) {
  const s = startGame(createGame({ seed: 22 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = [];
  const hd = s.regions['helms-deep'];
  hd.siegeBox = { units: { rohan: { regular: 0, elite: 1 } }, leaders: 0, nazgul: 0, characters: ['aragorn', 'legolas', 'gimli'] };
  hd.units = { isengard: { regular: 2, elite: 0 } }; hd.leaders = 0; hd.besieged = true;
  s.fellowship.companions = s.fellowship.companions.filter((c) => !['legolas', 'gimli', 'strider', 'aragorn'].includes(c));
  for (const c of ['aragorn', 'legolas', 'gimli']) s.characters.inPlay[c] = 'helms-deep';
  s.fellowship.guide = 'gandalf-grey';
  if (pelargirShadow) {
    s.regions['pelargir'].units = { southrons: { regular: 1, elite: 0 } };
    s.regions['pelargir'].control = 'shadow';
  }
  s.cards.fp.hand = ['fp-char-22'];
  return s;
}
const playCard = (s) => {
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-22');
  return play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp') : null;
};

console.log('\n=== playable from inside a besieged Helm\'s Deep ===');
{
  const s = setup();
  const s2 = playCard(s);
  check('the card can be played', !!s2);
  if (s2) {
    const legal = wotrAdapter.legalActions(s2, 'fp');
    const picks = legal.filter(isCardCharPick);
    check('Legolas and Gimli may choose to go (map picks)', picks.map((a) => a.companion).sort().join(',') === 'gimli,legolas', picks.map((a) => a.companion).join(','));
    check('Aragorn is not optional (no pick for him)', !picks.some((a) => a.companion === 'aragorn'));
    const dests = legal.filter((a) => a.kind === 'eventTarget' && a.region && a.companion === 'aragorn');
    check('three map destinations', dests.map((a) => a.region).sort().join(',') === 'erech,lamedon,pelargir');
    check('none of it is a panel button', [...picks, ...dests].every((a) => !panelShowsAction(a, legal, s2)));
  }
}

console.log('\n=== Legolas goes, Gimli stays ===');
{
  let s = playCard(setup());
  s = wotrAdapter.applyAction(s, ets(s).find((a) => isCardCharPick(a) && a.companion === 'legolas'), 'fp');
  check('Gimli is still on offer, Legolas is not', ets(s).filter(isCardCharPick).map((a) => a.companion).join(',') === 'gimli');
  s = wotrAdapter.applyAction(s, ets(s).find((a) => a.region === 'erech'), 'fp');
  const counts = ets(s);
  check('the recruit step offers 0..3', counts.map((a) => a.count).join(',') === '0,1,2,3', counts.map((a) => a.count).join(','));
  check('...in the decision modal', eventChoiceInModal(wotrAdapter.legalActions(s, 'fp')));
  check('...with readable labels', describeAction(counts[0]).includes('no Gondor') && describeAction(counts[2]).includes('2 Gondor Regulars'), describeAction(counts[2]));
  s = wotrAdapter.applyAction(s, counts.find((a) => a.count === 2), 'fp');
  const erech = s.regions['erech'];
  check('Aragorn and Legolas are in Erech', erech.characters.includes('aragorn') && erech.characters.includes('legolas'), erech.characters.join(','));
  check('Gimli stayed in the Helm\'s Deep garrison', s.regions['helms-deep'].siegeBox.characters.includes('gimli') && !erech.characters.includes('gimli'));
  check('two Gondor Regulars recruited', erech.units.gondor?.regular === 2, JSON.stringify(erech.units));
  check('the card is finished', s.pendingChoice?.kind !== 'eventTarget', s.pendingChoice?.kind ?? 'none');
}

console.log('\n=== Pelargir: the Dead Men strike; recruiting none keeps it Shadow ===');
{
  let s = playCard(setup({ pelargirShadow: true }));
  const southStep = s.nations.southrons.step;
  s = wotrAdapter.applyAction(s, ets(s).find((a) => a.region === 'pelargir'), 'fp');
  check('the Shadow Army is gone from Pelargir', !s.regions['pelargir'].units.southrons);
  check('the attack moved the Political Track', s.nations.southrons.step <= southStep, `${southStep} → ${s.nations.southrons.step}`);
  s = wotrAdapter.applyAction(s, ets(s).find((a) => a.count === 0), 'fp');
  check('no recruit, no control: Pelargir stays Shadow', s.regions['pelargir'].control === 'shadow', String(s.regions['pelargir'].control));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
