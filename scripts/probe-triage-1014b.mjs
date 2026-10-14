#!/usr/bin/env vite-node
// probe-triage-1014b.mjs — player report 706o116h4g4f6j3x: with the Fellowship on the
// Mordor Track the Shadow AI played The Black Captain Commands, picked a Nazgûl to fly,
// found no landing worth more than stopping, and stopped — the card did nothing. It now
// skips the pointless fly, takes the two free Nazgûl, then moves or attacks.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== The Black Captain Commands (Fellowship on the Mordor Track) ===');
{
  let s = startGame(createGame({ seed: 11 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.fellowship.mordor = 1; s.fellowship.location = 'morannon';
  s.nations.southrons.active = true; s.nations.southrons.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  for (const r of Object.values(s.regions)) { r.characters = r.characters.filter((c) => c !== 'witch-king'); r.nazgul = 0; }
  s.regions['lamedon'].units = { southrons: { regular: 3, elite: 0 } };
  s.regions['lamedon'].nazgul = 6; s.regions['lamedon'].characters = ['witch-king'];
  s.regions['lamedon'].control = 'shadow';
  s.characters.inPlay['witch-king'] = 'lamedon';
  if (!s.characters.entered.includes('witch-king')) s.characters.entered.push('witch-king');
  s.reinforcements.sauron.nazgul = 2;
  s.regions['pelargir'].units = { gondor: { regular: 1, elite: 0 } };
  s.cards.shadow.hand = ['sh-char-24'];
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-char-24');
  check('the card is playable', !!p);
  const n = s.log.length;
  s = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
  for (let i = 0; i < 30 && s.pendingChoice?.owner === 'shadow' && s.pendingChoice.kind === 'eventTarget'; i++) {
    s = wotrAdapter.applyAction(s, chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(3)), 'shadow');
  }
  const lines = s.log.slice(n).map((e) => e.msg);
  check('the two Nazgûl are recruited', lines.some((m) => m.includes('musters 2 Nazgûl')), lines.join(' | '));
  check('the Witch-king\'s Army then moves or attacks', lines.some((m) => /attacks|Army moves/.test(m)), lines.join(' | '));
}

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1); }
console.log('\nall ok');
