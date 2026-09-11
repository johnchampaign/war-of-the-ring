#!/usr/bin/env vite-node
// probe-trivial-die.mjs — the only die choices settled without asking are a plain
// Army die against the Army/Muster hybrid, and a plain Muster die against it: the
// hybrid does everything the plain die does, so spending it first is strictly worse
// (player report 4w2p23491g062m5l). Anything involving a Will of the West, a
// Character die or an Event die is a REAL choice and must still be asked, because
// those dice carry costs of their own (The Day Without Dawn discards Will dice).
import { trivialDie, dieOptions } from '../src/play/actionText.ts';
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== the two trivial cases are settled silently ===');
check('Army vs Army/Muster spends the plain Army die', trivialDie(['army', 'armyMuster']) === 'army');
check('Muster vs Army/Muster spends the plain Muster die', trivialDie(['armyMuster', 'muster']) === 'muster');

console.log('\n=== everything else still asks ===');
for (const [label, opts] of [
  ['a Will of the West is in the mix', ['army', 'armyMuster', 'will']],
  ['Will vs the plain die', ['army', 'will']],
  ['a Character die is in the mix', ['army', 'armyMuster', 'character']],
  ['Character vs Army (a Leader-led attack)', ['army', 'character']],
  ['an Event die for a card', ['event', 'will']],
  ['three dice of any kind', ['muster', 'armyMuster', 'will']],
]) check(label, trivialDie(opts) === null, JSON.stringify(opts));
check('a single option is not a "choice" at all', trivialDie(['army']) === null);

console.log('\n=== in a real position: a muster with Muster + hybrid in the pool ===');
{
  const s = startGame(createGame({ seed: 101 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['muster', 'armyMuster'];
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  const recruit = { kind: 'recruitUnit', nation: 'sauron', region: 'barad-dur', regular: 1, elite: 0 };
  const opts = dieOptions(recruit, s, 'shadow');
  check('both dice could pay', opts.length === 2, JSON.stringify(opts));
  check('...and the plain Muster die is chosen for you', trivialDie(opts) === 'muster', JSON.stringify(opts));
  s.dice.shadow = ['muster', 'armyMuster', 'character'];
  check('adding a Character die does not change it (it cannot muster)', trivialDie(dieOptions(recruit, s, 'shadow')) === 'muster');
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
