#!/usr/bin/env vite-node
// probe-guide-draw-timing.mjs — Gandalf the Grey's Guide draw asks who is Guide at
// the END of the Action (Almanac, Gandalf the Grey: "only if an Event result is used
// and Gandalf is the Guide at the end of the Action"; player report joug252d7gwnw3ke):
//
//   1. Gwaihir, played with an Event die, separates Gandalf: no Guide draw.
//   2. Gwaihir separates Strider, the Guide, leaving Gandalf the highest Level: Gandalf
//      is Guide by the end, so the draw IS offered.
//   3. Control: Gwaihir separating a Hobbit while Gandalf stays Guide still draws.
//
// Also checks the log order of a move and the Nation it rouses (report j59rj32xtre3q5g8).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const act = (s, a, side = 'fp') => wotrAdapter.applyAction(s, a, side);

/** FP to act with one Event die and Gwaihir in hand; the Fellowship in Rivendell. */
function base(companions, guide) {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice = { fp: ['event'], shadow: ['army'] };
  state.usedDice = { fp: [], shadow: [] };
  state.pendingChoice = null;
  Object.assign(state.fellowship, { location: 'rivendell', mordor: null, hidden: true, progress: 0, companions, guide });
  state.cards.fp.hand = ['fp-char-15'];
  return state;
}

/** Play Gwaihir, pick `who`, then the first destination offered. */
function separate(state, who) {
  let s = act(state, { kind: 'playEvent', cardId: 'fp-char-15', die: 'event' });
  check(`Gwaihir asks for its targets`, s.pendingChoice?.kind === 'eventTarget', s.pendingChoice?.kind);
  for (const c of who) s = act(s, { kind: 'eventTarget', card: 'fp-char-15', companion: c });
  const dest = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'eventTarget' && a.region && !a.from);
  check('a separation destination is offered', !!dest);
  return act(s, dest);
}

const all = ['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin'];

{
  console.log('\n=== Gwaihir separates Gandalf the Guide: no draw ===');
  const s = separate(base(all, 'gandalf-grey'), ['gandalf-grey']);
  check('Gandalf left the Fellowship', !s.fellowship.companions.includes('gandalf-grey'));
  check('Gandalf is no longer Guide', s.fellowship.guide !== 'gandalf-grey', s.fellowship.guide);
  check('no Guide draw is offered', s.pendingChoice?.kind !== 'guideDraw', s.pendingChoice?.kind);
}

{
  console.log('\n=== Gwaihir separates the Guide, making Gandalf Guide: draw ===');
  const s = separate(base(['gandalf-grey', 'strider', 'meriadoc'], 'strider'), ['strider']);
  check('Gandalf is Guide by the end of the Action', s.fellowship.guide === 'gandalf-grey', s.fellowship.guide);
  check('the Guide draw is offered', s.pendingChoice?.kind === 'guideDraw', s.pendingChoice?.kind);
}

{
  console.log('\n=== Gwaihir separates a Hobbit, Gandalf stays Guide: draw ===');
  const s = separate(base(all, 'gandalf-grey'), ['meriadoc']);
  check('Gandalf is still Guide', s.fellowship.guide === 'gandalf-grey', s.fellowship.guide);
  check('the Guide draw is offered', s.pendingChoice?.kind === 'guideDraw', s.pendingChoice?.kind);
  const drawn = act(s, { kind: 'guideDraw', draw: true });
  check('...and taking it draws a Character card', drawn.cards.fp.hand.length === 1 && !drawn.pendingChoice, JSON.stringify(drawn.cards.fp.hand));
}

{
  console.log('\n=== the move is logged before the Nation it rouses ===');
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice = { fp: ['character'], shadow: ['army'] };
  state.usedDice = { fp: [], shadow: [] };
  state.pendingChoice = null;
  state.nations.gondor.active = false;
  // Boromir alone, separated, one step from Pelargir (a Gondor City).
  for (const r of Object.values(state.regions)) r.characters = r.characters.filter((c) => c !== 'boromir');
  state.fellowship.companions = state.fellowship.companions.filter((c) => c !== 'boromir');
  state.characters.inPlay.boromir = 'lamedon';
  state.regions.lamedon.characters.push('boromir');
  const mv = wotrAdapter.legalActions(state, 'fp').find((a) => JSON.stringify(a).includes('boromir') && JSON.stringify(a).includes('pelargir'));
  check('a Boromir move to Pelargir is legal', !!mv, '');
  if (mv) {
    let s = act(state, mv);
    for (let i = 0; i < 4 && s.pendingChoice?.owner === 'fp' && !s.nations.gondor.active; i++) {
      const done = wotrAdapter.legalActions(s, 'fp').find((a) => JSON.stringify(a).includes('pelargir')) ?? wotrAdapter.legalActions(s, 'fp')[0];
      s = act(s, done);
    }
    const lines = s.log.map((e) => e.msg ?? '');
    const moved = lines.findIndex((t) => /boromir moves/.test(t));
    const roused = lines.findIndex((t) => /gondor (is )?activated/i.test(t));
    check('Gondor was activated', roused >= 0, lines.slice(-6).join(' | '));
    check('the move line comes first', moved >= 0 && moved < roused, `moved@${moved} activated@${roused}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
