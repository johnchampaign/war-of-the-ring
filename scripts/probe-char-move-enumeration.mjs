#!/usr/bin/env vite-node
// probe-char-move-enumeration.mjs — the Character-die move enumerator.
//
// Found while replaying player report 602t5q4h2b1g4g0j ("I have a Nazgul (alone) in N
// anduin dale. I've played a [C] to move Nazgul to minas Tirith, but it won't let me
// pick that one"). The engine DID offer that move, so the report was answered
// elsewhere — but the replay showed the enumerator sitting on exactly 18 options with
// the cap at 18. `characterMoveOptions` filled one flat array and returned the moment
// it hit the cap, so the budget was spent by whichever pieces came first in region-key
// order; one more friendly Army region and the North Anduin Vale Nazgul would have had
// NO legal move in `legalActions` at all. For the AI that is a piece it can never move.
//
// The invariant: the cap may trim a piece's CHOICES, never remove a PIECE. Checked
// without re-implementing the candidate rules — the uncapped enumeration is the ground
// truth, and every piece in it must survive capping.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { characterMoveOptions, characterDestinations, moveCharacter, movableCharsAt } from '../src/engine/charMove.ts';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 4);
const MAX_ACTIONS = 20000;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const clone = (s) => JSON.parse(JSON.stringify(s));
const pieceKey = (m) => `${m.char}@${m.from}`;
const pieces = (opts) => new Set(opts.map(pieceKey));

// --- 1. the shape that nearly lost a piece ---------------------------------------
console.log('\n=== many Nazgûl groups: the cap trims choices, never a piece ===');
{
  const s = startGame(createGame({ seed: 11 }));
  // Eight separate Nazgûl groups — 8 pieces against a cap of 18. Under the old flat
  // early-exit only the first ~3 got any option at all.
  const nazRegions = ['north-anduin-vale', 'lorien', 'moria', 'dol-guldur', 'morannon',
    'minas-morgul', 'barad-dur', 'gorgoroth'];
  for (const r of nazRegions) s.regions[r].nazgul = 1;
  // …and several Shadow armies, so farTargets has more than it can hold.
  for (const r of ['morannon', 'minas-morgul', 'barad-dur', 'gorgoroth', 'dol-guldur', 'moria', 'osgiliath']) {
    s.regions[r].units = { sauron: { regular: 3, elite: 0 } };
  }
  const uncapped = characterMoveOptions(s, 'shadow', Infinity);
  const capped = characterMoveOptions(s, 'shadow', 18);
  const want = pieces(uncapped), got = pieces(capped);
  check(`${want.size} pieces have legal moves`, want.size >= 8, [...want].join(' '));
  const lost = [...want].filter((k) => !got.has(k));
  check('every one of them is still offered a move under the cap', lost.length === 0, lost.join(', '));
  check('the cap still bounds the list', capped.length <= Math.max(18, want.size), `${capped.length} options`);
  check('…and the uncapped list really was bigger', uncapped.length > capped.length, `${uncapped.length} vs ${capped.length}`);
  // Fairness: with 8 pieces and 18 slots nobody should be hogging.
  const perPiece = {};
  for (const m of capped) perPiece[pieceKey(m)] = (perPiece[pieceKey(m)] ?? 0) + 1;
  const counts = Object.values(perPiece);
  check('no piece is starved while another is fed', Math.min(...counts) >= 1,
    Object.entries(perPiece).map(([k, v]) => `${k}:${v}`).join(' '));
  check('the spread is even (max - min <= 1)', Math.max(...counts) - Math.min(...counts) <= 1,
    `min ${Math.min(...counts)} max ${Math.max(...counts)}`);
}

