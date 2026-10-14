#!/usr/bin/env vite-node
// probe-ai-1014.mjs — AI reports of 2026-10-14.
//  - 1q112f1z0d6x262j: the Shadow brings Saruman in sooner — but not while the Free
//    Peoples hold an unused Will of the West and his arrival (the first Minion) would let
//    Gandalf the White come at once.
//  - 1m2s5r0z6j5v3a3p: the Shadow pays for an Event card with an Event die when it has
//    one, keeping its Army / Muster / Character dice for the board (Shadow only: the
//    Free Peoples version measured worse — see wotrAI.ts payWithEventDie).
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const shadowTurn = (fpDice) => {
  const s = startGame(createGame({ seed: 17 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.dice.shadow = ['muster']; s.dice.fp = fpDice;
  // Every Shadow Settlement garrisoned, so refilling an empty one is not the urgent call.
  for (const [id, d] of Object.entries(REGIONS)) {
    if (!d.settlement || !['sauron', 'isengard', 'southrons'].includes(d.nation)) continue;
    const r = s.regions[id];
    if (Object.values(r.units).reduce((t, u) => t + u.regular + u.elite, 0) < 2) r.units[d.nation] = { regular: 2, elite: 0 };
  }
  // Gandalf the Grey has left the Fellowship, so the White could come.
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gandalf-grey');
  if (!s.characters.eliminated.includes('gandalf-grey')) s.characters.eliminated.push('gandalf-grey');
  return s;
};
const decide = (s) => chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(2));

console.log('\n=== Saruman ===');
{
  const s = shadowTurn([]);
  const offered = wotrAdapter.legalActions(s, 'shadow').some((a) => a.kind === 'bringMinion' && a.minion === 'saruman');
  const a = decide(s);
  check('the Free Peoples are out of dice: Saruman comes', offered && a.kind === 'bringMinion' && a.minion === 'saruman', JSON.stringify(a).slice(0, 100));
}
{
  const s = shadowTurn(['will', 'character']);
  const a = decide(s);
  check('…with a Will of the West still in their hand: he waits', !(a.kind === 'bringMinion' && a.minion === 'saruman'), JSON.stringify(a).slice(0, 100));
}

console.log('\n=== Event die first (Shadow) ===');
{
  const s = startGame(createGame({ seed: 17 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event', 'muster']; s.dice.fp = ['army'];
  // Musterings of Long-planned War: a Muster-icon card, the only action on offer.
  const card = s.cards.shadow.draw.strategy.find((c) => wotrAdapter.legalActions({ ...s, cards: { ...s.cards, shadow: { ...s.cards.shadow, hand: [c] } } }, 'shadow')
    .some((a) => a.kind === 'playEvent'));
  s.cards.shadow.hand = [card];
  // The card play plus throwing a die away, so the AI weighs a real choice (a lone
  // legal action is returned untouched).
  const legal = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'playEvent' || a.kind === 'skipDie');
  const a = chooseAction(s, 'shadow', legal, new Rng(1));
  check('a card played with the Event die left the Muster die', a.kind === 'playEvent' && a.die === 'event', JSON.stringify(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
