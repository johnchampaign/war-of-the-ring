#!/usr/bin/env vite-node
// probe-army-move-rules.mjs — the ONE set of Army-movement rules (armies.ts:
// armyMoveOffer / armySelectionReason) that every kind of Army move now asks: die moves,
// second moves, card moves, attacks, and (as they move over) advances. Player report
// 4f0z2o2y1t2d3y6v: "there needs to only be one common implementation".
//
// Stage 1 routed splitBlockReason, moveArmySplit, attackError and cardSplitBlockReason
// through it. A differential run over 171,564 checks on identical positions found only
// two differences, both corrections, both pinned here:
//   * a Nation listed with ZERO moving units no longer trips the border rule;
//   * an enemy Character sharing the region is not part of the attacker's rearguard.
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { splitBlockReason, armySelectionReason, armyMoveOffer } from '../src/engine/armies.ts';
import { attackError } from '../src/engine/combat.ts';
import { cardSplitBlockReason } from '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => {
  const s = startGame(createGame({ seed: 3 }));
  // Dale: Elves At War with a passive North contingent, an FP Leader, Legolas.
  s.nations.elves.active = true; s.nations.elves.step = 0;
  s.nations.north.active = false; s.nations.north.step = 2;
  const d = s.regions['dale'];
  d.units = { elves: { regular: 2, elite: 1 }, north: { regular: 1, elite: 0 } }; d.leaders = 1; d.characters = ['legolas'];
  s.characters.inPlay['legolas'] = 'dale'; s.fellowship.companions = s.fellowship.companions.filter((c) => c !== 'legolas');
  for (const r of ['erebor', 'woodland-realm', 'northern-rhovanion']) { s.regions[r].units = {}; s.regions[r].leaders = 0; }
  return s;
};

console.log('\n=== the border rule reads who MOVES, not who is listed ===');
{
  const s = board();
  check('Elves into Erebor (a Dwarven region) with North listed at zero: legal',
    splitBlockReason(s, 'dale', 'erebor', 'fp', { units: { elves: { regular: 1 }, north: { regular: 0 } }, leaders: 1 }) === null);
  const r = splitBlockReason(s, 'dale', 'erebor', 'fp', { units: { elves: { regular: 1 }, north: { regular: 1 } }, leaders: 1 });
  check('…but a North unit actually going is refused, naming the North', !!r && /North/.test(r), r ?? 'null');
  const offer = armyMoveOffer(s, { kind: 'move', side: 'fp', force: s.regions['dale'], to: 'erebor' });
  const north = offer.nations.find((n) => n.nation === 'north');
  check('the offer greys the North out for Erebor, with the reason', north && north.regular === 0 && !!north.reason, north?.reason ?? '');
  const north2 = armyMoveOffer(s, { kind: 'move', side: 'fp', force: s.regions['dale'], to: 'northern-rhovanion' }).nations.find((n) => n.nation === 'north');
  check('…but not for a North region', north2 && north2.regular === 1 && !north2.reason);
}

console.log('\n=== what may be left behind: p.27 for moves, p.28 for attacks ===');
{
  const s = board();
  const r = splitBlockReason(s, 'dale', 'woodland-realm', 'fp', { units: { elves: { regular: 2, elite: 1 } }, leaders: 0 });
  check('an Elven move that leaves the Leader with only the North is legal (a unit stays)', r === null, r ?? 'null');
  s.regions['dale'].units = { elves: { regular: 1, elite: 0 } };
  const r2 = splitBlockReason(s, 'dale', 'woodland-realm', 'fp', { units: { elves: { regular: 1 } }, leaders: 0 });
  check('a move that leaves an FP Leader alone is refused', !!r2 && /Leaders can never be left/.test(r2), r2 ?? 'null');
  // A Shadow Army sharing its region with an FP Companion: that Companion is not part of
  // the attacker's rearguard (it was counted as one, and refused the attack).
  const t = startGame(createGame({ seed: 3 }));
  t.nations.sauron.active = true; t.nations.sauron.step = 0;
  const mm = t.regions['minas-morgul']; mm.units = { sauron: { regular: 3, elite: 0 } }; mm.nazgul = 0; mm.characters = ['gandalf-white'];
  const a = attackError(t, 'minas-morgul', 'shadow', { units: {}, characters: ['gandalf-white'] });
  check('an enemy Companion in the region is not the attacker\'s rearguard', a === null, a ?? 'null');
  mm.nazgul = 1;
  const a2 = attackError(t, 'minas-morgul', 'shadow', { units: {}, nazgul: 1 });
  check('…but our own Nazgûl left behind with no unit is refused (p.28)', a2 === 'A rearguard must contain at least one unit', a2 ?? 'null');
}

console.log('\n=== the Character-die escort, the same rule for a move and an attack ===');
{
  const s = board();
  const m = splitBlockReason(s, 'dale', 'woodland-realm', 'fp', { units: { elves: { regular: 1 } }, leaders: 0 }, true);
  check('a Character-die move with no Leader or Companion going is refused', !!m && /Character-die/.test(m), m ?? 'null');
  check('…and allowed once Legolas goes', splitBlockReason(s, 'dale', 'woodland-realm', 'fp', { units: { elves: { regular: 1 } }, characters: ['legolas'] }, true) === null);
}

console.log('\n=== a card move clamps, then asks the same rules ===');
{
  const s = board();
  check('an over-generous card selection is clamped, not refused',
    cardSplitBlockReason(s, 'dale', 'fp', { units: { elves: { regular: 9 } }, leaders: 1, characters: ['legolas'] }) === null);
  const z = cardSplitBlockReason(s, 'dale', 'fp', { units: {} });
  check('a card move of no units is refused with the move wording', z === 'At least one Army unit must move.', z ?? 'null');
}

console.log('\n=== figures that already moved (the "movable" limit) ===');
{
  const s = board();
  const rules = { kind: 'move', side: 'fp', force: s.regions['dale'], to: 'woodland-realm', movable: { units: { elves: { regular: 1 } } } };
  const offer = armyMoveOffer(s, rules);
  const elves = offer.nations.find((n) => n.nation === 'elves');
  check('only the figures that had not moved are offered', elves.regular === 1 && elves.elite === 0, JSON.stringify(elves));
  const r = armySelectionReason(s, rules, { units: { elves: { regular: 1, elite: 1 } } });
  check('…and asking for more names the rule', !!r && /cannot move twice/.test(r), r ?? 'null');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