// --- 2. a Nazgûl can still be flown into a Stronghold its own Army besieges -------
console.log('\n=== the reported move is offered (Nazgûl -> besieged Minas Tirith) ===');
{
  const s = startGame(createGame({ seed: 11 }));
  const mt = s.regions['minas-tirith'];
  mt.units = { sauron: { regular: 7, elite: 1 } };
  mt.nazgul = 2; mt.besieged = true;
  mt.siegeBox = { units: { gondor: { regular: 4, elite: 1 } }, leaders: 1, nazgul: 0, characters: [] };
  s.regions['north-anduin-vale'].nazgul = 1;
  check('the board-click path offers it',
    characterDestinations(s, 'shadow', 'nazgul', 'north-anduin-vale').includes('minas-tirith'));
  const opts = characterMoveOptions(s, 'shadow', 18);
  check('and so does legalActions',
    opts.some((m) => m.char === 'nazgul' && m.from === 'north-anduin-vale' && m.to === 'minas-tirith'),
    JSON.stringify(opts.filter((m) => m.from === 'north-anduin-vale')));
}

// --- 3. over full games: no piece lost, and nothing offered is then refused -------
console.log(`\n=== ${GAMES} full games: piece survival + offer/apply agreement ===`);
{
  let states = 0, offers = 0, lostPieces = 0, refused = 0, biggest = 0;
  let lostExample = '', refusedExample = '';
  for (let g = 1; g <= GAMES; g++) {
    const rng = new Rng(g * 104729);
    let state = startGame(createGame({ seed: g * 104729 }));
    for (let n = 0; n < MAX_ACTIONS; n++) {
      if (wotrAdapter.result(state)) break;
      const actor = wotrAdapter.currentActor(state);
      if (!actor) break;
      const legal = wotrAdapter.legalActions(state, actor);
      if (!legal.length) break;

      // Compare capped vs uncapped for whichever side is acting.
      const uncapped = characterMoveOptions(state, actor, Infinity);
      if (uncapped.length) {
        states++;
        const capped = characterMoveOptions(state, actor, 18);
        biggest = Math.max(biggest, capped.length);
        const want = pieces(uncapped), got = pieces(capped);
        for (const k of want) {
          if (!got.has(k)) { lostPieces++; if (!lostExample) lostExample = `${k} (of ${want.size} pieces, ${uncapped.length} uncapped)`; }
        }
        // Everything OFFERED must be ACCEPTED — the offer/apply agreement the
        // stop-rule regression taught us to check.
        for (const m of capped) {
          offers++;
          if (!moveCharacter(clone(state), actor, m.char, m.from, m.to)) {
            refused++;
            if (!refusedExample) refusedExample = JSON.stringify(m);
          }
        }
      }
      state = wotrAdapter.applyAction(state, chooseAction(state, actor, legal, rng), actor);
    }
  }
  check(`exercised ${states} states / ${offers} offered character moves`, states > 200 && offers > 500, `${states} / ${offers}`);
  check('no piece with legal moves was dropped by the cap', lostPieces === 0, lostExample);
  check('every offered move is accepted by the engine', refused === 0, refusedExample);
  check('the capped list stayed bounded', biggest <= 40, `largest ${biggest}`);
}

// --- 4. the two enumerators agree with the apply path ----------------------------
console.log('\n=== characterDestinations agrees with moveCharacter (offer == accept) ===');
{
  const s = startGame(createGame({ seed: 5 }));
  s.regions['fangorn'].characters.push('gandalf-grey');
  s.characters.inPlay['gandalf-grey'] = 'fangorn';
  s.regions['minas-morgul'].nazgul = 2;
  let mismatch = 0, pairs = 0, firstBad = '';
  for (const [side, char, from] of [['fp', 'gandalf-grey', 'fangorn'], ['shadow', 'nazgul', 'minas-morgul']]) {
    const offered = new Set(characterDestinations(s, side, char, from));
    for (const to of Object.keys(s.regions)) {
      if (to === from) continue;
      pairs++;
      const accepted = moveCharacter(clone(s), side, char, from, to);
      if (offered.has(to) !== accepted) { mismatch++; if (!firstBad) firstBad = `${char} ${from}->${to}: offered=${offered.has(to)} accepted=${accepted}`; }
    }
    check(`${char} is offered somewhere`, offered.size > 0, `${offered.size} destinations`);
  }
  check(`all ${pairs} (from,to) pairs agree`, mismatch === 0, firstBad);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
