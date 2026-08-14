#!/usr/bin/env vite-node
// probe-report-fixes.mjs — the 2026-08-02 player-report batch:
//
//   1. Corsairs of Umbar onto a Free Peoples Army STARTS A BATTLE (card text)
//      instead of merging the two Armies into one region (report: Pelargir
//      "just stays there and is not attacked") — and the attack can't be ceased;
//   2. a whole-army move never carries the ENEMY's units along (report: "Gondor
//      has stolen my Southron Army"), and sweepStrandedUnits repairs a region a
//      pre-fix save already corrupted;
//   3. "Play if" preconditions gate The Last Battle / Palantír of Orthanc /
//      Denethor's Folly (reports: both were played to no effect and discarded);
//   4. Éomer Son of Eomund recruits only in true Settlements — the Fords of Isen
//      is a Fortification, not a Settlement (p.10).
import { createGame } from '../src/engine/setup.ts';
import { startGame } from '../src/adapter/wotrAdapter.ts';
import { getHandler, canPlayCard } from '../src/engine/handlers/registry.ts';
import { moveArmy, sweepStrandedUnits, unitCount, musterBlockReason, sweepAbandonedSieges } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Fresh full setup with the Southrons pushed to At War. */
function board() {
  const state = startGame(createGame({ seed: 7 }));
  state.nations.southrons.step = 0; // At War (Corsairs' precondition)
  return state;
}

// --- 1. Corsairs of Umbar ---------------------------------------------------------
{
  console.log('\n=== Corsairs of Umbar starts a battle on an occupied region ===');
  const state = board();
  const h = getHandler('sh-str-10');
  // Setup: Umbar holds 3 Southron Regulars; Pelargir holds 1 Gondor Regular.
  const targets = h.targets(state, 'shadow');
  check('Pelargir (FP-held) is offered as a target', targets.some((t) => t.to === 'pelargir'));
  h.applyTarget(state, 'shadow', { from: 'umbar', to: 'pelargir' });
  check('a battle starts', !!state.pendingCombat, JSON.stringify(state.pendingCombat && { from: state.pendingCombat.from, to: state.pendingCombat.to }));
  check('the Shadow attacks Pelargir from Umbar', state.pendingCombat?.attacker === 'shadow' && state.pendingCombat?.to === 'pelargir' && state.pendingCombat?.from === 'umbar');
  check('the attack cannot be ceased (noCease)', state.pendingCombat?.noCease === true);
  check('no premature merge: Pelargir still holds only its garrison', !state.regions['pelargir'].units.southrons, JSON.stringify(state.regions['pelargir'].units));

  // An EMPTY coastal region is a plain move (and no battle).
  const s2 = board();
  s2.regions['anfalas'].units = {};
  getHandler('sh-str-10').applyTarget(s2, 'shadow', { from: 'umbar', to: 'anfalas' });
  check('empty destination: the Army just moves', !s2.pendingCombat && (s2.regions['anfalas'].units.southrons?.regular ?? 0) === 3);
}

