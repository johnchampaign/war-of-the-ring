#!/usr/bin/env vite-node
// probe-forced-choices.mjs — a prompt with only one possible answer is not a choice,
// and online it keeps the other player waiting for its owner to log on (player report
// 82pv41soao2luug6: "I have rolled more than enough hits to defeat my opponent's army,
// but he has to log back on to choose casualties … being given the option to retreat
// when there is no valid region to retreat into, and choosing how many hunt dice to
// allocate when the only option is 1"; report vqsir22ho0c54p7w: the second Muster
// figure with nowhere to place it). Each is now settled without asking. (Overwhelming
// casualties are pinned in probe-casualty-choice.)
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { advance } from '../src/engine/phases.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== one legal number of Hunt dice is allocated without asking ===');
{
  const s = startGame(createGame({ seed: 3 }));
  s.phase = 'huntAllocation'; s.pendingChoice = null;
  s.hunt.fpDiceInBox = 1; s.flags.huntMin1ThisTurn = true;   // at least one
  s.fellowship.companions = ['strider']; s.fellowship.guide = 'strider'; // at most one
  advance(s);
  check('the Shadow is not asked', s.phase !== 'huntAllocation', s.phase);
  check('one die went to the Hunt Box', s.hunt.box === 1, String(s.hunt.box));
  check('…and the log says so', s.log.some((e) => /allocates 1 die to the Hunt \(the only allowed number\)/.test(e.msg)));
  const t = startGame(createGame({ seed: 3 }));
  t.phase = 'huntAllocation'; t.pendingChoice = null;
  advance(t);
  check('with a real range the Shadow is still asked', t.phase === 'huntAllocation');
}

console.log('\n=== "Retreat or stand?" only with somewhere to go ===');
{
  // A Free Peoples Army in Dagorlad hemmed in: every neighbour holds a Shadow Army.
  let found = false;
  for (let seed = 1; seed < 80 && !found; seed++) {
    const s = startGame(createGame({ seed }));
    for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
    for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
    s.regions['dagorlad'].units = { north: { regular: 5, elite: 0 } };
    s.regions['noman-lands'].units = { sauron: { regular: 6, elite: 0 } };
    for (const r of ['morannon', 'ash-mountains', 'north-ithilien', 'eastern-emyn-muil']) if (s.regions[r]) s.regions[r].units = { sauron: { regular: 1, elite: 0 } };
    startBattle(s, 'shadow', 'noman-lands', 'dagorlad');
    for (let i = 0; i < 30 && s.pendingCombat; i++) {
      combatStep(s);
      const ch = s.pendingChoice;
      if (!ch) continue;
      if (ch.kind === 'combatRetreat') { check('no retreat question with nowhere to go', false, `seed ${seed}`); found = true; break; }
      if (ch.kind === 'combatContinue') {
        found = true;
        // The attacker continues; the defender has nowhere to retreat — the next round
        // starts without asking him.
        s.pendingChoice = null; s.pendingCombat.step = 'retreatDecision';
        combatStep(s);
        check('the Army stands without being asked', s.pendingChoice?.kind !== 'combatRetreat', s.pendingChoice?.kind ?? 'none');
        check('…and the log says why', s.log.some((e) => /no free region to retreat into/.test(e.msg)));
        break;
      }
      // Any other question (card plays, casualties): take the first offer.
      const a = wotrAdapter.legalActions(s, ch.owner)[0];
      if (!a) break;
      const r = wotrAdapter.tryApplyAction(s, a, ch.owner);
      if (!r.ok) break;
      Object.assign(s, r.state);
    }
  }
  check('a hemmed-in battle reached the retreat step', found);
}

console.log('\n=== a Muster with no second figure to place ends the Action ===');
{
  const s = startGame(createGame({ seed: 5 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['muster']; s.dice.shadow = ['army'];
  for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
  // Nothing else to recruit anywhere: every reserve empty but one Gondor Regular.
  for (const n of Object.keys(s.reinforcements)) s.reinforcements[n] = { ...s.reinforcements[n], regular: 0, elite: 0, leader: 0 };
  s.reinforcements.gondor.regular = 1;
  const r1 = wotrAdapter.legalActions(s, 'fp').find((a) => a.kind === 'recruitUnit' && a.then);
  if (!r1) check('a two-figure muster is offered', false);
  else {
    const t = wotrAdapter.applyAction(s, r1, 'fp');
    check('no "second figure" question', t.pendingChoice?.kind !== 'musterSecond', t.pendingChoice?.kind ?? 'none');
    check('…the turn passed to the Shadow', t.currentPlayer === 'shadow', t.currentPlayer);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
