#!/usr/bin/env vite-node
// probe-faramir-rangers.mjs — the 2026-09-03 player report: "Faramir's Rangers can be
// played without a shadow army in Ithilien".
//
// The reporter was right. The card carries no "Play if" line, and its two halves stand
// alone: rulebook p.23 ("...can still be played, and its effects are applied to the
// maximum extent possible") plus the Almanac entry — "may be used if no Shadow Army is
// in North Ithilien or South Ithilien just to perform the final recruitment action, but
// only if a Free Peoples Army is currently standing in Osgiliath".
//
// The same pass fixed the missing Gondor LEADER: the card reads "recruit one Gondor unit
// (Regular or Elite) AND one Gondor Leader there" — only the unit was ever placed.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { unitCount } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => startGame(createGame({ seed: 11 }));
const h = getHandler('fp-str-06');

// --- 1. the reported position: setup Osgiliath, empty Ithilien ---------------------
{
  console.log('\n=== no Shadow Army in Ithilien: playable for the Osgiliath recruit ===');
  const state = board();
  const leaderPool0 = state.reinforcements.gondor.leader;
  check('Osgiliath opens with a Gondor Army', unitCount(state, 'osgiliath') === 2, String(unitCount(state, 'osgiliath')));
  check('no Shadow Army in Osgiliath / N. or S. Ithilien',
    ['osgiliath', 'north-ithilien', 'south-ithilien'].every((r) => unitCount(state, r) === 0 || r === 'osgiliath'));
  check('the card is playable', canPlayCard(state, 'fp-str-06', 'fp'));

  const opts = h.targets(state, 'fp', []);
  check('the first choice is the recruit, not a strike', opts.length === 2 && opts.every((t) => t.region === 'osgiliath' && t.figure),
    JSON.stringify(opts));

  h.applyTarget(state, 'fp', { nation: 'gondor', region: 'osgiliath', figure: 'elite', slot: 1 }, []);
  check('the Elite lands in Osgiliath', state.regions['osgiliath'].units.gondor.elite === 1);
  check('no second target step', h.targets(state, 'fp', [{ nation: 'gondor', region: 'osgiliath', figure: 'elite', slot: 1 }]).length === 0);
  h.finalize(state, 'fp', [{ figure: 'elite' }]);
  check('and the Gondor Leader comes with it', state.regions['osgiliath'].leaders === 1, String(state.regions['osgiliath'].leaders));
  check('the Leader came out of reinforcements', state.reinforcements.gondor.leader === leaderPool0 - 1, `${leaderPool0} -> ${state.reinforcements.gondor.leader}`);
}

// --- 2. strike first, then the recruit --------------------------------------------
{
  console.log('\n=== a Shadow Army in N. Ithilien: strike, then recruit ===');
  const state = board();
  state.regions['north-ithilien'].units = { sauron: { regular: 4, elite: 0 } };
  check('the card is playable', canPlayCard(state, 'fp-str-06', 'fp'));
  const opts = h.targets(state, 'fp', []);
  check('N. Ithilien is the strike target', opts.length === 1 && opts[0].region === 'north-ithilien' && !opts[0].figure, JSON.stringify(opts));

  h.applyTarget(state, 'fp', { region: 'north-ithilien' }, []);
  const after = h.targets(state, 'fp', [{ region: 'north-ithilien' }]);
  check('the recruit follows the strike', after.length === 2 && after.every((t) => t.region === 'osgiliath' && t.figure), JSON.stringify(after));
  h.finalize(state, 'fp', [{ region: 'north-ithilien' }, { figure: 'regular' }]);
  check('the Leader still lands', state.regions['osgiliath'].leaders === 1);
}

// --- 3. no FP Army in Osgiliath: the strike alone ---------------------------------
{
  console.log('\n=== Osgiliath in Shadow hands: strike only, no recruit ===');
  const state = board();
  state.regions['osgiliath'].units = { sauron: { regular: 3, elite: 0 } };
  check('the card is playable', canPlayCard(state, 'fp-str-06', 'fp'));
  h.applyTarget(state, 'fp', { region: 'osgiliath' }, []);
  check('no recruit is offered', h.targets(state, 'fp', [{ region: 'osgiliath' }]).length === 0);
  h.finalize(state, 'fp', [{ region: 'osgiliath' }]);
  check('and no Leader is placed', state.regions['osgiliath'].leaders === 0);
}

// --- 4. nothing at all to do ------------------------------------------------------
{
  console.log('\n=== empty Osgiliath, empty Ithilien: unplayable ===');
  const state = board();
  state.regions['osgiliath'].units = {};
  check('the card is NOT playable', !canPlayCard(state, 'fp-str-06', 'fp'));
}

// --- 5. Leader-only: no Gondor units left in reinforcements ------------------------
{
  console.log('\n=== no Gondor units in reinforcements: the Leader alone ===');
  const state = board();
  state.reinforcements.gondor.regular = 0;
  state.reinforcements.gondor.elite = 0;
  check('the card is still playable', canPlayCard(state, 'fp-str-06', 'fp'));
  check('no unit target to choose', h.targets(state, 'fp', []).length === 0);
  h.apply(state, 'fp'); // playEvent's path when there are no targets
  check('the Leader is recruited anyway', state.regions['osgiliath'].leaders === 1, String(state.regions['osgiliath'].leaders));

  // ...and with no Leaders left either, there is nothing to apply.
  const dry = board();
  dry.reinforcements.gondor.regular = 0;
  dry.reinforcements.gondor.elite = 0;
  dry.reinforcements.gondor.leader = 0;
  check('with the Gondor pool empty the card is unplayable', !canPlayCard(dry, 'fp-str-06', 'fp'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