// --- 2. moves never kidnap enemy units + the stranded-units sweep ------------------
{
  console.log('\n=== a whole-army move leaves enemy units behind ===');
  const state = board();
  // Corrupt a region the way the old Corsairs bug did: Gondor + Southrons in Pelargir.
  state.regions['pelargir'].units = { gondor: { regular: 2, elite: 0 }, southrons: { regular: 3, elite: 0 } };
  state.nations.gondor.step = 0; // At War so the move is legal
  const ok = moveArmy(state, 'pelargir', 'lossarnach', 'fp');
  check('the FP move succeeds', ok);
  check('Gondor units arrive', (state.regions['lossarnach'].units.gondor?.regular ?? 0) >= 2);
  check('the Southron Army stays put', (state.regions['pelargir'].units.southrons?.regular ?? 0) === 3, JSON.stringify(state.regions['pelargir'].units));

  // The sweep REPORTS a mixed region; it must never DELETE. It used to remove the
  // 'stranded' side, and that destroyed three real Dwarven units when a siege-lift
  // merged a garrison under an enemy Army (root cause fixed in liftSiegeIfAbandoned).
  // Deleting is irreversible — FP units never come back — so a suspected engine bug
  // must not be 'repaired' by throwing pieces off the board.
  console.log('\n=== sweepStrandedUnits REPORTS a mixed region without deleting ===');
  const s2 = board();
  s2.regions['pelargir'].units = { gondor: { regular: 2, elite: 0 }, southrons: { regular: 3, elite: 1 } };
  const poolR = s2.reinforcements.southrons.regular, poolE = s2.reinforcements.southrons.elite;
  const logs0 = s2.log.length;
  sweepStrandedUnits(s2);
  check('the units are LEFT ON THE BOARD', (s2.regions['pelargir'].units.southrons?.regular ?? 0) === 3, JSON.stringify(s2.regions['pelargir'].units));
  check('nothing is silently recycled', s2.reinforcements.southrons.regular === poolR && s2.reinforcements.southrons.elite === poolE);
  check('the anomaly is logged for a report', s2.log.slice(logs0).some((e) => e.msg.includes('share pelargir')), s2.log.slice(logs0).map((e) => e.msg).join(' | ') || '(no new log)');
  check('the owning Army is untouched', (s2.regions['pelargir'].units.gondor?.regular ?? 0) === 2);
  check('a clean board sweeps to no change', (() => { const s3 = board(); const j = JSON.stringify(s3.regions); sweepStrandedUnits(s3); return JSON.stringify(s3.regions) === j; })());
}

// --- 3. "Play if" preconditions gate play -----------------------------------------
{
  console.log('\n=== precondition gating: The Last Battle / Palantír / Denethor\'s Folly ===');
  const state = board();
  check('The Last Battle unplayable without Aragorn in play', !canPlayCard(state, 'fp-str-01', 'fp'));
  // Aragorn with an FP Army OUTSIDE a Free Peoples Nation (Umbar's neighbor works).
  state.characters.inPlay['aragorn'] = 'west-harondor';
  state.regions['west-harondor'].units = { gondor: { regular: 1, elite: 0 } };
  state.regions['west-harondor'].characters = ['aragorn'];
  check('…playable with Aragorn + FP Army outside an FP Nation', canPlayCard(state, 'fp-str-01', 'fp'));
  state.characters.inPlay['aragorn'] = 'minas-tirith';
  check('…unplayable when that Army is inside an FP Nation', !canPlayCard(state, 'fp-str-01', 'fp'));

  check('Palantír of Orthanc unplayable before Saruman is mustered', !canPlayCard(state, 'sh-char-21', 'shadow'));
  state.characters.entered.push('saruman');
  state.characters.inPlay['saruman'] = 'orthanc';
  check('…playable once Saruman is in play', canPlayCard(state, 'sh-char-21', 'shadow'));

  check("Denethor's Folly unplayable without a siege of Minas Tirith", !canPlayCard(state, 'sh-str-03', 'shadow'));
  state.regions['minas-tirith'].besieged = true;
  check('…playable while Minas Tirith is besieged', canPlayCard(state, 'sh-str-03', 'shadow'));
}

// --- 4. Éomer recruits only in true Settlements -----------------------------------
{
  console.log('\n=== Éomer, Son of Eomund: the Fords of Isen is not a Settlement ===');
  const state = board();
  const targets = getHandler('fp-str-23').targets(state, 'fp');
  const regions = [...new Set(targets.map((t) => t.region))];
  check('the Fords of Isen is NOT offered', !regions.includes('fords-of-isen'), regions.join(', '));
  check('real Rohan Settlements are offered', regions.includes('edoras'));
}

