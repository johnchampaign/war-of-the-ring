#!/usr/bin/env vite-node
// probe-triage-1006.mjs — fixes from the 2026-10-06 report batch:
//
//  Walking Characters obey the Stronghold rules at EVERY step of a move, not just
//  the last one (report 3m2h093m3g6t2g2c). p.25: a Minion moving without an Army
//  "cannot be moved into a region containing a Stronghold controlled by the Free
//  Peoples unless it is besieged by a Shadow Army"; p.24/25: Companions and the Mouth
//  "can never leave or enter a region containing a friendly Stronghold besieged by an
//  enemy Army". The Mouth of Sauron used to walk Fords of Bruinen → Moria → Dimrill
//  Dale straight past a Free Peoples Moria.
//
//  Event cards recruit in FULL and the owner trims the excess afterwards (p.26 "at the
//  end of any action"; Almanac, Points common to all Free Peoples recruitment cards:
//  "first, fully perform the recruitment … and then remove units … to meet the
//  stacking limit of 5"). Guards of the Citadel into a full besieged Minas Tirith used
//  to do nothing (reports 9lksjgviw4ui2d3z, 4v3e2q1x564f0c3c).
import { wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { characterDestinations, moveCharacter, moveCompanionGroup, characterMoveBlockReason } from '../src/engine/charMove.ts';
import { separationDestinations } from '../src/engine/fellowship.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const adj = (a, b) => REGIONS[a].adjacency.includes(b);

{
  console.log('\n=== the Mouth of Sauron cannot walk through an unbesieged Free Peoples Moria ===');
  check('map: Moria lies between Fords of Bruinen side and Dimrill Dale', adj('moria', 'dimrill-dale'));
  const s = startGame(createGame({ seed: 7 }));
  // Clear Moria of any Shadow presence so it is a Free Peoples (Dwarven) Stronghold, unbesieged.
  // Moria is a Shadow Stronghold at setup; the reporter's Free Peoples had taken it.
  s.regions['moria'].units = { dwarves: { regular: 1, elite: 0 } }; s.regions['moria'].besieged = false;
  s.regions['moria'].siegeBox = undefined; s.regions['moria'].control = 'fp';
  s.regions['fords-of-bruinen'].characters.push('mouth-of-sauron');
  s.characters.inPlay['mouth-of-sauron'] = 'fords-of-bruinen';
  const dests = characterDestinations(s, 'shadow', 'mouth-of-sauron', 'fords-of-bruinen');
  check('Moria itself is not a destination', !dests.includes('moria'));
  check('Dimrill Dale (only via Moria) is not a destination', !dests.includes('dimrill-dale'), dests.join(','));
  check('the engine refuses the move too', !moveCharacter(structuredClone(s), 'shadow', 'mouth-of-sauron', 'fords-of-bruinen', 'dimrill-dale'));
  const why = characterMoveBlockReason(s, 'shadow', 'mouth-of-sauron', 'fords-of-bruinen', 'dimrill-dale');
  check('the map explains why', !!why && /Stronghold/.test(why), why ?? '(none)');
  check('ordinary 3-step walks still work', dests.length > 0, `${dests.length} destinations`);
}

{
  console.log('\n=== Companions cannot walk through a besieged Free Peoples Stronghold ===');
  const s = startGame(createGame({ seed: 8 }));
  // Pick a Free Peoples Stronghold X and two of its neighbours whose only path of
  // length 2 runs through X, then besiege X.
  const dist2Avoiding = (a, b, x) => REGIONS[a].adjacency.some((m) => m !== x && (m === b || REGIONS[m].adjacency.includes(b)));
  let X = null, from = null, to = null;
  for (const [id, def] of Object.entries(REGIONS)) {
    if (def.settlement !== 'Stronghold' || !s.regions[id] || from) continue;
    if (['dwarves', 'elves', 'gondor', 'north', 'rohan'].indexOf(def.nation) < 0) continue;
    for (const a of def.adjacency) for (const b of def.adjacency) {
      if (!from && a !== b && !dist2Avoiding(a, b, id)) { X = id; from = a; to = b; }
    }
  }
  if (X) {
    const r = s.regions[X];
    r.siegeBox = { units: r.units, leaders: r.leaders ?? 0, nazgul: 0, characters: [] };
    r.units = { sauron: { regular: 2, elite: 0 } }; r.besieged = true;
  }
  check('found a pair of regions joined only via a besieged Stronghold', !!from, `${from} → ${X} → ${to}`);
  if (from) {
    s.regions[from].characters.push('boromir'); s.characters.inPlay['boromir'] = from;
    const dests = characterDestinations(s, 'fp', 'boromir', from);
    check('the besieged Stronghold is not a destination', !dests.includes(X));
    // Boromir is Level 2: two steps through X is the only way to reach `to`.
    check(`${to} (only via the besieged Stronghold within 2) is not a destination`, !dests.includes(to), dests.join(','));
    check('the engine refuses the group move', !moveCompanionGroup(structuredClone(s), 'fp', from, to, ['boromir']));
    const sep = separationDestinations(s, from, 2);
    check('a separating Companion cannot pass through it either', !sep.includes(to) && !sep.includes(X), sep.join(','));
  }
}

{
  console.log('\n=== Guards of the Citadel overstacks a full besieged Minas Tirith, then trims to 5 ===');
  let s = startGame(createGame({ seed: 9 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp';
  s.dice.fp = ['muster', 'muster']; s.dice.shadow = ['army'];
  s.cards.fp.hand = ['fp-str-14'];
  const mt = s.regions['minas-tirith'];
  mt.siegeBox = { units: { gondor: { regular: 5, elite: 0 } }, leaders: 1, nazgul: 0, characters: [] };
  mt.units = { sauron: { regular: 6, elite: 0 } }; mt.leaders = 0; mt.besieged = true;
  s.reinforcements.gondor.elite = Math.max(1, s.reinforcements.gondor.elite);
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-14');
  check('Guards of the Citadel is playable', !!play);
  s = wotrAdapter.applyAction(s, play, 'fp');
  const elite = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'eventTarget' && a.figure === 'elite');
  check('the Elite is offered although the garrison is full', !!elite, JSON.stringify(wotrAdapter.legalActions(s, 'fp').slice(0, 4)));
  if (elite) {
    s = wotrAdapter.applyAction(s, elite, 'fp');
    const box = s.regions['minas-tirith'].siegeBox;
    const units = Object.values(box.units).reduce((n, u) => n + u.regular + u.elite, 0);
    check('the Elite and the Leader both landed in the garrison', units === 6 && box.leaders === 2, `${units} units, ${box.leaders} Leaders`);
    check('the Free Peoples are asked which unit to remove', s.pendingChoice?.kind === 'removeExcess' && s.pendingChoice.owner === 'fp' && s.pendingChoice.data.boxed === true, JSON.stringify(s.pendingChoice));
    const opts = wotrAdapter.legalActions(s, 'fp');
    check('they may remove a Regular or the new Elite', opts.some((a) => a.figure === 'regular') && opts.some((a) => a.figure === 'elite'));
    s = wotrAdapter.applyAction(s, opts.find((a) => a.figure === 'regular'), 'fp');
    const after = s.regions['minas-tirith'].siegeBox.units.gondor;
    check('trimmed to 5: four Regulars and an Elite', after.regular === 4 && after.elite === 1 && !s.pendingChoice, JSON.stringify(after));
  }
}

{
  console.log('\n=== a field recruit card overstacks a 10-unit Army, then the owner trims ===');
  let s = startGame(createGame({ seed: 10 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp';
  s.dice.fp = ['muster']; s.dice.shadow = ['army'];
  s.cards.fp.hand = ['fp-str-14'];
  const mt = s.regions['minas-tirith'];
  mt.units = { gondor: { regular: 10, elite: 0 } }; mt.besieged = false; mt.siegeBox = undefined;
  s.reinforcements.gondor.elite = Math.max(1, s.reinforcements.gondor.elite);
  s = wotrAdapter.applyAction(s, wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-14'), 'fp');
  const elite = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'eventTarget' && a.figure === 'elite');
  check('the Elite is offered at 10 units', !!elite);
  if (elite) {
    s = wotrAdapter.applyAction(s, elite, 'fp');
    check('11 units, then a removeExcess prompt', s.pendingChoice?.kind === 'removeExcess' && !s.pendingChoice.data.boxed, JSON.stringify(s.pendingChoice));
  }
}

console.log(failures ? `\nprobe-triage-1006: ${failures} FAILURE(S)` : '\nprobe-triage-1006: all ok');
process.exit(failures ? 1 : 0);
