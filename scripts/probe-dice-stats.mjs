#!/usr/bin/env vite-node
// probe-dice-stats.mjs — the end-of-game dice statistics (player report
// zfi5pzt828h4v6xq) are read back from the log's roll payloads. If a payload loses the
// field the tally keys on (the battle's attackerSide, the Action roll's faces, the Hunt
// dice), the screen would quietly show nothing; this plays whole games and checks that
// every kind of roll is counted, and that the counts agree with the log.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { wotrAdapter, startGame } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { tallyDice } from '../src/play/DiceStats.tsx';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sum = (c) => c.reduce((a, b) => a + b, 0);

console.log('\n=== dice statistics count every roll in the log ===');
for (const seed of [77, 78]) {
  let s = startGame(createGame({ seed })); const rng = new Rng(seed);
  for (let i = 0; i < 4000 && !wotrAdapter.result(s); i++) {
    const side = wotrAdapter.currentActor(s); if (!side) break;
    const res = wotrAdapter.tryApplyAction(s, chooseAction(s, side, wotrAdapter.legalActions(s, side), rng), side);
    if (!res.ok) break; s = res.state;
  }
  const t = tallyDice(s);
  // Expected totals straight from the payloads.
  let action = 0, combat = 0, hunt = 0, rounds = 0;
  for (const e of s.log) {
    const p = e.payload; if (!p) continue;
    if (e.kind === 'roll') action += (p.fp?.length ?? 0) + (p.shadow?.length ?? 0) + (p.eyes ?? 0);
    if (e.kind === 'combat' && Array.isArray(p.attacker?.dice)) { rounds++; combat += p.attacker.dice.length + p.attacker.rerolls.length + p.defender.dice.length + p.defender.rerolls.length; }
    if (e.kind === 'combat' && p.side && p.dice) combat += p.dice.length;
    if (e.kind === 'hunt' && p.dice) hunt += p.dice.length + (p.rerolls?.length ?? 0);
  }
  const counted = (side) => Object.values(t.action[side]).reduce((a, b) => a + b, 0);
  check(`seed ${seed}: every Action die counted`, action > 0 && counted('fp') + counted('shadow') === action, `${counted('fp') + counted('shadow')} of ${action}`);
  check(`seed ${seed}: every battle round is tagged with its attacker`, s.log.filter((e) => e.kind === 'combat' && Array.isArray(e.payload?.attacker?.dice)).every((e) => e.payload.attackerSide === 'fp' || e.payload.attackerSide === 'shadow'), `${rounds} rounds`);
  check(`seed ${seed}: every Combat die counted`, rounds === 0 || sum(t.combat.fp) + sum(t.combat.shadow) === combat, `${sum(t.combat.fp) + sum(t.combat.shadow)} of ${combat}`);
  check(`seed ${seed}: every Hunt die counted`, sum(t.hunt) === hunt, `${sum(t.hunt)} of ${hunt}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