// --- 5. "Why can't I muster here?" ------------------------------------------------
// Report: "I can't muster in Lorien while it is empty, but it is still under control
// of the Free People's player so I should be able to." Emptiness is never the reason —
// but three real blockers are invisible on the board, so clicking your own Settlement
// now names the one that applies instead of doing nothing.
{
  console.log('\n=== a refused muster explains itself ===');
  const empty = () => {
    const s = board();
    const r = s.regions['lorien'];
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false;
    return s;
  };
  const s = empty();
  s.nations.elves.step = 0; // At War
  check('an empty, At-War, friendly Lorien is mustered in freely', musterBlockReason(s, 'lorien', 'fp') === null,
    String(musterBlockReason(s, 'lorien', 'fp')));

  const notAtWar = empty();
  notAtWar.nations.elves.step = 2;
  check('not At War is named', /not At War/.test(musterBlockReason(notAtWar, 'lorien', 'fp') ?? ''),
    String(musterBlockReason(notAtWar, 'lorien', 'fp')));

  const captured = empty();
  captured.nations.elves.step = 0;
  captured.regions['lorien'].control = 'shadow';
  check('an enemy Control marker is named', /enemy control/.test(musterBlockReason(captured, 'lorien', 'fp') ?? ''),
    String(musterBlockReason(captured, 'lorien', 'fp')));

  const drained = empty();
  drained.nations.elves.step = 0;
  drained.reinforcements.elves.regular = 0; drained.reinforcements.elves.elite = 0;
  check('an empty reinforcement pool is named', /reinforcements/.test(musterBlockReason(drained, 'lorien', 'fp') ?? ''),
    String(musterBlockReason(drained, 'lorien', 'fp')));

  const besieged = empty();
  besieged.nations.elves.step = 0;
  besieged.regions['lorien'].besieged = true;
  check('a siege is named', /siege/.test(musterBlockReason(besieged, 'lorien', 'fp') ?? ''),
    String(musterBlockReason(besieged, 'lorien', 'fp')));

  check('Osgiliath is named a Fortification', /Fortification/.test(musterBlockReason(s, 'osgiliath', 'fp') ?? ''),
    String(musterBlockReason(s, 'osgiliath', 'fp')));
  check('a Shadow Stronghold says nothing to the Free Peoples', musterBlockReason(s, 'barad-dur', 'fp') === null);
}

// --- 6. a siege with nobody besieging it is over ----------------------------------
// A besieged Stronghold whose besieger is gone looks EMPTY on the board (its garrison
// is in the siege box) and quietly refuses musters. Whatever path leaves that behind,
// one sweep per state transition puts the garrison back on the field.
{
  console.log('\n=== an abandoned siege is swept up ===');
  const state = board();
  const r = state.regions['lorien'];
  r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = [];
  r.besieged = true;
  r.siegeBox = { units: { elves: { regular: 1, elite: 2 } }, leaders: 1, nazgul: 0, characters: [] };
  sweepAbandonedSieges(state);
  check('the siege is lifted', !r.besieged && !r.siegeBox);
  check('the garrison is back on the field', unitCount(state, 'lorien') === 3, String(unitCount(state, 'lorien')));
  check('and its Leader came with it', r.leaders === 1);

  // A LIVE siege is untouched: the besieger still holds the field.
  const held = board();
  const h = held.regions['lorien'];
  h.units = { sauron: { regular: 4, elite: 0 } };
  h.besieged = true;
  h.siegeBox = { units: { elves: { regular: 1, elite: 2 } }, leaders: 1, nazgul: 0, characters: [] };
  sweepAbandonedSieges(held);
  check('a real siege carries on', h.besieged && !!h.siegeBox);

  // Mid-battle the field can be momentarily empty — never sweep then.
  const mid = board();
  const m = mid.regions['lorien'];
  m.units = {}; m.besieged = true;
  m.siegeBox = { units: { elves: { regular: 1, elite: 2 } }, leaders: 0, nazgul: 0, characters: [] };
  mid.pendingCombat = { to: 'lorien', from: 'lorien' };
  sweepAbandonedSieges(mid);
  check('a live battle is left alone', m.besieged && !!m.siegeBox);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
