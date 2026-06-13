#!/usr/bin/env vite-node
// probe-combat.mjs — Deterministically reach an interactive battle and dump the
// data the DecisionModal renders, to verify the combat path produces the fields
// the UI reads (the browser soak rarely stumbles into a battle by random play).
// Drives heuristic AI vs AI until state.pendingCombat is non-null at a point where
// the owner has a decision, then prints the redacted view's combat context +
// the decision actions offered.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { redactStateForViewer } from '../src/adapter/redact.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

const MAX_GAMES = 200, MAX_ACTIONS = 20000;
let found = 0;

for (let game = 0; game < MAX_GAMES && found < 3; game++) {
  let state = startGame(createGame({ seed: game + 1 }));
  const ai = new Rng(game * 1000 + 7);
  let actions = 0;
  while (!wotrAdapter.result(state) && actions < MAX_ACTIONS) {
    const actor = wotrAdapter.currentActor(state);
    if (actor === null) break;

    if (state.pendingCombat && state.pendingChoice) {
      const viewer = state.pendingChoice.owner;
      const v = redactStateForViewer(state, viewer);
      const legal = wotrAdapter.legalActions(state, viewer);
      const decisionKinds = ['playCombatCard', 'chooseCasualties', 'combatContinue', 'combatRetreat'];
      const decisions = legal.filter((a) => decisionKinds.includes(a.kind));
      if (decisions.length) {
        found++;
        const pc = v.pendingCombat;
        console.log(`\n=== Battle reached (game seed ${game + 1}, turn ${state.turn}) ===`);
        console.log(`  pendingCombat present in redacted view: ${!!pc}`);
        console.log(`  attacker=${pc.attacker} defender=${pc.defender} from=${pc.from} to=${pc.to}`);
        console.log(`  round=${pc.round} fortified=${pc.fortified} step=${pc.step} atkHits=${pc.atkHits} defHits=${pc.defHits}`);
        console.log(`  attackerCard=${pc.attackerCard} defenderCard=${pc.defenderCard}`);
        console.log(`  pendingChoice.kind=${v.pendingChoice.kind} owner=${v.pendingChoice.owner}`);
        console.log(`  decision actions offered: ${JSON.stringify(decisions)}`);
        // assert the fields CombatHeader reads are all defined
        const fields = ['attacker', 'defender', 'from', 'to', 'round', 'fortified', 'step', 'atkHits', 'defHits'];
        const missing = fields.filter((f) => pc[f] === undefined);
        console.log(missing.length ? `  !! MISSING FIELDS: ${missing}` : '  all CombatHeader fields present ✓');
      }
    }

    const legal = wotrAdapter.legalActions(state, actor);
    if (!legal.length) break;
    const res = wotrAdapter.tryApplyAction(state, chooseAction(state, actor, legal, ai), actor);
    if (!res.ok) break;
    state = res.state;
    actions++;
  }
}

console.log(found ? `\nprobe OK — reached ${found} battle decision point(s)` : '\nprobe: no battle reached');
process.exit(found ? 0 : 1);
