#!/usr/bin/env vite-node
// probe-search.mjs — the sampled look-ahead (src/ai/search.ts) is fair and repeatable.
//  - No peeking: the search's choice is the same whatever the opponent actually holds
//    (hand, draw piles) and whatever the live dice RNG is — it sees only the redacted view.
//  - Deterministic: the same position and choice RNG give the same action.
//  - The live game is never touched (playouts run on copies).
//  - A determinized copy has no hidden-card markers left and deals every card exactly once.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction, topCandidates } from '../src/ai/wotrAI.ts';
import { chooseActionSearch, searchScores, determinize, searchStats } from '../src/ai/search.ts';
import { deckOf, EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const OPTS = { cands: 3, samples: 4, horizon: 1, margin: 0.03 };
const opp = (s) => (s === 'fp' ? 'shadow' : 'fp');
const deckOfCard = (id) => (EVENT_BY_ID[id]?.deck === 'Character' ? 'character' : 'strategy');

/** Play the heuristic from `seed` until `side` faces a searchable decision on turn >= `turn`. */
function reach(seed, side, turn) {
  let s = startGame(createGame({ seed }));
  const rng = new Rng(seed * 31 + 1);
  for (let n = 0; n < 20000 && !s.winner; n++) {
    const who = wotrAdapter.currentActor(s);
    const legal = wotrAdapter.legalActions(s, who);
    if (who === side && s.turn >= turn && topCandidates(s, who, legal, new Rng(1), OPTS.cands)?.length > 1) return s;
    s = wotrAdapter.applyAction(s, chooseAction(s, who, legal, rng), who);
  }
  return null;
}

/** The opponent's hidden cards swapped for others of the same deck, and new live dice. */
function reshuffleHidden(state, side) {
  const o = opp(side);
  const s = JSON.parse(JSON.stringify(state));
  const piles = s.cards[o];
  for (const deck of ['character', 'strategy']) {
    const pub = new Set([...piles.discard[deck], ...piles.table]);
    const hidden = [...piles.hand.filter((id) => deckOfCard(id) === deck), ...piles.draw[deck]];
    const pool = deckOf(o, deck).filter((id) => !pub.has(id) && !(piles.discardFaceDown ?? []).includes(id));
    // rotate the pool so every hidden slot gets a different card where possible
    const rot = [...pool.slice(3), ...pool.slice(0, 3)];
    let k = 0;
    piles.hand = piles.hand.map((id) => (deckOfCard(id) === deck ? rot[k++] : id));
    piles.draw[deck] = piles.draw[deck].map(() => rot[k++]);
    if (k !== hidden.length) throw new Error('reshuffle miscounted');
  }
  s.rngState = new Rng(987654).serialize();
  return s;
}

for (const side of ['shadow', 'fp']) {
  console.log(`\n=== ${side === 'fp' ? 'Free Peoples' : 'Shadow'} searching on turn 4 ===`);
  const s = reach(7, side, 4);
  check('reached a searchable decision', !!s);
  if (!s) continue;
  const legal = wotrAdapter.legalActions(s, side);
  const before = JSON.stringify(s);
  const a1 = chooseActionSearch(s, side, legal, new Rng(42), OPTS);
  check('the live game is unchanged by the search', JSON.stringify(s) === before);
  const a2 = chooseActionSearch(s, side, legal, new Rng(42), OPTS);
  check('same position and RNG → same action', JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a1));
  const t = reshuffleHidden(s, side);
  check('the reshuffle really changed the opponent\'s hand',
    JSON.stringify(t.cards[opp(side)].hand) !== JSON.stringify(s.cards[opp(side)].hand));
  const a3 = chooseActionSearch(t, side, wotrAdapter.legalActions(t, side), new Rng(42), OPTS);
  check('different hidden cards and dice → same action (no peeking)', JSON.stringify(a1) === JSON.stringify(a3), JSON.stringify(a3));
  const m1 = searchScores(s, side, legal, new Rng(42), OPTS);
  const m3 = searchScores(t, side, wotrAdapter.legalActions(t, side), new Rng(42), OPTS);
  check('different hidden cards and dice → identical playout means', JSON.stringify(m1) === JSON.stringify(m3),
    m1?.mean.map((x) => x.toFixed(3)).join(' '));

  const mism = searchStats.dealMismatch;
  const d = determinize(s, side, 12345);
  const piles = d.cards[opp(side)];
  const all = [...piles.hand, ...(piles.discardFaceDown ?? []), ...piles.draw.character, ...piles.draw.strategy];
  check('no hidden markers left in the copy', !all.some((id) => String(id).startsWith('hidden')));
  const every = [...all, ...piles.discard.character, ...piles.discard.strategy, ...piles.table];
  check('every opponent card dealt exactly once', new Set(every).size === every.length && searchStats.dealMismatch === mism,
    `${every.length} cards, ${new Set(every).size} distinct`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall search checks passed');
process.exit(failures ? 1 : 0);
