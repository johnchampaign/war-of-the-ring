#!/usr/bin/env vite-node
// protocol-agree.mjs — how often our AI picks what another bot picked, on recorded games.
//
//   vite-node scripts/protocol-agree.mjs DIR [--bot NAME] [--games N]
//
// DIR is a referee's tournament download (games.json + <game>.protocol.jsonl.gz, SPEC §10).
// For every ACTION / FELLOWSHIP_PHASE / HUNT_ALLOCATION decision the named bot answered,
// our client (heuristic) answers the same decide; the report gives the agreement and the
// commonest disagreements as (their choice -> ours), by side. A diagnostic of where a
// stronger bot plays differently — not a claim that it is right each time.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { newContext, decide } from '../src/protocol/decide.ts';
import { sideOf } from '../src/protocol/names.ts';

const dir = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const BOT = arg('--bot', 'Normal');
const GAMES = Number(arg('--games', 1000));
const index = JSON.parse(readFileSync(join(dir, 'games.json'), 'utf8')).games;
const KINDS = new Set(['ACTION', 'FELLOWSHIP_PHASE', 'HUNT_ALLOCATION']);
const cat = (o) => !o ? '?' : o.kind === 'use_die' ? `${o.action}${o.action === 'play_card' ? '' : ''}/${o.face}` : o.kind === 'hunt_dice' ? `hunt ${o.count}` : o.kind;
const tally = {}, conf = {};
const add = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
let games = 0;
for (const g of index) {
  const seat = g.seats.find((s) => s.bot.startsWith(BOT));
  if (!seat || games >= GAMES) continue;
  games++;
  const text = gunzipSync(readFileSync(join(dir, g.file))).toString('utf8');
  const open = {};
  const ctx = newContext(sideOf(seat.side), 11, chooseAction);
  for (const line of text.split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (rec.side !== seat.side) continue;
    let m; try { m = JSON.parse(rec.line); } catch { continue; }
    if (rec.dir === 'out' && m.type === 'decide') open[m.id] = m;
    if (rec.dir === 'in' && m.type === 'choice' && open[m.id]) {
      const dm = open[m.id]; delete open[m.id];
      const d = dm.decision;
      if (!KINDS.has(d.kind)) continue;
      ctx.plan = []; ctx.after = null;
      const ours = decide(ctx, d, dm.view);
      const theirs = d.options.find((o) => o.o === m.o), mine = d.options.find((o) => o.o === ours);
      const key = `${seat.side} ${d.kind}`;
      add(tally, key + ' n'); if (ours === m.o) add(tally, key + ' same');
      else if (cat(theirs) === cat(mine)) add(tally, key + ' same kind');
      else add(conf, `${seat.side.slice(0, 2)} ${cat(theirs)}  ->  ours ${cat(mine)}`);
    }
  }
}
console.log(`${BOT}: ${games} games`);
for (const side of ['FREE_PEOPLES', 'SHADOW']) for (const k of KINDS) {
  const n = tally[`${side} ${k} n`] ?? 0;
  if (n) console.log(`  ${side} ${k}: n ${n}, same option ${(100 * (tally[`${side} ${k} same`] ?? 0) / n).toFixed(0)}%, same kind of action ${(100 * ((tally[`${side} ${k} same`] ?? 0) + (tally[`${side} ${k} same kind`] ?? 0)) / n).toFixed(0)}%`);
}
console.log('commonest disagreements (theirs -> ours):');
for (const [k, n] of Object.entries(conf).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${k}`);
