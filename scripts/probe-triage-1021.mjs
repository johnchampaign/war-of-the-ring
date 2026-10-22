#!/usr/bin/env vite-node
// probe-triage-1021.mjs — the 2026-10-21 reports.
//  2h071a3f5o12180m / 1n731y0v682u2d3v: There Is Another Way's hide went around
//    hideFellowship, so the turn was never marked as one the Fellowship acted in and
//    the Mordor Track still billed "lingering" Corruption ("has not attempted to move
//    or hide the Fellowship", p.43). It now hides like every other hide.
//  0i384x5e5e3j6m2v: every Hunt tile drawn gets its own line, and the closing line
//    says what the Ring cost ("for using the Ring (3 → 4)"), not "Hunt resolved".
//  681z6z1d0a3b4l26: victory lines in the rulebook's words (p.44).
//  390h4x2m1f2i3917: an Event card's Hunt draw no longer repeats the card's name —
//    the line above already says "Shadow plays Orc Patrol"; a Stronghold reveal keeps it.
//  384y5h3c5c1d3m0l: the Companion is the subject of his own casualty line, in the
//    active voice ("Strider sacrifices himself …", "…, drawn at random, …").
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { extraHunt, resolveMordorStep, resolveHuntDamage } from '../src/engine/hunt.ts';
import { checkRingVictory, checkMilitaryVictory } from '../src/engine/victory.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => startGame(createGame({ seed: 11 }));
const msgs = (s) => s.log.map((e) => e.msg);
const onlyTile = (s, pred) => {
  s.hunt.pool = [STANDARD_TILE_LIST.findIndex(pred)];
  s.hunt.specialsInPool = []; s.hunt.drawn = []; s.hunt.specialsDrawn = [];
};

console.log('\n=== There Is Another Way hides through the normal hide ===');
{
  const s = fresh();
  s.fellowship.hidden = false;
  s.flags.fellowshipDeclaredOrMovedThisTurn = false;
  getHandler('fp-char-10').applyTarget(s, 'fp', { mode: 'hide' }, []);
  check('the Fellowship is hidden', s.fellowship.hidden === true);
  check('the turn counts as one the Fellowship acted in', s.flags.fellowshipDeclaredOrMovedThisTurn === true);
  check('the generic hide line', msgs(s).at(-1) === 'The Fellowship hides', msgs(s).at(-1));
}

console.log('\n=== Hunt tiles get their own line ===');
{
  const s = fresh();
  s.fellowship.hidden = false;
  onlyTile(s, (t) => t.value === 'eye');
  extraHunt(s, { source: 'revealed through Moria' });
  check('a Stronghold Eye: drawn and discarded', msgs(s).at(-1) === 'Shadow draws an Eye (Moria), discarded without effect', msgs(s).at(-1));
}
{
  const s = fresh();
  s.fellowship.mordor = 0; s.fellowship.hidden = false; // revealed: Gollum has no reveal-to-reduce, so no prompt
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.fellowship.corruption = 3;
  s.hunt.box = 1; s.hunt.fpDiceInBox = 0;
  onlyTile(s, (t) => t.value === 1 && !t.reveal);
  resolveMordorStep(s);
  const m = msgs(s);
  check('the drawn tile is named', m.includes('Shadow draws a 1'), m.slice(-4).join(' | '));
  check('the cost names the Ring and the track', m.includes('The Ring-bearers suffer 1 Corruption for using the Ring (3 → 4)'), m.slice(-4).join(' | '));
  check('no "Hunt resolved"', !m.some((x) => x.startsWith('Hunt resolved')));
}

console.log('\n=== an Event card\'s draw does not repeat the card ===');
for (const mode of ['guide', 'random']) {
  const s = fresh();
  s.fellowship.hidden = false;
  onlyTile(s, (t) => t.value === 2 && !t.reveal);
  extraHunt(s, { source: 'Orc Patrol' });
  check('the draw line names no source', msgs(s).includes('Shadow draws a 2'), msgs(s).slice(-2).join(' | '));
  check('the damage prompt still names the card', s.pendingChoice?.data?.source === 'Orc Patrol');
  const guide = s.fellowship.guide;
  resolveHuntDamage(s, mode);
  const line = msgs(s).find((m) => m.includes('to absorb'));
  check(`${mode} casualty in the active voice`, mode === 'guide'
    ? /^Gandalf the Grey sacrifices himself to absorb 2 Corruption — .+ becomes the Guide$/.test(line ?? '') && guide === 'gandalf-grey'
    : /^\S.*, drawn at random, (sacrifices himself|is taken alive) to absorb \d Corruption/.test(line ?? ''), line);
}

console.log('\n=== victory lines in the rulebook\'s words ===');
{
  const s = fresh(); s.fellowship.corruption = 12; checkRingVictory(s);
  check('corruption', s.winReason === 'The Ring-bearers succumb to the Ring (12 Corruption)', s.winReason);
  const t = fresh(); t.victoryPoints.shadow = 10; checkMilitaryVictory(t);
  check('Shadow military', t.winReason === 'The Shadow conquers Middle-earth (10 Victory Points)', t.winReason);
  const u = fresh(); u.victoryPoints.fp = 4; checkMilitaryVictory(u);
  check('FP military', u.winReason === 'Sauron is banished from Middle-earth (4 Victory Points)', u.winReason);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nprobe-triage-1021 OK');
