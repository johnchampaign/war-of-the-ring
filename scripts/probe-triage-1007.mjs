#!/usr/bin/env vite-node
// probe-triage-1007.mjs — fixes from the 2026-10-07 report batch:
//
//  Every Event-card recruit logs what it placed, once. Many Kings to the Service of
//  Mordor, Pits of Mordor, Musterings of Long-planned War, Orcs Multiplying Again and
//  House of the Stewards recruited in silence (reports 5w212u3f3z2h5z2q,
//  1q1l0052184n2w0v, 0b6k4s40345o5t3u, 18696p1a3o082d1j, 535f44733o564r5v); the cards
//  that did log must not now log twice.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import '../src/engine/handlers/index.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = (seed) => startGame(createGame({ seed }));
const musterLines = (s, from) => s.log.slice(from).filter((e) => e.kind === 'muster').map((e) => e.msg);

{
  console.log('\n=== Orcs Multiplying Again logs both recruits ===');
  const s = fresh(11); const n = s.log.length;
  getHandler('sh-str-20').apply(s, 'shadow');
  const m = musterLines(s, n);
  check('two muster lines', m.length === 2, JSON.stringify(m));
  check('Dol Guldur named', m.some((x) => x === 'Shadow musters 3R/0E sauron in dol-guldur'));
}

{
  console.log('\n=== Musterings of Long-planned War logs both recruits ===');
  const s = fresh(12); const n = s.log.length;
  getHandler('sh-str-23').apply(s, 'shadow');
  const m = musterLines(s, n);
  check('Gorgoroth and Nurn', m.some((x) => /southrons in gorgoroth/.test(x)) && m.some((x) => /sauron in nurn/.test(x)), JSON.stringify(m));
}

{
  console.log('\n=== Many Kings logs each pick ===');
  const s = fresh(13); const n = s.log.length;
  const h = getHandler('sh-str-17');
  const t = h.targets(s, 'shadow', [])[0];
  check('a target is offered', !!t);
  if (t) h.applyTarget(s, 'shadow', t, []);
  const m = musterLines(s, n);
  check('one muster line for 2 Regulars', m.length === 1 && m[0].startsWith('Shadow musters 2R/0E southrons in'), JSON.stringify(m));
}

{
  console.log('\n=== House of the Stewards logs its Gondor unit, once ===');
  const s = fresh(14); const n = s.log.length;
  const h = getHandler('fp-char-23');
  // Boromir is in the Fellowship at setup; stand him in Minas Tirith.
  s.regions['minas-tirith'].characters.push('boromir'); s.characters.inPlay['boromir'] = 'minas-tirith';
  const t = h.targets(s, 'fp', [])[0];
  check('a target is offered', !!t);
  if (t) h.applyTarget(s, 'fp', t, []);
  const m = musterLines(s, n);
  check('exactly one muster line', m.length === 1 && /gondor in minas-tirith/.test(m[0]), JSON.stringify(m));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
