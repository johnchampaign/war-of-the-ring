#!/usr/bin/env vite-node
// probe-in-play-cards.mjs — "Play if X is in play" means X has entered AND has not
// since been eliminated. Return of the Witch-king checked only that he had entered, so a
// fallen Witch-king stood up again in Angmar (player report riwixp8f8cyn1ktr). The King
// is Revealed (Aragorn) and the three Ents Awake cards (Gandalf the White) had the same
// slip.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== a fallen figure is not "in play" ===');
for (const [card, who] of [['sh-str-12', 'witch-king'], ['sh-str-18', 'aragorn'], ['fp-char-19', 'gandalf-white']]) {
  const s = startGame(createGame({ seed: 9 }));
  for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
  s.characters.entered.push(who);
  if (card === 'fp-char-19') { s.regions.fangorn.characters.push('strider'); s.characters.inPlay.strider = 'fangorn'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'strider'); s.regions.orthanc.units = { isengard: { regular: 2, elite: 0 } }; }
  const h = getHandler(card);
  s.characters.inPlay[who] = 'angmar'; s.regions.angmar.characters.push(who);
  const alive = h.canPlay(s, card.startsWith('sh') ? 'shadow' : 'fp');
  s.regions.angmar.characters = s.regions.angmar.characters.filter((c) => c !== who); delete s.characters.inPlay[who];
  s.characters.eliminated.push(who);
  const dead = h.canPlay(s, card.startsWith('sh') ? 'shadow' : 'fp');
  check(`${card}: playable while ${who} is in play, not once he has fallen`, alive && !dead, `alive=${alive} dead=${dead}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
