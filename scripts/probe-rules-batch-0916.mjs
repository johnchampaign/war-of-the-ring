#!/usr/bin/env vite-node
// probe-rules-batch-0916.mjs — four rules fixes from player reports.
//
// 1. Drúadan Forest is a Gondor region (Almanac, "Boromir … Gondor region … Drúadan
//    Forest, Erech, or Anfalas"), so a not-At-War Rohan Army cannot enter it
//    (report 4h564p406i0b6l11).
// 2. A revealed Fellowship may not END in a Free Peoples City/Stronghold the Free
//    Peoples control — but a captured Shadow Stronghold like Moria is not one
//    (rulebook p.39; report 51605i2q17082f2s).
// 3. Book of Mazarbul does not rouse the Dwarves from a CAPTURED Erebor / Ered Luin
//    (Almanac; report 3a3e73174f1m1s4b).
// 4. Stormcrow: when several Nations qualify, the Shadow player chooses
//    (Almanac; report 2r3060480g063o5c).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { moveBlockReason } from '../src/engine/armies.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = (side, face = 'event') => {
  const s = startGame(createGame({ seed: 23 }));
  s.phase = 'actionResolution'; s.currentPlayer = side; s.pendingChoice = null;
  s.dice.shadow = side === 'shadow' ? [face] : []; s.dice.fp = side === 'fp' ? [face] : [];
  return s;
};
const legal = (s, side) => wotrAdapter.legalActions(s, side);
const play = (s, side, cardId) => {
  s.cards[side].hand = [cardId];
  const a = legal(s, side).find((x) => x.kind === 'playEvent' && x.cardId === cardId);
  return a ? wotrAdapter.applyAction(s, { ...a, die: 'event' }, side) : null;
};
const placeCompanion = (s, c, region) => {
  s.fellowship.companions = s.fellowship.companions.filter((x) => x !== c);
  s.characters.inPlay[c] = region;
  s.regions[region].characters.push(c);
};

console.log('\n=== 1. Drúadan Forest belongs to Gondor ===');
{
  check('the map says so', REGIONS['druadan-forest'].nation === 'gondor');
  const s = board('fp', 'army');
  s.nations.rohan.step = 2; s.nations.rohan.active = true;
  s.regions['folde'].units = { rohan: { regular: 2, elite: 0 } };
  s.regions['druadan-forest'].units = {};
  const why = moveBlockReason(s, 'folde', 'druadan-forest', 'fp');
  check('a not-At-War Rohan Army may not enter it', !!why && why.includes('not At War'), why ?? 'null');
  const offered = legal(s, 'fp').some((a) => a.kind === 'moveArmy' && a.from === 'folde' && a.to === 'druadan-forest');
  check('and the move is not offered', !offered);
}

console.log('\n=== 2. revealing into a captured Shadow Stronghold ===');
{
  const s = board('fp');
  s.fellowship.location = 'hollin'; s.fellowship.progress = 2;
  s.regions['moria'].control = 'fp'; s.regions['moria'].units = { north: { regular: 1, elite: 0 } };
  s.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  const targets = legal(s, 'fp').filter((a) => a.kind === 'revealMove').map((a) => a.target);
  check('Moria (captured by the Free Peoples) is offered', targets.includes('moria'), targets.join(','));
  check('Rivendell (an unconquered Elven Stronghold) is not', !targets.includes('rivendell'), targets.join(','));
}

console.log('\n=== 3. Book of Mazarbul needs an uncaptured Erebor ===');
for (const captured of [false, true]) {
  let s = board('fp');
  s.nations.dwarves.step = 2; s.nations.dwarves.active = false;
  placeCompanion(s, 'gimli', 'erebor');
  if (captured) { s.regions['erebor'].control = 'shadow'; s.regions['erebor'].units = { sauron: { regular: 1, elite: 0 } }; }
  else s.regions['erebor'].control = undefined;
  s = play(s, 'fp', 'fp-str-04');
  check(`the card is playable (${captured ? 'captured' : 'uncaptured'} Erebor)`, !!s);
  if (s) {
    const dw = s.nations.dwarves;
    check(captured ? 'the Dwarves stay where they were' : 'the Dwarves go to War',
      captured ? dw.step === 2 && !dw.active : dw.step === 0 && dw.active, JSON.stringify(dw));
  }
}

console.log('\n=== 4. Stormcrow lets the Shadow choose the Nation ===');
{
  let s = board('shadow');
  s.nations.elves.step = 2; s.nations.dwarves.step = 2;
  s.fellowship.location = 'rivendell';
  placeCompanion(s, 'gimli', 'erebor');
  s = play(s, 'shadow', 'sh-str-06');
  check('the card is playable and asks', !!s && s.pendingChoice?.kind === 'eventTarget', s?.pendingChoice?.kind ?? 'not playable');
  const opts = s ? legal(s, 'shadow').filter((a) => a.kind === 'eventTarget' && !a.done).map((a) => a.nation) : [];
  check('both Elves and Dwarves are offered', opts.includes('elves') && opts.includes('dwarves'), opts.join(','));
  check('with no Done', s ? !legal(s, 'shadow').some((a) => a.kind === 'eventTarget' && a.done) : false);
  const pick = s && legal(s, 'shadow').find((a) => a.kind === 'eventTarget' && a.nation === 'dwarves');
  if (pick) {
    s = wotrAdapter.applyAction(s, pick, 'shadow');
    check('the Dwarves go back one step', s.nations.dwarves.step === 3, String(s.nations.dwarves.step));
    check('the Elves are untouched', s.nations.elves.step === 2, String(s.nations.elves.step));
    check('the Free Peoples then choose a Dwarven loss', s.pendingChoice?.kind === 'stormcrowLoss' && s.pendingChoice.data.nation === 'dwarves', JSON.stringify(s.pendingChoice));
    const loss = legal(s, 'fp').find((a) => a.kind === 'stormcrowLoss');
    if (loss) { s = wotrAdapter.applyAction(s, loss, 'fp'); check('and the choice clears', s.pendingChoice === null, JSON.stringify(s.pendingChoice)); }
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
