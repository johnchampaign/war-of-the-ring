#!/usr/bin/env vite-node
// probe-besieged-card-clauses.mjs — two player reports from 2026-09-22/23, both the
// same root cause: an Event card that names a figure or an Army could not see one that
// was shut inside a besieged Stronghold.
//
//   1. "House of the Stewards doesn't work, when besieged" (6x6f3v1h1y5r3k4u) — Boromir
//      was in the siege box of Minas Tirith, so `charRegion` found him nowhere and the
//      card's printed condition ("Play if Boromir is in a Gondor region") failed.
//      Rulebook p.28 explicitly opens Event-card recruiting to a besieged Stronghold,
//      capped at the 5-unit garrison limit (p.31).
//   2. "Paths of the Woses is able to move an Army besieged in a Stronghold"
//      (36323l0a702k6m17) — the card says so in as many words ("from any one Rohan
//      region (INCLUDING A STRONGHOLD UNDER SIEGE) directly to Minas Tirith"), and the
//      enumerator offered open-field Armies only. The garrison marching out leaves the
//      Stronghold undefended under the besieger's feet, so it falls to him.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { forceUnitCount } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed = 11) => startGame(createGame({ seed }));
function besiege(state, region, field, box) {
  const r = state.regions[region];
  r.units = field.units; r.leaders = field.leaders ?? 0; r.nazgul = field.nazgul ?? 0; r.characters = field.characters ?? [];
  r.besieged = true;
  r.siegeBox = { units: box.units, leaders: box.leaders ?? 0, nazgul: 0, characters: box.characters ?? [] };
  return r;
}
const units = (f) => (f ? forceUnitCount(f) : 0);

{
  console.log('\n=== House of the Stewards: Boromir besieged in Minas Tirith (report 6x6f3v1h) ===');
  // The reporter's own position: Sauron 4R/1E + 2 Nazgûl in the field, a Gondor garrison
  // of 2R + a Leader + Boromir in the box.
  const s = fresh();
  s.characters.inPlay['boromir'] = 'minas-tirith';
  besiege(s, 'minas-tirith',
    { units: { sauron: { regular: 4, elite: 1 } }, nazgul: 2 },
    { units: { gondor: { regular: 2, elite: 0 } }, leaders: 1, characters: ['boromir'] });
  s.reinforcements.gondor.regular = 3; s.reinforcements.gondor.elite = 2;

  check('the card is playable with Boromir in the siege box', canPlayCard(s, 'fp-char-23', 'fp'));
  const h = getHandler('fp-char-23');
  const t = h.targets(s, 'fp');
  check('it offers the Regular and the Elite', t.length === 2, `${t.length} target(s)`);
  const before = units(s.regions['minas-tirith'].siegeBox);
  h.applyTarget(s, 'fp', t.find((x) => x.figure === 'elite') ?? t[0]);
  check('the unit joins the GARRISON, not the besieger\'s field',
    units(s.regions['minas-tirith'].siegeBox) === before + 1, `box=${units(s.regions['minas-tirith'].siegeBox)}`);
  check('the besieging Army is untouched', units(s.regions['minas-tirith']) === 5, `field=${units(s.regions['minas-tirith'])}`);
}

{
  console.log('\n=== House of the Stewards: a FULL garrison (5 units) has no room (p.31) ===');
  const s = fresh();
  s.characters.inPlay['boromir'] = 'minas-tirith';
  besiege(s, 'minas-tirith',
    { units: { sauron: { regular: 4, elite: 1 } } },
    { units: { gondor: { regular: 5, elite: 0 } }, characters: ['boromir'] });
  s.reinforcements.gondor.regular = 3; s.reinforcements.gondor.elite = 2;
  check('no recruit target at the 5-unit cap', getHandler('fp-char-23').targets(s, 'fp').length === 0);
}

