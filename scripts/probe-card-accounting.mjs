#!/usr/bin/env vite-node
// probe-card-accounting.mjs — from player report 1y0753093q2e1u1j: "the Free Peoples
// played its first two cards with MUSTER dice, so Gandalf the Grey's Guide draw can't
// have topped the hand up — where did the third card come from?" (The answer was King
// Brand's Men, whose own text draws a Strategy card. But the question is worth a
// permanent guard, because a hand that grows for no reason is unfalsifiable by eye.)
//
// Two invariants, checked after EVERY action of a full heuristic-vs-heuristic game:
//
//   1. Conservation — each side's 48 cards are always accounted for exactly once
//      across draw piles / hand / discards / table (plus the one card an interactive
//      Event holds out of hand while its target choice is pending).
//   2. Gandalf's Guide is the ONLY way playing an Event card refills the hand, and it
//      fires only when an Event (or Will of the West) die paid for the play — rulebook
//      p.22 / the Companion card. Growth is otherwise legitimate only when the played
//      card's own text says "draw", or when the play ended the turn (phase 1 then
//      deals both players a card from each deck).
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const GAMES = arg('--games', 60);
const MAX_ACTIONS = 20000;

// Cards whose own Event text draws — legitimate hand growth on any die.
const DRAWS_ITSELF = new Set(Object.values(EVENT_BY_ID)
  .filter((c) => /draw (one|two|a) /i.test(c.eventText ?? ''))
  .map((c) => c.id));

const allCards = (s, side) => {
  const p = s.cards[side];
  const ids = [...p.hand, ...p.draw.character, ...p.draw.strategy,
    ...p.discard.character, ...p.discard.strategy, ...(p.discardFaceDown ?? []), ...p.table];
  // An interactive Event is held out of every pile while its target choice is pending.
  const pc = s.pendingChoice;
  if (pc?.owner === side && pc.kind === 'eventTarget' && pc.data?.card) ids.push(pc.data.card);
  return ids;
};

const conservationError = (s) => {
  for (const side of ['fp', 'shadow']) {
    const ids = allCards(s, side);
    const seen = new Set(), dups = [];
    for (const id of ids) { if (seen.has(id)) dups.push(id); seen.add(id); }
    if (dups.length) return `${side}: duplicated ${dups.join(', ')}`;
    if (ids.length !== 48) return `${side}: ${ids.length} cards accounted for (expected 48)`;
  }
  return null;
};

/** Which die faces left the pool between two states. */
const spentFaces = (a, b, side) => {
  const rest = [...b.dice[side]];
  const out = [];
  for (const f of a.dice[side]) {
    const i = rest.indexOf(f);
    if (i >= 0) rest.splice(i, 1); else out.push(f);
  }
  return out;
};

let conserveFails = 0, growFails = 0, plays = 0, guideDraws = 0;
const offenders = [];

for (let game = 0; game < GAMES; game++) {
  const seed = game + 1;
  let state = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7);
  let actions = 0;
  while (!wotrAdapter.result(state) && actions < MAX_ACTIONS) {
    const actor = wotrAdapter.currentActor(state);
    if (actor === null) break;
    const legal = wotrAdapter.legalActions(state, actor);
    if (legal.length === 0) break;
    const action = chooseAction(state, actor, legal, ai);
    const before = state;
    const res = wotrAdapter.tryApplyAction(state, action, actor);
    if (!res.ok) { console.error(`  illegal: ${JSON.stringify(action)} -> ${res.reason} [game ${game}]`); break; }
    state = res.state;
    actions++;

    const bad = conservationError(state);
    if (bad) { conserveFails++; console.error(`  CARD LOST/DUPED [game ${game}] on ${JSON.stringify(action)} -> ${bad}`); break; }

    if (action.kind === 'playEvent') {
      plays++;
      const handBefore = before.cards[actor].hand.length;
      const handAfter = state.cards[actor].hand.length;
      const faces = spentFaces(before, state, actor);
      const eventPaid = faces.includes('event') || faces.includes('will');
      const guidePending = state.pendingChoice?.kind === 'guideDraw';
      if (guidePending || (eventPaid && handAfter > handBefore - 1)) guideDraws++;
      const newTurn = state.turn !== before.turn; // phase 1 deals 2 cards to each side
      const grew = handAfter > handBefore - 1 || guidePending;
      if (grew && !eventPaid && !newTurn && !DRAWS_ITSELF.has(action.cardId)) {
        growFails++;
        offenders.push({ game, turn: before.turn, actor, card: EVENT_BY_ID[action.cardId]?.name ?? action.cardId, faces, handBefore, handAfter, guidePending });
      }
    }
  }
}

console.log(`\n${GAMES} games — ${plays} Event cards played, ${guideDraws} Guide draws`);
console.log(`  ${conserveFails === 0 ? 'ok  ' : 'FAIL'} card conservation (48 per side, no duplicates)`);
console.log(`  ${growFails === 0 ? 'ok  ' : 'FAIL'} the hand only refills on an Event/Will die (Gandalf's Guide) or the card's own text`);
for (const o of offenders.slice(0, 20)) console.log('     ', JSON.stringify(o));
process.exit(conserveFails + growFails === 0 ? 0 : 1);
