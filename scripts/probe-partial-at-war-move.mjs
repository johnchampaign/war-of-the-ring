#!/usr/bin/env vite-node
// probe-partial-at-war-move.mjs — a mixed Army whose Nations sit on different steps of
// the Political Track can still move: the At-War units go, the rest stay.
//
// Player report 615m5q0t090g205d: "The Army in Vale of the Carnen cannot move into East
// Rhûn. That's half correct — only some of the figures in that Army are at War ... the
// board hint does say 'split off only its At-War units', but that's not how Army
// movement works in the UI. I have to select the destination first."
//
// p.27 lets a player move "all or some of the units" of an Army, so the destination
// enumerator has to ask the PERMISSIVE question (can ANY of this stack go?) and the
// strict one is applied to whoever actually travels. The board lights East Rhûn, a bare
// whole-army move takes the Elves and leaves the North standing, and a selection that
// names the North is still refused.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { canMoveArmy, canMoveSomeArmy, moveBlockReason, partialMoveBlockReason, nationsAllowedInto, moveArmy, moveArmySplit } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// Vale of the Carnen (no Nation) holds an Elven/North stack; East Rhûn is a Southrons &
// Easterlings region, so only a Nation At War may cross into it.
const base = () => {
  const s = startGame(createGame({ seed: 7 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['army']; s.dice.shadow = [];
  s.nations.elves.active = true; s.nations.elves.step = 0;   // At War
  s.nations.north.active = true; s.nations.north.step = 2;   // still on the road
  const r = s.regions['vale-of-the-carnen'];
  r.units = { elves: { regular: 2, elite: 1 }, north: { regular: 3, elite: 0 } };
  r.leaders = 1; r.characters = [];
  s.regions['east-rhun'].units = {}; s.regions['east-rhun'].leaders = 0; s.regions['east-rhun'].nazgul = 0;
  s.regions['east-rhun'].characters = [];
  return s;
};

console.log('\n=== the board lights a destination only the At-War half can reach ===');
{
  const s = base();
  check('the whole stack may NOT go (strict)', !canMoveArmy(s, 'vale-of-the-carnen', 'east-rhun', 'fp'));
  check('but part of it may (permissive)', canMoveSomeArmy(s, 'vale-of-the-carnen', 'east-rhun', 'fp'), partialMoveBlockReason(s, 'vale-of-the-carnen', 'east-rhun', 'fp') ?? 'null');
  const allowed = nationsAllowedInto(s, 'vale-of-the-carnen', 'east-rhun', 'fp');
  check('only the Elves are allowed across', allowed.join(',') === 'elves', allowed.join(','));
  const acts = wotrAdapter.legalActions(s, 'fp');
  const lit = acts.some((a) => a.kind === 'moveArmy' && a.from === 'vale-of-the-carnen' && a.to === 'east-rhun');
  check('the move is offered', lit);
}

console.log('\n=== a bare whole-army move takes the At-War half and leaves the rest ===');
{
  const s = base();
  const next = wotrAdapter.applyAction(s, { kind: 'moveArmy', from: 'vale-of-the-carnen', to: 'east-rhun', die: 'army' }, 'fp');
  const src = next.regions['vale-of-the-carnen'], dst = next.regions['east-rhun'];
  check('the Elves marched', (dst.units.elves?.regular ?? 0) === 2 && (dst.units.elves?.elite ?? 0) === 1, JSON.stringify(dst.units));
  check('no Elves left behind', !src.units.elves, JSON.stringify(src.units));
  check('the North stayed', (src.units.north?.regular ?? 0) === 3 && !dst.units.north, JSON.stringify({ src: src.units, dst: dst.units }));
  check('the Leader went with the movers', dst.leaders === 1 && src.leaders === 0, `${src.leaders}/${dst.leaders}`);
  const said = next.log.some((e) => (e.msg ?? '').includes('not At War and stayed'));
  check('the log says why the North stayed', said, JSON.stringify(next.log.slice(-3).map((e) => e.msg)));
}

console.log('\n=== a selection that names the not-At-War Nation is still refused ===');
{
  const s = base();
  const sel = { units: { elves: { regular: 2, elite: 1 }, north: { regular: 3 } }, leaders: 1 };
  check('moveArmySplit refuses it', !moveArmySplit(structuredClone(s), 'vale-of-the-carnen', 'east-rhun', 'fp', sel, false));
  let msg = '';
  try { wotrAdapter.applyAction(s, { kind: 'moveArmy', from: 'vale-of-the-carnen', to: 'east-rhun', die: 'army', move: sel }, 'fp'); }
  catch (e) { msg = e.message; }
  check('the refusal names the North', msg.includes('not At War'), msg);
}

console.log('\n=== a stack with NO At-War Nation still cannot go ===');
{
  const s = base();
  s.nations.elves.step = 2; // nobody At War
  check('strict refuses', !canMoveArmy(s, 'vale-of-the-carnen', 'east-rhun', 'fp'));
  check('permissive refuses too', !canMoveSomeArmy(s, 'vale-of-the-carnen', 'east-rhun', 'fp'));
  const why = partialMoveBlockReason(s, 'vale-of-the-carnen', 'east-rhun', 'fp');
  check('and it says why', !!why && why.includes('not At War'), why ?? 'null');
  check('moveArmy refuses', !moveArmy(structuredClone(s), 'vale-of-the-carnen', 'east-rhun', 'fp'));
  const acts = wotrAdapter.legalActions(s, 'fp');
  check('the board does not light it', !acts.some((a) => a.kind === 'moveArmy' && a.from === 'vale-of-the-carnen' && a.to === 'east-rhun'));
}

console.log('\n=== a move inside no-Nation / own borders is untouched ===');
{
  const s = base();
  // Vale of the Carnen -> Dale, a NORTH region: the North's own units may always enter
  // their own Nation's borders and the Elves are At War, so the whole stack goes.
  s.regions['dale'].units = {}; s.regions['dale'].leaders = 0; s.regions['dale'].characters = [];
  check('the whole stack may go to Dale', canMoveArmy(s, 'vale-of-the-carnen', 'dale', 'fp'), moveBlockReason(s, 'vale-of-the-carnen', 'dale', 'fp') ?? 'null');
  const next = wotrAdapter.applyAction(s, { kind: 'moveArmy', from: 'vale-of-the-carnen', to: 'dale', die: 'army' }, 'fp');
  check('everyone marched', (next.regions['dale'].units.north?.regular ?? 0) === 3 && (next.regions['dale'].units.elves?.regular ?? 0) === 2, JSON.stringify(next.regions['dale'].units));
  check('nothing stayed', Object.keys(next.regions['vale-of-the-carnen'].units).length === 0, JSON.stringify(next.regions['vale-of-the-carnen'].units));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
