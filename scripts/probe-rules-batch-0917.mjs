#!/usr/bin/env vite-node
// probe-rules-batch-0917.mjs — two rules fixes from player reports.
//
// A. BALROG OF MORIA fires on a reveal, not only a declaration. Card text
//    (sh-char-17): "You may discard 'Balrog of Moria' to draw an additional Hunt tile
//    if the Fellowship moves into, out of, or through Moria while being DECLARED OR
//    REVEALED." The engine only asked on the declare path, so a Fellowship caught by
//    the Hunt while crossing Moria never faced the Balrog (report 3m4a0q4l643g1s2s).
// B. THE PALANTÍR OF ORTHANC's "any one Action die result and one Elven Ring" clause
//    no longer offers the Will of the West: the card has its own Will clause, so
//    paying this one with a Will die buys the same discard and an Elven Ring on top
//    (report 2r1d613t4d3l6631).
//
// A's cases:
//   1. revealed THROUGH Moria with the card on the table → the Shadow is asked;
//   2. the Shadow is asked BEFORE Moria's own Stronghold tile, and that tile still
//      draws once the card is answered (the Balrog must not be swallowed by D12);
//   3. revealed in place at Moria (no movement) → STILL asked: the Almanac adds
//      "or remains stationary in Moria while being revealed" to the card's own
//      wording, and says so explicitly ("although 'remains stationary' is not
//      mentioned, it also meets the condition … e.g. if the Fellowship is standing in
//      Moria and a card like 'Orc Patrol' causes the Fellowship to reveal there") —
//      player report 120x4a0f6n4k4m14;
//   4. card not on the table → not asked;
//   5. a declaration THROUGH Moria still asks (the original path, unbroken);
//   6. a declaration in place at Moria asks too ("if the Ring-bearers figure is
//      standing in Moria, the Free Peoples player may choose to declare there …
//      allowing the Shadow player to use the in play 'Balrog of Moria' card");
//   7. and a reveal with NO Progress at all — the case that never reaches the
//      placement step, so `beginReveal` has to fire the card itself.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { beginReveal } from '../src/engine/hunt.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A game with the Fellowship hidden at `at` with `progress` steps in hand, the Balrog
 *  on the Shadow table unless `balrog: false`, and a `revealMove` choice pending. */
function revealSetup({ at, progress, balrog = true }) {
  const state = startGame(createGame({ seed: 7 }));
  state.fellowship.location = at;
  state.fellowship.progress = progress;
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  if (balrog) state.cards.shadow.table.push('sh-char-17');
  state.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  return state;
}

const reveal = (state, target) => wotrAdapter.tryApplyAction(state, { kind: 'revealMove', target }, 'fp');

// Moria's neighbours, so the probe doesn't hard-code a map that may be re-cut.
const { REGIONS } = await import('../src/engine/data.ts');
const nextToMoria = REGIONS.moria.adjacency.filter((r) => REGIONS[r]);
const [sideA, sideB] = [nextToMoria[0], nextToMoria[1]];

// --- 1. revealed through Moria: the Shadow is asked ------------------------------
{
  console.log('\n=== revealed on a path through Moria ===');
  // Start next door to Moria and reveal INTO it: one step, so the path is [from, moria].
  const state = revealSetup({ at: sideA, progress: 1 });
  const res = reveal(state, 'moria');
  check('reveal accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('the Shadow is asked about the Balrog', after.pendingChoice?.kind === 'balrog',
    `kind=${after.pendingChoice?.kind}`);
  check('the SHADOW owns that choice', after.pendingChoice?.owner === 'shadow');
  check('the Fellowship is revealed at Moria', after.fellowship.hidden === false && after.fellowship.location === 'moria');
}

