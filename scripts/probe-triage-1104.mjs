#!/usr/bin/env vite-node
// probe-triage-1104.mjs — player report 7phf0f7truaquyr0 asked whether a captured Free
// Peoples Settlement still counts as one for card purposes. It does, as the Almanac rules,
// and checking it turned up the Balrog of Moria clause that was never wired: "Ignore any
// 'Reveal' icon on the drawn tile if the Fellowship has been declared in a Free Peoples City
// or Stronghold", which "applies even if the Settlement has been captured by the Shadow
// player". Gollum's own reveal-to-reduce stays barred in one the Free Peoples still hold.
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const act = (s, a, who) => {
  const r = wotrAdapter.tryApplyAction(s, a, who);
  if (!r.ok) throw new Error(`${a.kind}: ${r.error}`);
  return r.state;
};
const revealTile = STANDARD_TILE_LIST.findIndex((t) => t.reveal && t.value === 1);
const plainTile = STANDARD_TILE_LIST.findIndex((t) => !t.reveal && t.value === 1);

/** Declare from Moria to `target` with the Balrog on the table and one known tile to draw. */
function declare(target, { tile = revealTile, control, guide, companions } = {}) {
  const s = startGame(createGame({ seed: 7 }));
  s.phase = 'fellowship';
  s.pendingChoice = null;
  s.fellowship.location = 'moria';
  s.fellowship.progress = 2;
  s.fellowship.hidden = true;
  if (guide) s.fellowship.guide = guide;
  if (companions) s.fellowship.companions = companions;
  if (control) s.regions[target].control = control;
  s.cards.shadow.table.push('sh-char-17');
  s.hunt.pool = [tile];
  s.hunt.drawn = [];
  return act(s, { kind: 'declareFellowship', target }, 'fp');
}
const useBalrog = (s) => act(s, { kind: 'balrog', use: true }, 'shadow');
const takeCorruption = (s) => (s.pendingChoice?.kind === 'huntDamage' ? act(s, { kind: 'huntDamage', mode: 'corruption' }, 'fp') : s);

console.log('\n=== Balrog tile on a declaration ===');
{
  const s = useBalrog(declare('lorien'));
  check('the Fellowship stays hidden in an unconquered Lórien', takeCorruption(s).fellowship.hidden === true);
  check('the log says the icon was ignored', JSON.stringify(s.log).includes('Reveal icon is ignored'));
  check('the popup shows no reveal', s.hunt.draws.at(-1).reveal === false);
}
{
  const s = takeCorruption(useBalrog(declare('lorien', { control: 'shadow' })));
  check('the Fellowship stays hidden in a captured Lórien too', s.fellowship.hidden === true);
}
{
  const s = takeCorruption(useBalrog(declare('dimrill-dale')));
  check('an ordinary region still reveals', s.fellowship.hidden === false);
}
{
  const s = takeCorruption(useBalrog(declare('lorien', { tile: plainTile })));
  check('the tile\'s damage still lands', s.fellowship.hidden === true && s.hunt.draws.at(-1).damage === 1);
}

console.log('\n=== Gollum\'s reveal-to-reduce ===');
{
  const s = useBalrog(declare('lorien', { guide: 'gollum', companions: ['gimli'] }));
  const modes = wotrAdapter.legalActions(s, 'fp').map((a) => a.mode);
  check('barred in an unconquered Lórien with no Progress', s.pendingChoice?.kind === 'huntDamage' && !modes.includes('reduceReveal'), modes.join(','));
}
{
  const s = useBalrog(declare('lorien', { guide: 'gollum', companions: ['gimli'], control: 'shadow' }));
  const modes = wotrAdapter.legalActions(s, 'fp').map((a) => a.mode);
  check('allowed in a captured Lórien', modes.includes('reduceReveal'), modes.join(','));
}

console.log('\n=== captured Settlements still shield from Orc Patrol and friends ===');
{
  const s = startGame(createGame({ seed: 7 }));
  s.fellowship.location = 'lorien';
  s.regions.lorien.control = 'shadow';
  check('Orc Patrol refused in a captured Lórien', !getHandler('sh-char-05').canPlay(s, 'shadow'));
  check('Candles of Corpses refused in a captured Lórien', !getHandler('sh-char-08').canPlay(s, 'shadow'));
  s.fellowship.location = 'angmar';
  s.regions.angmar.control = 'fp';
  check('a captured Shadow Stronghold or Town gives no shelter', getHandler('sh-char-05').canPlay(s, 'shadow'));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
