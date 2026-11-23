#!/usr/bin/env vite-node
// probe-protocol-rule-diffs.mjs — rule differences found by following another engine's games.
//
// PR #1's protocol bot follows a referee's game on our engine, and every place the two engines
// disagreed got a switch (followOptions in data.ts). Checked against the card texts and the
// Almanac, these were bugs in OUR engine and are now fixed for every game:
//  - Only a side's own Characters lead its Army: a Companion of no Nation left in a region a
//    Shadow Army entered used to add his Leadership to the Shadow's re-roll.
//  - Mighty Attack forfeits the Leadership of one participating Companion: Aragorn's 2 when he
//    is the only one (it cost 1 whoever was there).
//  - Mighty Attack / Andúril turn the miss into a hit BEFORE the Leader re-roll.
//  - Relentless Assault / Onslaught may take every unit of the Army (Almanac).
//  - The "move any or all of the Nazgûl" cards have room for all eight figures.
//  - Mûmakil's "more total hits" counts the Free Peoples pre-Combat attack hits.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { forceLeadership } from '../src/engine/armies.ts';
import { combatModsFor } from '../src/engine/combatCards.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const state = startGame(createGame({ seed: 7 }));

console.log('\n=== Leadership: own side only ===');
{
  const shadow = { units: { sauron: { regular: 3, elite: 0 } }, leaders: 0, nazgul: 1, characters: ['gandalf-grey', 'meriadoc'] };
  check('Gandalf the Grey and Merry add nothing to a Shadow Army', forceLeadership(state, shadow, 'shadow') === 1, `got ${forceLeadership(state, shadow, 'shadow')}`);
  const fp = { units: { gondor: { regular: 3, elite: 0 } }, leaders: 1, nazgul: 0, characters: ['gandalf-grey', 'aragorn'] };
  check('…and still lead their own Army (1 + 1 + 2)', forceLeadership(state, fp, 'fp') === 4, `got ${forceLeadership(state, fp, 'fp')}`);
}

console.log('\n=== Mighty Attack: the forfeited Companion\'s Leadership ===');
{
  const alone = combatModsFor('fp-char-06', { ownCharacters: ['aragorn'] });
  check('Aragorn alone forfeits 2', alone?.ownLeadershipPenalty === 2, `got ${alone?.ownLeadershipPenalty}`);
  const both = combatModsFor('fp-char-06', { ownCharacters: ['aragorn', 'legolas'] });
  check('with Legolas there, the cheaper 1', both?.ownLeadershipPenalty === 1, `got ${both?.ownLeadershipPenalty}`);
  check('still one miss turned to a hit', both?.guaranteedHits === 1);
}

console.log('\n=== Nazgûl cards: room for every figure ===');
{
  const h = getHandler('sh-char-08b');
  check('The Nazgûl Strike! allows 16 steps (8 figures x pick + destination)', (h?.repeat ?? 0) >= 16, `repeat ${h?.repeat}`);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
