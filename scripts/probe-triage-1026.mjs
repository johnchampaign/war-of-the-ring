#!/usr/bin/env vite-node
// probe-triage-1026.mjs — the 2026-10-26 reports.
//  4p396o3y0p4o5z45: The Breaking of the Fellowship logs its tile like any Hunt draw
//    ("Shadow draws a 3"), and the Companions it separates leave as ONE party on ONE
//    line, with the Guide change at the end — not one line per Companion.
//  2v1p6a0e69733u38: a Paths of the Woses split that marches every unit out of a
//    besieged Stronghold says nothing about the figures left inside stepping out (as
//    siegeFall says nothing); they still stand in the region and the Stronghold falls.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const msgs = (s) => s.log.map((e) => e.msg);
const onlyTile = (s, pred) => {
  s.hunt.pool = [STANDARD_TILE_LIST.findIndex(pred)];
  s.hunt.specialsInPool = []; s.hunt.drawn = []; s.hunt.specialsDrawn = [];
};

console.log('\n=== The Breaking of the Fellowship: one draw line, one separation line ===');
{
  let s = startGame(createGame({ seed: 11 }));
  s.fellowship.hidden = false;
  s.fellowship.companions = ['strider', 'boromir', 'legolas', 'gimli', 'meriadoc'];
  s.fellowship.guide = 'strider';
  onlyTile(s, (t) => t.value === 3);
  const before = s.log.length;
  getHandler('sh-char-14').apply(s, 'shadow');
  const drawn = msgs(s).slice(before);
  check('the draw reads like a Hunt draw', drawn.includes('Shadow draws a 3'), JSON.stringify(drawn));
  check('no "tile number" line', !drawn.some((m) => m.includes('tile number')));
  check('the Free Peoples choose 3', s.pendingChoice?.kind === 'breakingSep' && s.pendingChoice.data.left === 3);
  const mark = s.log.length;
  for (const c of ['strider', 'boromir', 'legolas']) s = wotrAdapter.applyAction(s, { kind: 'breakingSep', companion: c }, 'fp');
  const sep = msgs(s).slice(mark).filter((m) => m.includes('separate'));
  check('one separation line', sep.length === 1, JSON.stringify(sep));
  check('it names the party and the new Guide',
    sep[0] === `Strider, Boromir, Legolas separate from the Fellowship and move to ${s.fellowship.location}; Gimli becomes the Guide`, sep[0]);
  check('all three stand in the Fellowship\'s region',
    ['strider', 'boromir', 'legolas'].every((c) => s.characters.inPlay[c] === s.fellowship.location && s.regions[s.fellowship.location].characters.includes(c)));
  check('the choice is over', s.pendingChoice === null || s.pendingChoice.kind !== 'breakingSep');
}
{
  const s = startGame(createGame({ seed: 11 }));
  s.fellowship.hidden = false;
  onlyTile(s, (t) => t.value === 'eye');
  const before = s.log.length;
  getHandler('sh-char-14').apply(s, 'shadow');
  const drawn = msgs(s).slice(before);
  check('an Eye is drawn and discarded, in the Hunt\'s words', drawn.includes('Shadow draws an Eye, discarded without effect'), JSON.stringify(drawn));
  check('nobody has to separate', s.pendingChoice?.kind !== 'breakingSep');
}

console.log('\n=== Paths of the Woses leaves figures behind: no extra line ===');
{
  const s = startGame(createGame({ seed: 7 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['event']; s.dice.shadow = [];
  s.nations.rohan.active = true; s.nations.rohan.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  const hd = s.regions['helms-deep'];
  hd.units = { isengard: { regular: 4, elite: 0 } }; hd.leaders = 0; hd.characters = [];
  hd.besieged = true;
  hd.siegeBox = { units: { rohan: { regular: 2, elite: 0 } }, leaders: 0, nazgul: 0, characters: ['gimli'] };
  s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'gimli');
  s.characters.inPlay['gimli'] = 'helms-deep';
  s.regions['minas-tirith'].units = {};
  s.cards.fp.hand = ['fp-str-11'];
  const play = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'playEvent' && a.cardId === 'fp-str-11');
  let t = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'fp');
  const target = wotrAdapter.legalActions(t, 'fp').find((a) => a.kind === 'eventTarget' && a.from === 'helms-deep');
  const mark = t.log.length;
  t = wotrAdapter.applyAction(t, { ...target, move: { units: { rohan: { regular: 2 } } } }, 'fp');
  const lines = msgs(t).slice(mark);
  check('no "step out into the region" line', !lines.some((m) => m.includes('step out')), JSON.stringify(lines));
  check('the capture is still logged', lines.some((m) => m.includes('capture')), JSON.stringify(lines));
  check('Gimli stands in Helm\'s Deep', t.regions['helms-deep'].characters.includes('gimli'));
  check('the Stronghold fell', t.regions['helms-deep'].control === 'shadow' && !t.regions['helms-deep'].besieged);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
