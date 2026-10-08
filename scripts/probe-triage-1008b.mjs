#!/usr/bin/env vite-node
// probe-triage-1008b.mjs — Event cards that draw Hunt tiles WITHOUT a Hunt record
// the tiles for the Hunt popup, with the card's result line (player reports
// 4t5m0k5b5h264g1e, 5e0i3g330x3b6a6i, 5h4j4w4m671w0l5w, 1o2h3a4u6q6c3a38):
// Challenge of the King's three tiles and The Breaking of the Fellowship's one,
// including an Eye that does nothing.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { challengeOfTheKing, drawHuntTileNumber } from '../src/engine/hunt.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const idx = (pred) => STANDARD_TILE_LIST.map((t, i) => (pred(t) ? i : -1)).filter((i) => i >= 0);
const eyes = idx((t) => t.value === 'eye');
const nums = idx((t) => typeof t.value === 'number' && t.value > 0);
const fresh = () => { const s = startGame(createGame({ seed: 5 })); s.hunt.draws = []; return s; };

console.log('\n=== Challenge of the King: all three tiles recorded, with the result ===');
{
  const s = fresh(); s.hunt.pool = [eyes[0], nums[0], nums[1]]; s.hunt.specialsInPool = []; s.hunt.drawn = [];
  const lost = challengeOfTheKing(s, 'Strider');
  const d = s.hunt.draws;
  check('not all Eyes, so he survives', lost === false);
  check('three draws recorded under the card', d.length === 3 && d.every((x) => x.source === 'Challenge of the King'), JSON.stringify(d));
  check('each carries the result line', d.every((x) => /1 Eye tile permanently removed/.test(x.outcome ?? '')), d[0]?.outcome);
  check('no notice-only dialog any more', !(s.notices ?? []).some((n) => n.title === 'Challenge of the King'));
}
{
  const s = fresh(); s.hunt.pool = eyes.slice(0, 3); s.hunt.specialsInPool = []; s.hunt.drawn = [];
  const lost = challengeOfTheKing(s, 'Strider');
  check('all Eyes eliminates him, and says who', lost && /Strider is eliminated/.test(s.hunt.draws[0]?.outcome ?? ''), s.hunt.draws[0]?.outcome);
}

console.log('\n=== The Breaking of the Fellowship: the tile shows, even an Eye ===');
{
  const s = fresh(); s.hunt.pool = [eyes[0]]; s.hunt.specialsInPool = []; s.hunt.drawn = [];
  const n = drawHuntTileNumber(s, 'The Breaking of the Fellowship', (k) => (k === null ? 'discarded' : `${k} separate`));
  check('an Eye gives no number', n === null);
  check('...but the drawn Eye is recorded for the popup', s.hunt.draws.length === 1 && s.hunt.draws[0].value === 'eye' && s.hunt.draws[0].outcome === 'discarded', JSON.stringify(s.hunt.draws));
}
{
  const s = fresh(); s.hunt.pool = [nums[0]]; s.hunt.specialsInPool = []; s.hunt.drawn = [];
  const n = drawHuntTileNumber(s, 'The Breaking of the Fellowship', (k) => `${k} separate`);
  check('a number tile records its number and result', n === STANDARD_TILE_LIST[nums[0]].value && s.hunt.draws[0].outcome === `${n} separate`, JSON.stringify(s.hunt.draws));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
