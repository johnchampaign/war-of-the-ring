#!/usr/bin/env vite-node
// probe-triage-1010b.mjs — player reports 64185k012e1r6d0n and 634k193f614n105n:
// placing the revealed Ring-bearers, and landing a separating group, explain a
// refused map click. Each reason must agree exactly with the moves on offer: a
// region gets no reason iff it is a legal landing.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { REGIONS } from '../src/engine/data.ts';
import { separationDestinations, separationBlockReason, revealMoveBlockReason } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const ALL = Object.keys(REGIONS);

console.log('\n=== 1. the revealed Fellowship: a reason exactly where the move is refused ===');
for (const [loc, progress] of [['fangorn', 2], ['north-ithilien', 3], ['rivendell', 1], ['osgiliath', 2]]) {
  const s = startGame(createGame({ seed: 5 }));
  s.phase = 'actionResolution';
  s.fellowship.location = loc; s.fellowship.progress = progress; s.fellowship.hidden = false;
  s.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  const legal = new Set(wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'revealMove').map((a) => a.target));
  const bad = ALL.filter((r) => r !== loc && (revealMoveBlockReason(s, r) === null) !== legal.has(r));
  check(`from ${loc}, Progress ${progress}`, bad.length === 0, bad.slice(0, 5).join(', '));
}
{
  const s = startGame(createGame({ seed: 5 }));
  s.fellowship.location = 'osgiliath'; s.fellowship.progress = 2;
  const why = revealMoveBlockReason(s, 'minas-tirith') ?? '';
  check('Minas Tirith names the City/Stronghold rule', /Free Peoples Stronghold the Free Peoples still control/.test(why), why);
  const far = revealMoveBlockReason(s, 'the-shire') ?? '';
  check('a far region says it is out of reach', /out of reach.*at most 2 regions/.test(far), far);
}

console.log('\n=== 2. a separating group: a reason exactly where the landing is refused ===');
for (const [from, range] of [['fangorn', 3], ['moria', 2], ['rivendell', 4], ['minas-tirith', 3]]) {
  for (const siege of [false, true]) {
    const s = startGame(createGame({ seed: 5 }));
    if (siege) { s.regions['helms-deep'].besieged = true; s.regions['minas-tirith'].besieged = true; }
    const legal = new Set(separationDestinations(s, from, range));
    const bad = ALL.filter((r) => (separationBlockReason(s, from, r, range) === null) !== legal.has(r));
    check(`from ${from}, range ${range}${siege ? ', Strongholds besieged' : ''}`, bad.length === 0, bad.slice(0, 5).join(', '));
  }
}
{
  const s = startGame(createGame({ seed: 5 }));
  s.regions['minas-tirith'].besieged = true;
  const why = separationBlockReason(s, 'osgiliath', 'minas-tirith', 3) ?? '';
  check('a besieged Stronghold says so', /under siege/.test(why), why);
  const sealed = separationBlockReason(s, 'minas-tirith', 'osgiliath', 3) ?? '';
  check('separating inside a besieged Stronghold says they cannot leave', /cannot leave/.test(sealed), sealed);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
