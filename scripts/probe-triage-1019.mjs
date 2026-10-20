#!/usr/bin/env vite-node
// probe-triage-1019.mjs — player report 364t5b2j0o3h3h16: "The automatic retreat in
// the case that there is only one legal destination is confusing ... You still have to
// click the single destination yourself" for every other map pick. A retreat with a
// single free region now asks for it like any other destination.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { retreatDestinations, resolveRetreat } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== a retreat with ONE free region still asks for it ===');
{
  const s = startGame(createGame({ seed: 12 }));
  s.phase = 'actionResolution';
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'orthanc', to: 'fords-of-isen', round: 1 };
  s.pendingChoice = { owner: 'fp', kind: 'retreatTo' };
  const all = retreatDestinations(s);
  const keep = all[0];
  for (const r of all.slice(1)) s.regions[r].units = { isengard: { regular: 1, elite: 0 } };
  s.pendingChoice = { owner: 'fp', kind: 'retreatTo' };
  check('exactly one destination is left', retreatDestinations(s).length === 1, retreatDestinations(s).join(','));
  s.pendingChoice = null;
  resolveRetreat(s, true);
  check('the defender is asked where to retreat', s.pendingChoice?.kind === 'retreatTo' && s.pendingChoice.owner === 'fp', JSON.stringify(s.pendingChoice));
  check('the Army has not moved yet', (s.regions['fords-of-isen'].units.rohan?.regular ?? 0) === 2);
  const legal = wotrAdapter.legalActions(s, 'fp');
  check('the one destination is the only offer', legal.length === 1 && legal[0].kind === 'retreatTo' && legal[0].region === keep, JSON.stringify(legal));
  const after = wotrAdapter.applyAction(s, legal[0], 'fp');
  check('clicking it retreats the Army there', (after.regions[keep].units.rohan?.regular ?? 0) === 2 && !after.regions['fords-of-isen'].units.rohan?.regular,
    JSON.stringify(after.regions[keep].units));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
