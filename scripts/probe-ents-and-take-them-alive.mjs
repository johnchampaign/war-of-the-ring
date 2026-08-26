#!/usr/bin/env vite-node
// probe-ents-and-take-them-alive.mjs — the 2026-08-25 player-report pair.
//
//   1. THE ENTS AWAKE vs a BESIEGED Orthanc (report 4u10):
//        "T10: I spent [C] to move GtW to fangorn. Then a spent [E] to play 'Ents
//         Awake'. It told me there was no shadow army in Orthanc (0r, 1e, Saruman
//         didn't count)? Wasted 2 dice and 1 card."
//      The reporter's snapshot shows Orthanc besieged BY THE FREE PEOPLES: 3 Rohan
//      Elites in the open field, and 1 Isengard Elite plus Saruman in the Stronghold
//      Box. A besieged Army is still IN its region (p.31) — only its units sit in the
//      box — so the card's "a Shadow Army in Orthanc" is squarely that garrison. The
//      handler read the open field only, saw the FP besiegers, and fizzled.
//
//   2. "TAKE THEM ALIVE!" on a Hunt casualty (report 506t):
//        "T8: I moved F&S. Hunt successful; drew a (3) tile. I sacrificed a random and
//         got Pippin (-1). According to his 'Take them alive' ability, he should have
//         been placed on the board as tho separated - so separated and moved up to 5
//         spaces. Instead he was eliminated."
//      Meriadoc/Peregrin: "If he is eliminated while in the Fellowship, immediately
//      place him in play again as if he was just separated from the Fellowship. This
//      special ability cannot be used if the Fellowship is on the Mordor Track."
//      fellowship.ts honoured it; the Hunt's own copy of the casualty code did not.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import { forceUnitCount, settlementController } from '../src/engine/armies.ts';
import { resolveHunt } from '../src/engine/hunt.ts';
import { STANDARD_TILE_LIST } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** The reported board: Orthanc besieged by Rohan, Saruman boxed with one Elite. */
function orthancUnderFpSiege({ seed = 7, garrison = 1 } = {}) {
  const s = startGame(createGame({ seed }));
  const r = s.regions['orthanc'];
  r.units = { rohan: { regular: 0, elite: 3 } };
  r.leaders = 2; r.nazgul = 0; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: { isengard: { regular: 0, elite: garrison } }, leaders: 0, nazgul: 0, characters: ['saruman'] };
  s.characters.inPlay['saruman'] = 'orthanc';
  if (!s.characters.entered.includes('saruman')) s.characters.entered.push('saruman');
  // The card's printed precondition: Gandalf the White in play, a Companion in Fangorn.
  if (!s.characters.entered.includes('gandalf-white')) s.characters.entered.push('gandalf-white');
  s.regions['fangorn'].characters = ['gandalf-white'];
  s.characters.inPlay['gandalf-white'] = 'fangorn';
  return s;
}

// --- 1. the Ents see the garrison in the box -----------------------------------------
{
  console.log('\n=== The Ents Awake strikes the BESIEGED Orthanc garrison ===');
  const s = orthancUnderFpSiege();
  const before = forceUnitCount(s.regions['orthanc'].siegeBox);
  const field = forceUnitCount(s.regions['orthanc']);
  getHandler('fp-char-20').apply(s);
  const fizzled = s.log.some((e) => e.msg.includes('Orthanc holds no Shadow Army'));
  check('the card no longer reports an empty Orthanc', !fizzled);
  check('it rolls against the garrison', s.log.some((e) => /The Ents Awake: \d+ hit\(s\)/.test(e.msg)),
    s.log.slice(-4).map((e) => e.msg).join(' | '));
  // Any hit lands in the BOX; the Rohan besiegers are never touched.
  check('the besieging Rohan Army is untouched', forceUnitCount(s.regions['orthanc']) === field,
    `${field} → ${forceUnitCount(s.regions['orthanc'])}`);
  const box = s.regions['orthanc'].siegeBox;
  const after = box ? forceUnitCount(box) : 0;
  check('the garrison took the hits (or was wiped)', after <= before, `${before} → ${after}`);
  if (after === 0) {
    check('a wiped garrison ends the siege', !s.regions['orthanc'].besieged);
    check('Saruman goes down with his Army', s.characters.eliminated.includes('saruman'));
    check('the besieging Free Peoples take the Stronghold', settlementController(s, 'orthanc') === 'fp');
  }
}

// --- 1b. Saruman alone in the box is still "in Orthanc" -------------------------------
{
  console.log('\n=== Saruman alone inside a besieged Orthanc is still eliminated ===');
  const s = orthancUnderFpSiege({ garrison: 0 });
  s.regions['orthanc'].siegeBox.units = {};
  getHandler('fp-char-19').apply(s);
  check('Saruman is eliminated', s.characters.eliminated.includes('saruman'),
    s.log.slice(-3).map((e) => e.msg).join(' | '));
}

