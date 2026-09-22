#!/usr/bin/env vite-node
// probe-card-play-conditions.mjs — the batch of 2026-09-22 player reports about Event
// cards whose offer or whose split rules did not match the printed text:
//
//  * Paths of the Woses (fp-str-11) — "Move a Free Peoples Army from any one Rohan
//    region directly to Minas Tirith". It names NO Companion, but the handler carried
//    Through a Day and a Night's Companion clause (and that card's name in the error),
//    so a legal split was refused with the wrong card's rule (report 1b1c5q54732v1a22).
//  * A Nazgûl-led Army split (The Ringwraiths Are Abroad / The Black Captain Commands)
//    forced a Nazgûl into the movers even when the Army qualified through the
//    Witch-king alone — an escort that was not there.
//  * Athelas (fp-char-09) and Bilbo's Song (fp-char-12) are pure heals, so at zero
//    Corruption they burn an Action die and the card for nothing (report
//    0k6e6n2c6m6g153q) — the same strengthening There Is Another Way already has.
//  * The Ents Awake (fp-char-19/20/21) meets its printed precondition with an empty
//    Orthanc and Gandalf the White far away, and then does nothing at all (report
//    0o183f33230m5g4v).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
/** A cleared board: no figures anywhere, so each case states its own position. */
function board(seed = 5) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  return s;
}

// --- Paths of the Woses takes any Rohan Army, Companion or no Companion ------------
{
  console.log('\n=== Paths of the Woses: no Companion clause on the card ===');
  const s = board();
  s.nations.rohan.step = 0;                                   // At War (the printed condition)
  s.regions['edoras'].units = { rohan: { regular: 3, elite: 1 } };
  s.regions['minas-tirith'].units = { gondor: { regular: 1, elite: 0 } };
  const t = getHandler('fp-str-11').targets(s, 'fp').find((x) => x.from === 'edoras' && x.to === 'minas-tirith');
  check('an Edoras → Minas Tirith move is offered', !!t, JSON.stringify(t));
  let threw = null;
  try { getHandler('fp-str-11').applyTarget(s, 'fp', { ...t, move: { units: { rohan: { regular: 2 } } } }); }
  catch (e) { threw = String(e.message ?? e); }
  check('a split with no Companion among the movers is allowed', threw === null, threw ?? '');
  check('2 Regulars arrive at Minas Tirith', s.regions['minas-tirith'].units.rohan?.regular === 2,
    JSON.stringify(s.regions['minas-tirith'].units));
  check('the rest holds Edoras', s.regions['edoras'].units.rohan?.regular === 1 && s.regions['edoras'].units.rohan?.elite === 1,
    JSON.stringify(s.regions['edoras'].units));
}

// --- but the same split rules still bind it ---------------------------------------
{
  console.log('\n=== Paths of the Woses: the split rules still bind ===');
  const s = board();
  s.nations.rohan.step = 0;
  s.regions['edoras'].units = { rohan: { regular: 2, elite: 0 } };
  s.regions['edoras'].leaders = 1;
  const t = getHandler('fp-str-11').targets(s, 'fp').find((x) => x.from === 'edoras' && x.to === 'minas-tirith');
  let strand = false;
  try { getHandler('fp-str-11').applyTarget(s, 'fp', { ...t, move: { units: { rohan: { regular: 2 } }, leaders: 0 } }); }
  catch { strand = true; }
  check('a split that would strand the Free Peoples Leader is refused', strand);
  check('and nothing moved', s.regions['edoras'].units.rohan?.regular === 2 && s.regions['edoras'].leaders === 1);
}

