#!/usr/bin/env vite-node
// probe-capture-not-attack.mjs — player report 6d1g1o4l2d4r0a3q: "onSettlementCaptured
// is over-engineered and slightly confused. It never makes sense to say that a
// Settlement was captured via an attack; an attack is the action that initiates a
// battle, so it's an orthogonal concept to movement or Settlement captures."
//
// The reporter is right. Capturing a Settlement no longer carries a `viaAttack` flag:
//
//  A. When Edoras or Helm's Deep really is attacked, the attack has already fired its
//     own political reaction (with viaAttack) before anyone advances in, so Wormtongue
//     is off the table by the time the capture lands.
//  B. A walk-in occupation of an undefended Settlement is not an attack and never was,
//     so it must not rouse Rohan through Wormtongue.
//
// Reviewing Wormtongue in that light turned up the one case the old flag was covering
// by accident: the card's attack exception names the REGION — "Rohan cannot be
// activated except by an appropriate Companion, or by the Fellowship being declared in
// Edoras or Helm's Deep, or by an attack on Edoras or Helm's Deep" — so an attack there
// rouses Rohan even when the Army defending the place holds no Rohan units. That now
// fires from the card, at the moment of the attack, instead of from the capture.
//
// The same flag drove Threats and Promises (sh-str-05), which discards itself when a
// Free Peoples Nation advances "due to an attack": a battle advances the Nation at the
// attack, so the card still goes; a walk-in capture is not an attack, so it stays.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle } from '../src/engine/combat.ts';
import { captureIfEnemySettlement } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => {
  const s = startGame(createGame({ seed: 11 }));
  s.characters.inPlay['saruman'] = 'orthanc'; // Wormtongue's own play condition
  return s;
};
/** Rohan's seat, emptied of its garrison so the capture path is a bare walk-in. */
const emptyEdoras = (s) => { s.regions['edoras'].units = {}; s.regions['edoras'].leaders = 0; };

console.log('\n=== a walk-in capture of an undefended Edoras leaves Rohan passive ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-char-22');
  emptyEdoras(s);
  s.regions['edoras'].units = { sauron: { regular: 3, elite: 0 } }; // the Shadow just walked in
  check('Rohan starts passive', s.nations.rohan.active === false);
  captureIfEnemySettlement(s, 'edoras', 'shadow');
  check('Edoras is captured', s.regions['edoras'].control === 'shadow');
  check('Rohan is STILL passive (a capture is not an attack)', s.nations.rohan.active === false);
  check('Wormtongue is still on the table', s.cards.shadow.table.includes('sh-char-22'));
}

console.log('\n=== without Wormtongue, that same capture rouses Rohan as usual ===');
{
  const s = board();
  emptyEdoras(s);
  const step0 = s.nations.rohan.step;
  captureIfEnemySettlement(s, 'edoras', 'shadow');
  check('Rohan is activated', s.nations.rohan.active === true);
  check('and advances one step', s.nations.rohan.step === step0 - 1, `${step0} -> ${s.nations.rohan.step}`);
}

console.log('\n=== an attack on Edoras rouses Rohan even with no Rohan unit defending ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-char-22');
  emptyEdoras(s);
  s.regions['edoras'].units = { gondor: { regular: 2, elite: 0 } }; // an allied garrison, no Rohan
  s.regions['westemnet'].units = { isengard: { regular: 4, elite: 0 } };
  check('Rohan starts passive', s.nations.rohan.active === false);
  startBattle(s, 'shadow', 'westemnet', 'edoras');
  check('the attack on Edoras rouses Rohan through the card', s.nations.rohan.active === true);
  check('Rohan’s own track does not advance (its Army was not attacked)',
    s.nations.rohan.step === startGame(createGame({ seed: 11 })).nations.rohan.step, String(s.nations.rohan.step));
}

console.log('\n=== an attack somewhere else still leaves Rohan asleep ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-char-22');
  s.regions['north-ithilien'].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'shadow', 'north-ithilien', 'osgiliath');
  check('Rohan is still passive', s.nations.rohan.active === false);
  check('Wormtongue is still on the table', s.cards.shadow.table.includes('sh-char-22'));
}

console.log('\n=== Threats and Promises: a walk-in capture is not "due to an attack" ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-str-05');
  s.regions['dale'].units = {}; s.regions['dale'].leaders = 0; // an undefended North City
  s.nations.north.active = true;
  captureIfEnemySettlement(s, 'dale', 'shadow');
  check('the North advanced', s.nations.north.step < startGame(createGame({ seed: 11 })).nations.north.step);
  check('Threats and Promises stays on the table', s.cards.shadow.table.includes('sh-str-05'));
}

console.log('\n=== ...but a real attack still discards it ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-str-05');
  s.nations.north.active = true;
  s.regions['dale'].units = { north: { regular: 2, elite: 0 } };
  s.regions['northern-rhovanion'].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'shadow', 'northern-rhovanion', 'dale');
  check('Threats and Promises is discarded', !s.cards.shadow.table.includes('sh-str-05'));
}

console.log(failures ? `\nprobe-capture-not-attack: ${failures} FAILURE(S)` : '\nprobe-capture-not-attack OK');
process.exit(failures ? 1 : 0);
