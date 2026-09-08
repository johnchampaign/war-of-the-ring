#!/usr/bin/env vite-node
// probe-declare-tiebreak.mjs — two declare targets equally close to the Morannon:
// the FP AI takes the one farther from the Shadow's pieces and next to a heal spot
// (player report 2026-09-08: N Anduin Vale, one step from Dol Guldur, was chosen
// over Parth Celebrant, which sits beside Lórien).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { Rng } from 'digital-boardgame-framework';
import { chooseAction, dist } from '../src/ai/wotrAI.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const s = startGame(createGame({ seed: 41 }));
s.phase = 'fellowship'; s.currentPlayer = 'fp'; s.pendingChoice = null;
// Start far enough back that either target gains >= 3 regions toward the Morannon.
const far = Object.keys(REGIONS).find((r) => dist(r, 'morannon') >= 8 && dist(r, 'north-anduin-vale') <= 4 && dist(r, 'parth-celebrant') <= 4);
s.fellowship.location = far; s.fellowship.progress = 4; s.fellowship.corruption = 1; s.fellowship.hidden = true;
console.log(`  (Fellowship at ${far}: ${dist(far, 'morannon')} from the Morannon; both targets 5)`);
const mk = (order) => order.map((target) => ({ kind: 'declareFellowship', target })).concat([{ kind: 'skipFellowshipPhase' }]);

console.log('\n=== N Anduin Vale listed first: Parth Celebrant still wins the tie ===');
{
  const pick = chooseAction(s, 'fp', mk(['north-anduin-vale', 'parth-celebrant']), new Rng(2));
  check('declares at Parth Celebrant', pick.kind === 'declareFellowship' && pick.target === 'parth-celebrant', JSON.stringify(pick));
}
console.log('\n=== ...and in the other order (it is not list order) ===');
{
  const pick = chooseAction(s, 'fp', mk(['parth-celebrant', 'north-anduin-vale']), new Rng(2));
  check('declares at Parth Celebrant', pick.kind === 'declareFellowship' && pick.target === 'parth-celebrant', JSON.stringify(pick));
}
console.log('\n=== a Shadow Army camped on Parth Celebrant flips it ===');
{
  const t = structuredClone(s); t.regions['parth-celebrant'].units = { sauron: { regular: 3, elite: 0 } };
  const pick = chooseAction(t, 'fp', mk(['north-anduin-vale', 'parth-celebrant']), new Rng(2));
  check('declares at N Anduin Vale instead', pick.kind === 'declareFellowship' && pick.target === 'north-anduin-vale', JSON.stringify(pick));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
