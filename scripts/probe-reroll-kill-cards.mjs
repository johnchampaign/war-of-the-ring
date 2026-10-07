#!/usr/bin/env vite-node
// probe-reroll-kill-cards.mjs — Blade of Westernesse, Fateful Strike and Black Breath
// trigger on hits scored by the LEADER RE-ROLL, not on the round's total (Card Text
// Reference; Almanac, Blade of Westernesse: "Only a hit from a Leader re-roll can
// trigger this"). They used to fire on any hit, so a Blade whose re-roll missed still
// killed Saruman (report 2x5x0a1b3f4g2j4t). Their kill line comes after the dice line
// (initiative 6) and names the card (report 493j1d205i604m69).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const byTitle = (t) => Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === t);
const BLADE = byTitle('Blade of Westernesse'), FATEFUL = byTitle('Fateful Strike'), BREATH = byTitle('Black Breath');
check('the cards exist', !!(BLADE && FATEFUL && BREATH), `${BLADE} ${FATEFUL} ${BREATH}`);

/** Shadow (5 Isengard Regulars, `nazgul` Nazgûl and `shadowChars`) out of Orthanc into
 *  the Fords of Isen, held by 3 Rohan Regulars, `leaders` Leaders and `fpChars`. Each
 *  side plays its card (or nothing); runs to the end of the round's roll. */
function battle(seed, { fpChars, shadowChars = [], nazgul = 0, leaders = 2, fpCard = null, shadowCard = null }) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0; s.nations.sauron.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 5, elite: 0 } };
  s.regions['orthanc'].nazgul = nazgul;
  s.regions['orthanc'].characters = [...shadowChars];
  s.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
  s.regions['fords-of-isen'].leaders = leaders;
  s.regions['fords-of-isen'].characters = [...fpChars];
  for (const c of [...fpChars, ...shadowChars]) {
    if (!s.characters.entered.includes(c)) s.characters.entered.push(c);
    s.characters.inPlay[c] = c === 'saruman' || c === 'witch-king' ? 'orthanc' : 'fords-of-isen';
  }
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  s.cards.fp.hand = fpCard ? [fpCard] : [];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    if (s.pendingCombat.defRoll) return s;
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard : fpCard); continue; }
    return s;
  }
  return s;
}
const hit = (roll, d) => d === 6 || (d !== 1 && d >= (roll.rerollTarget ?? roll.target));
const rerollHits = (roll) => roll.rerolls.filter((d) => hit(roll, d)).length;
const lineIdx = (s, re) => s.log.findIndex((e) => re.test(e.msg ?? ''));

console.log('\n=== Blade of Westernesse ===');
{
  let scored = 0, missed = 0; const bad = [];
  for (let seed = 1; seed < 120; seed++) {
    const s = battle(seed, { fpChars: ['meriadoc'], shadowChars: ['saruman'], fpCard: BLADE });
    const r = s.pendingCombat?.defRoll; if (!r) continue;
    const dead = s.characters.eliminated.includes('saruman');
    const rh = rerollHits(r);
    if (rh > 0) scored++; else missed++;
    if (dead !== rh > 0) bad.push(`${seed}: re-roll hits ${rh}, Saruman ${dead ? 'dead' : 'alive'}`);
    if (dead) {
      const dice = lineIdx(s, /Round 1 dice/), kill = lineIdx(s, /Saruman falls to the Blade of Westernesse/);
      if (!(kill > dice && dice >= 0)) bad.push(`${seed}: kill line ${kill} not after dice line ${dice}`);
      if (s.characters.inPlay['saruman']) bad.push(`${seed}: Saruman still listed in play`);
    }
  }
  check(`Saruman falls exactly when the FP re-roll scores (${scored} scored, ${missed} missed)`, scored > 0 && missed > 0 && bad.length === 0, bad.slice(0, 4).join('; '));
  const s = battle(3, { fpChars: ['meriadoc'], shadowChars: ['saruman'], fpCard: BLADE });
  check('the card line no longer explains the effect', s.log.some((e) => /play 'Blade of Westernesse' \(Mithril Coat and Sting\)$/.test(e.msg ?? '')));
}

console.log('\n=== Fateful Strike ===');
{
  const seen = { 0: 0, 1: 0, 2: 0 }; const bad = [];
  for (let seed = 1; seed < 160; seed++) {
    const s = battle(seed, { fpChars: ['strider'], shadowChars: ['witch-king'], nazgul: 2, leaders: 3, fpCard: FATEFUL });
    const r = s.pendingCombat?.defRoll; if (!r) continue;
    const rh = Math.min(2, rerollHits(r)); seen[rh]++;
    const wk = s.characters.eliminated.includes('witch-king');
    const naz = s.regions['orthanc'].nazgul;
    const want = rh === 0 ? { wk: false, naz: 2 } : rh === 1 ? { wk: false, naz: 1 } : { wk: true, naz: 2 };
    if (wk !== want.wk || naz !== want.naz) bad.push(`${seed}: re-roll hits ${rerollHits(r)}, WK ${wk ? 'dead' : 'alive'}, Nazgûl ${naz}`);
  }
  check(`no re-roll hit: nothing; one: a Nazgûl; two+: the Witch-king (${JSON.stringify(seen)})`, seen[0] && seen[1] && seen[2] && bad.length === 0, bad.slice(0, 4).join('; '));
}

console.log('\n=== Black Breath ===');
{
  let fired = 0, quiet = 0; const bad = [];
  for (let seed = 1; seed < 120; seed++) {
    // Strider is Level 3; Meriadoc Level 1. Nazgûl Leadership 3 gives the Shadow re-rolls.
    const s = battle(seed, { fpChars: ['strider', 'meriadoc'], nazgul: 3, leaders: 0, shadowCard: BREATH });
    const r = s.pendingCombat?.atkRoll; if (!r) continue;
    const rh = rerollHits(r);
    const gone = ['strider', 'meriadoc'].filter((c) => s.characters.eliminated.includes(c));
    const want = rh >= 3 ? ['strider'] : rh >= 1 ? ['meriadoc'] : [];
    if (rh) fired++; else quiet++;
    if (gone.join() !== want.join()) bad.push(`${seed}: re-roll hits ${rh}, eliminated [${gone}]`);
  }
  check(`Black Breath kills by re-roll hits only (${fired} fired, ${quiet} quiet)`, fired > 0 && quiet > 0 && bad.length === 0, bad.slice(0, 4).join('; '));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall re-roll kill-card checks passed');
process.exit(failures ? 1 : 0);
