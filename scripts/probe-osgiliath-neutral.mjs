#!/usr/bin/env vite-node
// probe-osgiliath-neutral.mjs — OSGILIATH IS NOT A GONDOR REGION.
//
// The map draws Osgiliath (and North/South Ithilien) OUTSIDE Gondor's border. The
// Almanac says so twice, in the notes on "Challenge of the King" and "House of the
// Stewards": "Note that Osgiliath is a ruin of a Gondor city, and so is not a Gondor
// region (even though Gondor units start the game in this region)."
//
// We had it tagged `nation: 'gondor'`, which quietly changed four things: The Last
// Battle was refused with Aragorn there, a Shadow Army walking into an EMPTY
// Osgiliath roused Gondor, non-At-War Free Peoples units were barred from crossing
// into it, and it counted as "a Gondor region" for card conditions. A player caught
// it and cited the map. It is now `nation: null` + `setupNation: 'gondor'` — no
// nation owns the region, but the 2 Gondor Regulars still start there.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { canPlayCard } from '../src/engine/handlers/registry.ts';
import '../src/engine/handlers/index.ts'; // registers every card handler
import { moveArmy } from '../src/engine/armies.ts';
import { startBattle } from '../src/engine/combat.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('=== the region belongs to no Nation, but keeps its Gondor garrison ===');
{
  check('Osgiliath has no nation', REGIONS['osgiliath'].nation === null, String(REGIONS['osgiliath'].nation));
  check('…and is still a Fortification', REGIONS['osgiliath'].settlement === 'Fortification');
  check('North Ithilien has no nation', REGIONS['north-ithilien'].nation === null);
  check('South Ithilien has no nation', REGIONS['south-ithilien'].nation === null);
  check('Fords of Isen is still Rohan', REGIONS['fords-of-isen'].nation === 'rohan'); // the OTHER Fortification is inside its border
  const s = startGame(createGame({ seed: 11 }));
  const u = s.regions['osgiliath'].units.gondor;
  check('2 Gondor Regulars start in Osgiliath', !!u && u.regular === 2 && u.elite === 0, JSON.stringify(s.regions['osgiliath'].units));
  check('Minas Tirith is still Gondor', REGIONS['minas-tirith'].nation === 'gondor');
}

console.log('\n=== "The Last Battle": Aragorn outside a Free Peoples Nation ===');
{
  const at = (region) => {
    const s = startGame(createGame({ seed: 12 }));
    s.regions[region].units = { gondor: { regular: 2, elite: 0 } };
    s.regions[region].characters = ['aragorn'];
    s.characters.inPlay['aragorn'] = region;
    return canPlayCard(s, 'fp-str-01');
  };
  check('playable in Osgiliath', at('osgiliath'));
  check('playable in South Ithilien', at('south-ithilien'));
  check('playable in North Ithilien', at('north-ithilien'));
  check('refused in Minas Tirith (Gondor)', !at('minas-tirith'));
  check('refused in Lossarnach (Gondor)', !at('lossarnach'));
}

console.log('\n=== rousing Gondor: the garrison, not the ground ===');
{
  // Walking into an EMPTY Osgiliath is not entering a Gondor region, so the
  // Political Track does not move.
  const s = startGame(createGame({ seed: 13 }));
  s.regions['osgiliath'].units = {};
  const before = s.nations.gondor.step;
  s.regions['south-ithilien'].units = { sauron: { regular: 3, elite: 0 } };
  moveArmy(s, 'south-ithilien', 'osgiliath', 'shadow');
  check('Shadow walks into an empty Osgiliath', Object.keys(s.regions['osgiliath'].units).length > 0);
  check('…and Gondor does NOT advance', s.nations.gondor.step === before, `${before} -> ${s.nations.gondor.step}`);
  check('…and Gondor is not activated', !s.nations.gondor.active);

  // ATTACKING the Gondor units there still rouses Gondor ("An Army containing units
  // of that Nation is attacked" — the trigger is the units, not the region).
  const t = startGame(createGame({ seed: 13 }));
  const was = t.nations.gondor.step;
  t.regions['south-ithilien'].units = { sauron: { regular: 3, elite: 0 } };
  startBattle(t, 'shadow', 'south-ithilien', 'osgiliath');
  check('attacking the Osgiliath garrison advances Gondor', t.nations.gondor.step === was - 1, `${was} -> ${t.nations.gondor.step}`);
  check('…and activates it', t.nations.gondor.active);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nprobe-osgiliath-neutral OK');
process.exit(failures ? 1 : 0);
