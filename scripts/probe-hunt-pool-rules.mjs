#!/usr/bin/env vite-node
// probe-hunt-pool-rules.mjs — what goes back into the Hunt Pool, and when:
//
//   1. A reshuffle returns only the STANDARD (beige) tiles; drawn special tiles stay
//      out (rulebook p.40, player report 3k2z356g13360y4u).
//   2. Entering Mordor puts every Eye tile drawn so far back into the pool (p.43 step 2).
//   3. Mithril Coat and Sting sets the first tile ASIDE: the redraw can't come up with
//      it, and it rejoins the pool only once the Action is over ("apply the effects of
//      the second tile instead of the first one, then return the first tile to the Hunt
//      Pool" — player report 2l152j1a1s1d583x).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { STANDARD_TILE_LIST, SPECIAL_TILE_BY_CARD } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const plain = (v) => STANDARD_TILE_LIST.findIndex((t) => t.value === v && !t.stop && !t.reveal);
const TILE_1 = plain(1), TILE_2 = plain(2);
const EYE = STANDARD_TILE_LIST.findIndex((t) => t.value === 'eye');
const SHADOW_SPECIAL = Object.keys(SPECIAL_TILE_BY_CARD).find((id) => id.startsWith('sh-'));

/** The Ring-bearers on Mordor step 1 with a Character die to move them. */
function onMordor(hunt) {
  const state = startGame(createGame({ seed: 7 }));
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice = { fp: ['character'], shadow: [] };
  state.usedDice = { fp: [], shadow: [] };
  Object.assign(state.fellowship, {
    location: 'morannon', mordor: 1, hidden: true, progress: 0,
    corruption: 0, companions: ['strider'], guide: 'strider',
  });
  Object.assign(state.hunt, { drawn: [], specialsInPlay: [], specialsInPool: [], specialsDrawn: [], box: 0, fpDiceInBox: 0, ...hunt });
  return state;
}
const act = (s, a, side = 'fp') => wotrAdapter.applyAction(s, a, side);
const step = (s) => act(s, { kind: 'moveFellowship' });
const takeAsCorruption = (s) => act(s, { kind: 'huntDamage', mode: 'corruption' });

check('fixture tiles exist', TILE_1 >= 0 && TILE_2 >= 0 && EYE >= 0 && !!SHADOW_SPECIAL);

{
  console.log('\n=== a reshuffle returns only the standard tiles ===');
  const s = step(onMordor({ pool: [], drawn: [TILE_2], specialsDrawn: [SHADOW_SPECIAL] }));
  check('the standard tile came back and was drawn', s.hunt.drawn.includes(TILE_2), JSON.stringify(s.hunt.drawn));
  check('the drawn special tile stayed out of the pool', !s.hunt.specialsInPool.includes(SHADOW_SPECIAL), JSON.stringify(s.hunt.specialsInPool));
  check('...and is still on the drawn pile', s.hunt.specialsDrawn.includes(SHADOW_SPECIAL));
}

{
  console.log('\n=== entering Mordor returns the drawn Eye tiles ===');
  const s0 = startGame(createGame({ seed: 7 }));
  s0.phase = 'fellowship';
  Object.assign(s0.fellowship, { location: 'morannon', mordor: null });
  const rest = s0.hunt.pool.filter((i) => i !== EYE && i !== TILE_2);
  Object.assign(s0.hunt, { pool: rest, drawn: [EYE, TILE_2], specialsInPlay: [], specialsInPool: [], specialsDrawn: [] });
  const s = act(s0, { kind: 'enterMordor' });
  check('on the Mordor Track', s.fellowship.mordor === 0);
  check('the drawn Eye is back in the pool', s.hunt.pool.includes(EYE) && !s.hunt.drawn.includes(EYE), JSON.stringify(s.hunt));
  check('the drawn numbered tile stays out', s.hunt.drawn.includes(TILE_2) && !s.hunt.pool.includes(TILE_2));
}

{
  console.log('\n=== Mithril Coat and Sting sets the first tile aside until the Action ends ===');
  for (let seed = 0; seed < 6; seed++) {
    const base = onMordor({ pool: [TILE_1, TILE_2] });
    base.rngState = seed + 1;
    base.cards.fp.table.push('fp-char-05');
    const drawn = step(base);
    check(`[${seed}] the redraw is offered`, drawn.pendingChoice?.kind === 'huntRedraw', drawn.pendingChoice?.kind);
    const first = drawn.pendingChoice.data.ref.std;
    const redrawn = act(drawn, { kind: 'huntRedraw', redraw: true });
    check(`[${seed}] the second tile is the OTHER tile`, redrawn.hunt.drawn.length === 1 && redrawn.hunt.drawn[0] !== first, JSON.stringify(redrawn.hunt.drawn));
    check(`[${seed}] the first tile is set aside, not in the pool, mid-Hunt`, !redrawn.hunt.pool.includes(first) && redrawn.hunt.setAside?.some((r) => r.std === first), JSON.stringify(redrawn.hunt));
    const done = redrawn.pendingChoice ? takeAsCorruption(redrawn) : redrawn;
    check(`[${seed}] once the Action is over it is back in the pool`, !done.pendingChoice && done.hunt.pool.includes(first) && !(done.hunt.setAside ?? []).length, JSON.stringify(done.hunt.pool));
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall hunt-pool checks passed');
process.exit(failures ? 1 : 0);
