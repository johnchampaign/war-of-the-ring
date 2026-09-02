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
import { REGIONS as REGIONSBYID } from '../src/engine/data.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { chooseActionEval } from '../src/ai/evalChooser.ts';

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const strArg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
};
const GAMES = arg('--games', 300);
// --seed-offset N: play a DIFFERENT seed family (seeds N+1..N+GAMES) — a second
// sample for A/Bs whose result sits near a threshold, so noise can be estimated
// instead of guessed. Default 0 keeps every historic soak reproducible.
const SEED_OFFSET = arg('--seed-offset', 0);
const MAX_ACTIONS = 20000;
// Controller per side: 'heuristic' (default), 'random', or 'eval' (the 1-ply
// evaluator — docs/ai-1ply-evaluator.md; ~50-100x slower per decision, so size
// --games accordingly). Head-to-head: --shadow eval vs the heuristic FP, etc.
const CTRL = { fp: strArg('--fp', 'heuristic'), shadow: strArg('--shadow', 'heuristic') };
const pick = (ctrl, state, actor, legal, rng) =>
  ctrl === 'random' ? rng.pick(legal)
    : ctrl === 'eval' ? chooseActionEval(state, actor, legal, rng)
      : chooseAction(state, actor, legal, rng);

// Total Army units (regular+elite) on the board plus in reinforcements. Move-family
// actions only relocate/recycle units, so this total must NOT change across them —
// a drop means a unit vanished (the reported "moved and the troop disappeared" bug).
const armyUnitTotal = (s) => {
  let n = 0;
  for (const r of Object.values(s.regions)) {
    for (const u of Object.values(r.units)) n += u.regular + u.elite;
    if (r.siegeBox) for (const u of Object.values(r.siegeBox.units)) n += u.regular + u.elite; // boxed garrison still on the board
  }
  for (const p of Object.values(s.reinforcements)) n += (p.regular ?? 0) + (p.elite ?? 0);
  return n;
};
const MOVE_KINDS = new Set(['moveArmy', 'armyMove2', 'removeExcess']);

// p.26: a Free Peoples Leader can never stand in a region without FP Army units. The
// movers and the muster refuse it, but any effect that removes the region's LAST FP unit
// used to leave the Leaders there — found here first, as a Stormcrow loss at seed 313
// (it renders as a phantom Army badge over an empty region). Guarded permanently.
const FP_NATION = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan']);
const hasFpUnits = (f) => Object.entries(f?.units ?? {}).some(([n, u]) => FP_NATION.has(n) && u.regular + u.elite > 0);
const strandedLeaderRegion = (s) => Object.keys(s.regions).find((id) => {
  const r = s.regions[id];
  return r.leaders > 0 && !hasFpUnits(r) && !hasFpUnits(r.siegeBox);
}) ?? null;

let stalls = 0, illegals = 0, timeouts = 0, leaks = 0, vanished = 0, stranded = 0;
// --- Fellowship telemetry (docs/ai-fellowship-plan.md groundwork): the baseline the
// plan-machine A/Bs will be judged against. Win rate alone is too coarse — the
// per-turn-quota experiment RAISED FP% while ruining the game.
const fel = { games: 0, mordorEntries: 0, entryTurns: [], healDeclares: 0, pushDeclares: 0,
  progressAtPush: [], stalledTurns: 0, preMordorTurns: 0, peakCorruption: [] };
const wins = { fp: 0, shadow: 0 };
const reasons = {};
const turnCounts = [];

for (let game = 0; game < GAMES; game++) {
  const seed = SEED_OFFSET + game + 1;
  let state = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7); // independent choice RNG
  let actions = 0;
  let peakCorr = 0, lastTurnSeen = 0, progressAtTurnStart = 0, movedThisTurn = false;

  while (!wotrAdapter.result(state) && actions < MAX_ACTIONS) {
    peakCorr = Math.max(peakCorr, state.fellowship.corruption);
    // Turn boundary: settle the PREVIOUS turn's stall verdict (pre-Mordor only).
    if (state.turn !== lastTurnSeen) {
      if (lastTurnSeen > 0 && state.fellowship.mordor === null) {
        fel.preMordorTurns++;
        if (!movedThisTurn && state.fellowship.progress === progressAtTurnStart) fel.stalledTurns++;
      }
      lastTurnSeen = state.turn; progressAtTurnStart = state.fellowship.progress; movedThisTurn = false;
    }
    const actor = wotrAdapter.currentActor(state);
    if (actor === null) { stalls++; break; }
    const legal = wotrAdapter.legalActions(state, actor);
    if (legal.length === 0) { stalls++; break; }
    const action = pick(CTRL[actor], state, actor, legal, ai);
    // Fellowship telemetry (cheap, observational only).
    if (action.kind === 'moveFellowship' || action.kind === 'declareFellowship') movedThisTurn = true;
    if (action.kind === 'enterMordor') { fel.mordorEntries++; fel.entryTurns.push(state.turn); }
    else if (action.kind === 'declareFellowship') {
      const t = action.target, fs = state.fellowship;
      const d = state.regions[t], def = REGIONSBYID[t];
      const heals = def && (def.settlement === 'City' || def.settlement === 'Stronghold')
        && def.nation && FP_NATION.has(def.nation) && d.control !== 'shadow';
      if (heals && fs.corruption > 0) fel.healDeclares++; else { fel.pushDeclares++; fel.progressAtPush.push(fs.progress); }
    }
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
    const lone = strandedLeaderRegion(state);
    if (lone) { stranded++; console.error(`  STRANDED FP LEADER in ${lone} on ${JSON.stringify(action)} [game ${game} seed ${seed}]`); break; }

    // Periodic codec round-trip + redaction leak check.
    if (actions % 50 === 0) {
      const enc = JSON.stringify(state);
      if (JSON.stringify(JSON.parse(enc)) !== enc) { console.error('  codec mismatch'); illegals++; break; }
      // The hidden-info invariant is mid-game only — at game over redact reveals
      // everything by design (see redact.ts), so skip terminal states.
      const sv = redactStateForViewer(state, 'shadow');
      if (!state.winner && (sv.rngState !== 0 || sv.cards.fp.hand.some((c) => !String(c).startsWith('hidden')))) leaks++;
      // The FP view must not see the Shadow AI's campaign roll (the opening plan).
      const fv = redactStateForViewer(state, 'fp');
      if (!state.winner && fv.shadowPlanRoll != null) leaks++;
    }
  }

  const result = wotrAdapter.result(state);
  fel.games++;
  fel.peakCorruption.push(peakCorr);
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
console.log(`  stalls: ${stalls}, illegal-accepted: ${illegals}, timeouts: ${timeouts}, view-leaks: ${leaks}, vanished-units: ${vanished}, stranded-leaders: ${stranded}`);
const favg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
console.log(`  fellowship: Mordor entries ${fel.mordorEntries}/${fel.games} (mean turn ${favg(fel.entryTurns)}), heal-declares ${fel.healDeclares}, push-declares ${fel.pushDeclares} (mean progress ${favg(fel.progressAtPush)}), stalled pre-Mordor turns ${fel.stalledTurns}/${fel.preMordorTurns}, peak corruption ${favg(fel.peakCorruption)}`);

const ok = stalls === 0 && illegals === 0 && timeouts === 0 && leaks === 0 && vanished === 0 && stranded === 0 && (wins.fp + wins.shadow) === GAMES;
console.log(ok ? '\nsoak OK — all games terminated cleanly' : '\nSOAK FAILED');
process.exit(ok ? 0 : 1);
