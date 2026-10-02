#!/usr/bin/env vite-node
// probe-triage-1002.mjs — two fixes from the 2026-10-02 report batch:
//
//  1. "Give it to Uss!" is a red Shadow Special tile that prints a 1 with a reveal
//     icon. It was treated as a STANDARD numbered tile, so Gollum ignored its reveal
//     and could then reveal on top of it for −1 damage. Almanac, Gollum: red Shadow
//     Special tiles with a reveal icon always reveal, and he may not reveal-to-reduce
//     on a tile that already revealed. Report osf97egfulfaixb3.
//  2. A Character refused a destination is told why in Character-move terms — a
//     Companion barred from his own besieged Stronghold used to get the muster hint
//     "There is an enemy Army in Helm's Deep". Report 5q0l1z724w6u2742.
//  3. The die named for an Army move/attack must be able to pay for it: a Muster die
//     only through the Mouth of Sauron's once-a-turn Messenger. And the die filter
//     knows the Messenger, so a Character die selected hides Army moves it can't pay
//     for (reports 3p6r2o011u3t4t1d, 023j54683q492a41); Will-only upgrades likewise
//     hide under any other die (report 6n004u6e723a2749).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { extraHunt } from '../src/engine/hunt.ts';
import { characterMoveBlockReason } from '../src/engine/charMove.ts';
import { dieOptions } from '../src/play/actionText.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

{
  console.log('\n=== "Give it to Uss!" always reveals, even with Gollum as the Guide ===');
  const s = startGame(createGame({ seed: 31 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.fellowship.mordor = 2; s.fellowship.hidden = true; s.fellowship.corruption = 3;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  // Only the Uss tile left in the pool, so it is the one drawn (an empty pool would
  // reshuffle `drawn` back in — keep that empty too).
  s.hunt.pool = []; s.hunt.drawn = []; s.hunt.specialsInPool = ['sh-char-04'];
  extraHunt(s, { source: 'probe' });
  const draw = s.hunt.draws.at(-1);
  check('the drawn tile is "Give it to Uss!"', draw?.specialCard === 'Give it to Uss!' || draw?.special === 'shadow', JSON.stringify(draw));
  const legal = s.pendingChoice?.kind === 'huntDamage' ? wotrAdapter.legalActions(s, 'fp') : [];
  check('Gollum is NOT offered reveal-to-reduce on it',
    !legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal'), legal.map((a) => a.mode).join(','));
  check('the tile reveals the Fellowship', s.fellowship.hidden === false || s.pendingChoice?.kind === 'revealMove' || s.pendingChoice?.data?.reveal === true,
    `hidden=${s.fellowship.hidden} pending=${JSON.stringify(s.pendingChoice)}`);
  check('its 1 damage is taken as Corruption', s.fellowship.corruption === 4, String(s.fellowship.corruption));
}

{
  console.log('\n=== a standard numbered tile still lets Gollum ignore its reveal ===');
  let s = startGame(createGame({ seed: 32 }));
  s.phase = 'actionResolution';
  s.fellowship.location = 'rivendell'; s.fellowship.hidden = true;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: false, revealIcon: true, numbered: true } };
  const legal = wotrAdapter.legalActions(s, 'fp');
  check('reveal-to-reduce is still offered on a standard "1 + reveal" tile',
    legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal'));
}

{
  console.log('\n=== a Companion refused his besieged Stronghold is told why ===');
  const s = startGame(createGame({ seed: 33 }));
  s.regions['helms-deep'].siegeBox = { units: { rohan: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  s.regions['helms-deep'].units = { isengard: { regular: 5, elite: 3 } };
  s.regions['helms-deep'].leaders = 0;
  s.regions['helms-deep'].besieged = true;
  s.regions['westemnet'].characters = ['legolas'];
  const why = characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'helms-deep');
  check('the reason names the siege, not an "enemy Army"', !!why && /under siege/.test(why) && !/enemy Army in/.test(why), why ?? 'null');
  const far = characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'grey-havens');
  check('an out-of-reach click says so', !!far && /out of reach/.test(far), far ?? 'null');
  check('a reachable, open region has no refusal', characterMoveBlockReason(s, 'fp', 'legolas', 'westemnet', 'eastemnet') === null);
}

{
  console.log('\n=== a Muster die moves an Army only through the Mouth of Sauron ===');
  const base = startGame(createGame({ seed: 34 }));
  base.phase = 'actionResolution'; base.currentPlayer = 'shadow';
  base.dice.shadow = ['muster', 'muster', 'character'];
  const mv = wotrAdapter.legalActions(base, 'shadow').find((a) => a.kind === 'moveArmy' && !a.move);
  // No Mouth in play: the Muster die cannot pay.
  const r1 = wotrAdapter.tryApplyAction(base, mv ? { ...mv, die: 'muster' } : { kind: 'moveArmy', from: 'gorgoroth', to: 'nurn', die: 'muster' }, 'shadow');
  check('without the Mouth, a named Muster die is refused for an Army move', r1.ok === false, JSON.stringify(r1).slice(0, 120));
  // With the Mouth in play, once a turn.
  const s = JSON.parse(JSON.stringify(base));
  s.characters.entered.push('mouth-of-sauron');
  const legal = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'moveArmy' && !a.move);
  check('with the Mouth in play, Army moves are legal on Muster dice', legal.length > 0, String(legal.length));
  const opts = dieOptions(legal[0], s, 'shadow');
  check('the die filter offers the Muster die for that move', opts.includes('muster'), opts.join(','));
  const r2 = wotrAdapter.tryApplyAction(s, { ...legal[0], die: 'muster' }, 'shadow');
  check('the Messenger pays with a Muster die', r2.ok === true, JSON.stringify(r2).slice(0, 160));
  if (r2.ok) {
    const t = r2.state; t.currentPlayer = 'shadow'; t.pendingChoice = null; t.flags.armyMove2 = undefined;
    check('...and is used up for the turn', t.flags.mouthMusterUsedThisTurn === true);
    const again = wotrAdapter.legalActions(t, 'shadow').find((a) => a.kind === 'moveArmy');
    const o2 = again ? dieOptions(again, t, 'shadow') : [];
    check('the filter stops offering the Muster die once the Messenger is spent', !o2.includes('muster'), o2.join(','));
  }
  // Will of the West upgrades are Will-only.
  const f = startGame(createGame({ seed: 35 }));
  check('Crown Aragorn is paid by a Will die only', JSON.stringify(dieOptions({ kind: 'bringUpgrade', which: 'aragorn' }, { ...f, dice: { ...f.dice, fp: ['will', 'character'] } }, 'fp')) === '["will"]');
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
