#!/usr/bin/env vite-node
// probe-siege-character-die.mjs — a besieged garrison is still IN its region, so:
//   * Strider inside a besieged Minas Tirith can still be crowned (player report
//     84xepmomb9r6lvdn), and Gandalf the Grey inside one can still be replaced;
//   * a SORTIE may be paid for with a Character die, and the panel offers it —
//     the die list read the region (the BESIEGER's Leaders) instead of the
//     Stronghold Box (player report pi96ev7lwj6xzv9h).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { dieOptions } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const besiegedMT = (chars) => {
  const s = startGame(createGame({ seed: 91 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  for (const n of ['gondor', 'sauron']) { s.nations[n].active = true; s.nations[n].step = 0; }
  const mt = s.regions['minas-tirith'];
  mt.units = { sauron: { regular: 6, elite: 2 } }; mt.nazgul = 1; mt.besieged = true;
  mt.siegeBox = { units: { gondor: { regular: 2, elite: 1 } }, leaders: 1, nazgul: 0, characters: chars };
  for (const c of chars) s.characters.inPlay[c] = 'minas-tirith';
  return s;
};

console.log('\n=== Strider can be crowned inside a besieged Minas Tirith ===');
{
  const s = besiegedMT(['strider']); s.dice.fp = ['will']; s.dice.shadow = [];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const crown = legal.find((a) => a.kind === 'bringUpgrade' && a.which === 'aragorn');
  check('Crown Aragorn is offered', !!crown, JSON.stringify(legal.filter((a) => a.kind === 'bringUpgrade')));
  if (crown) {
    const t = wotrAdapter.applyAction(s, crown, 'fp');
    const box = t.regions['minas-tirith'].siegeBox;
    check('Aragorn stands where Strider stood — inside the Stronghold', box.characters.includes('aragorn') && !box.characters.includes('strider'), `box: ${box.characters.join(',')}`);
  }
}
console.log('\n=== a sortie may be paid for with a Character die ===');
{
  const s = besiegedMT([]); s.dice.fp = ['character']; s.dice.shadow = [];
  const sortie = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'attack' && a.from === a.to);
  check('the sortie is legal with only a Character die', !!sortie, 'the garrison has a Leader');
  if (sortie) {
    check('the panel offers the Character die for it', dieOptions(sortie, s, 'fp').includes('character'), JSON.stringify(dieOptions(sortie, s, 'fp')));
    const t = wotrAdapter.applyAction(s, { ...sortie, die: 'character' }, 'fp');
    check('...and it actually starts the battle', !!t.pendingCombat || !!t.pendingChoice, `combat ${!!t.pendingCombat}`);
  }
}
console.log('\n=== a garrison with NO Leader still cannot sortie on a Character die ===');
{
  const s = besiegedMT([]); s.regions['minas-tirith'].siegeBox.leaders = 0; s.dice.fp = ['character']; s.dice.shadow = [];
  const sortie = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'attack' && a.from === a.to);
  check('no Character-die sortie without a Leader in the box', !sortie, JSON.stringify(sortie ?? null));
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
