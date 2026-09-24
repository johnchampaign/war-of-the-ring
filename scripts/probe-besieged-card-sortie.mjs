#!/usr/bin/env vite-node
// probe-besieged-card-sortie.mjs — two player reports from 2026-09-24, both an Event
// card that could not see an Army shut inside a besieged Stronghold.
//
//   1. "The Grey Company doesn't work when Strider / Aragorn is besieged in a
//      Stronghold" (4a643h5l3p664m23) — the upgrade looked for Regulars in the open
//      field (the besieger's) instead of Strider's own garrison in the siege box.
//   2. "The Black Captain Commands and The Ringwraiths Are Abroad don't work for
//      sorties" (531h4p6p29375a1m) — both cards grant an attack with a Nazgûl-led Army,
//      and a sortie (p.32) is an attack; neither enumerator looked inside the box.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed = 11) => startGame(createGame({ seed }));
function besiege(state, region, field, box) {
  const r = state.regions[region];
  r.units = field.units; r.leaders = field.leaders ?? 0; r.nazgul = field.nazgul ?? 0; r.characters = field.characters ?? [];
  r.besieged = true;
  r.siegeBox = { units: box.units, leaders: box.leaders ?? 0, nazgul: box.nazgul ?? 0, characters: box.characters ?? [] };
  return r;
}
const isSortie = (t, id) => t.mode === 'attack' && t.from === id && t.to === id;

{
  console.log('\n=== The Grey Company: Strider besieged in Helm\'s Deep (report 4a643h5l) ===');
  const s = fresh();
  besiege(s, 'helms-deep',
    { units: { isengard: { regular: 4, elite: 2 } } },
    { units: { rohan: { regular: 2, elite: 0 } }, characters: ['strider'] });
  s.reinforcements.rohan.elite = 2;
  check('the card is playable', canPlayCard(s, 'fp-char-24', 'fp'));
  const h = getHandler('fp-char-24');
  const t = h.targets(s, 'fp');
  check('it offers the Rohan upgrade', t.length === 1 && t[0].nation === 'rohan', JSON.stringify(t));
  if (t[0]) h.applyTarget(s, 'fp', t[0]);
  const box = s.regions['helms-deep'].siegeBox.units.rohan;
  check('the GARRISON Regular became an Elite', box.regular === 1 && box.elite === 1, JSON.stringify(box));
  check('the Elite came from reinforcements', s.reinforcements.rohan.elite === 1);
  check('the besieger is untouched', s.regions['helms-deep'].units.isengard.regular === 4 && s.regions['helms-deep'].units.isengard.elite === 2);
}

function dolGuldurSiege(boxExtra) {
  const s = fresh();
  s.nations.sauron.step = 0;
  if (boxExtra.characters?.includes('witch-king')) s.characters.entered.push('witch-king');
  besiege(s, 'dol-guldur',
    { units: { elves: { regular: 3, elite: 1 } } },
    { units: { sauron: { regular: 3, elite: 1 } }, ...boxExtra });
  return s;
}

{
  console.log('\n=== The Ringwraiths Are Abroad: a Nazgûl in a besieged Dol Guldur may sortie (report 531h4p6p) ===');
  const s = dolGuldurSiege({ nazgul: 1 });
  check('the card is playable', canPlayCard(s, 'sh-char-23', 'shadow'));
  const t = getHandler('sh-char-23').targets(s, 'shadow', []);
  check('a sortie from Dol Guldur is offered', t.some((x) => isSortie(x, 'dol-guldur')));
  getHandler('sh-char-23').applyTarget(s, 'shadow', t.find((x) => isSortie(x, 'dol-guldur')));
  check('the battle starts as a sortie by the Shadow', !!s.pendingCombat && s.pendingCombat.attacker === 'shadow' && s.pendingCombat.boxed === 'shadow',
    JSON.stringify(s.pendingCombat && { a: s.pendingCombat.attacker, b: s.pendingCombat.boxed }));
}

{
  console.log('\n=== The Ringwraiths Are Abroad: no Nazgûl in the garrison, no sortie ===');
  const s = dolGuldurSiege({});
  const t = getHandler('sh-char-23').targets(s, 'shadow', []);
  check('no sortie from Dol Guldur', !t.some((x) => isSortie(x, 'dol-guldur')));
}

{
  console.log('\n=== The Black Captain Commands: the Witch-king leads a sortie ===');
  const s = dolGuldurSiege({ characters: ['witch-king'] });
  check('the card is playable', canPlayCard(s, 'sh-char-24', 'shadow'));
  const t = getHandler('sh-char-24').targets(s, 'shadow', []);
  check('a sortie from Dol Guldur is offered', t.some((x) => isSortie(x, 'dol-guldur')));
  getHandler('sh-char-24').applyTarget(s, 'shadow', t.find((x) => isSortie(x, 'dol-guldur')));
  check('the battle starts as a sortie by the Shadow', !!s.pendingCombat && s.pendingCombat.boxed === 'shadow');
}

{
  console.log('\n=== The Black Captain Commands: a sortie still needs a unit At War ===');
  const s = dolGuldurSiege({ characters: ['witch-king'] });
  s.nations.sauron.step = 1;
  const t = getHandler('sh-char-24').targets(s, 'shadow', []);
  check('no sortie while Sauron is not At War', !t.some((x) => isSortie(x, 'dol-guldur')));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
