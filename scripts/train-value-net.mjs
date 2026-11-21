#!/usr/bin/env vite-node
// train-value-net.mjs — fit the value net (src/ai/valueNet.ts) to self-play records.
//
//   vite-node scripts/train-value-net.mjs --out NET.json [--epochs 6] [--h1 128] [--h2 32]
//       [--lr 0.001] [--batch 1024] [--init NET.json] FILE.bin [FILE.bin ...]
//
// Records come from scripts/selfplay-gen.mjs. The last 10% of the LAST file is held out
// (contiguous, so whole games stay on one side of the split); the report compares the
// held-out log-loss with the base rate, overall and by phase and turn. --init continues
// from an earlier net (same shape) — the self-play iterations warm-start this way.
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { Rng } from 'digital-boardgame-framework';
import { INPUT_SIZE, INPUT_NAMES, ENCODING_VERSION } from '../src/ai/encode.ts';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const OUT = opt('--out', 'value-net.json');
const EPOCHS = Number(opt('--epochs', 6)), H1 = Number(opt('--h1', 128)), H2 = Number(opt('--h2', 32));
const LR = Number(opt('--lr', 0.001)), B = Number(opt('--batch', 1024)), L2 = Number(opt('--l2', 1e-5));
const INIT = opt('--init', null);
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) throw new Error('no data files');

const REC = INPUT_SIZE + 4;
// Read every file straight into one buffer (a concat would briefly hold the corpus twice).
const sizes = files.map((f) => statSync(f).size);
for (const [i, n] of sizes.entries()) if (n % REC) throw new Error(`${files[i]}: size ${n} is not a multiple of ${REC}`);
const data = Buffer.allocUnsafe(sizes.reduce((a, b) => a + b, 0));
let off = 0;
for (const [i, f] of files.entries()) {
  const fd = openSync(f, 'r');
  for (let got = 0; got < sizes[i];) got += readSync(fd, data, off + got, sizes[i] - got, got);
  closeSync(fd);
  off += sizes[i];
}
const N = data.length / REC;
const lastN = sizes[sizes.length - 1] / REC;
const nVal = Math.floor(lastN * 0.1);
const valStart = N - nVal;
console.log(`${N} positions from ${files.length} files; training ${valStart}, held out ${nVal}`);

const X = (r) => data.subarray(r * REC, r * REC + INPUT_SIZE);
const Y = (r) => data[r * REC + INPUT_SIZE];
const TURN = (r) => data[r * REC + INPUT_SIZE + 1];
const PH_FS = INPUT_NAMES.indexOf('phase.fellowship');

// --- input scale (1/std, not centred) ---------------------------------------------------
let scale;
let net;
if (INIT) {
  net = JSON.parse(readFileSync(INIT, 'utf8'));
  if (net.encodingVersion !== ENCODING_VERSION || net.h1 !== H1 || net.h2 !== H2) throw new Error('--init net has another shape');
  scale = Float32Array.from(net.scale);
} else {
  const s1 = new Float64Array(INPUT_SIZE), s2 = new Float64Array(INPUT_SIZE);
  const step = Math.max(1, Math.floor(valStart / 100000));
  let n = 0;
  for (let r = 0; r < valStart; r += step, n++) { const x = X(r); for (let i = 0; i < INPUT_SIZE; i++) { s1[i] += x[i]; s2[i] += x[i] * x[i]; } }
  scale = new Float32Array(INPUT_SIZE);
  for (let i = 0; i < INPUT_SIZE; i++) { const m = s1[i] / n, v = s2[i] / n - m * m; scale[i] = v > 1e-9 ? 1 / Math.sqrt(v) : 0; }
}

// --- parameters ---------------------------------------------------------------------------
const rng = new Rng(20261121);
const gauss = () => { let u = 0; while (u === 0) u = rng.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next()); };
const W1 = new Float32Array(INPUT_SIZE * H1), b1 = new Float32Array(H1);
const W2 = new Float32Array(H2 * H1), b2 = new Float32Array(H2);
const W3 = new Float32Array(H2);
let b3;
let base = 0;
for (let r = 0; r < valStart; r++) base += Y(r);
base /= valStart;
if (net) {
  W1.set(net.W1); b1.set(net.b1); W2.set(net.W2); b2.set(net.b2); W3.set(net.W3); b3 = net.b3;
} else {
  for (let i = 0; i < W1.length; i++) W1[i] = gauss() * Math.sqrt(2 / 200);
  for (let i = 0; i < W2.length; i++) W2[i] = gauss() * Math.sqrt(2 / H1);
  for (let i = 0; i < W3.length; i++) W3[i] = gauss() * 0.01;
  b3 = Math.log(base / (1 - base));
}
const P = [W1, b1, W2, b2, W3];
const G = P.map((p) => new Float32Array(p.length));
const M = P.map((p) => new Float32Array(p.length)), V = P.map((p) => new Float32Array(p.length));
let gb3 = 0, mb3 = 0, vb3 = 0, t = 0;

