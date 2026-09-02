#!/usr/bin/env vite-node
// probe-simulate.mjs — stage 2 of docs/ai-1ply-evaluator.md: the determinized
// simulator's three contracts.
//
//  1. NO-PEEK: scrambling everything the actor cannot see — the live RNG, the
//     opponent's hand identities, both deck orders — must not change any
//     candidate's simulated score. The sim is built from the redacted view, so
//     this holds by construction; the probe keeps it that way.
//  2. DETERMINISM: same (state, actor, action, simSeed) -> same score, always.
//  3. PURITY: simulating never touches the real state.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { simulateAction } from '../src/ai/simulate.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Heuristic self-play to a mid-game decision point for `wantActor`. */
function midGame(seed, wantTurn = 5) {
  let s = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7);
  let guard = 0;
  while (!wotrAdapter.result?.(s) && guard++ < 20000) {
    const actor = wotrAdapter.currentActor(s); if (!actor) break;
    if (s.turn >= wantTurn && !s.pendingChoice && !s.pendingCombat) return { s, actor };
    const legal = wotrAdapter.legalActions(s, actor); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, chooseAction(s, actor, legal, ai), actor);
  }
  return { s, actor: wotrAdapter.currentActor(s) };
}

/** Scramble ONLY hidden information, keeping every public fact identical:
 *  swap the live RNG, rotate the opponent's hand to different same-deck ids,
 *  and reverse both players' draw-deck orders (same composition). */
function scrambleHidden(state, actor) {
  const t = JSON.parse(JSON.stringify(state));
  t.rngState = ((t.rngState | 0) ^ 0x2545f491) >>> 1 || 12345;
  const opp = actor === 'fp' ? 'shadow' : 'fp';
  const deckOf = (id) => (EVENT_BY_ID[id]?.deck === 'Character' ? 'character' : 'strategy');
  t.cards[opp].hand = t.cards[opp].hand.map((id) => {
    const deck = deckOf(id);
    const draw = t.cards[opp].draw[deck];
    if (!draw.length) return id;                 // nothing to swap with — keep
    const swapped = draw.shift();                // take a different card of the SAME deck
    draw.push(id);                               // the old hand card goes into the pile
    return swapped;
  });
  for (const side of ['fp', 'shadow']) {
    t.cards[side].draw.character.reverse();
    t.cards[side].draw.strategy.reverse();
  }
  return t;
}

{
  const { s, actor } = midGame(11);
  const legal = wotrAdapter.legalActions(s, actor);
  console.log(`\n=== mid-game decision: turn ${s.turn}, ${actor} to act, ${legal.length} candidates ===`);
  check('a usable decision point was reached', !!actor && legal.length >= 3, `${legal.length} legal`);

  console.log('\n=== determinism ===');
  const a0 = legal[0];
  const x1 = simulateAction(s, actor, a0, 424242);
  const x2 = simulateAction(s, actor, a0, 424242);
  check('same seed, same score', x1 === x2, `${x1} vs ${x2}`);
  check('a score was produced at all', typeof x1 === 'number', String(x1));

  console.log('\n=== no-peek: hidden scrambles change nothing ===');
  const t = scrambleHidden(s, actor);
  check('the scramble really changed hidden state', JSON.stringify(t) !== JSON.stringify(s));
  let same = 0, tried = 0, firstDiff = '';
  for (const a of legal.slice(0, 12)) {
    const va = simulateAction(s, actor, a, 777);
    const vb = simulateAction(t, actor, a, 777);
    tried++;
    if (va === vb) same++;
    else if (!firstDiff) firstDiff = `${JSON.stringify(a).slice(0, 60)}: ${va} vs ${vb}`;
  }
  check(`every candidate scores identically across the scramble (${tried} tried)`, same === tried, firstDiff);

  console.log('\n=== purity ===');
  const before = JSON.stringify(s);
  for (const a of legal.slice(0, 5)) simulateAction(s, actor, a, 99);
  check('the real state is untouched', JSON.stringify(s) === before);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