// --- a Witch-king-led Army keeps him with the movers -------------------------------
{
  console.log('\n=== The Ringwraiths Are Abroad: a Witch-king-only Army keeps its escort ===');
  const s = board();
  s.nations.sauron.step = 0;
  s.regions['morannon'].units = { sauron: { regular: 4, elite: 0 } };
  s.regions['morannon'].characters = ['witch-king'];          // no plain Nazgûl in the stack
  s.characters.inPlay['witch-king'] = 'morannon';
  s.characters.entered = [...(s.characters.entered ?? []), 'witch-king'];
  const ts = getHandler('sh-char-23').targets(s, 'shadow');
  const t = ts.find((x) => x.from === 'morannon' && x.mode === 'move' && x.to && x.to !== 'morannon');
  check('a Morannon Army move is offered', !!t, JSON.stringify(t));
  getHandler('sh-char-23').applyTarget(s, 'shadow', { ...t, move: { units: { sauron: { regular: 2 } } } });
  check('the Witch-king travels with the movers', s.regions[t.to].characters.includes('witch-king'),
    `${t.to}: ${JSON.stringify(s.regions[t.to].characters)}, morannon: ${JSON.stringify(s.regions['morannon'].characters)}`);
  check('the roster index follows him', s.characters.inPlay['witch-king'] === t.to, String(s.characters.inPlay['witch-king']));
}

// --- pure heals are not offered with no Corruption to remove ----------------------
{
  console.log('\n=== Athelas / Bilbo’s Song: not offered at zero Corruption ===');
  const s = board();
  s.cards.fp.hand = ['fp-char-09', 'fp-char-12'];
  s.fellowship.corruption = 0;
  check('Athelas is not offered at 0 Corruption', !canPlayCard(s, 'fp-char-09', 'fp'));
  check('Bilbo’s Song is not offered at 0 Corruption', !canPlayCard(s, 'fp-char-12', 'fp'));
  s.fellowship.corruption = 1;
  check('Athelas is offered at 1 Corruption', canPlayCard(s, 'fp-char-09', 'fp'));
  check('Bilbo’s Song is offered at 1 Corruption', canPlayCard(s, 'fp-char-12', 'fp'));
}

// --- The Ents Awake needs something to do -----------------------------------------
{
  console.log('\n=== The Ents Awake: the printed precondition is not enough ===');
  const s = board();
  s.characters.entered = [...(s.characters.entered ?? []), 'gandalf-white'];
  s.regions['fangorn'].characters = ['legolas'];              // a Companion in Fangorn
  s.characters.inPlay['legolas'] = 'fangorn';
  s.regions['lorien'].characters = ['gandalf-white'];         // far from Fangorn and Rohan
  s.characters.inPlay['gandalf-white'] = 'lorien';
  s.cards.fp.hand = ['fp-char-19', 'fp-char-20'];
  check('not offered with Orthanc empty and Gandalf the White away', !canPlayCard(s, 'fp-char-19', 'fp'));
  // A Shadow Army in Orthanc is something to hit.
  s.regions['orthanc'].units = { isengard: { regular: 2, elite: 0 } };
  check('offered once a Shadow Army holds Orthanc', canPlayCard(s, 'fp-char-19', 'fp'));
  // Saruman alone in Orthanc is still a target (report 4u10) — no Army needed.
  s.regions['orthanc'].units = {};
  s.regions['orthanc'].characters = ['saruman'];
  s.characters.inPlay['saruman'] = 'orthanc';
  check('offered with Saruman alone in Orthanc', canPlayCard(s, 'fp-char-19', 'fp'));
  // And the free-card clause alone is enough, when there IS another Character card.
  s.regions['orthanc'].characters = [];
  delete s.characters.inPlay['saruman'];
  s.regions['lorien'].characters = [];
  s.regions['fangorn'].characters = ['legolas', 'gandalf-white'];
  s.characters.inPlay['gandalf-white'] = 'fangorn';
  check('offered for the free Character card when one is in hand', canPlayCard(s, 'fp-char-19', 'fp'));
  s.cards.fp.hand = ['fp-char-19'];
  check('not offered when the free card would have nothing to play', !canPlayCard(s, 'fp-char-19', 'fp'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
