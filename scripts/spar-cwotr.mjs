#!/usr/bin/env node
// spar-cwotr.mjs — play our protocol bot against a local CWOTR build (measurement only).
//
//   node scripts/spar-cwotr.mjs --bridge PATH/TO/CWOTR/proto/bridge --player PLAYER|prior
//        --games N [--seed-start S] [--clock 2000] [--sims 0] [--out DIR] -- <bot command...>
//
// CWOTR (github.com/behindmedia/CWOTR, no licence: never vendored or shipped) referees each
// game on its own engine and plays one side; our bot plays the other over stdin/stdout.
// Sides alternate by seed: our bot is the Free Peoples on odd seeds. One line per game
// goes to DIR/results.jsonl; the referee's log to DIR/<seed>.ref.log, the bot's stderr to
// DIR/<seed>.bot.log. Resumable: seeds already in results.jsonl are skipped.
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const botCmd = argv.slice(sep + 1);
const a = argv.slice(0, sep);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const BRIDGE = opt('--bridge'), PLAYER = opt('--player', 'prior');
const GAMES = Number(opt('--games', 2)), SEED0 = Number(opt('--seed-start', 0));
// --side sh|fp: play only the seeds where we hold that side (seed parity decides it).
const SIDE = opt('--side', null);
const CLOCK = opt('--clock', '2000'), SIMS = opt('--sims', '0'), OUT = opt('--out', 'spar-out');
mkdirSync(OUT, { recursive: true });
const RES = join(OUT, 'results.jsonl');
const done = new Set(existsSync(RES) ? readFileSync(RES, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).seed) : []);

function play(seed) {
  return new Promise((resolve) => {
    const ourSide = seed % 2 === 1 ? 'fp' : 'sh';
    const t0 = Date.now();
    const refErr = openSync(join(OUT, `${seed}.ref.log`), 'w');
    const botErr = openSync(join(OUT, `${seed}.bot.log`), 'w');
    const ref = spawn(BRIDGE, ['referee', PLAYER, ourSide, String(seed), CLOCK, SIMS], { stdio: ['pipe', 'pipe', refErr] });
    const bot = spawn(botCmd[0], botCmd.slice(1), { stdio: ['pipe', 'pipe', botErr] });
    ref.stdout.pipe(bot.stdin);
    bot.stdout.pipe(ref.stdin);
    bot.stdin.on('error', () => {}); ref.stdin.on('error', () => {});
    ref.on('exit', (code) => {
      setTimeout(() => bot.kill(), 2000);
      const log = readFileSync(join(OUT, `${seed}.ref.log`), 'utf8');
      const result = log.split('\n').find((l) => l.startsWith('RESULT')) ?? null;
      const rec = { seed, ourSide, result, refExit: code, seconds: Math.round((Date.now() - t0) / 1000) };
      appendFileSync(RES, JSON.stringify(rec) + '\n');
      console.log(JSON.stringify(rec));
      resolve();
    });
  });
}

for (let g = 0; g < GAMES; g++) {
  const seed = SEED0 + g + 1;
  if (done.has(seed)) continue;
  if (SIDE && (seed % 2 === 1 ? 'fp' : 'sh') !== SIDE) continue;
  await play(seed);
}
