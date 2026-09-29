#!/usr/bin/env vite-node
// probe-daring-defiance.mjs — Daring Defiance: "Forfeit the Leadership of all the
// Companions participating in the battle to cancel the Combat card played by the
// Shadow player." The forfeit is charged only when a Shadow card is actually
// cancelled (Almanac, Daring Defiance; player report n6r8a72c42xokefc — it used to
// cancel for free, keeping Strider's re-roll).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveWordsOfPower } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const byTitle = (t) => Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === t);
const DEFIANCE = byTitle('Daring Defiance'), WOP = byTitle('Words of Power');
check('the cards exist', !!(DEFIANCE && WOP), `${DEFIANCE} ${WOP}`);

/** Shadow (5 Isengard Regulars + 2 Nazgûl) out of Orthanc into the Fords of Isen, held
 *  by 3 Rohan Regulars, 1 Leader, Strider and Legolas (Leadership 3). FP plays Daring
 *  Defiance; the Shadow plays `shadowCard` (or passes). Runs to the FP roll. */
function battle(seed, shadowCard) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 5, elite: 0 } };
  s.regions['orthanc'].nazgul = 2;
  s.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
  s.regions['fords-of-isen'].leaders = 1;
  s.regions['fords-of-isen'].characters = ['strider', 'legolas'];
  for (const c of ['strider', 'legolas']) if (!s.characters.entered.includes(c)) s.characters.entered.push(c);
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  s.cards.fp.hand = [DEFIANCE];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    if (s.pendingCombat.defRoll) return s;
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard ?? null : DEFIANCE); continue; }
    if (ch.kind === 'wordsOfPower') { resolveWordsOfPower(s, 'legolas'); continue; }
    return s;
  }
  return s;
}
const misses = (r) => r.dice.filter((d) => d !== 6 && d < r.target).length;

function survey(label, shadowCard, maxRerolls, logPattern) {
  let seen = 0, most = 0; const bad = [];
  for (let seed = 1; seed < 80; seed++) {
    const s = battle(seed, shadowCard);
    const r = s.pendingCombat?.defRoll;
    if (!r) continue;
    const line = s.log.find((e) => /\(defender\) play/.test(e.msg ?? ''))?.msg ?? '';
    if (!logPattern.test(line)) bad.push(`${seed}:log "${line}"`);
    if (misses(r) < 3) continue;
    seen++; most = Math.max(most, r.rerolls.length);
    if (r.rerolls.length !== maxRerolls) bad.push(`${seed}:${r.rerolls.length} re-rolls`);
  }
  check(`${label} (${seen} seeds with 3+ misses)`, seen > 0 && bad.length === 0, bad.slice(0, 4).join(' | '));
}

console.log('\n=== Daring Defiance ===');
survey('cancelling Words of Power forfeits Strider + Legolas: 1 re-roll left', WOP, 1, /forfeits 2 Leadership.*cancels/);
survey('no Shadow card to cancel: nothing forfeited, all 3 re-rolls', null, 3, /Daring Defiance/);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
