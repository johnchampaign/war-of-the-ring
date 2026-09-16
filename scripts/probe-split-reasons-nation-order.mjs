#!/usr/bin/env vite-node
// probe-split-reasons-nation-order.mjs — a refused split names the rule it broke, and
// the UI lists Nations in rulebook order.
//
// Player report 5j5j6p09554n1q5s: a Will-of-the-West split out of Lórien that left the
// Elven Leader behind was refused with "a Character-die army move must take a Leader or
// Character" — the wrong rule, and the player hadn't used a Character die. The real
// reason is p.27: a Free Peoples Leader can never be left without combat units.
// Player report 1t2o400j3g3t286i: Shadow Nations read Isengard, Sauron, Southrons &
// Easterlings in the rulebook, but the UI followed the engine's Sauron-first order.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { splitBlockReason, moveArmySplit } from '../src/engine/armies.ts';
import { inNationOrder } from '../src/play/names.ts';
import { describeAction } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const base = () => {
  const s = startGame(createGame({ seed: 11 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['will']; s.dice.shadow = [];
  s.regions['lorien'].units = { elves: { regular: 2, elite: 0 } }; s.regions['lorien'].leaders = 1;
  s.regions['lorien'].characters = [];
  s.regions['dimrill-dale'].units = {}; s.regions['dimrill-dale'].leaders = 0;
  return s;
};

console.log('\n=== a split that strands an FP Leader says so ===');
{
  const s = base();
  const sel = { units: { elves: { regular: 2 } }, leaders: 0 };
  const why = splitBlockReason(s, 'lorien', 'dimrill-dale', 'fp', sel, false);
  check('the engine refuses the split', !moveArmySplit(structuredClone(s), 'lorien', 'dimrill-dale', 'fp', sel, false));
  check('the reason is the stranded-Leader rule', !!why && why.includes('Leaders can never be left'), why ?? 'null');
  check('the reason does not blame a Character die', !!why && !why.includes('Character-die'), why ?? 'null');
  let msg = '';
  try { wotrAdapter.applyAction(s, { kind: 'moveArmy', from: 'lorien', to: 'dimrill-dale', die: 'will', move: sel }, 'fp'); }
  catch (e) { msg = e.message; }
  check('the adapter throws that same sentence', msg === why, msg);
  const legal = splitBlockReason(s, 'lorien', 'dimrill-dale', 'fp', { units: { elves: { regular: 2 } }, leaders: 1 }, false);
  check('taking the Leader along is legal', legal === null, legal ?? 'null');
}

console.log('\n=== a Character-die split without a Leader still names the Character-die rule ===');
{
  const s = base();
  s.dice.fp = ['character'];
  const why = splitBlockReason(s, 'lorien', 'dimrill-dale', 'fp', { units: { elves: { regular: 1 } }, leaders: 0 }, true);
  check('the reason is the Character-die rule', !!why && why.includes('Character-die'), why ?? 'null');
}

console.log('\n=== Nations in rulebook order ===');
{
  const acts = [
    { kind: 'pass' },
    { kind: 'diplomaticAction', nation: 'sauron' },
    { kind: 'diplomaticAction', nation: 'southrons' },
    { kind: 'drawEvent', deck: 'character' },
    { kind: 'diplomaticAction', nation: 'isengard' },
  ];
  const out = inNationOrder(acts);
  check('Isengard, Sauron, Southrons & Easterlings', out.filter((a) => a.nation).map((a) => a.nation).join(',') === 'isengard,sauron,southrons', JSON.stringify(out));
  check('other entries keep their slots', out[0].kind === 'pass' && out[3].kind === 'drawEvent');
  const label = describeAction({ kind: 'diplomaticAction', nation: 'southrons' });
  check('the button spells out Southrons & Easterlings', label === 'Diplomacy: advance Southrons & Easterlings', label);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
