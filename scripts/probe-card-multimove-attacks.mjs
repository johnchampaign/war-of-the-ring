#!/usr/bin/env vite-node
// probe-card-multimove-attacks.mjs — stage 3 of the Army-movement consolidation.
//
// 1. Cards that move several Armies follow the Army die's rule (p.27): figures that
//    ARRIVED in an earlier move under the card may not move again, but what already
//    stood in that region may (player reports 242i0j4s115l5w33, 126p4f6l1i036u68).
//    The Shadow Lengthens and The Shadow is Moving used to bar the whole destination;
//    The Ringwraiths Are Abroad barred only origins, so one Army could move twice.
// 2. Card attacks take a rearguard, judged by the shared attack rules (player report
//    1o6s51234u6u4m30) — siege ASSAULTS included, which used to refuse one so that
//    held-back figures still fought (6f5g141x533t3i4e). Per the Almanac only The Black
//    Captain Commands keeps its figure in the fight; Grond's Witch-king "may be kept in a
//    rearguard", and The Ringwraiths Are Abroad follows "all normal attack rules".
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const shadowBoard = () => {
  const s = startGame(createGame({ seed: 17 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].active = true; s.nations[n].step = 0; }
  for (const r of Object.values(s.regions)) { r.nazgul = 0; }
  s.characters.inPlay = Object.fromEntries(Object.entries(s.characters.inPlay).filter(([c]) => c !== 'witch-king'));
  // Two Shadow Armies a region apart in the open: Dagorlad (3) and Morannon (2 residents).
  for (const r of ['dagorlad', 'morannon', 'ash-mountains', 'noman-lands']) { s.regions[r].units = {}; s.regions[r].characters = []; s.regions[r].besieged = false; delete s.regions[r].siegeBox; }
  s.regions['dagorlad'].units = { sauron: { regular: 3, elite: 0 } };
  s.regions['morannon'].units = { sauron: { regular: 2, elite: 0 } };
  return s;
};
const play = (s, card) => {
  s.cards.shadow.hand = [card];
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === card);
  return p ? wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow') : null;
};
const units = (s, r) => Object.values(s.regions[r].units).reduce((t, u) => t + u.regular + u.elite, 0);
const offers = (s) => wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'eventTarget' && a.from && a.to && !a.done);

for (const [card, name] of [['sh-str-09', 'The Shadow is Moving'], ['sh-str-08', 'The Shadow Lengthens']]) {
  console.log(`\n=== ${name}: the arrivals stay, the residents may still go ===`);
  let s = play(shadowBoard(), card);
  check('the card is playable and asks for a move', !!s && s.pendingChoice?.kind === 'eventTarget', s?.pendingChoice?.kind ?? 'not playable');
  if (!s) continue;
  const first = offers(s).find((a) => a.from === 'dagorlad' && a.to === 'morannon');
  check('Dagorlad → Morannon is offered', !!first);
  s = wotrAdapter.applyAction(s, first, 'shadow');
  check('…and lands: Morannon holds 5', units(s, 'morannon') === 5, String(units(s, 'morannon')));
  const out = offers(s).filter((a) => a.from === 'morannon');
  check('Morannon is still offered as an origin (it used to be barred outright)', out.length > 0, `${out.length} moves`);
  const o = out[0];
  check('…carrying the limit: only the 2 residents may go', o && o.movable?.units?.sauron?.regular === 2, JSON.stringify(o?.movable));
  if (o) {
    const bad = wotrAdapter.tryApplyAction(s, { ...o, move: { units: { sauron: { regular: 4 } } } }, 'shadow');
    check('a selection taking the newcomers is refused, naming the rule', !bad.ok && /cannot move twice/.test(bad.reason ?? ''), bad.reason ?? 'accepted');
    const t = wotrAdapter.applyAction(s, o, 'shadow');
    check('a plain click moves exactly the residents; the 3 newcomers stay', units(t, 'morannon') === 3 && units(t, o.to) >= 2, `morannon ${units(t, 'morannon')}, ${o.to} ${units(t, o.to)}`);
  }
}

console.log('\n=== The Ringwraiths Are Abroad: one Army cannot move twice ===');
{
  let s = shadowBoard();
  s.regions['dagorlad'].nazgul = 1;                       // a Nazgûl-led Army
  s = play(s, 'sh-char-23');
  check('the card is playable', !!s);
  if (s) {
    const first = offers(s).find((a) => a.from === 'dagorlad' && a.to === 'morannon' && a.mode === 'move');
    check('the Nazgûl-led Army may move to Morannon', !!first);
    s = wotrAdapter.applyAction(s, first, 'shadow');
    const again = offers(s).filter((a) => a.from === 'morannon' && a.mode === 'move');
    check('…but not on from Morannon: its residents have no Nazgûl of their own, the newcomers already moved', again.length === 0, again.map((a) => a.to).join(','));
  }
}

