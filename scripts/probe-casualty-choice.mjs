#!/usr/bin/env vite-node
// probe-casualty-choice.mjs — PER-CASUALTY ALLOCATION (rulebook p.30).
//
//   "For each hit, remove one Regular, OR replace one Elite with a Regular.
//    Alternatively, for every TWO hits, you may remove one Elite."
//
// This used to be a single regularsFirst/elitesFirst PLAN applied to the whole batch,
// which cannot express a mixed allocation. The reporter's case: besieging with
// {3R,3E} and taking 3 hits, they wanted to end on {2R,2E} — keeping an Elite to press
// the assault AND 4 dice — which neither all-regulars ({3E}, 3 dice) nor all-elites
// ({6R}, no Elite) allows. The "two hits for one Elite" option did not exist at all.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { casualtyOptions, queueOrApplyEventCasualties, resolveCasualtyStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const count = (f) => Object.values(f.units).reduce((a, u) => a + u.regular + u.elite, 0);
const shape = (f) => JSON.stringify(f.units);

function board() {
  const s = startGame(createGame({ seed: 4 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  return s;
}
/** Park an eventCasualties choice on a region holding `units`, then allocate. */
function armed(units, hits, side = 'shadow') {
  const s = board();
  s.regions['moria'].units = units;
  queueOrApplyEventCasualties(s, side, 'moria', hits);
  return s;
}

// --- the options the rules allow ---------------------------------------------------
{
  console.log('\n=== the three allocations of p.30 are offered ===');
  const f = { units: { sauron: { regular: 3, elite: 3 } }, leaders: 0, nazgul: 0, characters: [] };
  const three = casualtyOptions(f, 3).map((o) => o.step);
  check('remove a Regular (1 hit)', three.includes('removeRegular'));
  check('reduce an Elite to a Regular (1 hit)', three.includes('reduceElite'));
  check('remove an Elite outright (2 hits)', three.includes('removeElite'));
  const one = casualtyOptions(f, 1).map((o) => o.step);
  check('with a single hit, the 2-hit Elite removal is NOT offered', !one.includes('removeElite'), one.join(', '));
  const perNation = casualtyOptions({ units: { sauron: { regular: 1, elite: 0 }, isengard: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] }, 1);
  check('which Nation loses the figure is part of the choice', perNation.length === 2, perNation.map((o) => o.nation).join(', '));
}

// --- the reporter's siege: {3R,3E} takes 3 hits -> 1R + 1E, ending {2R,2E} ---------
{
  console.log("\n=== the reporter's case: 3 hits on {3R,3E} can end {2R,2E} ===");
  const s = armed({ sauron: { regular: 3, elite: 3 } }, 3);
  check('the owner is asked (it is a real choice)', s.pendingChoice?.kind === 'eventCasualties', s.pendingChoice?.kind ?? 'none');
  resolveCasualtyStep(s, 'removeRegular', 'sauron');   // 1 hit
  resolveCasualtyStep(s, 'removeElite', 'sauron');     // 2 hits -> 3 total
  const f = s.regions['moria'];
  check('ends on 2 Regulars + 2 Elites', f.units.sauron?.regular === 2 && f.units.sauron?.elite === 2, shape(f));
  check('4 units left, so 4 Combat dice', count(f) === 4);
  check('an Elite survives to press the assault', (f.units.sauron?.elite ?? 0) > 0);
  check('the choice is finished', s.pendingChoice === null, s.pendingChoice?.kind ?? 'none');
  check('Shadow figures recycled to reinforcements', s.reinforcements.sauron.regular > 0 && s.reinforcements.sauron.elite > 0);
}

// --- the two old plans are still reachable, one step at a time ---------------------
{
  console.log('\n=== the old all-or-nothing outcomes are still reachable ===');
  const a = armed({ sauron: { regular: 3, elite: 3 } }, 3);
  for (let i = 0; i < 3; i++) if (a.pendingChoice) resolveCasualtyStep(a, 'removeRegular', 'sauron');
  check('all-Regulars still gives {3E}', shape(a.regions['moria']) === JSON.stringify({ sauron: { regular: 0, elite: 3 } }), shape(a.regions['moria']));

  const b = armed({ sauron: { regular: 3, elite: 3 } }, 3);
  for (let i = 0; i < 3; i++) if (b.pendingChoice) resolveCasualtyStep(b, 'reduceElite', 'sauron');
  check('all-Elites still gives {6R}', shape(b.regions['moria']) === JSON.stringify({ sauron: { regular: 6, elite: 0 } }), shape(b.regions['moria']));
}

// --- forced allocations are never prompted ----------------------------------------
{
  console.log('\n=== a forced loss is applied without asking ===');
  const s = armed({ sauron: { regular: 2, elite: 0 } }, 2);   // only Regulars: no choice at all
  check('no prompt raised', !s.pendingChoice, s.pendingChoice?.kind ?? 'none');
  check('both Regulars are gone', count(s.regions['moria']) === 0, shape(s.regions['moria']));

  // One Elite and ONE hit: reducing it is the only legal step (2-hit removal needs 2).
  const t = armed({ sauron: { regular: 0, elite: 1 } }, 1);
  check('single forced Elite reduction is auto-applied', !t.pendingChoice && t.regions['moria'].units.sauron?.regular === 1, shape(t.regions['moria']));

  // But one Elite and TWO hits IS a choice: reduce twice, or remove outright.
  const u = armed({ sauron: { regular: 0, elite: 1 } }, 2);
  check('Elite + 2 hits is a genuine choice (reduce vs remove)', u.pendingChoice?.kind === 'eventCasualties', u.pendingChoice?.kind ?? 'none');
}

// --- 2 hits cannot wipe {1R,1E}: removing that Elite costs 2 hits by itself --------
{
  console.log('\n=== an Elite costs TWO hits to remove, so it can outlast the batch ===');
  const s = armed({ sauron: { regular: 1, elite: 1 } }, 2);
  while (s.pendingChoice) resolveCasualtyStep(s, 'removeRegular', 'sauron');
  check('one unit survives 2 hits', count(s.regions['moria']) === 1, shape(s.regions['moria']));
}

// --- a wiped Army still takes its Characters with it -------------------------------
{
  console.log('\n=== an Army destroyed by allocated hits loses its Characters (p.30) ===');
  // Forced path (no prompt): 2 Regulars, 2 hits.
  const a = board();
  a.regions['moria'].units = { sauron: { regular: 2, elite: 0 } };
  a.regions['moria'].characters = ['witch-king'];
  a.characters.inPlay['witch-king'] = 'moria';
  if (!a.characters.entered.includes('witch-king')) a.characters.entered.push('witch-king');
  queueOrApplyEventCasualties(a, 'shadow', 'moria', 2);
  check('[auto] the Army is gone', count(a.regions['moria']) === 0, shape(a.regions['moria']));
  check('[auto] the Witch-king is eliminated with it', a.characters.eliminated.includes('witch-king'));
  check('[auto] and no longer on the map', !a.characters.inPlay['witch-king']);

  // Prompted path: {1R,1E} needs 3 hits to clear (1 for the Regular, 2 for the Elite).
  const b = armed({ sauron: { regular: 1, elite: 1 } }, 3);
  b.regions['moria'].characters = ['mouth-of-sauron'];
  b.characters.inPlay['mouth-of-sauron'] = 'moria';
  if (!b.characters.entered.includes('mouth-of-sauron')) b.characters.entered.push('mouth-of-sauron');
  let guard = 0;
  while (b.pendingChoice && guard++ < 8) resolveCasualtyStep(b, 'removeRegular', 'sauron');
  check('[prompted] the Army is gone', count(b.regions['moria']) === 0, shape(b.regions['moria']));
  check('[prompted] the Mouth of Sauron is eliminated with it', b.characters.eliminated.includes('mouth-of-sauron'));
  check('[prompted] the loop terminated', guard < 8, `steps=${guard}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
