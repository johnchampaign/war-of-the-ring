#!/usr/bin/env vite-node
// probe-mordor-off-map.mjs — on the Mordor Track the Fellowship stands in NO region
// (player report 056d20305g6p4u0c). Its figure's `location` still names the entrance
// it came through, and the rules that read "the region with the Fellowship" used to
// see it there: It Is a Gift / One for the Dark Lord at a battle in Morannon, a Nazgûl
// "with the Fellowship" for Nazgûl Search, the Hunt re-rolls, Cruel Weather.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { playableCombatCards } from '../src/engine/combat.ts';
import { huntRerollSources } from '../src/engine/hunt.ts';
import { canPlayCard } from '../src/engine/handlers/registry.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';
import '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const byTitle = (t) => Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === t);
const GIFT = byTitle('It Is a Gift'), DARK = byTitle('One for the Dark Lord');

const at = (mordor) => {
  const s = startGame(createGame({ seed: 4 }));
  s.phase = 'actionResolution';
  s.fellowship.location = 'morannon'; s.fellowship.mordor = mordor; s.fellowship.progress = mordor === null ? 2 : 0;
  // A Free Peoples Army attacks the Shadow in Morannon (Shadow defends there).
  s.regions['dagorlad'].units = { north: { regular: 3, elite: 0 } };
  s.regions['morannon'].units = { sauron: { regular: 2, elite: 0 } }; s.regions['morannon'].nazgul = 1;
  s.pendingCombat = { attacker: 'fp', defender: 'shadow', from: 'dagorlad', to: 'morannon', round: 0, step: 'attackerCard', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0 };
  s.cards.fp.hand = [GIFT]; s.cards.shadow.hand = [DARK];
  return s;
};

console.log('\n=== "the same region as the Fellowship" ===');
{
  const off = at(null), on = at(2);
  check('beside Morannon on the map: It Is a Gift plays', playableCombatCards(off, 'fp').includes(GIFT));
  check('on the Mordor Track: It Is a Gift does not', !playableCombatCards(on, 'fp').includes(GIFT));
  check('…nor One for the Dark Lord', !playableCombatCards(on, 'shadow').includes(DARK));
}

console.log('\n=== the Hunt re-rolls and the cards ===');
{
  const on = at(2);
  const r = huntRerollSources(on);
  check('no re-roll sources on the Mordor Track', !r.stronghold && !r.army && !r.nazgul, JSON.stringify(r));
  const off = at(null);
  check('…while standing in Morannon they count', huntRerollSources(off).nazgul);
  check('Cruel Weather cannot be played on the Mordor Track', !canPlayCard(on, 'sh-char-10', 'shadow'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
