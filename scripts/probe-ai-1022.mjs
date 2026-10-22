#!/usr/bin/env vite-node
// probe-ai-1022.mjs — AI report 2dmygxizop2powe2 (2026-10-21): dice-arithmetic Combat
// cards (a bonus to the roll or re-roll, a penalty or a dice cap on the enemy) are
// valued by the hits they swing in THIS round, and held back unless they do at least
// half what they could: "Playing Devilry of Orthanc with one die is one fifth as
// effective as it could be"; Daylight is useless against an Army rolling three dice.
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
const byTitle = (t) => Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === t);
const DEVILRY = byTitle('Devilry of Orthanc'), DAYLIGHT = byTitle('Daylight');
check('the cards exist', !!DEVILRY && !!DAYLIGHT, `${DEVILRY} ${DAYLIGHT}`);

const plain = (id) => !REGIONS[id].settlement;
const field = Object.keys(REGIONS).flatMap((a) => plain(a) ? REGIONS[a].adjacency.filter(plain).map((b) => [a, b]) : [])[0];

/** Does `side` play `card` when first asked for a Combat card in this battle? */
function plays(side, card, attacker, [from, to], atk, def) {
  let s = startGame(createGame({ seed: 11 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  Object.assign(s.regions[from], atk); Object.assign(s.regions[to], def);
  s.cards.shadow.hand = side === 'shadow' ? [card] : []; s.cards.fp.hand = side === 'fp' ? [card] : [];
  startBattle(s, attacker, from, to);
  for (let i = 0; i < 20 && s.pendingCombat; i++) {
    const ch = s.pendingChoice;
    if (ch?.kind === 'combatCard' && ch.owner === side) {
      const a = chooseAction(s, side, wotrAdapter.legalActions(s, side), new Rng(1));
      return a.kind === 'playCombatCard' && a.cardId === card;
    }
    // Fight the round in the open: the question here is the card, not the siege.
    if (ch?.kind === 'siegeWithdraw') { s = wotrAdapter.applyAction(s, { kind: 'siegeWithdraw', withdraw: false }, ch.owner); continue; }
    if (ch) return `stopped at ${ch.kind}`;
    combatStep(s);
  }
  return 'no card prompt';
}
const army = (nation, regular, elite = 0, more = {}) => ({ units: { [nation]: { regular, elite } }, ...more });

console.log('\n=== Devilry of Orthanc (+1 to the Combat roll; an Isengard unit in the battle, the defender in a Stronghold) ===');
const nextTo = (id) => REGIONS[id].adjacency.find(plain) ?? REGIONS[id].adjacency[0];
const orthanc = [nextTo('orthanc'), 'orthanc'], helms = [nextTo('helms-deep'), 'helms-deep'];
check(`defending Orthanc with one die against five: kept for a better battle (${orthanc[0]})`,
  plays('shadow', DEVILRY, 'fp', orthanc, army('rohan', 4, 1), army('isengard', 1)) === false);
check(`attacking Helm's Deep with five dice: played (${helms[0]})`,
  plays('shadow', DEVILRY, 'shadow', helms, army('isengard', 5, 1), army('rohan', 2, 1)) === true);

console.log('\n=== Daylight (the enemy rolls at most three dice) ===');
check('against a Shadow Army rolling three: kept',
  plays('fp', DAYLIGHT, 'shadow', field, army('sauron', 3), army('gondor', 3, 1)) === false);
check('against a Shadow Army rolling five: played',
  plays('fp', DAYLIGHT, 'shadow', field, army('sauron', 6, 1), army('gondor', 3, 1)) === true);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
