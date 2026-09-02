#!/usr/bin/env vite-node
// probe-evaluate.mjs — ordering properties of the 1-ply evaluator's position
// score (stage 1, docs/ai-1ply-evaluator.md). No magnitudes asserted — only
// directions a correct evaluation cannot get wrong, so the weights stay free
// for the A/B protocol to tune.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { evaluate } from '../src/ai/evaluate.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const base = () => startGame(createGame({ seed: 30 }));
const clone = (s) => JSON.parse(JSON.stringify(s));

{
  console.log('\n=== zero-sum framing: the two sides mirror ===');
  const s = base();
  check('eval(s, shadow) === -eval(s, fp)', evaluate(s, 'shadow') === -evaluate(s, 'fp'));
}

{
  console.log('\n=== terminal states dominate ===');
  const s = base(); const w = clone(s); w.winner = 'shadow';
  check('a Shadow win beats any live position (shadow view)', evaluate(w, 'shadow') > evaluate(s, 'shadow') + 1e5);
  check('...and is catastrophic in the FP view', evaluate(w, 'fp') < -1e5);
}

{
  console.log('\n=== the clocks ===');
  const s = base();
  const corrupt = clone(s); corrupt.fellowship.corruption = 8;
  check('corruption is good for the Shadow', evaluate(corrupt, 'shadow') > evaluate(s, 'shadow'));
  const near = clone(s); near.fellowship.location = 'dagorlad'; near.fellowship.progress = 1;
  check('a Fellowship at the gates is good for the FP', evaluate(near, 'fp') > evaluate(s, 'fp'));
  const mordor = clone(near); mordor.fellowship.mordor = 3;
  check('...and deep in Mordor is better still', evaluate(mordor, 'fp') > evaluate(near, 'fp'));
  const vp = clone(s); vp.victoryPoints.shadow = 8;
  check('8 VP is good for the Shadow', evaluate(vp, 'shadow') > evaluate(s, 'shadow'));
  const vp4 = clone(s); vp4.victoryPoints.fp = 2;
  check('2 of 4 VP is good for the FP', evaluate(vp4, 'fp') > evaluate(s, 'fp'));
}

{
  console.log('\n=== the walk-in guard (the log-mined exploit class) ===');
  const s = base();
  // Empty Orthanc with a FP army two steps away vs a one-unit garrison.
  const open = clone(s);
  open.regions['orthanc'].units = {};
  open.regions['fords-of-isen'].units = { rohan: { regular: 3, elite: 0 } };
  const held = clone(open);
  held.regions['orthanc'].units = { isengard: { regular: 1, elite: 0 } };
  check('a garrisoned Orthanc beats an open door (shadow view)', evaluate(held, 'shadow') > evaluate(open, 'shadow'));
}

{
  console.log('\n=== material ===');
  const s = base();
  const poorer = clone(s);
  poorer.regions['gorgoroth'].units.sauron.regular -= 3;
  check('losing 3 Regulars is bad for the Shadow', evaluate(poorer, 'shadow') < evaluate(s, 'shadow'));
  check('...and good for the FP', evaluate(poorer, 'fp') > evaluate(s, 'fp'));
}

{
  console.log('\n=== purity: evaluating must not touch the state ===');
  const s = base();
  const before = JSON.stringify(s);
  evaluate(s, 'shadow', {});
  evaluate(s, 'fp');
  check('state unchanged by evaluation', JSON.stringify(s) === before);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
