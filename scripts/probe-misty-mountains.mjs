#!/usr/bin/env vite-node
// probe-misty-mountains.mjs — Shadows on the Misty Mountains: "Recruit two Sauron units
// (Regular or Elite) and one Nazgûl either in Mount Gram or in Moria." Each unit is the
// Shadow player's Regular/Elite pick — the card used to place two Regulars (player
// report a5qi63pq43cqj3sm) — and the Nazgûl joins the units in the chosen region.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const CARD = 'sh-str-19';
const board = () => {
  const s = startGame(createGame({ seed: 41 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['muster']; s.dice.fp = [];
  s.cards.shadow.hand = [CARD];
  return s;
};
const legal = (s) => wotrAdapter.legalActions(s, 'shadow');
const targets = (s) => legal(s).filter((a) => a.kind === 'eventTarget' && !a.done);
const play = (s) => {
  const a = legal(s).find((x) => x.kind === 'playEvent' && x.cardId === CARD);
  return a ? wotrAdapter.applyAction(s, a, 'shadow') : null;
};
const pick = (s, pred) => { const a = targets(s).find(pred); return a ? wotrAdapter.applyAction(s, a, 'shadow') : null; };
const resolving = (s) => s?.pendingChoice?.kind === 'eventTarget' && s.pendingChoice.data.card === CARD;
const sauron = (s, r) => s.regions[r].units.sauron ?? { regular: 0, elite: 0 };

console.log('\n=== two Elites and a Nazgûl in Moria ===');
{
  let s = board();
  const pool0 = { ...s.reinforcements.sauron };
  const moria0 = { ...sauron(s, 'moria') }; // Moria starts with a Sauron garrison
  s = play(s);
  check('the card asks for its units', resolving(s), s?.pendingChoice?.kind ?? 'not playable');
  const t0 = targets(s);
  check('Elite is offered (the report)', t0.some((a) => a.figure === 'elite'), JSON.stringify(t0));
  check('both Mount Gram and Moria are offered', ['mount-gram', 'moria'].every((r) => t0.some((a) => a.region === r)));
  s = pick(s, (a) => a.region === 'moria' && a.figure === 'elite');
  const t1 = targets(s);
  check('the second unit is locked to Moria', t1.length > 0 && t1.every((a) => a.region === 'moria'), JSON.stringify(t1));
  s = pick(s, (a) => a.figure === 'elite');
  check('the card resolves after two units', !resolving(s), s.pendingChoice?.kind ?? 'resolved');
  check('two Sauron Elites joined Moria', sauron(s, 'moria').elite === moria0.elite + 2 && sauron(s, 'moria').regular === moria0.regular,
    `${JSON.stringify(moria0)} -> ${JSON.stringify(sauron(s, 'moria'))}`);
  check('the Nazgûl joined them in Moria', s.regions.moria.nazgul === 1, String(s.regions.moria.nazgul));
  check('Mount Gram untouched', s.regions['mount-gram'].nazgul === 0 && sauron(s, 'mount-gram').elite + sauron(s, 'mount-gram').regular === 0);
  check('pool: 2 Elites and 1 Nazgûl fewer', s.reinforcements.sauron.elite === pool0.elite - 2 && s.reinforcements.sauron.nazgul === pool0.nazgul - 1
    && s.reinforcements.sauron.regular === pool0.regular, JSON.stringify(s.reinforcements.sauron));
}

console.log('\n=== a mixed pick: one Regular, one Elite in Mount Gram ===');
{
  let s = play(board());
  s = pick(s, (a) => a.region === 'mount-gram' && a.figure === 'regular');
  s = pick(s, (a) => a.figure === 'elite');
  check('1R + 1E in Mount Gram', sauron(s, 'mount-gram').regular === 1 && sauron(s, 'mount-gram').elite === 1, JSON.stringify(sauron(s, 'mount-gram')));
  check('with the Nazgûl', s.regions['mount-gram'].nazgul === 1);
}

console.log('\n=== no Sauron units left: the Nazgûl alone still comes ===');
{
  let s = board();
  s.reinforcements.sauron.regular = 0; s.reinforcements.sauron.elite = 0;
  s = play(s);
  check('still playable, asking for a region', resolving(s), s?.pendingChoice?.kind ?? 'not playable');
  s = pick(s, (a) => a.region === 'moria');
  check('the Nazgûl lands in Moria', s.regions.moria.nazgul === 1, String(s.regions.moria.nazgul));
  check('and the card resolves', !resolving(s));
}

console.log(`\nprobe-misty-mountains: ${failures ? `${failures} FAILED` : 'all ok'}`);
if (failures) process.exit(1);