{
  console.log('\n=== Paths of the Woses: the boxed Helm\'s Deep garrison marches out (report 36323l0a) ===');
  // The reporter's own position: Isengard 4R/4E + 5 Nazgûl + the Witch-king holding the
  // field at Helm's Deep, 4 Rohan Regulars in the box.
  const s = fresh();
  s.nations.rohan.step = 0; // "Play if the Rohan Nation is At War"
  besiege(s, 'helms-deep',
    { units: { isengard: { regular: 4, elite: 4 } }, nazgul: 5, characters: ['witch-king'] },
    { units: { rohan: { regular: 4, elite: 0 } } });
  for (const id of ['edoras', 'westemnet', 'eastemnet', 'folde', 'fords-of-isen']) {
    s.regions[id].units = {}; s.regions[id].leaders = 0; s.regions[id].characters = [];
  }
  s.regions['minas-tirith'].units = { gondor: { regular: 1, elite: 0 } };

  const h = getHandler('fp-str-11');
  const t = h.targets(s, 'fp');
  check('the besieged Stronghold is offered as an origin',
    t.some((x) => x.from === 'helms-deep' && x.to === 'minas-tirith'), JSON.stringify(t));
  h.applyTarget(s, 'fp', t.find((x) => x.from === 'helms-deep'));
  check('the 4 Rohan Regulars arrive at Minas Tirith',
    (s.regions['minas-tirith'].units.rohan?.regular ?? 0) === 4,
    JSON.stringify(s.regions['minas-tirith'].units));
  check('the siege is over', !s.regions['helms-deep'].besieged && !s.regions['helms-deep'].siegeBox);
  check('the besieging Isengard Army is still there', units(s.regions['helms-deep']) === 8);
  check('the abandoned Stronghold falls to the Shadow', s.regions['helms-deep'].control === 'shadow',
    `control=${s.regions['helms-deep'].control}`);
}

{
  console.log('\n=== Paths of the Woses: a PARTIAL march leaves the siege standing ===');
  const s = fresh();
  s.nations.rohan.step = 0;
  besiege(s, 'helms-deep',
    { units: { isengard: { regular: 4, elite: 4 } } },
    { units: { rohan: { regular: 4, elite: 0 } } });
  for (const id of ['edoras', 'westemnet', 'eastemnet', 'folde', 'fords-of-isen']) {
    s.regions[id].units = {}; s.regions[id].leaders = 0; s.regions[id].characters = [];
  }
  s.regions['minas-tirith'].units = { gondor: { regular: 1, elite: 0 } };
  const h = getHandler('fp-str-11');
  const t = h.targets(s, 'fp').find((x) => x.from === 'helms-deep');
  h.applyTarget(s, 'fp', { ...t, move: { units: { rohan: { regular: 2 } } } });
  check('two Regulars stayed in the box', units(s.regions['helms-deep'].siegeBox) === 2,
    `box=${units(s.regions['helms-deep'].siegeBox)}`);
  check('the siege still stands', s.regions['helms-deep'].besieged === true);
  check('the Stronghold is NOT captured', s.regions['helms-deep'].control !== 'shadow',
    `control=${s.regions['helms-deep'].control}`);
  check('two Regulars reached Minas Tirith', (s.regions['minas-tirith'].units.rohan?.regular ?? 0) === 2);
}

{
  console.log("\n=== Denethor's Folly: the Leader it eliminates is in the siege box (reports xycytl2o, 9vhwbo79) ===");
  const s = fresh();
  besiege(s, 'minas-tirith',
    { units: { sauron: { regular: 5, elite: 1 } }, nazgul: 1 },
    { units: { gondor: { regular: 2, elite: 1 } }, leaders: 2 });
  check('the card is playable', canPlayCard(s, 'sh-str-03', 'shadow'));
  getHandler('sh-str-03').apply(s, 'shadow');
  check('one boxed Leader is eliminated', s.regions['minas-tirith'].siegeBox.leaders === 1,
    `box leaders=${s.regions['minas-tirith'].siegeBox.leaders}`);
  check('the garrison units are untouched', units(s.regions['minas-tirith'].siegeBox) === 3);
  check('logged', s.log.some((e) => e.msg.includes("Denethor's Folly: a Free Peoples Leader")));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
