#!/usr/bin/env vite-node
// protocol-replay.mjs — offline check of the protocol client (src/protocol) on recorded games.
//
//   vite-node scripts/protocol-replay.mjs DIR [--games N] [--ai heuristic]
//
// DIR holds referee game logs (<game>.protocol.jsonl[.gz], SPEC §10). Every `decide` a
// referee sent is fed to our client (a fresh context per game and seat) and the answer
// is checked against the decision's options. Reports how decisions were answered: matched
// to one of our actions, from a queued plan, by a rule, or the fallback option 0 — plus
// errors and timing. The logs are data only; nothing in them is executed.
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { newContext, decide } from '../src/protocol/decide.ts';
import { viewToState } from '../src/protocol/viewToState.ts';
import { sideOf } from '../src/protocol/names.ts';
import { wotrAdapter } from '../src/adapter/wotrAdapter.ts';

const dir = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const GAMES = Number(arg('--games', 20));
const files = readdirSync(dir).filter((f) => /\.protocol\.jsonl(\.gz)?$/.test(f)).sort().slice(0, GAMES);
const total = {}, kinds = {}, bad = [];
let decisions = 0, ms = 0, viewErr = 0, legalEmpty = 0;
const add = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
for (const f of files) {
  const raw = readFileSync(join(dir, f));
  const text = (f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
  const ctxs = {};
  for (const line of text.split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (rec.dir !== 'out') continue;
    let m;
    try { m = JSON.parse(rec.line); } catch { continue; }
    if (m.type !== 'decide') continue;
    const seat = rec.side ?? m.decision.side;
    ctxs[seat] ??= newContext(sideOf(seat), 7, chooseAction);
    try {
      const st = viewToState(m.view);
      if (m.decision.kind === 'ACTION' && !wotrAdapter.legalActions(st, sideOf(seat)).length) legalEmpty++;
    } catch (e) { viewErr++; if (viewErr <= 5) console.error('viewToState:', e.message); }
    const t0 = performance.now();
    const o = decide(ctxs[seat], m.decision, m.view);
    ms += performance.now() - t0;
    decisions++;
    add(kinds, m.decision.kind);
    if (!m.decision.options.some((x) => x.o === o)) bad.push({ f, kind: m.decision.kind, o });
  }
  for (const c of Object.values(ctxs)) for (const [k, v] of Object.entries(c.stats)) add(total, k, v);
}
console.log(`${files.length} games, ${decisions} decisions, ${(ms / decisions).toFixed(1)} ms each; view errors ${viewErr}; ACTION with no legal action ${legalEmpty}; answers off the list ${bad.length}`);
const rows = Object.entries(total).sort((a, b) => b[1] - a[1]);
for (const [k, v] of rows) console.log(`  ${String(v).padStart(6)}  ${k}`);
