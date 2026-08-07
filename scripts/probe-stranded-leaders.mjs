#!/usr/bin/env vite-node
// probe-stranded-leaders.mjs — A FREE PEOPLES LEADER IS NEVER ALONE.
//
// p.26: "Free Peoples Leaders can never be in a region without Free Peoples Army units."
// Every movement and muster path refuses to create that state, but any effect that
// REMOVES a region's last Free Peoples unit used to leave its Leaders standing there.
// Stormcrow ("the Free Peoples lose one unit of that Nation") was caught doing it by the
// soak at seed 313, and every sibling card loss has the same shape.
//
// A lone Leader is not a harmless bookkeeping wart: the map draws a Free Peoples Army
// badge for it, over a region the hover inspector correctly reports as empty — the
// player report "an army is displayed on the map, but when you hover it says it's a free
// region without the army".
//
// sweepStrandedUnits (run from advance() after every action) is the catch-all, so an
// already-corrupted save heals on its next action too. These cases pin its edges: it
// must fire on an EMPTY region (the phantom-army case the old check skipped), fire under
// an enemy Army, and NEVER touch a besieged garrison's Leaders — the siege box is where
// a besieged Nation's Leaders legitimately live while its region's field is empty.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { sweepStrandedUnits } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => startGame(createGame({ seed: 7 }));

// 1. The reported shape: the last Free Peoples unit is gone and the region is EMPTY.
{
  const s = fresh();
  const r = s.regions['hollin'];
  r.units = {}; r.leaders = 1;
  sweepStrandedUnits(s);
  check('lone Leader in an empty region is removed', r.leaders === 0, `leaders=${r.leaders}`);
  check('the removal is logged', s.log.at(-1).msg.includes('stranded Free Peoples Leader'));
}

// 2. Under an enemy Army (the case the old check already covered — keep it covered).
{
  const s = fresh();
  const r = s.regions['hollin'];
  r.units = { sauron: { regular: 3, elite: 0 } }; r.leaders = 2;
  sweepStrandedUnits(s);
  check('Leaders under a Shadow Army are removed', r.leaders === 0, `leaders=${r.leaders}`);
}

// 3. With Free Peoples units present — the normal, legal case. Untouched.
{
  const s = fresh();
  const r = s.regions['hollin'];
  r.units = { gondor: { regular: 1, elite: 0 } }; r.leaders = 1;
  sweepStrandedUnits(s);
  check('a Leader WITH its Army is left alone', r.leaders === 1, `leaders=${r.leaders}`);
}

// 4. Besieged: the garrison (and its Leaders) live in the siege box while the field
//    holds the besieger. A stray region-level Leader is still stranded, but the BOX's
//    Leaders must survive — removing those would delete a real, legal garrison Leader.
{
  const s = fresh();
  const r = s.regions['minas-tirith'];
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: 2, elite: 1 } }, leaders: 1, nazgul: 0, characters: [] };
  r.units = { sauron: { regular: 4, elite: 0 } }; r.leaders = 0;
  sweepStrandedUnits(s);
  check('a besieged garrison keeps its Leaders', r.siegeBox.leaders === 1, `box leaders=${r.siegeBox.leaders}`);
  check('the besieged field is untouched', r.units.sauron.regular === 4);
}

// 5. A siege box holding Free Peoples units protects the region's Leaders too: the field
//    is empty of FP units by definition there, so a blanket sweep would eat them.
{
  const s = fresh();
  const r = s.regions['minas-tirith'];
  r.besieged = true;
  r.siegeBox = { units: { gondor: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  r.units = {}; r.leaders = 1;
  sweepStrandedUnits(s);
  check('Leaders over a Free Peoples garrison survive', r.leaders === 1, `leaders=${r.leaders}`);
}

console.log(failures ? `\nprobe-stranded-leaders: ${failures} FAILURE(S)` : '\nprobe-stranded-leaders OK');
process.exit(failures ? 1 : 0);
