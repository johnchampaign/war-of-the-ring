#!/usr/bin/env vite-node
// probe-retreat-hints.mjs — player report 6z172r5s4x731j62: "Let's also add hints for
// illegal destinations when retreating." While a retreat destination is being picked,
// a click on a region that is not highlighted now says why. The explanation must agree
// with the offer exactly: no reason for every offered region, a reason for every other
// neighbour, and it must work on the redacted view the UI holds.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { retreatDestinations, retreatBlockReason, preCombatRetreatDestinations } from '../src/engine/combat.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== a refused retreat click says why ===');
{
  // An FP Army in Fords of Isen, attacked from Orthanc; Westemnet is an empty
  // Shadow-held Town and an Isengard Army stands in Gap of Rohan.
  const s = startGame(createGame({ seed: 12 }));
  s.phase = 'actionResolution';
  s.regions['westemnet'].units = {}; s.regions['westemnet'].control = 'shadow';
  s.regions['gap-of-rohan'].units = { isengard: { regular: 2, elite: 0 } };
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'orthanc', to: 'fords-of-isen', round: 1 };
  s.pendingChoice = { owner: 'fp', kind: 'retreatTo' };
  const dests = retreatDestinations(s);
  const adj = REGIONS['fords-of-isen'].adjacency;
  check('some neighbour is still offered', dests.length > 0, dests.join(','));
  check('no offered destination carries a reason', dests.every((r) => retreatBlockReason(s, r) === null));
  const refused = adj.filter((r) => !dests.includes(r));
  check('every refused neighbour carries one', refused.length > 0 && refused.every((r) => !!retreatBlockReason(s, r)),
    refused.map((r) => `${r}: ${retreatBlockReason(s, r)}`).join(' | '));
  check('the attackers\' region names the rule', /attack came from Orthanc/.test(retreatBlockReason(s, 'orthanc') ?? ''), retreatBlockReason(s, 'orthanc'));
  check('an enemy Army is named', /enemy Army in Gap of Rohan/.test(retreatBlockReason(s, 'gap-of-rohan') ?? ''), retreatBlockReason(s, 'gap-of-rohan'));
  check('an empty enemy Settlement is explained', /controlled by the enemy/.test(retreatBlockReason(s, 'westemnet') ?? ''), retreatBlockReason(s, 'westemnet'));
  check('a far region says a retreat moves one region', /moves one region/.test(retreatBlockReason(s, 'minas-tirith') ?? ''), retreatBlockReason(s, 'minas-tirith'));
  check('the battle\'s own region points at the highlights', /highlighted/.test(retreatBlockReason(s, 'fords-of-isen') ?? ''));
  const view = wotrAdapter.viewFor(s, 'fp');
  check('the redacted view gives the same answers', adj.every((r) => retreatBlockReason(view, r) === retreatBlockReason(s, r)));
  s.pendingChoice = null;
  check('outside a retreat pick it stays silent', retreatBlockReason(s, 'westemnet') === null);
}

console.log('\n=== the pre-combat retreat (Scouts) explains itself the same way ===');
{
  const s = startGame(createGame({ seed: 12 }));
  s.phase = 'actionResolution';
  s.regions['westemnet'].units = {}; s.regions['westemnet'].control = 'shadow';
  s.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  s.pendingCombat = { attacker: 'fp', defender: 'shadow', from: 'fords-of-isen', to: 'orthanc', round: 1, preCombatRetreatFrom: 'fords-of-isen' };
  s.pendingChoice = { owner: 'fp', kind: 'preCombatRetreat' };
  const dests = preCombatRetreatDestinations(s);
  const adj = REGIONS['fords-of-isen'].adjacency;
  check('offered regions carry no reason, the rest do',
    adj.every((r) => (retreatBlockReason(s, r) === null) === dests.includes(r)),
    adj.map((r) => `${r}: ${retreatBlockReason(s, r)}`).join(' | '));
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
