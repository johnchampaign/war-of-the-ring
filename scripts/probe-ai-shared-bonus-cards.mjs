#!/usr/bin/env vite-node
// probe-ai-shared-bonus-cards.mjs — when the Shadow AI plays a "both Armies add N"
// Combat card (Deadly Strife, Desperate Battle). Player report 3w0r36515c5d2q6w: the
// old "only when rolling more dice" rule was wrong — a small Army's losses are capped,
// so the bigger side's extra hits are wasted while the small side's land in full; and
// an attacker hitting on 6 gains more from the bonus than a defender hitting on 5. The
// AI now counts the hits each side actually lands, before and after the bonus.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { REGIONS, EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const STRIFE = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === 'Deadly Strife');
check('Deadly Strife exists', !!STRIFE);

const SHADOW = new Set(['sauron', 'isengard', 'southrons']);
const plain = (id) => !REGIONS[id].settlement;
// Two adjacent open regions, and a Shadow City with an open neighbour.
const field = Object.keys(REGIONS).flatMap((a) => plain(a) ? REGIONS[a].adjacency.filter(plain).map((b) => [a, b]) : [])[0];
const city = Object.keys(REGIONS).flatMap((a) => REGIONS[a].settlement === 'City' && SHADOW.has(REGIONS[a].nation)
  ? REGIONS[a].adjacency.filter(plain).map((b) => [b, a]) : [])[0];
const fpCity = Object.keys(REGIONS).flatMap((a) => REGIONS[a].settlement === 'City' && REGIONS[a].nation && !SHADOW.has(REGIONS[a].nation)
  ? REGIONS[a].adjacency.filter(plain).map((b) => [b, a]) : [])[0];

/** The Shadow's answer to "play a Combat card?" with Deadly Strife in hand. */
function shadowPlays(attacker, [from, to], atk, def) {
  const s = startGame(createGame({ seed: 11 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  Object.assign(s.regions[from], atk); Object.assign(s.regions[to], def);
  if (REGIONS[to].settlement) s.regions[to].control = attacker === 'fp' ? 'shadow' : 'fp';
  s.cards.shadow.hand = [STRIFE]; s.cards.fp.hand = [];
  startBattle(s, attacker, from, to);
  for (let i = 0; i < 20 && s.pendingCombat; i++) {
    const ch = s.pendingChoice;
    if (ch?.kind === 'combatCard' && ch.owner === 'shadow') {
      const a = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(1));
      return a.kind === 'playCombatCard' && a.cardId === STRIFE;
    }
    if (ch) return `stopped at ${ch.kind}`;
    combatStep(s);
  }
  return 'no card prompt';
}
const army = (nation, regular, elite = 0, more = {}) => ({ units: { [nation]: { regular, elite } }, ...more });

console.log('\n=== Deadly Strife ===');
check('outnumbered 2 to 5 in the open, it plays: its losses are capped, its extra hits land',
  shadowPlays('fp', field, army('gondor', 5, 1), army('sauron', 2)) === true);
check('8 against 2 in the open, it keeps the card: its extra hits are wasted',
  shadowPlays('shadow', field, army('sauron', 6, 2, { nazgul: 1 }), army('gondor', 2)) === false);
check(`defending ${REGIONS[city[1]].name} against 5 with Leaders, it keeps the card (the attacker's 6s become 4s)`,
  shadowPlays('fp', city, army('gondor', 3, 2, { leaders: 3 }), army('southrons', 2, 2, { nazgul: 1 })) === false);
check(`attacking ${REGIONS[fpCity[1]].name} held by 3 with 5 and a Nazgûl, it plays (its 6s become 4s)`,
  shadowPlays('shadow', fpCity, army('sauron', 3, 2, { nazgul: 1 }), army(REGIONS[fpCity[1]].nation, 2, 1, { leaders: 1 })) === true);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
