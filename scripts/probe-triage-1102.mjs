#!/usr/bin/env vite-node
// probe-triage-1102.mjs — player report l2qbeep3olo04yjh: Monsters Roused recruited in an
// Angmar the Free Peoples had captured. Almanac, "Points common to all Shadow recruitment
// cards": "never permitted to use any of these cards to recruit into a captured Shadow
// Settlement". The whole-card recruits placed through eventRecruitTarget, which only asks
// about enemy Armies, so an EMPTY captured Settlement slipped through.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import '../src/engine/handlers/index.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => startGame(createGame({ seed: 11 }));
const reg = (s, region, nation = 'sauron') => s.regions[region].units[nation]?.regular ?? 0;

console.log('\n=== Monsters Roused ===');
{
  const s = fresh();
  s.regions.angmar.control = 'fp';
  const pool = s.reinforcements.sauron.regular;
  const before = reg(s, 'angmar');
  getHandler('sh-str-22').apply(s, 'shadow');
  check('nothing lands in an empty, captured Angmar', reg(s, 'angmar') === before, String(reg(s, 'angmar')));
  check('the Ettenmoors still gets its Regular', reg(s, 'ettenmoors') === 1);
  check('Weather Hills still gets its Regular', reg(s, 'weather-hills') === 1);
  check('the Angmar Regular stays in reinforcements', s.reinforcements.sauron.regular === pool - 2);
}
{
  const s = fresh();
  const before = reg(s, 'angmar');
  getHandler('sh-str-22').apply(s, 'shadow');
  check('a Shadow-held Angmar recruits as printed', reg(s, 'angmar') === before + 1);
}

console.log('\n=== other whole-card recruits ===');
{
  const s = fresh();
  s.regions['dol-guldur'].control = 'fp';
  for (const n of Object.keys(s.regions['dol-guldur'].units)) delete s.regions['dol-guldur'].units[n];
  const gundabad = reg(s, 'mount-gundabad');
  getHandler('sh-str-20').apply(s, 'shadow');
  check('Orcs Multiplying Again skips a captured Dol Guldur', reg(s, 'dol-guldur') === 0, String(reg(s, 'dol-guldur')));
  check('...and still recruits in Mount Gundabad', reg(s, 'mount-gundabad') === gundabad + 3);
}
{
  const s = fresh();
  s.regions.angmar.control = 'fp';
  const before = reg(s, 'angmar');
  s.characters.inPlay['witch-king'] = 'minas-morgul';
  s.regions['minas-morgul'].characters.push('witch-king');
  getHandler('sh-str-12').apply(s, 'shadow');
  check('Return of the Witch-king moves him but recruits nothing there', s.characters.inPlay['witch-king'] === 'angmar' && reg(s, 'angmar') === before);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