// --- forward / backward -----------------------------------------------------------------------
const a1 = new Float32Array(H1), a2 = new Float32Array(H2), d1 = new Float32Array(H1), d2 = new Float32Array(H2);
const nzI = new Int32Array(INPUT_SIZE), nzV = new Float32Array(INPUT_SIZE);
let nnz = 0;
function forward(x) {
  nnz = 0;
  a1.set(b1);
  for (let i = 0; i < INPUT_SIZE; i++) {
    const xi = x[i];
    if (!xi || !scale[i]) continue;
    const v = xi * scale[i], o = i * H1;
    nzI[nnz] = i; nzV[nnz++] = v;
    for (let j = 0; j < H1; j++) a1[j] += v * W1[o + j];
  }
  for (let j = 0; j < H1; j++) if (a1[j] < 0) a1[j] = 0;
  for (let k = 0; k < H2; k++) {
    let z = b2[k];
    const o = k * H1;
    for (let j = 0; j < H1; j++) z += W2[o + j] * a1[j];
    a2[k] = z > 0 ? z : 0;
  }
  let z = b3;
  for (let k = 0; k < H2; k++) z += W3[k] * a2[k];
  return 1 / (1 + Math.exp(-z));
}
function backward(p, y) {
  const [gW1, gb1, gW2, gb2, gW3] = G;
  const dz = p - y;
  gb3 += dz;
  for (let k = 0; k < H2; k++) { gW3[k] += dz * a2[k]; d2[k] = a2[k] > 0 ? dz * W3[k] : 0; }
  d1.fill(0);
  for (let k = 0; k < H2; k++) {
    const dk = d2[k];
    if (!dk) continue;
    gb2[k] += dk;
    const o = k * H1;
    for (let j = 0; j < H1; j++) { gW2[o + j] += dk * a1[j]; d1[j] += dk * W2[o + j]; }
  }
  for (let j = 0; j < H1; j++) if (a1[j] <= 0) d1[j] = 0; else gb1[j] += d1[j];
  for (let q = 0; q < nnz; q++) {
    const v = nzV[q], o = nzI[q] * H1;
    for (let j = 0; j < H1; j++) gW1[o + j] += d1[j] * v;
  }
}
function adam(n) {
  t++;
  const c1 = 1 - 0.9 ** t, c2 = 1 - 0.999 ** t;
  for (let pi = 0; pi < P.length; pi++) {
    const p = P[pi], g = G[pi], m = M[pi], v = V[pi];
    const decay = pi % 2 === 0 ? L2 : 0;
    for (let i = 0; i < p.length; i++) {
      const gi = g[i] / n + decay * p[i];
      m[i] = 0.9 * m[i] + 0.1 * gi; v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      p[i] -= LR * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
    }
    g.fill(0);
  }
  const gi = gb3 / n;
  mb3 = 0.9 * mb3 + 0.1 * gi; vb3 = 0.999 * vb3 + 0.001 * gi * gi;
  b3 -= LR * (mb3 / c1) / (Math.sqrt(vb3 / c2) + 1e-8);
  gb3 = 0;
}
const ll = (p, y) => -(y ? Math.log(Math.max(p, 1e-7)) : Math.log(Math.max(1 - p, 1e-7)));

function report(label) {
  const bucket = {};
  const add = (k, p, y) => { const b = (bucket[k] ??= { n: 0, m: 0, b: 0, acc: 0 }); b.n++; b.m += ll(p, y); b.b += ll(base, y); b.acc += (p > 0.5) === (y === 1) ? 1 : 0; };
  for (let r = valStart; r < N; r++) {
    const x = X(r), y = Y(r), p = forward(x), turn = TURN(r);
    add('all', p, y);
    add(x[PH_FS] ? 'turn start' : 'mid-turn', p, y);
    add(turn <= 3 ? 'turns 1-3' : turn <= 6 ? 'turns 4-6' : turn <= 9 ? 'turns 7-9' : 'turns 10+', p, y);
  }
  console.log(label);
  for (const [k, b] of Object.entries(bucket)) console.log(`  ${k.padEnd(10)} n ${String(b.n).padStart(7)}  base ${(b.b / b.n).toFixed(4)}  net ${(b.m / b.n).toFixed(4)}  acc ${(b.acc / b.n).toFixed(3)}`);
  return bucket.all.m / bucket.all.n;
}

report(INIT ? 'held out, starting net:' : 'held out, before training:');
const order = Int32Array.from({ length: valStart }, (_, i) => i);
const t0 = Date.now();
let best = Infinity;
for (let ep = 1; ep <= EPOCHS; ep++) {
  for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
  let loss = 0;
  for (let s = 0; s < order.length; s += B) {
    const end = Math.min(order.length, s + B);
    for (let q = s; q < end; q++) { const r = order[q], y = Y(r), p = forward(X(r)); loss += ll(p, y); backward(p, y); }
    adam(end - s);
  }
  const v = report(`epoch ${ep}: train ${(loss / order.length).toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  if (v < best) { best = v; save(); }
  else console.log('  (held-out loss rose — keeping the earlier epoch)');
}
function save() {
  const r = (a) => Array.from(a, (x) => Math.round(x * 1e6) / 1e6);
  writeFileSync(OUT, JSON.stringify({
    encodingVersion: ENCODING_VERSION, inputSize: INPUT_SIZE, h1: H1, h2: H2,
    trainedOn: files.map((f) => f.split('/').pop()), positions: N, heldOutLogLoss: best,
    scale: r(scale), W1: r(W1), b1: r(b1), W2: r(W2), b2: r(b2), W3: r(W3), b3: Math.round(b3 * 1e6) / 1e6,
  }));
  console.log(`  saved ${OUT}`);
}
