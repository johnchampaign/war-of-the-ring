#!/usr/bin/env vite-node
// probe-triage-1018.mjs — triage fixes of 2026-10-18.
//  * A pre-combat attack's hits (Sudden Strike, Charge, Durin's Bane) are casualties
//    like any others: the side taking them chooses which units fall (p.30). They
//    used to be applied Regulars-first with no prompt (player report
//    jxel9rth2n7t2ll3: "it just automatically kills regs for me").
//  * Hunt allocation offers at most 5 dice off the Mordor Track: a Hunt Level above
//    five adds nothing (p.41), and the Fellowship enters Mordor only in the
//    Fellowship phase, before allocation (p.43) — report 694h681d0924366i.
import { createGame } from '../src/engine/setup.ts';
import { huntAllocationBounds } from '../src/engine/phases.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveCasualtyStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function suddenStrike(seed) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.sauron.step = 0; s.nations.north.step = 0;
  s.regions['dale'].units = { north: { regular: 3, elite: 0 } };
  s.regions['dale'].leaders = 3;
  s.regions['northern-rhovanion'].units = { sauron: { regular: 3, elite: 3 } };
  s.cards.shadow.hand = [];
  s.cards.fp.hand = ['fp-char-14']; // Sudden Strike
  startBattle(s, 'shadow', 'northern-rhovanion', 'dale');
  let preChoice = null;
  for (let i = 0; i < 60 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'fp' ? 'fp-char-14' : null); continue; }
    if (ch.kind === 'combatCasualties') {
      const rolled = s.log.some((e) => (e.msg ?? '').startsWith('Round 1 dice'));
      if (!rolled && !preChoice) {
        preChoice = { owner: ch.owner, next: ch.data.next, hits: ch.data.hits };
        resolveCasualtyStep(s, 'reduceElite', 'sauron');
        while (s.pendingChoice?.kind === 'combatCasualties' && !s.log.some((e) => (e.msg ?? '').startsWith('Round 1 dice'))) resolveCasualtyStep(s, 'reduceElite', 'sauron');
        continue;
      }
      break;
    }
    break;
  }
  return { s, preChoice, msgs: s.log.map((e) => e.msg ?? '') };
}

{
  console.log('\n=== Sudden Strike: the Shadow chooses its casualties ===');
  let found = null;
  for (let seed = 1; seed < 80 && !found; seed++) { const r = suddenStrike(seed); if (r.preChoice) found = { ...r, seed }; }
  check('a seed where Sudden Strike hits a mixed Shadow Army asks the Shadow', !!found);
  if (found) {
    const { preChoice, msgs, seed } = found;
    check('the Shadow owns the casualty choice', preChoice.owner === 'shadow', `seed ${seed}`);
    check('...and the battle resumes at the round start', preChoice.next === 'beginRound');
    const pre = msgs.findIndex((m) => /^Sudden Strike: \[/.test(m));
    const roll = msgs.findIndex((m) => m.startsWith('Round 1 dice'));
    check('the Combat roll still follows the strike', pre >= 0 && roll > pre, `pre@${pre} roll@${roll}`);
    check('the chosen casualty is an Elite reduced, not a Regular removed', msgs.slice(pre, roll).some((m) => /Elite (falls|is reduced)/.test(m)), msgs.slice(pre, roll).filter((m) => /Regular falls|Elite (falls|is reduced)/.test(m)).join(' | '));
    const announce = msgs.filter((m) => /^Round 1: Free Peoples \(defender\)/.test(m)).length;
    check('the cards are announced once, not again on resuming', announce === 1, `${announce} announcements`);
    const strikes = msgs.filter((m) => /^Sudden Strike: \[/.test(m)).length;
    check('the strike is rolled once', strikes === 1, `${strikes}`);
  }
}

{
  console.log('\n=== Hunt allocation: no more than 5 dice off the Mordor Track ===');
  const s = startGame(createGame({ seed: 3 }));
  s.fellowship.companions = ['gandalf-grey', 'strider', 'legolas', 'gimli', 'boromir', 'meriadoc', 'peregrin'];
  s.dice.shadow = ['eye', 'eye', 'eye', 'eye', 'eye', 'eye', 'eye', 'eye'];
  const off = huntAllocationBounds(s);
  check('seven Companions, off the Track: at most 5', off.max === 5, JSON.stringify(off));
  s.fellowship.mordor = 1;
  const on = huntAllocationBounds(s);
  check('on the Mordor Track: up to the Companions (7)', on.max === 7, JSON.stringify(on));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
