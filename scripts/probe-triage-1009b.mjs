#!/usr/bin/env vite-node
// probe-triage-1009b.mjs — the 2026-10-09 afternoon triage batch:
//
//  1. Faramir's Rangers and The Spirit of Mordor let the SHADOW choose which units
//     absorb their hits, like Dreadful Spells (reports 29395e6o1y6r4y5e,
//     3i5z6d36724x115m). Faramir's Osgiliath recruit still follows the question.
//  2. The chosen casualties are logged, not only the forced ones (3i5z6d36724x115m).
//  3. Characters and Leaders falling with a destroyed Army share one log line
//     (5j234w1m2r370a5k).
//  4. Removing a Shadow table card logs "Free Peoples remove …" (614y1i2c4s001c1g).
//  5. The draw buttons don't repeat the card's name (6r5i5b0o1u4i5x3k).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { applyCasualties } from '../src/engine/combat.ts';
import { describeAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const msgs = (s, from) => s.log.slice(from).map((e) => e.msg);

/** FP to act with an Event die and `card` in hand. */
function board(seed, card) {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = ['army'];
  for (const p of [s.cards.fp.hand, s.cards.fp.draw.character, s.cards.fp.draw.strategy]) { const i = p.indexOf(card); if (i >= 0) p.splice(i, 1); }
  s.cards.fp.hand.push(card);
  return s;
}
/** Answer every Shadow casualty question with its first option; return the state. */
function shadowAnswers(t) {
  let n = 0;
  while (t.pendingChoice?.kind === 'eventCasualties' && n++ < 10) {
    const opts = wotrAdapter.legalActions(t, 'shadow');
    t = wotrAdapter.applyAction(t, opts[opts.length - 1], 'shadow');
  }
  return t;
}

console.log('\n=== 1a. Faramir\'s Rangers: the Shadow chooses, then the recruit follows ===');
{
  let asked = 0, recruited = 0, logged = 0, tried = 0;
  for (let seed = 1; seed < 40 && asked < 3; seed++) {
    const s = board(seed, 'fp-str-06');
    s.regions['north-ithilien'].units = { sauron: { regular: 3, elite: 2 }, southrons: { regular: 1, elite: 0 } };
    const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-06');
    if (!play) { check('Faramir\'s Rangers is playable', false); break; }
    let t = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
    const strike = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'eventTarget' && a.region === 'north-ithilien');
    if (!strike) { check('the strike is offered', false); break; }
    const mark = t.log.length;
    t = wotrAdapter.applyAction(t, strike, 'fp');
    tried++;
    if (t.pendingChoice?.kind !== 'eventCasualties') continue; // no hits this seed
    asked++;
    check(`seed ${seed}: the SHADOW is asked`, t.pendingChoice.owner === 'shadow' && wotrAdapter.currentActor(t) === 'shadow');
    t = shadowAnswers(t);
    if (msgs(t, mark).some((m) => /^Shadow casualties: /.test(m))) logged++;
    const next = wotrAdapter.legalActions(t, 'fp').filter((a) => a.kind === 'eventTarget' && a.figure);
    check(`seed ${seed}: the Osgiliath recruit comes back to the Free Peoples`, t.pendingChoice?.kind === 'eventTarget' && next.length > 0, t.pendingChoice?.kind);
    if (next.length) {
      const leaders0 = t.regions['osgiliath'].leaders;
      t = wotrAdapter.applyAction(t, next[0], 'fp');
      if (t.regions['osgiliath'].leaders === leaders0 + 1 && t.cards.fp.discard.strategy.includes('fp-str-06')) recruited++;
    }
  }
  check('some seed scored a hit worth a question', asked > 0, `${asked} of ${tried}`);
  check('every asked play then recruited the unit and Leader and discarded the card', recruited === asked, `${recruited}/${asked}`);
  check('the chosen casualty is logged', logged === asked, `${logged}/${asked}`);
}

