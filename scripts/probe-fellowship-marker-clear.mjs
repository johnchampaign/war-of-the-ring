#!/usr/bin/env vite-node
// probe-fellowship-marker-clear.mjs — the Fellowship marker never covers another token.
//
// Player report 43732p5u0j71692t: "There is a Nazgul in Trollshaws but it's hidden by
// the Fellowship token." The marker sat on the region anchor, which is exactly where a
// lone Nazgûl (or a single army badge) is drawn, and it is painted over everything.
//
// Checked on EVERY region of the map, using the same placement helper the board calls
// and the same token layout call the board makes:
//   A. a lone Nazgûl                (the report)
//   B. one full army badge
//   C. an army, a Settlement diamond and two Character discs
// For each: the marker overlaps no token, and its centre is inside its own region
// (a click on it goes to that region). An empty region keeps the marker on the anchor.
import { layoutTokensInPolygon, pointInPolygon } from 'digital-boardgame-framework';
import { regionIds, regionPolygon } from '../src/data/geometry.ts';
import { regionOccupants, fellowshipMarkerPoint, markerClearance } from '../src/play/tokenPlacement.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const cases = {
  'A lone Nazgûl': { solo: [true], settlement: false, chars: 0 },
  'B one army badge': { solo: [false], settlement: false, chars: 0 },
  'C army + Settlement + two Characters': { solo: [false], settlement: true, chars: 2 },
};

for (const [name, c] of Object.entries(cases)) {
  console.log(`\n=== ${name} ===`);
  const overlaps = [], outside = [];
  let worst = Infinity, worstId = '';
  for (const id of regionIds) {
    const poly = regionPolygon(id);
    if (!poly) continue;
    // Board.tsx: layoutTokensInPolygon(poly, max(1, armies.length), { tokenRadius: 22 }),
    // badge i at points[i] unless the layout stacked.
    const layout = layoutTokensInPolygon(poly, Math.max(1, c.solo.length), { tokenRadius: 22 });
    const armyPoints = c.solo.map((_, i) => (!layout.stacked && layout.points[i]) ? layout.points[i] : layout.anchor);
    const occupied = regionOccupants({ anchor: layout.anchor, armyPoints, armySolo: c.solo, scale: layout.scale,
      settlement: c.settlement, boxedCount: 0, charCount: c.chars, boxedCharCount: 0 });
    const p = fellowshipMarkerPoint(poly, layout.anchor, occupied);
    const clear = markerClearance(p, occupied);
    if (clear < worst) { worst = clear; worstId = id; }
    if (clear < 0) overlaps.push(`${id} (${clear.toFixed(1)})`);
    if (!pointInPolygon(p, poly)) outside.push(id);
  }
  check(`the marker covers no token in any of ${regionIds.length} regions`, overlaps.length === 0, overlaps.slice(0, 8).join(', '));
  check('the marker always stands inside its own region', outside.length === 0, outside.slice(0, 8).join(', '));
  console.log(`  tightest fit: ${worstId}, ${worst.toFixed(1)} px clear`);
}

console.log('\n=== the reported region, and an empty region ===');
{
  const poly = regionPolygon('trollshaws');
  const layout = layoutTokensInPolygon(poly, 1, { tokenRadius: 22 });
  const nazgul = { x: layout.points[0].x, y: layout.points[0].y };
  const occupied = regionOccupants({ anchor: layout.anchor, armyPoints: [nazgul], armySolo: [true], scale: layout.scale,
    settlement: false, boxedCount: 0, charCount: 0, boxedCharCount: 0 });
  const p = fellowshipMarkerPoint(poly, layout.anchor, occupied);
  check('Trollshaws: the marker moves off the Nazgûl', markerClearance(p, occupied) >= 0,
    `marker (${p.x.toFixed(0)},${p.y.toFixed(0)}) vs Nazgûl (${nazgul.x.toFixed(0)},${nazgul.y.toFixed(0)})`);
  const empty = fellowshipMarkerPoint(poly, layout.anchor, []);
  check('an empty region keeps the marker on the anchor, as before', empty.x === layout.anchor.x && empty.y === layout.anchor.y);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
