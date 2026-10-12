#!/usr/bin/env vite-node
// probe-separation-guide-log.mjs — a separation names a new Guide only when the Guide
// actually changed (player report 5w1b265f0s302w0q: "Meriadoc separates…; Strider
// becomes the Guide" when Strider had been the Guide all along).
import { createGame } from '../src/engine/setup.ts';
import { beginSeparation, placeSeparatedCompanion } from '../src/engine/fellowship.ts';

let fails = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };


{
  const s = createGame(1);
  s.fellowship.guide = 'strider';
  beginSeparation(s, 'meriadoc');
  placeSeparatedCompanion(s, 'meriadoc', 'rivendell');
  const t = s.log.map((e) => e.msg).find((x) => /Meriadoc.*separates/.test(x)) ?? '';
  check(!/becomes the Guide/.test(t), `Guide unchanged → no Guide note: "${t}"`);
  check(s.fellowship.sepGuide === undefined, 'the held Guide is cleared after placement');
}
{
  const s = createGame(1);
  s.fellowship.guide = 'meriadoc';
  beginSeparation(s, 'meriadoc');
  placeSeparatedCompanion(s, 'meriadoc', 'rivendell');
  const t = s.log.map((e) => e.msg).find((x) => /Meriadoc.*separates/.test(x)) ?? '';
  check(/becomes the Guide/.test(t), `the Guide left → the new Guide is named: "${t}"`);
}
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('probe-separation-guide-log OK');
