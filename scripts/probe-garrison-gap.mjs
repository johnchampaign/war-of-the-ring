#!/usr/bin/env vite-node
// probe-garrison-gap.mjs — a ONE-unit garrison in a threatened VP Stronghold is
// still a garrison to muster into. Uploaded games (2026-08-25..09-07): 44 human
// 4-VP military wins over the Shadow AI, and nearly every Stronghold taken had
// exactly one unit in it ('1R') — the garrison split stopped the walk-ins, and
// then the human simply stormed the lone figure. `garrisonGap` grades the need
// (empty 1, one unit 0.6, two 0.3) instead of switching off at the first unit.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { Rng } from 'digital-boardgame-framework';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const setup = (dgUnits) => {
  const s = startGame(createGame({ seed: 21 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.dice.shadow = ['muster']; s.dice.fp = []; s.pendingChoice = null;
  s.regions['dol-guldur'].units = dgUnits ? { sauron: { regular: dgUnits, elite: 0 } } : {};
  s.regions['dol-guldur'].nazgul = 0;
  // A Free Peoples stack next door: the human's Lórien/Woodland army on its way in.
  s.regions['narrows-of-the-forest'].units = { elves: { regular: 4, elite: 2 } };
  s.regions['narrows-of-the-forest'].leaders = 1;
  return s;
};
const legal = [
  { kind: 'recruitUnit', nation: 'sauron', region: 'dol-guldur', regular: 1, elite: 0, then: 'regular' },
  { kind: 'recruitUnit', nation: 'sauron', region: 'barad-dur', regular: 1, elite: 0, then: 'regular' },
  { kind: 'recruitUnit', nation: 'sauron', region: 'moria', regular: 1, elite: 0, then: 'regular' },
  { kind: 'skipDie', die: 'muster' },
];

console.log('\n=== a lone unit in Dol Guldur with an Elf army next door: muster INTO it ===');
{
  const pick = chooseAction(setup(1), 'shadow', legal, new Rng(4));
  check('one-unit garrison gets the recruit', pick.kind === 'recruitUnit' && pick.region === 'dol-guldur', JSON.stringify(pick));
}
console.log('\n=== empty Dol Guldur (the case the term was introduced for) still does ===');
{
  const pick = chooseAction(setup(0), 'shadow', legal, new Rng(4));
  check('empty garrison gets the recruit', pick.kind === 'recruitUnit' && pick.region === 'dol-guldur', JSON.stringify(pick));
}
console.log('\n=== with three units already inside, the garrison term is silent ===');
{
  // Compare against a copy where the threat is removed: with no gap and no threat
  // the choice must be the same, i.e. the garrison term contributed nothing.
  const a = setup(3);
  const b = setup(3); b.regions['narrows-of-the-forest'].units = {}; b.regions['narrows-of-the-forest'].leaders = 0;
  const pa = chooseAction(a, 'shadow', legal, new Rng(4)), pb = chooseAction(b, 'shadow', legal, new Rng(4));
  check('same pick with and without the neighbouring army', JSON.stringify(pa) === JSON.stringify(pb), `${JSON.stringify(pa)} vs ${JSON.stringify(pb)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
