#!/usr/bin/env vite-node
// probe-nazgul-card-fly.mjs — "move any or all of the Nazgûl" moves each figure once,
// not each REGION once. Flying the Witch-king out of a region used to pin the Nazgûl
// he left behind on The Black Captain Commands (player report 2m6j6f1z5w07390y), and a
// stack could not split two ways.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function board() {
  const s = startGame(createGame({ seed: 8 }));
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  s.regions['moria'].nazgul = 2;
  s.regions['moria'].characters = ['witch-king'];
  s.characters.inPlay['witch-king'] = 'moria';
  if (!s.characters.entered.includes('witch-king')) s.characters.entered.push('witch-king');
  return s;
}
/** Apply a target the way the eventTarget resolver does, recording it. */
function step(s, h, applied, t) { h.applyTarget(s, 'shadow', t); applied.push(t); }
const picks = (ts) => ts.filter((t) => t.companion && !t.region);

for (const card of ['sh-char-24', 'sh-char-23']) {
  console.log(`\n=== ${card}: the Witch-king flies first, then the Nazgûl he left ===`);
  const s = board(); const h = getHandler(card); const applied = [];
  step(s, h, applied, { companion: 'witch-king', from: 'moria' });
  const dest = h.targets(s, 'shadow', applied).find((t) => t.region);
  check('the Witch-king has somewhere to fly', !!dest);
  step(s, h, applied, dest);
  const p = picks(h.targets(s, 'shadow', applied));
  check('the Nazgûl left in Moria are still pickable', p.some((t) => t.companion === 'nazgul' && t.from === 'moria'), JSON.stringify(p));
  check('the Witch-king is not offered twice', !p.some((t) => t.companion === 'witch-king'));
}

{
  console.log('\n=== a stack splits two ways; a moved Nazgûl never flies again ===');
  const s = board(); const h = getHandler('sh-char-24'); const applied = [];
  step(s, h, applied, { companion: 'nazgul', from: 'moria' });
  const dests = h.targets(s, 'shadow', applied).filter((t) => t.region && t.count === 1);
  check('a single Nazgûl may fly', dests.length > 0);
  const d1 = dests[0];
  step(s, h, applied, d1);
  let p = picks(h.targets(s, 'shadow', applied));
  check('the other Moria Nazgûl may still fly', p.some((t) => t.companion === 'nazgul' && t.from === 'moria'));
  check(`the one that landed in ${d1.region} may not fly again`, !p.some((t) => t.companion === 'nazgul' && t.from === d1.region));
  step(s, h, applied, { companion: 'nazgul', from: 'moria' });
  const counts = new Set(h.targets(s, 'shadow', applied).filter((t) => t.region).map((t) => t.count));
  check('only ONE is left to move from Moria', counts.size === 1 && counts.has(1), [...counts].join(','));
  const d2 = h.targets(s, 'shadow', applied).find((t) => t.region && t.region !== d1.region);
  step(s, h, applied, d2);
  p = picks(h.targets(s, 'shadow', applied));
  check('no Nazgûl left to fly', !p.some((t) => t.companion === 'nazgul'), JSON.stringify(p));
  check('the Witch-king still may', p.some((t) => t.companion === 'witch-king'));
}

console.log('\n=== Nazgûl Search / The Nazgûl Strike! fly the Witch-king too (report 5vw7t8btxx0r2dq7) ===');
for (const id of ['sh-char-09', 'sh-char-08b']) {
  const s = board();
  s.fellowship.progress = 2;
  const h = getHandler(id);
  const applied = [];
  const p = picks(h.targets(s, 'shadow', applied));
  check(`${id} offers the Witch-king`, p.some((t) => t.companion === 'witch-king' && t.from === 'moria'), JSON.stringify(p));
  step(s, h, applied, { companion: 'witch-king', from: 'moria' });
  const dests = h.targets(s, 'shadow', applied).filter((t) => t.region);
  check(`${id} then offers him somewhere to fly`, dests.length > 0);
  step(s, h, applied, dests[0]);
  check(`${id} actually moves him`, s.regions[dests[0].region].characters.includes('witch-king')
    && !s.regions['moria'].characters.includes('witch-king'), `now in ${dests[0].region}`);
  check(`${id} will not fly him twice`, !picks(h.targets(s, 'shadow', applied)).some((t) => t.companion === 'witch-king'));
}
{
  // ...and the card is playable when the Witch-king is the LAST Ringwraith on the map.
  const s = board();
  s.fellowship.progress = 2;
  for (const r of Object.values(s.regions)) r.nazgul = 0;
  check('Nazgûl Search is playable with only the Witch-king out', getHandler('sh-char-09').canPlay(s, 'shadow'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