console.log('\n=== 1b. The Spirit of Mordor: the Shadow chooses ===');
{
  let asked = 0, done = 0;
  for (let seed = 1; seed < 40 && asked < 3; seed++) {
    const s = board(seed, 'fp-str-05');
    s.regions['gorgoroth'].units = { sauron: { regular: 4, elite: 3 }, southrons: { regular: 2, elite: 0 } };
    const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-05');
    if (!play) { check('The Spirit of Mordor is playable', false); break; }
    let t = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
    const target = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'eventTarget' && a.region === 'gorgoroth');
    t = wotrAdapter.applyAction(t, target, 'fp');
    if (t.pendingChoice?.kind !== 'eventCasualties') continue;
    asked++;
    check(`seed ${seed}: the SHADOW is asked`, t.pendingChoice.owner === 'shadow');
    t = shadowAnswers(t);
    // Done: the card is discarded and the Action is over — only Gandalf the Grey's
    // end-of-Action Guide draw may follow.
    if ((!t.pendingChoice || t.pendingChoice.kind === 'guideDraw') && t.cards.fp.discard.strategy.includes('fp-str-05') && t.currentPlayer === 'shadow') done++;
    else console.log('   ', JSON.stringify({ pc: t.pendingChoice?.kind, cur: t.currentPlayer, disc: t.cards.fp.discard.strategy }));
  }
  check('some seed scored a hit worth a question', asked > 0);
  check('the card then finishes and the turn passes', done === asked, `${done}/${asked}`);
}

console.log('\n=== 3. one line for everything that falls with a destroyed Army ===');
{
  const s = startGame(createGame({ seed: 3 }));
  const r = s.regions['minas-tirith'];
  r.units = { gondor: { regular: 1, elite: 0 } }; r.leaders = 1; r.characters = ['legolas', 'boromir'];
  s.fellowship.companions = s.fellowship.companions.filter((c) => !['legolas', 'boromir'].includes(c));
  s.characters.inPlay.legolas = 'minas-tirith'; s.characters.inPlay.boromir = 'minas-tirith';
  const mark = s.log.length;
  applyCasualties(s, 'minas-tirith', 'fp', 1, 'regularsFirst');
  const lines = msgs(s, mark).filter((m) => /with the destroyed Army/.test(m));
  check('a single "fall with the destroyed Army" line', lines.length === 1, JSON.stringify(lines));
  check('it names the Companions and the Leader', /legolas and boromir|legolas, boromir and a Free Peoples Leader/i.test(lines[0] ?? '') && /a Free Peoples Leader fall with/.test(lines[0] ?? ''), lines[0]);
}

console.log('\n=== 4. removing a Shadow table card ===');
{
  const s = board(5, 'fp-str-06');
  s.dice.fp = ['will'];
  for (const p of [s.cards.shadow.hand, s.cards.shadow.draw.character, s.cards.shadow.draw.strategy]) { const i = p.indexOf('sh-str-03'); if (i >= 0) p.splice(i, 1); }
  s.cards.shadow.table.push('sh-str-03');
  const rm = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'forceDiscardCard' && a.cardId === 'sh-str-03' && a.via === 'will');
  if (!rm) check('the tabled card can be removed with a Will die', false, JSON.stringify(wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'forceDiscardCard')));
  else {
    const mark = s.log.length;
    const t = wotrAdapter.applyAction(s, rm, 'fp');
    const line = msgs(t, mark).find((m) => /^Free Peoples (remove|force)/.test(m));
    check('"Free Peoples remove <card>", no die parenthetical', /^Free Peoples remove [^(]+$/.test(line ?? ''), line);
  }
}

console.log('\n=== 5. draw buttons ===');
check('Palantír', describeAction({ kind: 'bonusDraw', deck: 'character' }) === 'Draw a Character card');
check('Palantír, decline', describeAction({ kind: 'bonusDraw', deck: 'none' }) === 'Don’t draw');
check('Gandalf', describeAction({ kind: 'guideDraw', draw: true }) === 'Draw a card');

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
