#!/usr/bin/env vite-node
// fit-value.mjs — fit the search's value model (src/ai/valueModel.ts) to self-play.
//
// Plays --games heuristic games (half of them with the human-like Free Peoples, for a
// wider spread of positions) on seeds far from the A/B families (500001+), records the
// features of every turn-start position with the game's result, and fits a logistic
// regression (L2, standardized features, full-batch gradient descent). Writes
// src/ai/valueWeights.json and prints held-out log-loss beside two baselines: the
// base rate, and the hand-set evaluate() squashed through its own best-fit logistic.
//   vite-node scripts/fit-value.mjs --games 6000
import { writeFileSync } from 'node:fs';
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame, applyActionInPlace } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionHumanlike } from '../src/ai/humanlikeFP.ts';
import { evaluate } from '../src/ai/evaluate.ts';
import { features, FEATURE_NAMES } from '../src/ai/valueModel.ts';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 4000), OFFSET = arg('--seed-offset', 500000), L2 = arg('--l2', 1e-3);
const OUT = new URL('../src/ai/valueWeights.json', import.meta.url);

const X = [], Y = [], E = [], G = [];
for (let g = 0; g < GAMES; g++) {
  const seed = OFFSET + g + 1;
  const s = startGame(createGame({ seed })); s.log = [];
  const rng = new Rng(seed * 1000 + 7);
  const humanlike = g % 2 === 1;
  const rows = [];
  let lastTurn = 0, n = 0;
  while (!s.winner && n++ < 20000) {
    if (s.turn !== lastTurn && s.phase === 'fellowship' && !s.pendingChoice) {
      lastTurn = s.turn;
      rows.push([features(s), evaluate(s, 'shadow')]);
    }
    const actor = wotrAdapter.currentActor(s);
    if (!actor) break;
    const legal = wotrAdapter.legalActions(s, actor);
    if (!legal.length) break;
    const a = actor === 'fp' && humanlike ? chooseActionHumanlike(s, actor, legal, rng) : chooseAction(s, actor, legal, rng);
    try { applyActionInPlace(s, a, actor); } catch { break; }
    if (s.log.length > 64) s.log.splice(0, s.log.length - 16);
  }
  if (!s.winner) continue;
  const y = s.winner === 'shadow' ? 1 : 0;
  for (const [x, e] of rows) { X.push(x); Y.push(y); E.push(e); G.push(g); }
  if ((g + 1) % 500 === 0) console.error(`  ${g + 1} games, ${X.length} positions`);
}

const D = FEATURE_NAMES.length, N = X.length;
const test = (i) => G[i] % 5 === 0; // hold out every fifth game
const mean = Array(D).fill(0), std = Array(D).fill(0);
let nTrain = 0;
for (let i = 0; i < N; i++) if (!test(i)) { nTrain++; for (let j = 0; j < D; j++) mean[j] += X[i][j]; }
for (let j = 0; j < D; j++) mean[j] /= nTrain;
for (let i = 0; i < N; i++) if (!test(i)) for (let j = 0; j < D; j++) std[j] += (X[i][j] - mean[j]) ** 2;
for (let j = 0; j < D; j++) std[j] = Math.sqrt(std[j] / nTrain) || 1;
const Z = X.map((x) => x.map((v, j) => (v - mean[j]) / std[j]));

/** Full-batch gradient descent with momentum for logistic regression on columns `cols` of `rows`. */
function fit(rows, ys, dims, iters = 3000, lr = 0.5, l2 = L2) {
  const w = Array(dims).fill(0), vw = Array(dims).fill(0); let b = 0, vb = 0;
  const m = rows.length;
  for (let it = 0; it < iters; it++) {
    const gw = Array(dims).fill(0); let gb = 0;
    for (let i = 0; i < m; i++) {
      const x = rows[i]; let z = b;
      for (let j = 0; j < dims; j++) z += w[j] * x[j];
      const d = 1 / (1 + Math.exp(-z)) - ys[i];
      gb += d; for (let j = 0; j < dims; j++) gw[j] += d * x[j];
    }
    for (let j = 0; j < dims; j++) { vw[j] = 0.9 * vw[j] - lr * (gw[j] / m + l2 * w[j]); w[j] += vw[j]; }
    vb = 0.9 * vb - lr * gb / m; b += vb;
  }
  return { w, b };
}
const pred = (w, b, x) => { let z = b; for (let j = 0; j < x.length; j++) z += w[j] * x[j]; return 1 / (1 + Math.exp(-z)); };
const logloss = (ps, ys) => -ps.reduce((a, p, i) => a + (ys[i] ? Math.log(Math.max(p, 1e-9)) : Math.log(Math.max(1 - p, 1e-9))), 0) / ps.length;

const tr = [], trY = [], te = [], teY = [], trE = [], teE = [];
for (let i = 0; i < N; i++) (test(i) ? (te.push(Z[i]), teY.push(Y[i]), teE.push([E[i] / 300])) : (tr.push(Z[i]), trY.push(Y[i]), trE.push([E[i] / 300])));
const model = fit(tr, trY, D);
const evalFit = fit(trE, trY, 1, 1500, 0.5, 0);
const base = trY.reduce((a, b) => a + b, 0) / trY.length;
const acc = (ps, ys) => ps.filter((p, i) => (p > 0.5) === !!ys[i]).length / ps.length;
const pm = te.map((x) => pred(model.w, model.b, x)), pe = teE.map((x) => pred(evalFit.w, evalFit.b, x));
console.log(`positions ${N} (train ${tr.length}, held out ${te.length}); Shadow win rate ${base.toFixed(3)}`);
console.log(`held-out log-loss: base rate ${logloss(te.map(() => base), teY).toFixed(4)}, evaluate() ${logloss(pe, teY).toFixed(4)} (acc ${acc(pe, teY).toFixed(3)}), model ${logloss(pm, teY).toFixed(4)} (acc ${acc(pm, teY).toFixed(3)})`);
// Per-turn view: is the model useful early, where the search needs it?
for (const [lo, hi] of [[1, 3], [4, 6], [7, 9], [10, 40]]) {
  const idx = []; let k = 0;
  for (let i = 0; i < N; i++) if (test(i)) { if (X[i][FEATURE_NAMES.indexOf('turn')] >= lo && X[i][FEATURE_NAMES.indexOf('turn')] <= hi) idx.push(k); k++; }
  if (!idx.length) continue;
  const ys = idx.map((i) => teY[i]);
  console.log(`  turns ${lo}-${hi}: n ${idx.length}, base ${logloss(idx.map(() => base), ys).toFixed(4)}, evaluate ${logloss(idx.map((i) => pe[i]), ys).toFixed(4)}, model ${logloss(idx.map((i) => pm[i]), ys).toFixed(4)}`);
}
const order = FEATURE_NAMES.map((n, j) => [n, model.w[j]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
console.log('largest weights (standardized):', order.slice(0, 12).map(([n, w]) => `${n} ${w.toFixed(2)}`).join(', '));
// Refit on everything for the shipped weights.
const all = fit(Z, Y, D);
writeFileSync(OUT, JSON.stringify({ names: FEATURE_NAMES, mean, std, w: all.w, b: all.b, games: GAMES, positions: N }, null, 0) + '\n');
console.log(`wrote ${OUT.pathname}`);
