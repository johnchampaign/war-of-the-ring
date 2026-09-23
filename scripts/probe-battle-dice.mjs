#!/usr/bin/env vite-node
// probe-battle-dice.mjs — the battle MODAL shows each round's dice, so the data it
// draws from must be there while the battle is still running. The reporter of
// 2p2w0k6c5m2p6z4n had it exactly right: the end-of-battle popup had the good display
// (dice, hits in gold) and the modal had "super tiny text", so they traded places.
// This pins the contract the modal depends on — pendingCombat carries the live roll —
// and that the finished battle still carries its own copy for the outcome popup.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { combatStep } from '../src/engine/combat.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const ok = (r) => !!r && Array.isArray(r.dice) && typeof r.target === 'number';

// A plain field battle: Shadow attacks a Free Peoples Army in the open.
let s = startGame(createGame({ seed: 151 }));
s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
s.dice.shadow = ['army']; s.dice.fp = [];
s.nations.sauron.active = true; s.nations.sauron.step = 0;
s.nations.gondor.active = true; s.nations.gondor.step = 0;
s.regions['dagorlad'].units = { sauron: { regular: 5, elite: 1 } };
s.regions['north-ithilien'].units = { gondor: { regular: 3, elite: 1 } };

console.log('\n=== while the battle runs, the modal has dice to draw ===');
const atk = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'attack' && a.from === 'dagorlad' && a.to === 'north-ithilien');
check('the attack is available', !!atk, JSON.stringify(atk ?? null));
if (atk) {
  s = wotrAdapter.applyAction(s, { ...atk, die: 'army' }, 'shadow');
  let rolled = null;
  for (let i = 0; i < 60 && (s.pendingCombat || s.pendingChoice); i++) {
    if (s.pendingCombat && (s.pendingCombat.atkRoll || s.pendingCombat.defRoll)) { rolled = s.pendingCombat; break; }
    const who = wotrAdapter.currentActor(s); if (!who) break;
    const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, legal[0], who);
  }
  check('a round was rolled while the battle was still pending', !!rolled, rolled ? `round ${rolled.round + 1}` : 'never saw a live roll');
  if (rolled) {
    check('the attacker roll is there, with dice and a to-hit', ok(rolled.atkRoll), JSON.stringify(rolled.atkRoll ?? null));
    check('the defender roll too', ok(rolled.defRoll), JSON.stringify(rolled.defRoll ?? null));
    check('every die is a real face', [...(rolled.atkRoll?.dice ?? []), ...(rolled.defRoll?.dice ?? [])].every((n) => n >= 1 && n <= 6));
    check('the hit counts the modal prints alongside them are numbers', typeof rolled.atkHits === 'number' && typeof rolled.defHits === 'number');
  }
  // ...and when it is over, the outcome popup still has its own copy.
  for (let i = 0; i < 200 && (s.pendingCombat || s.pendingChoice); i++) {
    const who = wotrAdapter.currentActor(s); if (!who) break;
    const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, legal[0], who);
  }
  console.log('\n=== and the finished battle still carries its outcome ===');
  const b = s.lastBattle;
  check('a battle record was written', !!b, b ? `${b.rounds} round(s), ${b.outcome}` : 'none');
  if (b) {
    check('it names what it cost each side', typeof b.atkLosses === 'number' && typeof b.defLosses === 'number', `atk ${b.atkLosses}, def ${b.defLosses}`);
    check('and whether the region changed hands', 'captured' in b);
  }
}
console.log('\n=== the dice carry the round they were thrown in (report 1u171v5e) ===');
{
  // A siege defender gets no retreat, cease-attack or casualty prompt, so the FIRST
  // time it sees a round's dice is the NEXT round's Combat-card prompt — and the modal
  // labelled them with the round the battle had moved on to. The roll now stamps its
  // own round, so the label can say which one it belongs to.
  const t = startGame(createGame({ seed: 77 }));
  for (const r of Object.values(t.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  t.regions['dale'].units = { sauron: { regular: 5, elite: 0 } };
  t.regions['erebor'].units = { dwarves: { regular: 5, elite: 0 } };
  t.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'dale', to: 'erebor', round: 0,
    fortified: false, step: 'beginRound', attackerCard: null, defenderCard: null, atkHits: 0, defHits: 0 };
  combatStep(t);
  check('the first roll is stamped round 0', t.pendingCombat?.rollRound === 0, `rollRound=${t.pendingCombat?.rollRound}`);
  const firstDice = JSON.stringify(t.pendingCombat?.atkRoll?.dice);
  // Walk into round 2 without re-rolling: the stored dice must still be round 1's,
  // and must still say so even though pc.round has advanced.
  t.pendingCombat.round = 1; t.pendingCombat.step = 'attackerCard';
  check('the stored dice are still the previous round\'s', JSON.stringify(t.pendingCombat.atkRoll?.dice) === firstDice);
  check('…and they are NOT labelled with the new round', t.pendingCombat.rollRound !== t.pendingCombat.round,
    `rollRound=${t.pendingCombat.rollRound}, round=${t.pendingCombat.round}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
