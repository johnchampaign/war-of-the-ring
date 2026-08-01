#!/usr/bin/env vite-node
// measure-ai-passivity.mjs — INSTRUMENTATION, not a pass/fail gate.
//
// Quantifies the three things players reported about the Shadow AI:
//   1. "moves all its troops out of a stronghold, leaving it completely undefended"
//      -> WALK-INS: Settlements that changed hands with zero defenders present,
//         as a share of all captures. Battlefield tuning cannot touch these.
//   2. "underutilise the Southrons & Easterlings, not moving them during an entire
//      game while they do put in the effort to put them at war"
//      -> per-Nation march counts, and how many games each At-War Nation never
//         moved a single unit.
//   3. "keep their biggest Sauron force in Gorgoroth without using them"
//      -> the largest home stack's idle share.
//
// Run: vite-node scripts/measure-ai-passivity.mjs [--games 30]
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { settlementController, unitCount } from '../src/engine/armies.ts';
import { REGIONS } from '../src/engine/data.ts';
import { SHADOW_NATIONS, FP_NATIONS } from '../src/engine/types.ts';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const GAMES = arg('--games', 30);
const MAX_ACTIONS = 20000;

const VP_REGIONS = Object.keys(REGIONS).filter((id) => (REGIONS[id].vp ?? 0) > 0);
/** Actions that actually commit an Army to the map, as opposed to mustering more of
 *  it at home. "The AI never moved them all game" is about these. */
const ENGAGE_KINDS = new Set(['moveArmy', 'armyMove2', 'attack']);
const sideOf = (n) => (FP_NATIONS.includes(n) ? 'fp' : 'shadow');

/** Units of `nation` per region — used to detect that a nation's units actually moved. */
const placement = (s, nation) => {
  const out = {};
  for (const [id, r] of Object.entries(s.regions)) {
    const u = r.units[nation];
    if (u && u.regular + u.elite > 0) out[id] = u.regular + u.elite;
  }
  return out;
};
const samePlacement = (a, b) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => b[k] === a[k]);
};

const stat = {
  captures: { fp: 0, shadow: 0 },      // captures MADE by this side
  walkIns: { fp: 0, shadow: 0 },       // ...of which the settlement stood empty
  moves: Object.fromEntries([...FP_NATIONS, ...SHADOW_NATIONS].map((n) => [n, 0])),
  atWarGames: Object.fromEntries([...FP_NATIONS, ...SHADOW_NATIONS].map((n) => [n, 0])),
  idleGames: Object.fromEntries([...FP_NATIONS, ...SHADOW_NATIONS].map((n) => [n, 0])),
  wins: { fp: 0, shadow: 0 },
  finalVP: { fp: [], shadow: [] },
  turns: [],
};

for (let game = 0; game < GAMES; game++) {
  const seed = game + 1;
  let state = startGame(createGame({ seed }));
  const ai = new Rng(seed * 1000 + 7);
  let actions = 0;
  const movedThisGame = new Set();
  const wasAtWar = new Set();

  while (!wotrAdapter.result(state) && actions < MAX_ACTIONS) {
    const actor = wotrAdapter.currentActor(state);
    if (actor === null) break;
    const legal = wotrAdapter.legalActions(state, actor);
    if (!legal.length) break;

    // Snapshot the things we diff across this one action.
    const ctrlBefore = {}, defendedBefore = {};
    for (const id of VP_REGIONS) { ctrlBefore[id] = settlementController(state, id); defendedBefore[id] = unitCount(state, id); }
    const placeBefore = {};
    for (const n of [...FP_NATIONS, ...SHADOW_NATIONS]) placeBefore[n] = placement(state, n);
    for (const n of [...FP_NATIONS, ...SHADOW_NATIONS]) if (state.nations?.[n]?.active) wasAtWar.add(n);

    const action = chooseAction(state, actor, legal, ai);
    const res = wotrAdapter.tryApplyAction(state, action, actor);
    if (!res.ok) { actions++; continue; }
    state = res.state;
    actions++;

    // Captures, and whether the settlement was empty when it fell.
    for (const id of VP_REGIONS) {
      const now = settlementController(state, id);
      if (now && now !== ctrlBefore[id]) {
        stat.captures[now]++;
        if (defendedBefore[id] === 0) stat.walkIns[now]++;
      }
    }
    // A nation "marched" only on an actual march/attack — comparing placement alone
    // counts mustering and casualties as movement, which massively overstates how
    // engaged an idle Nation is.
    if (ENGAGE_KINDS.has(action.kind)) {
      for (const n of [...FP_NATIONS, ...SHADOW_NATIONS]) {
        if (!samePlacement(placeBefore[n], placement(state, n))) { stat.moves[n]++; movedThisGame.add(n); }
      }
    }
  }

  for (const n of wasAtWar) { stat.atWarGames[n]++; if (!movedThisGame.has(n)) stat.idleGames[n]++; }
  const r = wotrAdapter.result(state);
  if (r?.winners?.[0]) stat.wins[r.winners[0]]++;
  stat.finalVP.fp.push(state.victoryPoints.fp);
  stat.finalVP.shadow.push(state.victoryPoints.shadow);
  stat.turns.push(state.turn ?? 0);
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const pct = (a, b) => (b === 0 ? '  n/a' : `${String(Math.round((a / b) * 100)).padStart(3)}%`);

console.log(`\n=== AI passivity, ${GAMES} heuristic-vs-heuristic games ===`);
console.log(`wins: FP ${stat.wins.fp} / Shadow ${stat.wins.shadow}   median turns ${med(stat.turns)}`);
console.log(`final VP median: FP ${med(stat.finalVP.fp)} (needs 4)   Shadow ${med(stat.finalVP.shadow)} (needs 10)`);
console.log(`FP games reaching 4+ VP: ${stat.finalVP.fp.filter((v) => v >= 4).length}/${GAMES}`);

console.log(`\n--- captures, and how many were undefended walk-ins ---`);
for (const side of ['fp', 'shadow']) {
  console.log(`  ${side.padEnd(6)} captured ${String(stat.captures[side]).padStart(4)}  walk-ins ${String(stat.walkIns[side]).padStart(4)}  (${pct(stat.walkIns[side], stat.captures[side])} undefended)`);
}

console.log(`\n--- did each Nation actually march? (games it was At War) ---`);
for (const n of [...SHADOW_NATIONS, ...FP_NATIONS]) {
  const aw = stat.atWarGames[n], idle = stat.idleGames[n];
  console.log(`  ${sideOf(n).padEnd(6)} ${n.padEnd(10)} at-war in ${String(aw).padStart(3)} games, NEVER moved in ${String(idle).padStart(3)} (${pct(idle, aw)})   total marches ${stat.moves[n]}`);
}
console.log();
