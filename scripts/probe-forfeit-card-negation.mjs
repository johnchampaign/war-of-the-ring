#!/usr/bin/env vite-node
// probe-forfeit-card-negation.mjs — cards that forfeit a Companion's Leadership
// "before rolling the dice for your Leader re-roll" can be negated (Almanac):
//  - Mighty Attack: "'Words of Power' may cancel this card, but only if there is a
//    single Companion in the battle whose Leadership is cancelled" (report 5q3i090h581p042m).
//  - Foul Stench "completely negates Andúril, Blade of Westernesse, Mighty Attack,
//    and Fateful Strike" — when its condition holds and the re-roll is cancelled
//    (report 6w03085j2u02591t).
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
const MIGHTY = byTitle('Mighty Attack'), WOP = byTitle('Words of Power'), STENCH = byTitle('Foul Stench');
check('the cards exist', !!(MIGHTY && WOP && STENCH), `${MIGHTY} ${WOP} ${STENCH}`);

/** Shadow (5 Isengard Regulars + `nazgul` Nazgûl) out of Orthanc into the Fords of
 *  Isen, held by 3 Rohan Regulars and `chars`. The FP plays Mighty Attack. Runs to the
 *  round's first prompt past the card plays (naming `named` for Words of Power). */
function battle(seed, { chars, shadowCard, nazgul = 2, named }) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 5, elite: 0 } };
  s.regions['orthanc'].nazgul = nazgul;
  s.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
  s.regions['fords-of-isen'].characters = [...chars];
  for (const c of chars) if (!s.characters.entered.includes(c)) s.characters.entered.push(c);
  s.cards.shadow.hand = [shadowCard];
  s.cards.fp.hand = [MIGHTY];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    if (s.pendingCombat.defRoll) return s;
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard : MIGHTY); continue; }
    if (ch.kind === 'wordsOfPower') { resolveWordsOfPower(s, named); continue; }
    if (ch.kind === 'whiteRider') throw new Error('unexpected White Rider');
    return s;
  }
  return s;
}
const misses = (roll) => roll.dice.filter((d) => d !== 6 && d < roll.target).length;
const diceHits = (roll) => roll.dice.filter((d) => d === 6 || d >= roll.target).length
  + roll.rerolls.filter((d) => d === 6 || d >= (roll.rerollTarget ?? roll.target)).length;
/** FP hits the round actually scored beyond its dice (Mighty Attack's conversion). */
function converted(s) {
  const r = s.pendingCombat.defRoll;
  const logLine = [...s.log].reverse().find((e) => /Round 1 dice/.test(e.msg ?? ''))?.msg ?? '';
  const m = /defender .*?→ (\d+) hits? total/.exec(logLine);
  return m ? Number(m[1]) - diceHits(r) : NaN;
}

function survey(label, opts, expectConversion) {
  let seen = 0, bad = [];
  for (let seed = 1; seed < 80; seed++) {
    const s = battle(seed, opts);
    const r = s.pendingCombat?.defRoll;
    if (!r) continue;
    // Only rounds where a miss survives the re-roll can show a conversion.
    const left = misses(r) - r.rerolls.filter((d) => d === 6 || d >= (r.rerollTarget ?? r.target)).length;
    if (left <= 0) continue;
    seen++;
    const c = converted(s);
    if (c !== (expectConversion ? 1 : 0)) bad.push(`${seed}:${c}`);
  }
  check(`${label} (${seen} seeds with a miss left)`, seen > 0 && bad.length === 0, bad.join(' '));
}

console.log('\n=== Words of Power vs Mighty Attack ===');
survey('the only Companion named: Mighty Attack does nothing', { chars: ['legolas'], shadowCard: WOP }, false);
survey('another Companion present: he forfeits instead, Mighty Attack works', { chars: ['legolas', 'gimli'], shadowCard: WOP, named: 'legolas' }, true);
{
  const s = battle(5, { chars: ['legolas'], shadowCard: WOP });
  check('the log says Mighty Attack had no effect', s.log.some((e) => /Mighty Attack.*NO EFFECT/.test(e.msg ?? '')));
}

console.log('\n=== Foul Stench vs Mighty Attack ===');
// Nazgûl Leadership 2 vs FP Leadership 1 (Legolas): the re-roll is cancelled.
survey('Foul Stench takes effect: no re-roll and no conversion', { chars: ['legolas'], shadowCard: STENCH, nazgul: 2 }, false);
{
  const s = battle(5, { chars: ['legolas'], shadowCard: STENCH, nazgul: 2 });
  check('no FP re-roll dice', s.pendingCombat.defRoll.rerolls.length === 0);
  check('the log says the re-roll was cancelled so Mighty Attack did nothing', s.log.some((e) => /re-roll is cancelled, so .*Mighty Attack.* has no effect/.test(e.msg ?? '')));
}
// Nazgûl Leadership 1 vs FP Leadership 3: Foul Stench fails, Mighty Attack works.
survey('Foul Stench outmatched: Mighty Attack still converts', { chars: ['legolas', 'gimli', 'boromir'], shadowCard: STENCH, nazgul: 1 }, true);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall forfeit-card negation checks passed');
process.exit(failures ? 1 : 0);
