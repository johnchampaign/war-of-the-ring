#!/usr/bin/env vite-node
// probe-ai-1108.mjs — a Fortification is no capture.
//  - The Shadow bounced an Army between a Fortification and its neighbour, a die each way
//    (Westemnet <-> Fords of Isen in the snapshot of report xy4mcfzfpp6ut5i6; Fangorn <->
//    Fords of Isen on turns 10-12 of self-play seed 1): stepping back onto the empty Fords
//    scored as capturing a Free Peoples Settlement, though a Fortification is never
//    captured and is worth nothing (p.10).
//  - The Shadow walked one unit out of a two-unit Angmar beside an Elven Army in Arnor, then
//    pulled it straight back to shore the lone defender up: three Army dice between Angmar
//    and the Ettenmoors on turn 14 of self-play seed 3. Leaving a Stronghold or City on one
//    unit next to an enemy that can storm it now costs what refilling it would earn.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const show = (a) => JSON.stringify(a).slice(0, 120);

console.log('\n=== No march back onto an empty Fortification ===');
// Seed 1's turn-11 shape: Helm's Deep, Edoras and Minas Tirith already Shadow-held, so plan
// A aims at Pelargir; the Fellowship travelling (Progress 1); an Isengard/Sauron Army with
// the Witch-king in Fangorn, one region on from the empty Fords of Isen it just left.
for (const from of ['fangorn', 'westemnet']) {
  const s = startGame(createGame({ seed: 1 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].step = 0; s.nations[n].active = true; }
  s.shadowPlanRoll = 28; s.fellowship.progress = 1;
  Object.assign(s.regions['minas-tirith'], { units: { sauron: { regular: 3, elite: 0 } }, leaders: 0, control: 'shadow' });
  for (const r of ['helms-deep', 'edoras']) Object.assign(s.regions[r], { units: { isengard: { regular: 2, elite: 0 } }, leaders: 0, control: 'shadow' });
  for (const r of ['fangorn', 'fords-of-isen', 'eastemnet', 'westemnet']) Object.assign(s.regions[r], { units: {}, leaders: 0, nazgul: 0, characters: [], control: r === 'westemnet' ? 'shadow' : s.regions[r].control });
  Object.assign(s.regions[from], { units: { isengard: { regular: 0, elite: 2 }, sauron: { regular: 1, elite: 0 } }, nazgul: 1, characters: ['witch-king'] });
  s.dice.shadow = ['army']; s.dice.fp = ['muster'];
  const legal = wotrAdapter.legalActions(s, 'shadow').filter((x) => x.kind === 'moveArmy' && x.from === from && !x.move);
  const a = chooseAction(s, 'shadow', legal, new Rng(3));
  check(`${from}: not back onto the Fords of Isen, away from Pelargir`, legal.some((x) => x.to === 'fords-of-isen') && a.to !== 'fords-of-isen', show(a));
}

console.log('\n=== No lone defender left beside a stormer ===');
{
  const s = startGame(createGame({ seed: 3 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].step = 0; s.nations[n].active = true; }
  for (const n of ['elves', 'dwarves', 'north']) { s.nations[n].step = 0; s.nations[n].active = true; }
  // Only the Angmar pair and a lone Ettenmoors Elite on the board, as in the trace.
  for (const r of Object.keys(s.regions)) {
    const g = s.regions[r];
    for (const n of ['sauron', 'isengard', 'southrons']) delete g.units?.[n];
    g.nazgul = 0; g.characters = (g.characters ?? []).filter((c) => !['witch-king', 'saruman', 'mouth-of-sauron'].includes(c));
  }
  Object.assign(s.regions.angmar, { units: { sauron: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] });
  Object.assign(s.regions.ettenmoors, { units: { sauron: { regular: 0, elite: 1 } }, leaders: 0, nazgul: 0, characters: [] });
  Object.assign(s.regions.arnor, { units: { dwarves: { regular: 1, elite: 0 }, elves: { regular: 3, elite: 1 } }, leaders: 1, characters: [] });
  s.dice.shadow = ['army']; s.dice.fp = ['muster'];
  const legal = wotrAdapter.legalActions(s, 'shadow');
  const a = chooseAction(s, 'shadow', legal, new Rng(3));
  check('Angmar keeps both units while Arnor can storm it', legal.some((x) => x.kind === 'moveArmy' && x.from === 'angmar') && !(a.kind === 'moveArmy' && a.from === 'angmar'), show(a));
}

console.log(failures ? `\nFAIL: ${failures} failed` : '\nOK: all AI 11-08 checks pass');
process.exit(failures ? 1 : 0);
