#!/usr/bin/env vite-node
// probe-hobbit-guide-agency.mjs — when Merry/Pippin leaves as the Hobbit Guide to draw
// off the Hunt, the PLAYER places him (board click, up to Progress + Level from the
// Fellowship), the same deferred placement Take Them Alive uses. The engine used to
// pick the region itself (player report 5b38532p240s6o69: "the move was legal but I
// had no agency in placing him").
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
let s = startGame(createGame({ seed: 71 }));
s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
s.fellowship.location = 'dimrill-dale'; s.fellowship.progress = 2; s.fellowship.corruption = 4; s.fellowship.hidden = true;
s.fellowship.companions = ['meriadoc', 'peregrin']; s.fellowship.guide = 'meriadoc';
s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: false } };

console.log('\n=== the Hobbit Guide draws off the Hunt: placement is the player\'s ===');
const legal = wotrAdapter.legalActions(s, 'fp');
check('reduceSeparate is offered', legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceSeparate'));
s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'reduceSeparate' }, 'fp');
check('Merry left the Fellowship', !s.fellowship.companions.includes('meriadoc'), s.fellowship.companions.join(','));
check('...and is NOT yet on the board', !Object.values(s.regions).some((r) => r.characters.includes('meriadoc')));
check('a separateMove placement is pending for the Free Peoples', s.pendingChoice?.kind === 'separateMove' && s.pendingChoice.owner === 'fp', JSON.stringify(s.pendingChoice));
const d = s.pendingChoice?.data ?? {};
check('range is Progress + Level (2 + 1) from the Fellowship\'s region', d.range === 3 && d.from === 'dimrill-dale' && d.companions?.[0] === 'meriadoc', JSON.stringify(d));
const places = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'separateMove' && a.target);
check('several destinations are offered', places.length > 1, `${places.length} targets`);
if (places.length) {
  const pick = places.find((a) => a.target !== 'dimrill-dale') ?? places[0];
  s = wotrAdapter.applyAction(s, pick, 'fp');
  check(`Merry stands where the player put him (${pick.target})`, s.regions[pick.target].characters.includes('meriadoc'));
  check('the Hunt is fully resolved', s.pendingChoice === null, JSON.stringify(s.pendingChoice));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
