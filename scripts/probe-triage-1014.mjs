#!/usr/bin/env vite-node
// probe-triage-1014.mjs — player reports 5v1j3w4f5x006i4l (There Is Another Way's
// Fellowship move puts no die in the Hunt Box — Almanac C 10), 5k04685w425w1y6o (the
// Corsairs landing logs in the die-move format), 5f5m4v322e1r1122 (a Nazgûl-led card
// attack writes no second line under the battle's own) and 2c0n1q5b1m371g72 (a
// face-down Combat card's marker names its deck, so the battle window can draw its back).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { redactStateForViewer as viewFor } from '../src/adapter/redact.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const msgs = (s, from) => s.log.slice(from).map((e) => e.msg);

const anotherWay = (mordor) => {
  const s = startGame(createGame({ seed: 7 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = ['army'];
  s.fellowship.guide = 'gollum'; s.fellowship.companions = []; s.fellowship.hidden = true;
  s.fellowship.corruption = 2;
  if (mordor) s.fellowship.mordor = 0;
  s.hunt.box = 2; s.hunt.fpDiceInBox = 1;
  s.cards.fp.hand = ['fp-char-10'];
  const p = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-char-10');
  let t = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'fp');
  const mv = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'eventTarget' && a.mode === 'move');
  const n = t.log.length;
  t = wotrAdapter.applyAction(t, mv, 'fp');
  return { t, n };
};

console.log('\n=== There Is Another Way: the card moves the Fellowship, not the die ===');
{
  const { t, n } = anotherWay(false);
  check('the Hunt is still rolled', msgs(t, n).some((m) => m.startsWith('Hunt roll')), msgs(t, n).join(' | '));
  check('no Free Peoples die enters the Hunt Box', t.hunt.fpDiceInBox === 1, `fpDiceInBox ${t.hunt.fpDiceInBox}`);
}
{
  const { t } = anotherWay(true);
  check('on the Mordor Track too', t.hunt.fpDiceInBox === 1, `fpDiceInBox ${t.hunt.fpDiceInBox}`);
}

console.log('\n=== Corsairs of Umbar: the landing reads as an Army move ===');
{
  const s = startGame(createGame({ seed: 141 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.southrons.active = true; s.nations.southrons.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  s.regions['umbar'].units = { southrons: { regular: 6, elite: 2 } };
  s.regions['pelargir'].units = { gondor: { regular: 1, elite: 0 } };
  s.cards.shadow.hand = ['sh-str-10'];
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-10');
  let t = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
  const target = wotrAdapter.legalActions(t, 'shadow').find((a) => a.kind === 'eventTarget' && a.to === 'pelargir');
  const n = t.log.length;
  t = wotrAdapter.applyAction(t, target, 'shadow');
  const lines = msgs(t, n);
  check('"Shadow Army moves umbar → pelargir"', lines[0] === 'Shadow Army moves umbar → pelargir', lines.join(' | '));
  check('the card no longer narrates the landing', !lines.some((m) => m.startsWith('Corsairs of Umbar')));
}

console.log('\n=== The Black Captain Commands: one line for the attack ===');
{
  const s = startGame(createGame({ seed: 11 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  for (const r of Object.values(s.regions)) r.characters = r.characters.filter((c) => c !== 'witch-king');
  s.regions['osgiliath'].units = { sauron: { regular: 4, elite: 0 } };
  s.regions['osgiliath'].characters = ['witch-king'];
  s.regions['osgiliath'].control = 'shadow';
  s.characters.inPlay['witch-king'] = 'osgiliath';
  if (!s.characters.entered.includes('witch-king')) s.characters.entered.push('witch-king');
  s.regions['south-ithilien'].units = { gondor: { regular: 1, elite: 0 } };
  s.cards.shadow.hand = ['sh-char-24'];
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-24');
  if (!p) check('the card is playable in this setup', false);
  else {
    let t = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
    const atk = wotrAdapter.legalActions(t, 'shadow').find((a) => a.kind === 'eventTarget' && a.mode === 'attack');
    if (!atk) check('an attack is offered', false, wotrAdapter.legalActions(t, 'shadow').map((a) => JSON.stringify(a)).slice(0, 4).join(' '));
    else {
      const n = t.log.length;
      t = wotrAdapter.applyAction(t, atk, 'shadow');
      const lines = msgs(t, n);
      check('the battle line is there', lines.some((m) => m.startsWith('Shadow attacks')), lines.join(' | '));
      check('no "Nazgûl-led attack" echo', !lines.some((m) => m.startsWith('Nazgûl-led attack')), lines.join(' | '));
    }
  }
}

console.log('\n=== a face-down Combat card shows its deck, not its name ===');
{
  const s = startGame(createGame({ seed: 3 }));
  s.pendingCombat = { attacker: 'shadow', defender: 'fp', step: 'defenderCard', attackerCard: 'sh-char-01', defenderCard: null };
  const v = viewFor(s, 'fp');
  check('the Free Peoples see a Character back', v.pendingCombat.attackerCard === 'hidden-character', v.pendingCombat.attackerCard);
  s.pendingCombat.attackerCard = 'sh-str-10';
  check('…or a Strategy back', viewFor(s, 'fp').pendingCombat.attackerCard === 'hidden-strategy');
  check('the attacker still sees its own card', viewFor(s, 'shadow').pendingCombat.attackerCard === 'sh-str-10');
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