// --- 2. the card is asked first, and Moria's Stronghold tile still draws ----------
{
  console.log('\n=== the Balrog is asked first; the Stronghold tile follows ===');
  const state = revealSetup({ at: sideA, progress: 1 });
  const res = reveal(state, 'moria');
  const mid = res.ok ? res.state : state;
  const drawsBefore = (mid.hunt.draws ?? []).length;
  check('no Hunt tile drawn while the card is on the table', drawsBefore === 0, `draws=${drawsBefore}`);
  // Decline: the card stays, and Moria's own Stronghold tile is still owed.
  const no = wotrAdapter.tryApplyAction(mid, { kind: 'balrog', use: false }, 'shadow');
  check('declining accepted', no.ok, no.ok ? '' : no.error);
  const declined = no.ok ? no.state : mid;
  check('the card stays on the table', declined.cards.shadow.table.includes('sh-char-17'));
  check('Moria\'s Stronghold tile was drawn after the answer', (declined.hunt.draws ?? []).length >= 1,
    `draws=${(declined.hunt.draws ?? []).length}`);
  // Using it: the card is discarded and its own tile is drawn as well.
  const yes = wotrAdapter.tryApplyAction(mid, { kind: 'balrog', use: true }, 'shadow');
  check('using it accepted', yes.ok, yes.ok ? '' : yes.error);
  const used = yes.ok ? yes.state : mid;
  check('the card is discarded', !used.cards.shadow.table.includes('sh-char-17')
    && used.cards.shadow.discard.character.includes('sh-char-17'));
  check('at least the Balrog\'s own tile was drawn', (used.hunt.draws ?? []).length >= 1,
    `draws=${(used.hunt.draws ?? []).length}`);
}

// --- 3. revealed in place at Moria: stationary still counts -----------------------
{
  console.log('\n=== revealed in place at Moria (stationary) ===');
  const state = revealSetup({ at: 'moria', progress: 1 });
  const res = reveal(state, 'moria'); // target === location: zero steps
  check('reveal accepted', res.ok, res.ok ? '' : res.error);
  const after = res.ok ? res.state : state;
  check('the Shadow is asked', after.pendingChoice?.kind === 'balrog',
    `kind=${after.pendingChoice?.kind}`);
}

// --- 7. revealed at Moria with NO Progress: `beginReveal`'s own path --------------
{
  console.log('\n=== revealed at Moria with no Progress at all ===');
  const state = startGame(createGame({ seed: 7 }));
  state.fellowship.location = 'moria';
  state.fellowship.progress = 0;
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  state.cards.shadow.table.push('sh-char-17');
  beginReveal(state);
  check('the Fellowship is revealed in place', !state.fellowship.hidden && state.fellowship.location === 'moria');
  check('the Shadow is asked', state.pendingChoice?.kind === 'balrog', `kind=${state.pendingChoice?.kind}`);

  // …and not when the card is elsewhere, or the Fellowship is elsewhere.
  const noCard = startGame(createGame({ seed: 7 }));
  noCard.fellowship.location = 'moria'; noCard.fellowship.progress = 0; noCard.fellowship.hidden = true; noCard.fellowship.mordor = null;
  beginReveal(noCard);
  check('no card, no question', noCard.pendingChoice?.kind !== 'balrog', `kind=${noCard.pendingChoice?.kind}`);

  const elsewhere = startGame(createGame({ seed: 7 }));
  elsewhere.fellowship.location = sideA; elsewhere.fellowship.progress = 0; elsewhere.fellowship.hidden = true; elsewhere.fellowship.mordor = null;
  elsewhere.cards.shadow.table.push('sh-char-17');
  beginReveal(elsewhere);
  check('revealed outside Moria, no question', elsewhere.pendingChoice?.kind !== 'balrog', `kind=${elsewhere.pendingChoice?.kind}`);

  // An ALREADY-revealed Fellowship standing in Moria is not being revealed at all.
  const already = startGame(createGame({ seed: 7 }));
  already.fellowship.location = 'moria'; already.fellowship.progress = 0; already.fellowship.hidden = false; already.fellowship.mordor = null;
  already.cards.shadow.table.push('sh-char-17');
  beginReveal(already);
  check('an already-revealed Fellowship is not a reveal', already.pendingChoice?.kind !== 'balrog', `kind=${already.pendingChoice?.kind}`);
}

// --- 4. the card is not on the table ---------------------------------------------
{
  console.log('\n=== the card is not in play ===');
  const state = revealSetup({ at: sideA, progress: 1, balrog: false });
  const res = reveal(state, 'moria');
  const after = res.ok ? res.state : state;
  check('the Balrog is NOT asked', after.pendingChoice?.kind !== 'balrog',
    `kind=${after.pendingChoice?.kind}`);
}

