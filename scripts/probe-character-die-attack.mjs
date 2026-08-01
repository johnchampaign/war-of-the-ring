#!/usr/bin/env vite-node
// probe-character-die-attack.mjs — the Character Action die's army action (rulebook p.28):
// "A player using a Character Action die result can move a single Army containing at least
// one Leader or Character" and "An Army using a Character Action die result to make an
// attack must contain at least one Leader or Character."
//
// Two things make Orthanc special, and the engine used to get both wrong (player report:
// "I spent a [C] to attack from Orthanc. It wouldn't let me, even tho Saruman and 2 elites
// (leaders) were present"):
//   * Saruman's card — "Servants of the White Hand. Each Isengard Elite unit is considered
//     to be a Leader as well as an Army unit for all movement and combat purposes." So an
//     Isengard Elite leads a Character-die army action all by itself.
//   * Saruman himself "cannot leave Orthanc", which rules him out as the figure that joins
//     a Character-die MOVE — but not an attack, because "attacking units do not actually
//     move into the region they are attacking" (p.28).
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { attackError } from '../src/engine/combat.ts';
import { moveArmySplit } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const ORTHANC = 'orthanc', TARGET = 'gap-of-rohan'; // adjacent per the map data

/** A bare board with an Isengard army in Orthanc and a Rohan army next door, both At War,
 *  and the Shadow holding exactly one Character die. */
function board({ regular = 2, elite = 0, saruman = true } = {}) {
  const state = startGame(createGame({ seed: 7 }));
  for (const r of Object.values(state.regions)) {
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
    delete r.siegeBox; r.besieged = false;
  }
  for (const n of ['isengard', 'rohan', 'sauron']) { state.nations[n].step = 0; state.nations[n].active = true; }
  state.regions[ORTHANC].units = { isengard: { regular, elite } };
  state.regions[TARGET].units = { rohan: { regular: 2, elite: 0 } };
  if (saruman) {
    state.regions[ORTHANC].characters = ['saruman'];
    state.characters.inPlay['saruman'] = ORTHANC;
    if (!state.characters.entered.includes('saruman')) state.characters.entered.push('saruman');
  }
  state.phase = 'actionResolution';
  state.currentPlayer = 'shadow';
  state.pendingChoice = null;
  state.dice.shadow = ['character'];
  state.dice.fp = [];
  return state;
}

const shadowActions = (state) => wotrAdapter.legalActions(state, 'shadow');
const offers = (state, kind) => shadowActions(state).some((a) => a.kind === kind && a.from === ORTHANC);

// --- 1. The reported case: Saruman + 2 Isengard Elites -------------------------------
{
  console.log('\n=== Saruman and two Isengard Elites in Orthanc ===');
  const state = board({ regular: 0, elite: 2 });
  check('the Character die offers the attack', offers(state, 'attack'));
  check('attackError accepts it', attackError(state, ORTHANC, 'shadow', undefined, true) === null,
    attackError(state, ORTHANC, 'shadow', undefined, true) ?? '');
  check('the Elites also lead a Character-die move', offers(state, 'moveArmy'));
}

// --- 2. Saruman alone leads an attack, but not a move --------------------------------
{
  console.log('\n=== Saruman with Regulars only (no Elite Leaders) ===');
  const state = board({ regular: 3, elite: 0 });
  check('the attack is offered — the army never leaves the region', offers(state, 'attack'));
  check('attackError accepts it', attackError(state, ORTHANC, 'shadow', undefined, true) === null,
    attackError(state, ORTHANC, 'shadow', undefined, true) ?? '');
  check('the MOVE is refused — Saruman cannot leave Orthanc', !offers(state, 'moveArmy'));
}

// --- 3. No Saruman: plain Isengard Elites are not Leaders ----------------------------
{
  console.log('\n=== Isengard Elites with Saruman not in play ===');
  const state = board({ regular: 0, elite: 2, saruman: false });
  check('no Character-die attack', !offers(state, 'attack'));
  check('attackError rejects it', attackError(state, ORTHANC, 'shadow', undefined, true) !== null);
  check('no Character-die move', !offers(state, 'moveArmy'));
  // ...but an Army die still attacks perfectly well.
  state.dice.shadow = ['army'];
  check('an Army die still offers the attack', offers(state, 'attack'));
}

// --- 4. A Character-die attack that splits must keep a Leader in the attacking force --
{
  console.log('\n=== rearguard splits ===');
  const state = board({ regular: 1, elite: 1 });
  // Hold BOTH the Elite Leader and Saruman back: the attacking force is a lone Regular.
  const err = attackError(state, ORTHANC, 'shadow', { units: { isengard: { regular: 0, elite: 1 } }, characters: ['saruman'] }, true);
  check('an unled attacking force is refused', err !== null, err ?? 'accepted');
  // Hold the Elite back but let Saruman lead the attack out of his own Stronghold.
  const withSaruman = attackError(state, ORTHANC, 'shadow', { units: { isengard: { regular: 0, elite: 1 } } }, true);
  check('Saruman alone can lead it', withSaruman === null, withSaruman ?? '');
  // Leave the Regular behind instead: the Elite Leader attacks, Saruman stays home.
  const ok = attackError(state, ORTHANC, 'shadow', { units: { isengard: { regular: 1, elite: 0 } }, characters: ['saruman'] }, true);
  check('the Elite alone can lead it', ok === null, ok ?? '');
}

// --- 5. A Character-die SPLIT move may march out on an Elite alone --------------------
{
  console.log('\n=== a Character-die split move led by an Isengard Elite ===');
  const state = board({ regular: 1, elite: 1 });
  const moved = moveArmySplit(state, ORTHANC, 'fords-of-isen', 'shadow',
    { units: { isengard: { regular: 0, elite: 1 } } }, true);
  check('the Elite marches out on its own leadership', moved === true);
  check('Saruman stayed in Orthanc', state.regions[ORTHANC].characters.includes('saruman'));

  const state2 = board({ regular: 2, elite: 0 });
  const moved2 = moveArmySplit(state2, ORTHANC, 'fords-of-isen', 'shadow',
    { units: { isengard: { regular: 1, elite: 0 } }, characters: ['saruman'] }, true);
  check('a Regular-only split is refused — Saruman cannot join it', moved2 === false);
}

console.log(failures === 0 ? '\nprobe-character-die-attack: all checks passed' : `\nprobe-character-die-attack: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
