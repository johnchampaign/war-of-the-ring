#!/usr/bin/env vite-node
// protocol-bot.mjs — our AI as a WotR Bot Protocol bot (behindmedia/wotr-protocol, SPEC draft 0.2,
// base game only) on stdin/stdout, JSON Lines. Our own client, written from the spec.
//
//   vite-node scripts/protocol-bot.mjs [--ai heuristic|net|search] [--net FILE] [--stats FILE]
//
// Anything for people goes to stderr; stdout carries protocol only. --stats appends one
// JSON line per game: how each decision was answered (matched to our action, from a plan,
// by rule, or the fallback option 0) — the client's own health check.
import { createInterface } from 'node:readline';
import { readFileSync, appendFileSync } from 'node:fs';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionSearch, DEFAULT_SEARCH } from '../src/ai/search.ts';
import { chooseActionNet, DEFAULT_NET_PLAYER } from '../src/ai/netPlayer.ts';
import { loadValueNet } from '../src/ai/valueNet.ts';
import { newContext, decide } from '../src/protocol/decide.ts';
import { sideOf } from '../src/protocol/names.ts';

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
console.log = console.error; // nothing but protocol on stdout
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const AI = arg('--ai', 'heuristic');
const STATS = arg('--stats', null);
const NET = AI === 'net' ? loadValueNet(JSON.parse(readFileSync(arg('--net'), 'utf8'))) : null;
const chooser = AI === 'net' ? (s, a, l, r) => chooseActionNet(NET, s, a, l, r, DEFAULT_NET_PLAYER)
  : AI === 'search' ? (s, a, l, r) => chooseActionSearch(s, a, l, r, { ...DEFAULT_SEARCH, oppMix: 0.5 })
  : chooseAction;

let ctx = null, game = null;
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  switch (m.type) {
    case 'hello':
      out({ type: 'hello', id: m.id, protocol: 'wotr-bot/0.2', name: `WotR digital port AI (${AI})`, version: '2026.11', events: false, rulesets: ['base'] });
      break;
    case 'new_game':
      game = m.game;
      ctx = newContext(sideOf(m.side), Number(m.seed_bot ?? 1) >>> 0 || 1, chooser);
      out({ type: 'ready', id: m.id });
      break;
    case 'decide': {
      const t0 = Date.now();
      const o = decide(ctx, m.decision, m.view);
      out({ type: 'choice', id: m.id, o, ...(m.decision.fingerprint ? { fingerprint: m.decision.fingerprint } : {}) });
      const ms = Date.now() - t0;
      ctx.stats.decisions = (ctx.stats.decisions ?? 0) + 1;
      ctx.stats.maxMs = Math.max(ctx.stats.maxMs ?? 0, ms);
      break;
    }
    case 'game_over':
      console.error(`game ${m.game}: winner ${m.winner} (${m.how}) turn ${m.turn}; ${JSON.stringify(ctx?.stats)}`);
      if (STATS) appendFileSync(STATS, JSON.stringify({ game: m.game, side: ctx?.side, winner: m.winner, how: m.how, turn: m.turn, ai: AI, stats: ctx?.stats }) + '\n');
      break;
    case 'quit': process.exit(0); break;
    case 'get_view': break;
    default:
      if (m.id !== undefined && !['options', 'timeout', 'error'].includes(m.type)) out({ type: 'error', id: m.id, code: 'unknown_type' });
  }
});
rl.on('close', () => process.exit(0));
