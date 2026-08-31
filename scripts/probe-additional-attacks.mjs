#!/usr/bin/env vite-node
// probe-additional-attacks.mjs — the three "roll an additional attack" combat
// cards were all pooled into the round's roll as simultaneous extra dice. Their
// printed timings differ (player report: 'Please let Sudden Strike hit before
// combat! Witch king mauled my army'):
//   Sudden Strike / Charge: "BEFORE the Combat roll ... apply the result immediately"
//   We Come to Kill:        "AFTER removing casualties ..."
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function fight({ atkUnits, defUnits, defLeaders = 0, shadowCard = null, fpCard = null, seed = 5 }) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.sauron.step = 0; s.nations.north.step = 0;
  s.regions['dale'].units = { north: defUnits };
  s.regions['dale'].leaders = defLeaders;
  s.regions['northern-rhovanion'].units = { sauron: atkUnits };
  s.cards.shadow.hand = shadowCard ? [shadowCard] : [];
  s.cards.fp.hand = fpCard ? [fpCard] : [];
  startBattle(s, 'shadow', 'northern-rhovanion', 'dale');
  for (let i = 0; i < 60 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'shadow' ? shadowCard : fpCard); continue; }
    if (ch.kind === 'combatCasualties') { s.pendingChoice = null; s.pendingCombat.step = ch.data.next; continue; }
    break; // any other choice: round 1 is fully resolved, that's all we need
  }
  const msgs = s.log.map((e) => e.msg ?? '');
  return { s, msgs,
    preIdx: msgs.findIndex((m) => m.includes('additional attack (before the Combat roll)')),
    postIdx: msgs.findIndex((m) => m.includes('additional attack (after casualties)')),
    rollIdx: msgs.findIndex((m) => m.startsWith('Round 1 dice')) };
}

{
  console.log('\n=== Sudden Strike strikes BEFORE the Combat roll ===');
  // FP defender with 2 Leaders plays Sudden Strike (Leadership dice).
  const { msgs, preIdx, rollIdx } = fight({ atkUnits: { regular: 5, elite: 0 }, defUnits: { regular: 3, elite: 0 }, defLeaders: 2, fpCard: 'fp-char-14' });
  check('the additional attack is logged', preIdx >= 0, msgs.filter((m) => m.includes('additional')).join(' | ') || 'none');
  check('...and it resolves BEFORE the Round 1 dice', preIdx >= 0 && rollIdx > preIdx, `pre@${preIdx}, roll@${rollIdx}`);
  const rollLine = msgs[rollIdx] ?? '';
  check('the round roll shows NO in-round extra attack any more', !rollLine.includes('extra attack'), rollLine.slice(0, 90));
}

{
  console.log('\n=== We Come to Kill strikes AFTER casualties ===');
  const { msgs, postIdx, rollIdx } = fight({ atkUnits: { regular: 3, elite: 3 }, defUnits: { regular: 5, elite: 0 }, shadowCard: 'sh-str-13', seed: 9 });
  check('the additional attack is logged', postIdx >= 0, msgs.filter((m) => m.includes('additional')).join(' | ') || 'none');
  check('...and it resolves AFTER the Round 1 dice', postIdx >= 0 && rollIdx >= 0 && postIdx > rollIdx, `roll@${rollIdx}, post@${postIdx}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
