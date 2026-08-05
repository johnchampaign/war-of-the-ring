#!/usr/bin/env vite-node
// probe-play-via.mjs — the 2026-08-05 player-report batch:
//
//   1. an Event card is played with the die whose ICON it prints (Character / Army /
//      Muster), not with any die of its deck — the Army-vs-Muster split inside the
//      Strategy decks used to be ignored (report 1w592n);
//   2. Nazgûl Search / The Nazgûl Strike! are gated ONLY on their printed condition
//      ("the Fellowship is on step 1 or higher"), so they can be played purely to
//      reposition the Nazgûl (report 3i1v1v);
//   3. when Nazgûl Search reveals the Fellowship, the Free Peoples must move the
//      figure and the Progress resets — the reveal is not a bare flag flip
//      (report 3k733e).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { EVENT_CARDS, EVENT_BY_ID, playFacesFor } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const board = () => startGame(createGame({ seed: 11 }));
const playable = (state, side) => wotrAdapter.legalActions(state, side).filter((a) => a.kind === 'playEvent').map((a) => a.cardId);

// --- 1. the play-via icon is complete and drives the die choice --------------------
{
  console.log('\n=== every base card carries a play-via icon ===');
  const missing = EVENT_CARDS.filter((c) => !c.playableVia);
  check('all 96 cards have playableVia', EVENT_CARDS.length === 96 && missing.length === 0, missing.map((c) => c.id).join(', '));
  check('every Character-deck card plays on a Character die',
    EVENT_CARDS.filter((c) => c.deck === 'Character').every((c) => c.playableVia === 'character'));
  check('every Strategy-deck card plays on an Army or Muster die',
    EVENT_CARDS.filter((c) => c.deck === 'Strategy').every((c) => c.playableVia === 'army' || c.playableVia === 'muster'));
  // Spot-checks against the rulebook's own worked example (p.22) and the Almanac index.
  check('Paths of the Woses is an Army card (rulebook p.22 example)', EVENT_BY_ID['fp-str-11'].playableVia === 'army');
  check('Threats and Promises is a Muster card', EVENT_BY_ID['sh-str-05'].playableVia === 'muster');
  check('Nazgûl Search is a Character card', EVENT_BY_ID['sh-char-09'].playableVia === 'character');

  console.log('\n=== the die must match the icon ===');
  check('an Army card takes Army / Army-Muster / Event / Will',
    JSON.stringify(playFacesFor('sh-str-07')) === JSON.stringify(['army', 'armyMuster', 'event', 'will']));
  check('a Muster card takes Muster / Army-Muster / Event / Will',
    JSON.stringify(playFacesFor('sh-str-05')) === JSON.stringify(['muster', 'armyMuster', 'event', 'will']));

  // Threats and Promises (Muster icon) vs Shadows Gather (Army icon): one Army die
  // must offer exactly one of them. Both are otherwise unconditional at setup.
  const state = board();
  state.phase = 'actionResolution';
  state.currentPlayer = 'shadow';
  state.cards.shadow.hand = ['sh-str-05', 'sh-str-07'];
  state.dice.shadow = ['army'];
  state.dice.fp = [];
  const withArmy = playable(state, 'shadow');
  check('an Army die plays the Army card only', withArmy.includes('sh-str-07') && !withArmy.includes('sh-str-05'), withArmy.join(', '));

  state.dice.shadow = ['muster'];
  const withMuster = playable(state, 'shadow');
  check('a Muster die plays the Muster card only', withMuster.includes('sh-str-05') && !withMuster.includes('sh-str-07'), withMuster.join(', '));

  state.dice.shadow = ['armyMuster'];
  check('an Army/Muster die plays both', playable(state, 'shadow').length === 2);

  state.dice.shadow = ['event'];
  check('an Event die plays both', playable(state, 'shadow').length === 2);

  state.dice.shadow = ['character'];
  check('a Character die plays neither Strategy card', playable(state, 'shadow').length === 0);

  // A Character-deck card still needs a Character (or Event) die.
  state.cards.shadow.hand = ['sh-char-16']; // Flocks of Crebain — no board precondition
  state.dice.shadow = ['character'];
  check('a Character die plays a Character card', playable(state, 'shadow').includes('sh-char-16'));
  state.dice.shadow = ['army'];
  check('an Army die does not play a Character card', playable(state, 'shadow').length === 0);

  // The icon die is spent in preference to the scarce Event die.
  const s2 = board();
  s2.phase = 'actionResolution';
  s2.currentPlayer = 'shadow';
  s2.cards.shadow.hand = ['sh-str-05'];
  s2.dice.shadow = ['event', 'muster'];
  const s3 = wotrAdapter.applyAction(s2, { kind: 'playEvent', cardId: 'sh-str-05' }, 'shadow');
  check('the Muster die pays, the Event die survives', s3.dice.shadow.includes('event') && !s3.dice.shadow.includes('muster'), JSON.stringify(s3.dice.shadow));
}

