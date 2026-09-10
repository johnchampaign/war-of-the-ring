#!/usr/bin/env vite-node
// probe-nazgul-muster-and-fortifications.mjs — two player reports, 2026-09-10.
//
// 1) "While Nazgûl aren't beholden to Diplomacy rules like Free Peoples Leaders, they
//     still require the Sauron Nation to be At War to recruit them using a Muster
//     Action die result during the Action Resolution phase." (report 1f2q456i4h3b470x)
//    p.26: reinforcements are recruited only in a Settlement of a Nation that is At
//    War. Nazgûl are Sauron Leaders, so the gate applies to them too — `recruit()` had
//    it for every other figure, `canRecruitNazgul` did not.
//
// 2) "Osgiliath and Fords of Isen have control markers. Please remove them!"
//    (report 1c0k225r21493a52) A Fortification is NOT a Settlement (p.10): it is never
//    captured, carries no Settlement Control marker and is worth no Victory Points.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { canRecruitNazgul, recruitNazgul, captureIfEnemySettlement } from '../src/engine/armies.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => startGame(createGame({ seed: 5 }));

console.log('\n=== a Muster die places a Nazgûl only once Sauron is At War (p.26) ===');
{
  const s = fresh();
  check('Sauron starts short of War', s.nations.sauron.step > 0, `step ${s.nations.sauron.step}`);
  const holds = ['barad-dur', 'minas-morgul', 'morannon'];
  for (const r of holds) check(`no Nazgûl muster at ${r} while Sauron is not At War`, !canRecruitNazgul(s, r));
  check('…and the muster is refused if submitted anyway', !recruitNazgul(s, 'barad-dur'));
  const before = s.reinforcements.sauron.nazgul;
  s.nations.sauron.step = 0; // At War
  for (const r of holds) check(`${r} offers the muster once Sauron is At War`, canRecruitNazgul(s, r));
  check('and it places a figure from the pool', recruitNazgul(s, 'barad-dur')
    && s.reinforcements.sauron.nazgul === before - 1 && s.regions['barad-dur'].nazgul > 0);
  // The rest of the Nazgûl gates still hold.
  s.reinforcements.sauron.nazgul = 0;
  check('an empty Nazgûl pool still blocks it', !canRecruitNazgul(s, 'minas-morgul'));
}

console.log('\n=== a Fortification never takes a Settlement Control marker (p.10) ===');
for (const fort of ['osgiliath', 'fords-of-isen']) {
  const s = fresh();
  check(`${fort} is a Fortification`, REGIONS[fort].settlement === 'Fortification');
  const vpBefore = { ...s.victoryPoints };
  s.regions[fort].units = { sauron: { regular: 2, elite: 0 } };
  captureIfEnemySettlement(s, fort, 'shadow', true);
  check(`no control marker on ${fort} after a Shadow takeover`, s.regions[fort].control === null,
    String(s.regions[fort].control));
  check('no Victory Points changed hands', s.victoryPoints.shadow === vpBefore.shadow && s.victoryPoints.fp === vpBefore.fp,
    JSON.stringify(s.victoryPoints));
}
{
  // …while a real Settlement still flips, so the early return didn't swallow the rule.
  const s = fresh();
  const vp = s.victoryPoints.shadow;
  s.regions['dol-amroth'].units = { sauron: { regular: 2, elite: 0 } };
  captureIfEnemySettlement(s, 'dol-amroth', 'shadow', true);
  check('a captured City still takes the marker', s.regions['dol-amroth'].control === 'shadow');
  check('…and still scores its VP', s.victoryPoints.shadow === vp + REGIONS['dol-amroth'].vp,
    `${vp} -> ${s.victoryPoints.shadow}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
