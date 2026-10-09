#!/usr/bin/env vite-node
// probe-ai-card-move-stacking.mjs — player report 3ykowo95on5omwd6 ("The Shadow
// Lengthens massacre again"): the Shadow AI used The Shadow Lengthens to pile two
// Armies into South Ithilien and then had to remove eleven of its own Regulars. A card
// move may overstack (the excess is removed afterwards), so the AI must count what the
// landing stack would throw away — and prefer a destination that loses nothing, or stop.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = (stacks) => {
  const s = startGame(createGame({ seed: 17 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].active = true; s.nations[n].step = 0; }
  // Only the Armies under test: every other Shadow Army leaves the board, so the AI's
  // choice is between stacking these and going somewhere harmless (or stopping).
  for (const r of Object.values(s.regions)) {
    r.nazgul = 0;
    r.units = Object.fromEntries(Object.entries(r.units).filter(([n]) => !['sauron', 'isengard', 'southrons'].includes(n)));
  }
  for (const r of ['dagorlad', 'morannon', 'ash-mountains', 'noman-lands']) { s.regions[r].units = {}; s.regions[r].characters = []; s.regions[r].besieged = false; delete s.regions[r].siegeBox; }
  for (const [r, n] of Object.entries(stacks)) s.regions[r].units = { sauron: { regular: n, elite: 0 } };
  s.cards.shadow.hand = ['sh-str-08'];
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-08');
  return wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
};
const units = (s, r) => Object.values(s.regions[r].units).reduce((t, u) => t + u.regular + u.elite, 0);
const shadowUnits = (s) => Object.values(s.regions).reduce((t, r) => t + Object.entries(r.units).reduce((u, [n, x]) => u + (['sauron', 'isengard', 'southrons'].includes(n) ? x.regular + x.elite : 0), 0), 0);
const decide = (s) => chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(7));

console.log('\n=== The Shadow Lengthens: the AI does not throw its own units away ===');
for (const stacks of [{ dagorlad: 8, morannon: 6, 'noman-lands': 2 }, { dagorlad: 7, morannon: 7 }, { dagorlad: 9, morannon: 9, 'noman-lands': 9 }]) {
  let s = board(stacks);
  const before = shadowUnits(s);
  const offers = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'eventTarget');
  console.log(`  board ${JSON.stringify(stacks)}: ${offers.length} offers (${offers.map((a) => a.done ? 'done' : `${a.from}→${a.to}`).join(', ')})`);
  for (let i = 0; i < 6 && s.pendingChoice?.kind === 'eventTarget'; i++) {
    const pick = decide(s);
    console.log(`    pick: ${pick.done ? 'done' : `${pick.from}→${pick.to}`}`);
    s = wotrAdapter.applyAction(s, pick, 'shadow');
    // The removal of an overstack may itself be a Shadow choice; let the AI make it.
    for (let j = 0; j < 10 && s.pendingChoice && s.pendingChoice.kind !== 'eventTarget' && s.pendingChoice.owner === 'shadow'; j++) s = wotrAdapter.applyAction(s, decide(s), 'shadow');
  }
  const lost = before - shadowUnits(s);
  check(`no Shadow unit is lost to the stacking limit on ${JSON.stringify(stacks)}`, lost === 0, `${lost} lost`);
  check('no region ends above 10 units', Object.keys(s.regions).every((r) => units(s, r) <= 10));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
