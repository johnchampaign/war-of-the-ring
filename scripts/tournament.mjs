#!/usr/bin/env vite-node
// tournament.mjs — Headless soak: two RandomAIs play full games via the
// GameAdapter. Asserts the Phase-1 invariants: no crash, no stall (currentActor
// never null mid-game), no illegal action accepted, every game terminates with a
// winner, and per-seat views never leak the RNG or the opponent's hand. Also
// checks codec round-trips (encode -> decode -> re-encode identical).
//
// Run: npm run tournament  (or: vite-node scripts/tournament.mjs --games 500)
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { redactStateForViewer } from '../src/adapter/redact.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const strArg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const GAMES = arg('--games', 300);
const MAX_ACTIONS = 20000;
// Controller per side: 'heuristic' (default) or 'random'.
const CTRL = { fp: strArg('--fp', 'heuristic'), shadow: strArg('--shadow', 'heuristic') };
const pick = (ctrl, state, actor, legal, rng) =>
  ctrl === 'random' ? rng.pick(legal) : chooseAction(state, actor, legal, rng);

// Total Army units (regular+elite) on the board plus in reinforcements. Move-family
// actions only relocate/recycle units, so this total must NOT change across them —
// a drop means a unit vanished (the reported "moved and the troop disappeared" bug).
const armyUnitTotal = (s) => {
  let n = 0;
  for (const r of Object.values(s.regions)) for (const u of Object.values(r.units)) n += u.regular + u.elite;
  for (const p of Object.values(s.reinforcements)) n += (p.regular ?? 0) + (p.elite ?? 0);
  return n;
};
const MOVE_KINDS = new Set(['moveArmy', 'armyMove2', 'removeExcess']);

let stalls = 0, illegals = 0, timeouts = 0, leaks = 0, vanished = 0;
const wins = { fp: 0, shadow: 0 };
const reasons = {};
const turnCounts = [];

for (let game = 0; game < GAMES; game++) {
  const seed = game + 1;
  let state = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7); // independent choice RNG
  let actions = 0;

  while (!wotrAdapter.result(state) && actions < MAX_ACTIONS) {
    const actor = wotrAdapter.currentActor(state);
    if (actor === null) { stalls++; break; }
    const legal = wotrAdapter.legalActions(state, actor);
    if (legal.length === 0) { stalls++; break; }
    const action = pick(CTRL[actor], state, actor, legal, ai);
    // Conservation guard for move-family actions (no combat in play): the army-unit
    // total must be identical before/after — a drop is a vanished unit.
    const checkConserve = MOVE_KINDS.has(action.kind) && !state.pendingCombat;
    const before = checkConserve ? armyUnitTotal(state) : 0;
    const res = wotrAdapter.tryApplyAction(state, action, actor);
    if (!res.ok) { illegals++; console.error(`  illegal: ${JSON.stringify(action)} -> ${res.reason}`); break; }
    state = res.state;
    if (checkConserve && !state.pendingCombat) {
      const after = armyUnitTotal(state);
      if (after !== before) { vanished++; console.error(`  UNIT VANISHED (${before}->${after}) on ${JSON.stringify(action)} [game ${game} seed ${seed}]`); break; }
    }
    actions++;

    // Periodic codec round-trip + redaction leak check.
    if (actions % 50 === 0) {
      const enc = JSON.stringify(state);
      if (JSON.stringify(JSON.parse(enc)) !== enc) { console.error('  codec mismatch'); illegals++; break; }
      // The hidden-info invariant is mid-game only — at game over redact reveals
      // everything by design (see redact.ts), so skip terminal states.
      const sv = redactStateForViewer(state, 'shadow');
      if (!state.winner && (sv.rngState !== 0 || sv.cards.fp.hand.some((c) => c !== 'hidden'))) leaks++;
    }
  }

  const result = wotrAdapter.result(state);
  if (result) { wins[result.winners[0]]++; turnCounts.push(state.turn); reasons[result.reason] = (reasons[result.reason] || 0) + 1; }
  else if (actions >= MAX_ACTIONS) timeouts++;
}

turnCounts.sort((a, b) => a - b);
const avg = turnCounts.length ? (turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length) : 0;
const med = turnCounts.length ? turnCounts[Math.floor(turnCounts.length / 2)] : 0;
console.log(`Games: ${GAMES} (FP=${CTRL.fp}, Shadow=${CTRL.shadow})`);
console.log(`  winners: FP ${wins.fp}, Shadow ${wins.shadow}`);
console.log(`  win reasons: ${JSON.stringify(reasons)}`);
console.log(`  turns: min ${turnCounts[0] ?? '-'}, median ${med}, avg ${avg.toFixed(1)}, max ${turnCounts.at(-1) ?? '-'}`);
console.log(`  stalls: ${stalls}, illegal-accepted: ${illegals}, timeouts: ${timeouts}, view-leaks: ${leaks}, vanished-units: ${vanished}`);

const ok = stalls === 0 && illegals === 0 && timeouts === 0 && leaks === 0 && vanished === 0 && (wins.fp + wins.shadow) === GAMES;
console.log(ok ? '\nsoak OK — all games terminated cleanly' : '\nSOAK FAILED');
process.exit(ok ? 0 : 1);
