#!/usr/bin/env vite-node
// probe-words-of-power.mjs — Words of Power NAMES its Companion (player reports
// wuna1zhu7ux1az7o, 5644674x). Card Text Reference:
//   "Play if a Nazgûl is in the battle. Choose a Companion. That Companion's
//    Leadership and special abilities are cancelled for this Combat round."
// Almanac: it stays playable against The White Rider, and naming Gandalf the White
// cancels that ability for the round — the Nazgûl Leadership comes back. It used to
// take a flat 1 off the Free Peoples Leadership with no choice, so it could never
// switch The White Rider off.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveWhiteRider, resolveWordsOfPower } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const WOP = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === 'Words of Power');
check('a Words of Power card exists', !!WOP, WOP);

/** Shadow (5 Isengard Regulars + 2 Nazgûl) out of Orthanc into the Fords of Isen,
 *  held by 3 Rohan Regulars and `chars`. Runs until the first prompt that isn't a
 *  combat-card or White Rider choice (both answered here). */
function battle(seed, { chars = ['gandalf-white', 'legolas'], forfeit = true, fpCard = null } = {}) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 5, elite: 0 } };
  s.regions['orthanc'].nazgul = 2;
  s.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
  s.regions['fords-of-isen'].characters = [...chars];
  for (const c of chars) if (!s.characters.entered.includes(c)) s.characters.entered.push(c);
  s.cards.shadow.hand = [WOP];
  s.cards.fp.hand = fpCard ? [fpCard] : [];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'whiteRider') { resolveWhiteRider(s, forfeit); continue; }
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? WOP : fpCard); continue; }
    return s;
  }
  return s;
}
/** Answer the Words of Power prompt, then run on to the round's first casualty prompt. */
function name(s, who) {
  resolveWordsOfPower(s, who);
  for (let i = 0; i < 20 && s.pendingCombat && !s.pendingChoice; i++) combatStep(s);
  return s;
}
const misses = (roll) => roll.dice.filter((d) => d !== 6 && d < roll.target).length;

{
  console.log('\n=== The Shadow names the Companion, from those in the battle ===');
  const s = battle(1);
  check('a wordsOfPower prompt, owned by the Shadow', s.pendingChoice?.kind === 'wordsOfPower' && s.pendingChoice.owner === 'shadow', s.pendingChoice?.kind);
  const opts = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'wordsOfPower').map((a) => a.companion);
  check('Gandalf the White and Legolas are offered', opts.length === 2 && opts.includes('gandalf-white') && opts.includes('legolas'), opts.join(','));
  const ai = chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'));
  check('the AI names Gandalf the White while The White Rider is in use', ai?.companion === 'gandalf-white', JSON.stringify(ai));
  let threw = false;
  try { resolveWordsOfPower(battle(1), 'boromir'); } catch { threw = true; }
  check('a Companion who is not in the battle cannot be named', threw);
}
{
  console.log('\n=== Naming Gandalf the White switches The White Rider off for the round ===');
  // A seed where the Shadow misses at least one die, so the Nazgûl's re-roll shows.
  let seen = 0, gtwOk = true, legOk = true;
  for (let seed = 1; seed < 60; seed++) {
    const a = name(battle(seed), 'gandalf-white');
    const b = name(battle(seed), 'legolas');
    if (!a.pendingCombat?.atkRoll || !b.pendingCombat?.atkRoll) continue;
    const m = misses(a.pendingCombat.atkRoll);
    if (m === 0) continue;
    seen++;
    if (a.pendingCombat.atkRoll.rerolls.length !== Math.min(2, m)) gtwOk = false;
    if (b.pendingCombat.atkRoll.rerolls.length !== 0) legOk = false;
  }
  check('some seeds had Shadow misses', seen > 0, `${seen}`);
  check('Gandalf named: the 2 Nazgûl re-roll their misses', gtwOk);
  check('Legolas named: The White Rider still negates the Nazgûl Leadership', legOk);
}
{
  console.log('\n=== The named Companion\'s Leadership is gone from the Free Peoples re-roll ===');
  let bad = [];
  for (let seed = 1; seed < 60; seed++) {
    // No White Rider: FP Leadership = Gandalf 1 + Legolas 1 = 2; naming either leaves 1.
    const s = name(battle(seed, { forfeit: false }), 'legolas');
    const r = s.pendingCombat?.defRoll;
    if (!r) continue;
    if (r.rerolls.length > Math.min(1, misses(r))) bad.push(seed);
  }
  check('never more than one FP re-roll die', bad.length === 0, bad.join(','));
}
{
  console.log('\n=== One Companion in the battle: nothing to choose ===');
  const s = battle(3, { chars: ['legolas'] });
  check('no wordsOfPower prompt', s.pendingChoice?.kind !== 'wordsOfPower', s.pendingChoice?.kind);
  check('Legolas is named automatically', s.pendingCombat?.wordsOfPowerTarget === 'legolas', String(s.pendingCombat?.wordsOfPowerTarget));
  const logged = s.log.some((e) => /Words of Power names Legolas/.test(e.msg ?? ''));
  check('the log says whom it cancelled', logged);
}
{
  console.log('\n=== No Companion: the card has nothing to cancel ===');
  const s = battle(4, { chars: [] });
  check('no wordsOfPower prompt', s.pendingChoice?.kind !== 'wordsOfPower', s.pendingChoice?.kind);
  check('target recorded as none', s.pendingCombat == null || s.pendingCombat.wordsOfPowerTarget === null, String(s.pendingCombat?.wordsOfPowerTarget));
}

{
  // Player report 3u1q184s3d1d0v70: Daring Defiance (initiative 0) cancels Words of
  // Power (initiative 1) before it resolves, so the Shadow must not be asked to name
  // a Companion at all.
  console.log('\n=== Cancelled by Daring Defiance: no Words of Power question ===');
  const DD = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === 'Daring Defiance');
  const s = battle(5, { chars: ['strider', 'legolas'], fpCard: DD });
  check('no wordsOfPower prompt', s.pendingChoice?.kind !== 'wordsOfPower', s.pendingChoice?.kind);
  check('nobody is named', s.pendingCombat == null || s.pendingCombat.wordsOfPowerTarget === null, String(s.pendingCombat?.wordsOfPowerTarget));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall Words of Power checks passed');
process.exit(failures ? 1 : 0);