// --- 5 & 6. the declaration path, unbroken ---------------------------------------
{
  console.log('\n=== declaring through Moria asks; so does declaring in place ===');
  const decl = (at, progress, target) => {
    const state = startGame(createGame({ seed: 7 }));
    state.phase = 'fellowship';
    state.fellowship.location = at;
    state.fellowship.progress = progress;
    state.fellowship.hidden = true;
    state.fellowship.mordor = null;
    state.cards.shadow.table.push('sh-char-17');
    return wotrAdapter.tryApplyAction(state, { kind: 'declareFellowship', target }, 'fp');
  };
  const through = decl(sideA, 1, 'moria');
  check('declaring into Moria accepted', through.ok, through.ok ? '' : through.error);
  check('the Shadow is asked', through.ok && through.state.pendingChoice?.kind === 'balrog',
    `kind=${through.ok ? through.state.pendingChoice?.kind : 'n/a'}`);

  const inPlace = decl('moria', 1, 'moria');
  check('declaring in place accepted', inPlace.ok, inPlace.ok ? '' : inPlace.error);
  check('the Shadow is asked there too', inPlace.ok && inPlace.state.pendingChoice?.kind === 'balrog',
    `kind=${inPlace.ok ? inPlace.state.pendingChoice?.kind : 'n/a'}`);

  // …and a declaration in place ANYWHERE ELSE still leaves the card on the table.
  const restingElsewhere = decl(sideA, 0, sideA);
  check('declaring in place outside Moria accepted', restingElsewhere.ok, restingElsewhere.ok ? '' : restingElsewhere.error);
  check('the Balrog is NOT asked', restingElsewhere.ok && restingElsewhere.state.pendingChoice?.kind !== 'balrog',
    `kind=${restingElsewhere.ok ? restingElsewhere.state.pendingChoice?.kind : 'n/a'}`);
}

console.log(`  (Moria's neighbours used: ${sideA}, ${sideB})`);

// --- B. the Palantír's plain-die clause never spends a Will of the West -----------
{
  console.log('\n=== The Palantír of Orthanc: the Will die is not offered for the Ring clause ===');
  const { fpForceDiscardMethods } = await import('../src/engine/persistent.ts');
  const { dieOptions } = await import('../src/play/actionText.ts');

  /** The Palantír on the Shadow table, an FP Elven Ring in hand, and `dice` in the pool. */
  const palantir = (dice) => {
    const state = startGame(createGame({ seed: 11 }));
    state.cards.shadow.table.push('sh-char-21');
    state.dice.fp = dice;
    state.flags.fpUsedElvenRingThisTurn = false;
    if (!state.elvenRings.includes('fp')) state.elvenRings[0] = 'fp';
    return state;
  };

  const both = palantir(['will', 'army']);
  const m1 = fpForceDiscardMethods(both, 'sh-char-21');
  check('with a Will AND a plain die, both clauses are offered', m1.includes('will') && m1.includes('ring'),
    JSON.stringify(m1));
  const opts = dieOptions({ kind: 'forceDiscardCard', cardId: 'sh-char-21', via: 'ring' }, both, 'fp');
  check('the Ring clause offers the Army die only', opts.length === 1 && opts[0] === 'army', JSON.stringify(opts));
  const willOpts = dieOptions({ kind: 'forceDiscardCard', cardId: 'sh-char-21', via: 'will' }, both, 'fp');
  check('the Will clause still offers the Will die', willOpts.join() === 'will', JSON.stringify(willOpts));

  const willOnly = palantir(['will']);
  const m2 = fpForceDiscardMethods(willOnly, 'sh-char-21');
  check('with ONLY a Will die, the Ring clause is not offered at all', m2.join() === 'will', JSON.stringify(m2));
  const forced = wotrAdapter.tryApplyAction(
    { ...willOnly, phase: 'actionResolution', currentPlayer: 'fp' },
    { kind: 'forceDiscardCard', cardId: 'sh-char-21', via: 'ring' }, 'fp');
  check('and the engine refuses it outright', !forced.ok, forced.ok ? 'accepted!' : forced.error);

  const plainOnly = palantir(['army']);
  const m3 = fpForceDiscardMethods(plainOnly, 'sh-char-21');
  check('with only a plain die, only the Ring clause is offered', m3.join() === 'ring', JSON.stringify(m3));
}

console.log(failures ? `\nprobe-rules-batch-0917: ${failures} FAILURE(S)` : '\nprobe-rules-batch-0917 OK');
process.exit(failures ? 1 : 0);