console.log('\n=== card attacks take a rearguard (normal attack rules) ===');
{
  let s = shadowBoard();
  s.regions['dagorlad'].nazgul = 1;
  s.regions['north-ithilien'].units = { gondor: { regular: 1, elite: 0 } }; s.regions['north-ithilien'].besieged = false; delete s.regions['north-ithilien'].siegeBox;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  s = play(s, 'sh-char-23');
  const atk = s && wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.mode === 'attack' && a.from === 'dagorlad');
  check('The Ringwraiths Are Abroad offers the attack', !!atk, atk ? `→ ${atk.to}` : 'none');
  if (atk) {
    const sitOut = wotrAdapter.tryApplyAction(s, { ...atk, rearguard: { units: { sauron: { regular: 1 } }, nazgul: 1 } }, 'shadow');
    check('its Nazgûl may wait in the rearguard (normal attack rules, Almanac)', sitOut.ok, sitOut.reason ?? 'accepted');
    const ok = wotrAdapter.tryApplyAction(s, { ...atk, rearguard: { units: { sauron: { regular: 1 } } } }, 'shadow');
    // The battle resolves at once (no Combat cards in hand), so read its opening line.
    const opening = (st) => st.log.find((e) => /attacks north-ithilien from dagorlad|attacks North Ithilien from Dagorlad/i.test(e.msg))?.msg ?? '';
    check('a rearguard of one Regular is accepted and sits out', ok.ok && /attacker 2R/.test(opening(ok.state)), ok.reason ?? opening(ok.state));
    const bare = wotrAdapter.tryApplyAction(s, atk, 'shadow');
    check('a plain click still attacks with everyone', bare.ok && /attacker 3R/.test(opening(bare.state)), bare.reason ?? opening(bare.state));
  }
}


console.log('\n=== siege assaults take a rearguard; Grond may leave the Witch-king, the Black Captain may not ===');
const siegeBoard = () => {
  const s = shadowBoard();
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  const mt = s.regions['minas-tirith'];
  mt.siegeBox = { units: { gondor: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  mt.units = { sauron: { regular: 4, elite: 0 } }; mt.leaders = 0; mt.nazgul = 1; mt.characters = ['witch-king']; mt.besieged = true; mt.control = 'fp';
  if (!s.characters.entered.includes('witch-king')) s.characters.entered.push('witch-king');
  s.characters.inPlay['witch-king'] = 'minas-tirith';
  return s;
};
{
  let s = play(siegeBoard(), 'sh-char-20');                        // Grond
  const t = s && wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.mode === 'attack');
  check('Grond offers the assault', !!t);
  if (t) {
    const r = wotrAdapter.tryApplyAction(s, { ...t, rearguard: { units: { sauron: { regular: 1 } }, characters: ['witch-king'] } }, 'shadow');
    const line = r.ok ? r.state.log.find((e) => /siege assault/.test(e.msg))?.msg ?? '' : '';
    check('the assault holds a rearguard back (it used to fight anyway)', r.ok && /attacker 3R/.test(line) && !/Witch-king/.test(line.split(' vs ')[0]), r.reason ?? line);
  }
}
{
  let s = play(siegeBoard(), 'sh-char-24');                        // The Black Captain Commands
  const t = s && wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.mode === 'attack' && a.from === 'minas-tirith');
  check('The Black Captain Commands offers the assault', !!t);
  if (t) {
    const r = wotrAdapter.tryApplyAction(s, { ...t, rearguard: { units: { sauron: { regular: 1 } }, characters: ['witch-king'] } }, 'shadow');
    check('…but its Witch-king may not sit out (Almanac)', !r.ok && /Witch-king/.test(r.reason ?? ''), r.reason ?? 'accepted');
  }
}


console.log('\n=== an assault thrown back: the rearguard keeps up the siege (Almanac) ===');
{
  // One Regular storms a strong garrison while three wait in the rearguard. Played to the
  // end over many seeds, every time the assaulting unit dies the siege must go on — it
  // used to lift, as if nobody were left outside.
  let wiped = 0, held = 0;
  for (let seed = 1; seed <= 40; seed++) {
    let s = siegeBoard();
    s.regions['minas-tirith'].siegeBox.units = { gondor: { regular: 0, elite: 5 } };
    s.regions['minas-tirith'].characters = []; s.regions['minas-tirith'].nazgul = 0;
    s.rngState = seed * 7919;
    s.dice.shadow = ['army'];
    const atk = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'attack' && a.from === 'minas-tirith' && a.to === 'minas-tirith');
    if (!atk) { check('a die assault is offered', false); break; }
    s = wotrAdapter.applyAction(s, { ...atk, die: 'army', rearguard: { units: { sauron: { regular: 3 } } } }, 'shadow');
    for (let i = 0; i < 300 && (s.pendingCombat || s.pendingChoice); i++) {
      const who = wotrAdapter.currentActor(s); if (!who) break;
      const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
      // Keep assaulting: never cease, never retreat.
      const pick = legal.find((a) => a.kind === 'combatContinue' && a.cont === true) ?? legal.find((a) => a.kind === 'playCombatCard' && a.cardId === null) ?? legal[0];
      s = wotrAdapter.applyAction(s, pick, who);
    }
    const mt = s.regions['minas-tirith'];
    if ((mt.units.sauron?.regular ?? 0) <= 3 && s.log.some((e) => /rearguard keeps up the siege/.test(e.msg))) {
      wiped++;
      if (mt.besieged && mt.siegeBox && (mt.units.sauron?.regular ?? 0) === 3) held++;
    }
  }
  check('some assaults were thrown back with the rearguard standing', wiped > 0, `${wiped} of 40`);
  check('…and every one of them kept the siege, with the 3 rearguard units in the field', held === wiped, `${held}/${wiped}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
