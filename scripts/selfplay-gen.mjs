#!/usr/bin/env vite-node
// selfplay-gen.mjs — self-play positions for the value net (docs/ai-selfplay-plan.md).
//
//   vite-node scripts/selfplay-gen.mjs --games N --seed-start S --out FILE [--net FILE]
//
// Plays N games on seeds S+1..S+N and appends one binary record per sampled position:
//   [INPUT_SIZE bytes: encode(state)] [label: 1 = Shadow won, 0 = Free Peoples won]
//   [turn of the position] [final turn] [side to move: 1 = FP]
// Positions sampled: every turn start (the Fellowship phase's first decision) and ~12% of
// the action-resolution decisions. Games that end without a winner are dropped.
//
// Variety, drawn per game from the seed: the Free Peoples are the heuristic (70%) or the
// human-like yardstick (30%); each side gets a noise level (0, 0.1, 0.2 or 0.35) — the
// fraction of its top-level decisions taken uniformly from its heuristic top 3.
// With --net, both sides play the net player (netPlayer.ts, 6 candidates x 4 samples)
// instead of the plain heuristic — the next self-play iteration; human-like FP games stay.
// Training targets are always the real result, never the noise.
// A piece writes FILE.part and renames it to FILE when done, so a killed piece leaves no
// half-written file behind and a rerun redoes it.
import { writeFileSync, renameSync, existsSync, appendFileSync, unlinkSync } from 'node:fs';
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter, applyActionInPlace } from '../src/adapter/wotrAdapter.ts';
import { chooseAction, topCandidates } from '../src/ai/wotrAI.ts';
import { chooseActionHumanlike } from '../src/ai/humanlikeFP.ts';
import { encode, INPUT_SIZE, ENCODING_VERSION } from '../src/ai/encode.ts';
import { loadValueNet } from '../src/ai/valueNet.ts';
import { chooseActionNet } from '../src/ai/netPlayer.ts';
import { readFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const GAMES = Number(arg('--games', 100));
const SEED0 = Number(arg('--seed-start', 0));
const OUT = arg('--out', 'selfplay.bin');
const NET_FILE = arg('--net', null);
const NET = NET_FILE ? loadValueNet(JSON.parse(readFileSync(NET_FILE, 'utf8'))) : null;
const NETOPT = { cands: 6, samples: 4, margin: 0.02 };
const REC = INPUT_SIZE + 4;
const NOISE = [0, 0.1, 0.2, 0.35];
const GUARD = 20000;

if (existsSync(OUT)) { console.log(`${OUT} exists — skipping`); process.exit(0); }
const PART = OUT + '.part';
if (existsSync(PART)) unlinkSync(PART);
writeFileSync(PART, Buffer.alloc(0));

let kept = 0, dropped = 0, positions = 0, shWins = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const seed = SEED0 + g + 1;
  const cfg = new Rng(seed * 7919 + 13);
  const fpHumanlike = cfg.next() < 0.3;
  const noise = { fp: NOISE[cfg.int(4)], shadow: NOISE[cfg.int(4)] };
  const rng = new Rng(seed * 1000 + 3);
  const s = startGame(createGame({ seed }));
  const recs = [];
  let lastTurnStart = -1, ok = true;
  for (let n = 0; n < GUARD && !s.winner; n++) {
    const who = wotrAdapter.currentActor(s);
    if (!who) { ok = false; break; }
    const legal = wotrAdapter.legalActions(s, who);
    if (!legal.length) { ok = false; break; }
    if (!s.pendingChoice) {
      const turnStart = s.phase === 'fellowship' && lastTurnStart !== s.turn;
      if (turnStart || (s.phase === 'actionResolution' && rng.next() < 0.12)) {
        if (turnStart) lastTurnStart = s.turn;
        recs.push({ x: encode(s), turn: s.turn, fpToMove: who === 'fp' ? 1 : 0 });
      }
    }
    let a;
    const top = noise[who] && rng.next() < noise[who] ? topCandidates(s, who, legal, rng, 3) : null;
    if (top && top.length > 1) a = top[rng.int(top.length)];
    else if (who === 'fp' && fpHumanlike) a = chooseActionHumanlike(s, who, legal, rng);
    else if (NET) a = chooseActionNet(NET, s, who, legal, rng, NETOPT);
    else a = chooseAction(s, who, legal, rng);
    try { applyActionInPlace(s, a, who); } catch { ok = false; break; }
    if (s.log.length > 64) s.log.splice(0, s.log.length - 16);
  }
  if (!ok || !s.winner) { dropped++; continue; }
  const label = s.winner === 'shadow' ? 1 : 0;
  shWins += label;
  const buf = Buffer.alloc(recs.length * REC);
  recs.forEach((r, i) => {
    buf.set(r.x, i * REC);
    buf[i * REC + INPUT_SIZE] = label;
    buf[i * REC + INPUT_SIZE + 1] = Math.min(255, r.turn);
    buf[i * REC + INPUT_SIZE + 2] = Math.min(255, s.turn);
    buf[i * REC + INPUT_SIZE + 3] = r.fpToMove;
  });
  appendFileSync(PART, buf);
  kept++; positions += recs.length;
  if ((g + 1) % 100 === 0) console.log(`  ${g + 1} games, ${positions} positions, ${((Date.now() - t0) / (g + 1)).toFixed(0)} ms/game`);
}
renameSync(PART, OUT);
writeFileSync(OUT + '.json', JSON.stringify({ net: NET_FILE, encodingVersion: ENCODING_VERSION, inputSize: INPUT_SIZE, record: REC, seedStart: SEED0, games: GAMES, kept, dropped, positions, shadowWins: shWins }) + '\n');
console.log(`done: ${kept} games kept, ${dropped} dropped, ${positions} positions, Shadow won ${shWins}, ${((Date.now() - t0) / GAMES).toFixed(0)} ms/game`);