// --- 2. the Nazgûl cards are gated only on their printed condition -----------------
{
  console.log('\n=== Nazgûl Search: only the printed "step 1 or higher" gates it ===');
  const state = board();
  check('unplayable at Progress 0 (the card says step 1+)', !canPlayCard(state, 'sh-char-09', 'shadow'));

  state.fellowship.progress = 1;
  check('playable at Progress 1 with Nazgûl on the map', canPlayCard(state, 'sh-char-09', 'shadow'));

  // The old guard blocked the card whenever no Nazgûl could reach the Fellowship —
  // e.g. while it rests in Rivendell, an unbesieged FP Stronghold. RAW lets it be
  // played to reposition the Nazgûl; the reveal half simply doesn't fire.
  state.fellowship.location = 'rivendell';
  check('still playable with the Fellowship in an FP Stronghold', canPlayCard(state, 'sh-char-09', 'shadow'));
  check('The Nazgûl Strike! likewise', canPlayCard(state, 'sh-char-08b', 'shadow'));

  // An already-revealed Fellowship doesn't stop the Nazgûl from moving either.
  state.fellowship.hidden = false;
  check('still playable with the Fellowship revealed', canPlayCard(state, 'sh-char-09', 'shadow'));

  // No Nazgûl anywhere → nothing to move, so it stays off the menu.
  const s2 = board();
  s2.fellowship.progress = 2;
  for (const r of Object.values(s2.regions)) r.nazgul = 0;
  check('unplayable with no Nazgûl on the map', !canPlayCard(s2, 'sh-char-09', 'shadow'));
}

// --- 3. a card-driven reveal moves the figure and resets Progress ------------------
{
  console.log('\n=== Nazgûl Search reveals: the Free Peoples must place the figure ===');
  const state = board();
  state.fellowship.location = 'hollin';
  state.fellowship.progress = 2;
  state.fellowship.hidden = true;
  state.regions['hollin'].nazgul = 1; // a Nazgûl is already with the Fellowship
  getHandler('sh-char-09').finalize(state, 'shadow', []);
  check('the Free Peoples are asked where the figure goes',
    state.pendingChoice?.kind === 'revealMove' && state.pendingChoice.owner === 'fp', JSON.stringify(state.pendingChoice));
  check('the Fellowship is still Hidden until that resolves', state.fellowship.hidden === true);
  check('Progress is untouched until that resolves', state.fellowship.progress === 2);

  const moves = wotrAdapter.legalActions(state, 'fp').filter((a) => a.kind === 'revealMove');
  check('reveal destinations are offered', moves.length > 0, `${moves.length} regions`);
  const dest = moves.find((a) => a.target !== 'hollin') ?? moves[0];
  const after = wotrAdapter.applyAction(state, dest, 'fp');
  check('the figure moved', after.fellowship.location === dest.target, `${after.fellowship.location} (asked for ${dest.target})`);
  check('Progress reset to 0', after.fellowship.progress === 0);
  check('the Fellowship is now Revealed', after.fellowship.hidden === false);

  // At Progress 0 there is nothing to move: the reveal lands immediately.
  const s2 = board();
  s2.fellowship.location = 'hollin';
  s2.fellowship.progress = 0;
  s2.regions['hollin'].nazgul = 1;
  getHandler('sh-char-09').finalize(s2, 'shadow', []);
  check('Progress 0 reveals in place with no prompt', s2.fellowship.hidden === false && s2.pendingChoice === null);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
