#!/usr/bin/env vite-node
// probe-block-hint-window.mjs — player report 5f3q6k1f20650635, 2026-09-10:
//
//   "The musterBlockReason, moveBlockReason and such thingys are active even outside
//    the window of time when they apply during the Action Resolution phase… if the
//    Fellowship is revealed and the player is prompted to place the Ring-bearers
//    figure, clicking on an unconquered Free Peoples Stronghold that is besieged by an
//    enemy Army causes this misleading error message: 'There is an enemy Army in
//    {region}'. While it's true that one cannot reveal into a region containing an
//    unconquered Free Peoples City or Stronghold, the placement wasn't blocked for the
//    reason stated."
//
// Two halves, and BOTH matter:
//  1. the reported situation really does produce that misleading sentence, so the gate
//     is suppressing something real rather than dead code;
//  2. the gate is closed in every flow that is not a basic Move / Muster action, and
//     open in the ones that are.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { musterBlockReason, moveBlockReason } from '../src/engine/armies.ts';
import { basicMoveHintsApply } from '../src/play/blockHints.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The reported board: Minas Tirith unconquered but besieged — the Shadow holds the
 *  open field, the Gondor garrison is in the siege box. */
function besiegedMinasTirith() {
  const s = startGame(createGame({ seed: 9 }));
  const r = s.regions['minas-tirith'];
  r.units = { sauron: { regular: 6, elite: 1 } };
  r.leaders = 0;
  r.nazgul = 1;
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: 3, elite: 1 } }, leaders: 1, nazgul: 0, characters: [] };
  return s;
}

console.log('\n=== 1. the misleading sentence is genuinely there to suppress ===');
{
  const s = besiegedMinasTirith();
  const reason = musterBlockReason(s, 'minas-tirith', 'fp');
  check('musterBlockReason still blames the besieging Army', reason === 'There is an enemy Army in Minas Tirith.', String(reason));
  // …and the Fellowship genuinely cannot reveal there, for a completely different
  // reason — which is why printing the muster rule was misleading rather than merely
  // redundant.
  check('Minas Tirith is an unconquered Free Peoples Stronghold',
    s.regions['minas-tirith'].control === null, String(s.regions['minas-tirith'].control));
}

console.log('\n=== 2. the hint window is CLOSED outside the basic Move / Muster action ===');
{
  const s = besiegedMinasTirith();
  s.phase = 'actionResolution';
  const shut = [
    ['placing the Ring-bearers after a reveal', { owner: 'fp', kind: 'revealMove', data: {} }],
    ['choosing where a Companion separates to', { owner: 'fp', kind: 'separateMove', data: {} }],
    ['an Event card picking its targets', { owner: 'fp', kind: 'eventTarget', data: {} }],
    ['allocating combat casualties', { owner: 'fp', kind: 'casualties', data: {} }],
    ['answering Hunt damage', { owner: 'fp', kind: 'huntDamage', data: {} }],
  ];
  for (const [label, pc] of shut) {
    s.pendingChoice = pc;
    check(`closed while ${label}`, !basicMoveHintsApply(s));
  }
  // Outside Action Resolution entirely — the Fellowship phase's declare is a map click too.
  s.pendingChoice = null;
  for (const phase of ['setup', 'recover', 'fellowship', 'huntAllocation', 'actionRoll']) {
    s.phase = phase;
    check(`closed during the ${phase} phase`, !basicMoveHintsApply(s));
  }
  check('closed for a missing view', !basicMoveHintsApply(null));
}

console.log('\n=== 3. …and OPEN for the basic Move / Muster action it belongs to ===');
{
  const s = besiegedMinasTirith();
  s.phase = 'actionResolution';
  s.pendingChoice = null;
  check('open for a plain Action Resolution map click', basicMoveHintsApply(s));
  // The optional second army move and the Character die's move chain are the SAME
  // basic action continued on the same die, so the hint still belongs there.
  s.pendingChoice = { owner: 'shadow', kind: 'armyMove2', data: {} };
  check('open while continuing an Army die (armyMove2)', basicMoveHintsApply(s));
  s.pendingChoice = { owner: 'shadow', kind: 'charMove2', data: { chars: [], movedNazgul: {} } };
  check('open while continuing a Character die (charMove2)', basicMoveHintsApply(s));
}

console.log('\n=== 4. the hints themselves are untouched inside the window ===');
{
  // The originally-reported muster case ("I can't muster in Lorien while it is empty")
  // and a refused merge must still explain themselves.
  const s = startGame(createGame({ seed: 9 }));
  s.phase = 'actionResolution';
  s.pendingChoice = null;
  check('window is open', basicMoveHintsApply(s));
  const notAtWar = musterBlockReason(s, 'lorien', 'fp');
  check('a not-At-War Nation still explains itself', !!notAtWar && /At War/.test(notAtWar), String(notAtWar));
  const nonAdj = moveBlockReason(s, 'minas-tirith', 'the-shire', 'fp');
  check('a non-adjacent move still explains itself', nonAdj === 'Those regions are not adjacent.', String(nonAdj));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
