#!/usr/bin/env vite-node
// probe-triage-1010.mjs — player reports 221x631w3b3i4b1j and 3k6f3l215c5h1o47:
//
//  1. Balrog of Moria on the table: "Or, you may discard 'Balrog of Moria' to use its
//     Combat card effect as if you were playing the card from your hand" (Card Text
//     Reference). Durin's Bane is offered from the table and leaves it when played.
//  2. A retreat's battle-end line names where the Army went, with the verb agreeing
//     ("Shadow retreats to …").
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolveRetreat, resolveRetreatTo, playableCombatCards } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
function board() {
  const s = startGame(createGame({ seed: 9 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.cards.fp.hand = []; s.cards.shadow.hand = [];
  return s;
}

console.log('\n=== 1. Balrog of Moria plays Durin\'s Bane from the table ===');
{
  const s = board();
  s.cards.shadow.table.push('sh-char-17');
  s.regions['moria'].units = { sauron: { regular: 3, elite: 0 } };
  s.regions['hollin'].units = { elves: { regular: 2, elite: 0 } };
  s.phase = 'actionResolution'; s.activePlayer = 'shadow';
  startBattle(s, 'shadow', 'moria', 'hollin'); combatStep(s);
  check('Durin\'s Bane is playable from the table', playableCombatCards(s, 'shadow').includes('sh-char-17'));
  check('the Shadow is asked for a Combat card', s.pendingChoice?.kind === 'combatCard' && s.pendingChoice.owner === 'shadow', s.pendingChoice?.kind ?? 'none');
  const opts = wotrAdapter.legalActions(s, 'shadow');
  check('it is a legal play', opts.some((a) => a.kind === 'playCombatCard' && a.cardId === 'sh-char-17'));
  const t = wotrAdapter.applyAction(s, { kind: 'playCombatCard', cardId: 'sh-char-17' }, 'shadow');
  check('it leaves the table for the discard', !t.cards.shadow.table.includes('sh-char-17') && t.cards.shadow.discard.character.includes('sh-char-17'));
  check('and is the attacker\'s card this round', t.pendingCombat?.attackerCard === 'sh-char-17' || t.lastBattle != null);
}
{
  const s = board();
  s.cards.shadow.table.push('sh-char-17');
  s.regions['minas-tirith'].units = { gondor: { regular: 2, elite: 0 } };
  s.regions['osgiliath'].units = { sauron: { regular: 3, elite: 0 } };
  startBattle(s, 'shadow', 'osgiliath', 'minas-tirith');
  check('not offered far from Moria', !playableCombatCards(s, 'shadow').includes('sh-char-17'));
  check('not offered to the Free Peoples', !playableCombatCards(s, 'fp').includes('sh-char-17'));
}

console.log('\n=== 2. the retreat line names its destination ===');
{
  const s = board();
  s.regions['edoras'].units = { rohan: { regular: 1, elite: 4 } };
  s.regions['westemnet'].units = { sauron: { regular: 4, elite: 0 } };
  startBattle(s, 'fp', 'edoras', 'westemnet');
  s.pendingChoice = { owner: 'shadow', kind: 'combatRetreat' };
  resolveRetreat(s, true);
  if (s.pendingChoice?.kind === 'retreatTo') resolveRetreatTo(s, 'eastemnet');
  const line = s.log.map((e) => e.msg).find((m) => m.startsWith('The battle at'));
  check('"Shadow retreats to Eastemnet"', /Shadow retreats to Eastemnet$/.test(line ?? ''), line);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
