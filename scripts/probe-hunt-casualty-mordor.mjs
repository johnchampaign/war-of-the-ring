#!/usr/bin/env vite-node
// probe-hunt-casualty-mordor.mjs — the 2026-08-12 player-report batch on the Hunt:
//
//   1. MORDOR EYE DAMAGE (p.43): "If the tile drawn shows an Eye, the Hunt damage is
//      equal to the number of dice in the Hunt Box (including Free Peoples dice
//      PREVIOUSLY used for moving the Fellowship during the same turn)." The die paying
//      for the CURRENT move goes in after the Hunt resolves (p.41), so it must not
//      count towards its own draw. Reports: "5 dice in the box dealt 6 damage" and
//      "an Eye for 3 damage although there were only 2 dice in the box."
//   2. ONE CASUALTY PER HUNT (p.42): "If the Free Peoples player takes a casualty, he
//      must eliminate one Companion… If the Hunt damage is higher than the Level of the
//      eliminated Companion, any excess damage must still be taken as Corruption."
//      Report: one tile ate Legolas, Gimli AND Meriadoc.
//   3. THE LAST BATTLE with Aragorn BESIEGED — he is still "with a Free Peoples Army",
//      and the roster index must not have gone stale behind an Army move. Report:
//      "Aragorn occupies Minas Morgul and it won't let me play The Last Battle."
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { resolveMordorStep } from '../src/engine/hunt.ts';
import { canPlayCard } from '../src/engine/handlers/registry.ts';
import { moveArmySplit, reindexBoardCharacters, characterWithArmy } from '../src/engine/armies.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';
import { advance } from '../src/engine/phases.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const EYE = STANDARD_TILE_LIST.findIndex((t) => t.value === 'eye');

/** A game with the Fellowship on the Mordor Track and an Eye as the only drawable tile. */
function inMordor({ box, fpDice }) {
  const s = startGame(createGame({ seed: 11 }));
  s.fellowship.mordor = 0;
  s.fellowship.hidden = true;
  s.hunt.box = box;
  s.hunt.fpDiceInBox = fpDice;
  s.hunt.pool = [EYE];            // the only tile left, so the draw is deterministic
  s.hunt.specialsInPool = [];
  s.hunt.drawn = [];
  s.hunt.specialsDrawn = [];
  return s;
}

// --- 1. Mordor Eye damage counts the box, not the die paying for this move ---------
{
  console.log('\n=== a Mordor Eye deals the dice ALREADY in the Hunt Box ===');
  // The T7 report: 4 allocated + 1 Eye die = 5 Shadow dice, first Fellowship move.
  const s = inMordor({ box: 5, fpDice: 0 });
  resolveMordorStep(s);
  check('5 Shadow dice, first move → 5 damage (not 6)', s.hunt.lastRoll.level === 5, `level=${s.hunt.lastRoll.level}`);
  check('the die paying for this move is now in the box', s.hunt.fpDiceInBox === 1, `fpDiceInBox=${s.hunt.fpDiceInBox}`);

  // The T8 report: 1 allocated + 1 Eye die = 2 Shadow dice, first Fellowship move.
  const t = inMordor({ box: 2, fpDice: 0 });
  resolveMordorStep(t);
  check('2 Shadow dice, first move → 2 damage (not 3)', t.hunt.lastRoll.level === 2, `level=${t.hunt.lastRoll.level}`);

  // …but a die from an EARLIER move this turn DOES count (the older report that first
  // put the FP dice into this sum: 2 Shadow + 1 FP die must deal 3).
  const u = inMordor({ box: 2, fpDice: 1 });
  resolveMordorStep(u);
  check('2 Shadow + 1 earlier FP die → 3 damage', u.hunt.lastRoll.level === 3, `level=${u.hunt.lastRoll.level}`);

  // No 5-cap in Mordor — that cap is on ROLLED Hunt dice (p.41) and no roll happens here.
  const v = inMordor({ box: 5, fpDice: 2 });
  resolveMordorStep(v);
  check('no 5-cap on the Mordor Track', v.hunt.lastRoll.level === 7, `level=${v.hunt.lastRoll.level}`);
}

