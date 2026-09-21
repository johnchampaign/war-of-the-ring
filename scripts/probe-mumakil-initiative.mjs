#!/usr/bin/env vite-node
// probe-mumakil-initiative.mjs — Mûmakil's "more total hits" test runs at initiative 5,
// right after the Leader re-roll (Almanac, Mûmakil; player report 4i562s26251v1y26):
// No Quarter / Nameless Wood (also initiative 5) count only when the Free Peoples
// DEFEND (ties resolve the defender first); Confusion '1's count for the Free Peoples;
// Shield-wall / Heroic Death (initiative 6) never change the test. It used to compare
// the totals AFTER cancellation, so an initiative-6 card could switch the bonus off.
import { outscoreBonusHits } from '../src/engine/combat.ts';
import { combatModsFor } from '../src/engine/combatCards.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mumId = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id].combat?.title === 'Mûmakil');
const mum = combatModsFor(mumId, { ownCharacters: [], cost: 0 });
const none = {};
const roll = (extra = {}) => ({ dice: [], rerolls: [], target: 5, ...extra });

check('Mûmakil card is modelled with the outscore bonus', !!mum?.bonusHitIfOutscore);

// Shadow attacks with Mûmakil; FP defends with No Quarter: 2 rolled + 1 auto = 3 vs 3.
let r = outscoreBonusHits(mum, none, 3, 3, roll(), roll({ auto: 1 }));
check('attacking Mûmakil sees the defender\'s No Quarter hit (3 vs 2+1: no bonus)', r.atk === 0, JSON.stringify(r));
// Shadow defends with Mûmakil; FP attacks with No Quarter: 3 vs 2+1 — the auto hit is not yet in.
r = outscoreBonusHits(none, mum, 3, 3, roll({ auto: 1 }), roll());
check('defending Mûmakil resolves before the attacker\'s No Quarter (3 vs 2: bonus)', r.def === 1, JSON.stringify(r));
// Confusion: the Shadow's two raw 1s are Free Peoples hits for the test.
r = outscoreBonusHits(mum, none, 3, 2, roll({ backfire: 2 }), roll());
check('Confusion 1s count for the Free Peoples (3 vs 2+2: no bonus)', r.atk === 0, JSON.stringify(r));
// Plain outscore still scores.
r = outscoreBonusHits(mum, none, 3, 2, roll(), roll());
check('3 vs 2 scores the extra hit', r.atk === 1, JSON.stringify(r));
r = outscoreBonusHits(mum, none, 2, 2, roll(), roll());
check('a tie scores nothing', r.atk === 0, JSON.stringify(r));

if (failures) { console.log(`probe-mumakil-initiative: ${failures} FAILED`); process.exit(1); }
console.log('probe-mumakil-initiative: all ok');
