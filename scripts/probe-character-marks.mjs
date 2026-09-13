#!/usr/bin/env vite-node
// probe-character-marks.mjs — every figure that can stand on the map carries a mark
// unique to it. First initials alone were not enough: Gandalf and Gimli were both a
// bare "G", so they were indistinguishable on the board (player report
// 134422574z465h4b). This keeps that from coming back — a new Character with a
// colliding initial fails here rather than in someone's game.
import charsData from '../assets/characters.json';
import { ALL_CHAR_MARKS, charMark, charName } from '../src/play/charInfo.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const ids = [
  ...Object.keys(charsData.companions ?? {}),
  ...Object.keys(charsData.upgrades ?? {}),
  ...Object.keys(charsData.minions ?? {}),
  'gollum', 'nazgul',
];

console.log('\n=== every figure on the map has a mark of its own ===');
const missing = ids.filter((id) => !charMark(id));
check('no figure is left without one', missing.length === 0, missing.join(', ') || 'none');
const seen = new Map();
for (const id of ids) {
  const m = charMark(id); if (!m) continue;
  const prev = seen.get(m.label);
  if (prev) check(`"${m.label}" is used twice`, false, `${charName(prev)} and ${charName(id)}`);
  seen.set(m.label, id);
}
check('all marks are distinct', seen.size === ids.filter((id) => charMark(id)).length, `${seen.size} marks for ${ids.length} figures`);
check('none is longer than two characters (they sit in a ~15px disc)',
  [...seen.keys()].every((l) => [...l].length <= 2), [...seen.keys()].filter((l) => [...l].length > 2).join(',') || 'none');

console.log('\n=== the pairs that actually collided are now separable ===');
for (const [a, b] of [['gandalf-grey', 'gimli'], ['gandalf-grey', 'gandalf-white'], ['strider', 'aragorn'], ['meriadoc', 'mouth-of-sauron'], ['saruman', 'strider']]) {
  const ma = charMark(a), mb = charMark(b);
  check(`${charName(a)} vs ${charName(b)}`, ma.label !== mb.label, `${ma.label} / ${mb.label}`);
}
check('the Gandalfs differ in ink as well as letters', charMark('gandalf-grey').ink !== charMark('gandalf-white').ink);
check('the Witch-king keeps his Eye', charMark('witch-king').label === '👁');
console.log(`\n  marks: ${ids.map((id) => `${charName(id)}=${charMark(id)?.label ?? '?'}`).join(', ')}`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