// --- 1c. the open-field case still works ---------------------------------------------
{
  console.log('\n=== an unbesieged Orthanc Army is hit exactly as before ===');
  const s = startGame(createGame({ seed: 7 }));
  if (!s.characters.entered.includes('gandalf-white')) s.characters.entered.push('gandalf-white');
  s.regions['fangorn'].characters = ['gandalf-white'];
  s.characters.inPlay['gandalf-white'] = 'fangorn';
  const before = forceUnitCount(s.regions['orthanc']);
  getHandler('fp-char-21').apply(s);
  check('Orthanc holds a Shadow Army', before > 0, `${before} units`);
  check('the card rolls against it', s.log.some((e) => /The Ents Awake: \d+ hit\(s\)/.test(e.msg)));
}

// --- 2. Take Them Alive on a Hunt casualty --------------------------------------------
/** A hidden Fellowship at Progress `progress`, one drawable numbered tile of `value`. */
function huntBoard({ seed = 3, progress = 4, value = 3 } = {}) {
  const s = startGame(createGame({ seed }));
  s.fellowship.hidden = true;
  s.fellowship.progress = progress;
  s.fellowship.mordor = null;
  s.hunt.box = 2; s.hunt.fpDiceInBox = 0;
  s.hunt.pool = [STANDARD_TILE_LIST.findIndex((t) => t.value === value && !t.reveal)];
  s.hunt.specialsInPool = []; s.hunt.drawn = []; s.hunt.specialsDrawn = [];
  return s;
}

{
  console.log('\n=== a Hobbit taken as a Hunt casualty is placed, not eliminated ===');
  const s = huntBoard();
  s.hunt.box = 12;              // guarantee a hit
  resolveHunt(s);
  check('the FP is asked how to absorb the damage', s.pendingChoice?.kind === 'huntDamage', s.pendingChoice?.kind ?? 'none');
  s.fellowship.guide = 'peregrin';
  const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('Peregrin left the Fellowship', !t.fellowship.companions.includes('peregrin'));
  check('Peregrin is NOT eliminated', !t.characters.eliminated.includes('peregrin'),
    t.log.slice(-4).map((e) => e.msg).join(' | '));
  check('the log says he was taken alive', t.log.some((e) => e.msg.includes('taken alive')),
    t.log.slice(-4).map((e) => e.msg).join(' | '));
  check('the FP is asked where he lands', t.pendingChoice?.kind === 'separateMove', t.pendingChoice?.kind ?? 'none');
  const data = t.pendingChoice?.data ?? {};
  check('only Peregrin travels', JSON.stringify(data.companions) === '["peregrin"]', JSON.stringify(data.companions));
  check('range is Progress + Level = 4 + 1', data.range === 5, `range=${data.range}`);
  const acts = wotrAdapter.legalActions(t, 'fp');
  check('destinations are offered', acts.some((a) => a.kind === 'separateMove' && a.target), `${acts.length} actions`);
  check('no other Companion may hitch a ride', !acts.some((a) => a.kind === 'separateMove' && a.companion),
    JSON.stringify(acts.filter((a) => a.companion)));
  const dest = acts.find((a) => a.kind === 'separateMove' && a.target && a.target !== data.from) ?? acts.find((a) => a.target);
  const u = wotrAdapter.applyAction(t, dest, 'fp');
  check('Peregrin is on the board', !!u.characters.inPlay['peregrin'], String(u.characters.inPlay['peregrin']));
  check('he stands where the FP put him', u.regions[dest.target].characters.includes('peregrin'));
  check('and he is still not eliminated', !u.characters.eliminated.includes('peregrin'));
  check('the placement choice is cleared', u.pendingChoice?.kind !== 'separateMove', u.pendingChoice?.kind ?? 'none');
}

{
  console.log('\n=== ...but never on the Mordor Track (the card says so) ===');
  const s = huntBoard();
  s.fellowship.mordor = 2;
  s.fellowship.progress = 0;
  s.hunt.box = 12;
  s.fellowship.guide = 'meriadoc';
  resolveHunt(s);
  if (s.pendingChoice?.kind !== 'huntDamage') {
    check('the FP is asked how to absorb the damage', false, s.pendingChoice?.kind ?? 'none');
  } else {
    const t = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
    check('Meriadoc IS eliminated in Mordor', t.characters.eliminated.includes('meriadoc'),
      t.log.slice(-4).map((e) => e.msg).join(' | '));
    check('no placement prompt is raised', t.pendingChoice?.kind !== 'separateMove', t.pendingChoice?.kind ?? 'none');
    check('and he is not on the board', !t.characters.inPlay['meriadoc']);
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