// --- 2. One Companion casualty per Hunt -------------------------------------------
{
  console.log('\n=== only ONE Companion may be eliminated per Hunt (p.42) ===');
  let s = inMordor({ box: 6, fpDice: 0 }); // 6 damage: more than any single Companion
  const before = s.fellowship.companions.length;
  resolveMordorStep(s);
  check('the FP is asked how to absorb it', s.pendingChoice?.kind === 'huntDamage', s.pendingChoice?.kind ?? 'none');
  check('a casualty is on offer', wotrAdapter.legalActions(s, 'fp').some((a) => a.mode === 'guide'));

  s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('one Companion is gone', s.fellowship.companions.length === before - 1,
    `${before} → ${s.fellowship.companions.length}`);

  if (s.pendingChoice?.kind === 'huntDamage') {
    const acts = wotrAdapter.legalActions(s, 'fp');
    check('no SECOND casualty is offered', !acts.some((a) => a.mode === 'guide' || a.mode === 'random'),
      acts.map((a) => a.mode).join(','));
    check('taking the rest as Corruption is still offered', acts.some((a) => a.mode === 'corruption'));
    let threw = false;
    try { s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp'); } catch { threw = true; }
    check('and a second casualty is refused outright', threw);
  } else {
    // No reduction ability left, so the remainder went straight to Corruption — which is
    // exactly what p.42 requires. Only one Companion may have died.
    check('the Hunt is over after one casualty', s.pendingChoice === null);
    check('the rest became Corruption', s.fellowship.corruption > 0, `corruption=${s.fellowship.corruption}`);
    check('exactly one Companion died', s.fellowship.companions.length === before - 1);
  }
}

// --- 3. The Last Battle: besieged Aragorn, and a roster index kept honest ----------
{
  console.log('\n=== The Last Battle plays with Aragorn besieged outside a FP Nation ===');
  const s = startGame(createGame({ seed: 3 }));
  // Aragorn holds Minas Morgul (a Sauron Stronghold the FP took) with a Gondor Army,
  // besieged by the Shadow — the reporter's exact board.
  s.characters.inPlay['aragorn'] = 'minas-tirith'; // deliberately STALE
  const mm = s.regions['minas-morgul'];
  mm.units = { sauron: { regular: 4, elite: 0 } };
  mm.nazgul = 1;
  mm.characters = [];
  mm.besieged = true;
  mm.control = 'fp';
  mm.siegeBox = { units: { gondor: { regular: 1, elite: 0 } }, leaders: 1, nazgul: 0, characters: ['aragorn'] };

  check('the stale index does point at the wrong region', s.characters.inPlay['aragorn'] === 'minas-tirith');
  reindexBoardCharacters(s);
  check('the reindex finds him in the siege box', s.characters.inPlay['aragorn'] === 'minas-morgul',
    s.characters.inPlay['aragorn']);
  check('and he counts as being with a FP Army there',
    characterWithArmy(s, 'aragorn', 'fp') === 'minas-morgul');
  check('The Last Battle is playable', canPlayCard(s, 'fp-str-01'));

  // It must NOT be playable inside a Free Peoples Nation ("outside of a Free Peoples
  // Nation") — the reporter's South Ithilien / Osgiliath attempts were correctly refused.
  const t = startGame(createGame({ seed: 3 }));
  t.regions['osgiliath'].units = { gondor: { regular: 2, elite: 0 } };
  t.regions['osgiliath'].characters = ['aragorn'];
  t.characters.inPlay['aragorn'] = 'osgiliath';
  check('but not in Osgiliath — Gondor is a Free Peoples Nation', !canPlayCard(t, 'fp-str-01'));
}

{
  console.log('\n=== an Army move keeps the roster index honest ===');
  const s = startGame(createGame({ seed: 4 }));
  s.nations.gondor.step = 0; // At War, so the border rule doesn't block the move
  s.regions['minas-tirith'].characters = ['aragorn'];
  s.characters.inPlay['aragorn'] = 'minas-tirith';
  const ok = moveArmySplit(s, 'minas-tirith', 'osgiliath', 'fp',
    { units: { gondor: { regular: 2, elite: 0 } }, characters: ['aragorn'] });
  check('the split move is legal', ok);
  check('Aragorn is in Osgiliath on the board', s.regions['osgiliath'].characters.includes('aragorn'));
  advance(s); // advance() runs the reindex before anything reads the roster
  check('and the index agrees', s.characters.inPlay['aragorn'] === 'osgiliath', s.characters.inPlay['aragorn']);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
