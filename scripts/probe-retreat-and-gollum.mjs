#!/usr/bin/env vite-node
// probe-retreat-and-gollum.mjs — four RAW fixes from one batch of player reports:
//
//  1. A RETREAT needs a "free region" (p.10): no enemy Army AND no enemy-controlled
//     Settlement. We used the looser "free for the purposes of Army movement" test, so
//     an empty enemy-held Settlement was offered (report 5u4q1y0m5o1y6l4m: Westemnet).
//  2. Gollum's ignore-the-reveal-icon is asked when the reveal is APPLIED, not when the
//     tile is drawn: "Any Guide abilities may be used immediately when a new Guide is
//     chosen, including mid-Hunt resolution" (Almanac). Report l61v0rpyl8vhrpcl.
//  3. Gollum's reveal-to-reduce is a FULL reveal — the figure moves and Progress resets
//     (p.39). It used to flip `hidden` in place. Report 484g5d6e162t361o.
//  4. The Fellowship figure may stand in Gorgoroth / Barad-dûr / Nurn; the Mordor Track
//     is not part of Gorgoroth (p.44). Report 6v2x723i4d2d6t12.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { retreatDestinations } from '../src/engine/combat.ts';
import { freeRegion, freeForMovement } from '../src/engine/armies.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- 1. retreats and free regions -------------------------------------------------
{
  console.log('\n=== a retreat needs a free region, not just one free for Army movement ===');
  const s = startGame(createGame({ seed: 11 }));
  // Westemnet is a Rohan Town; hand it to the Shadow and empty it.
  s.regions['westemnet'].units = {};
  s.regions['westemnet'].control = 'shadow';
  check('Westemnet is free for the purposes of Army MOVEMENT (empty)', freeForMovement(s, 'westemnet', 'fp'));
  check('...but it is not a FREE REGION for the Free Peoples (enemy-controlled Settlement)',
    !freeRegion(s, 'westemnet', 'fp'));
  check('an unowned, empty region is a free region for both sides',
    freeRegion(s, 'gap-of-rohan', 'fp') && freeRegion(s, 'gap-of-rohan', 'shadow'));
  // A besieger's own region is free for the besieger even though the enemy holds the
  // Stronghold (p.10).
  s.regions['helms-deep'].units = { isengard: { regular: 3, elite: 0 } };
  s.regions['helms-deep'].besieged = true;
  s.regions['helms-deep'].siegeBox = { units: { rohan: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  check('an enemy Stronghold besieged by MY Army is free for me', freeRegion(s, 'helms-deep', 'shadow'));
  check('...and still not free for the garrison\'s side', !freeRegion(s, 'helms-deep', 'fp'));

  // And the real retreat list: an FP Army in Fords of Isen, attacked from Orthanc.
  const r = startGame(createGame({ seed: 12 }));
  r.regions['westemnet'].units = {};
  r.regions['westemnet'].control = 'shadow';
  r.regions['fords-of-isen'].units = { rohan: { regular: 2, elite: 0 } };
  r.regions['fords-of-isen'].leaders = 1;
  r.pendingCombat = { attacker: 'shadow', defender: 'fp', from: 'orthanc', to: 'fords-of-isen', round: 1 };
  const dests = retreatDestinations(r);
  check('Westemnet is NOT an offered retreat destination', !dests.includes('westemnet'), dests.join(','));
  check('...while ordinary free neighbours still are', dests.length > 0, dests.join(','));
}

// --- 2. a new Guide's ability applies to the tile already on the table -------------
{
  console.log('\n=== a mid-Hunt casualty makes Gollum the Guide — and his ignore applies ===');
  let s = startGame(createGame({ seed: 21 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.fellowship.location = 'rivendell'; s.fellowship.progress = 2; s.fellowship.hidden = true;
  s.fellowship.companions = ['gimli']; s.fellowship.guide = 'gimli'; // Level 2
  // A NUMBERED tile with a reveal icon: damage 2, reveal.
  s.hunt.draws = [{ seq: 1, value: 2, damage: 2, reveal: true, onMordor: false }];
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 2, reveal: true, revealIcon: true, numbered: true } };
  s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('Gimli absorbed the damage and Gollum is the Guide', s.fellowship.guide === 'gollum' && s.fellowship.companions.length === 0);
  check('the Fellowship is still HIDDEN — the new Guide ignores the numbered tile\'s reveal icon',
    s.fellowship.hidden === true && s.pendingChoice === null, `hidden=${s.fellowship.hidden}, pending=${JSON.stringify(s.pendingChoice)}`);
  check('Progress is untouched (no reveal happened)', s.fellowship.progress === 2, String(s.fellowship.progress));
  check('the draw record agrees that nothing was revealed', s.hunt.draws.at(-1).reveal === false);

  // An EYE tile always reveals, even for Gollum.
  let e = startGame(createGame({ seed: 22 }));
  e.phase = 'actionResolution';
  e.fellowship.location = 'rivendell'; e.fellowship.progress = 1; e.fellowship.hidden = true;
  e.fellowship.companions = ['gimli']; e.fellowship.guide = 'gimli';
  e.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 2, reveal: true, revealIcon: true, numbered: false } };
  e = wotrAdapter.applyAction(e, { kind: 'huntDamage', mode: 'guide' }, 'fp');
  check('an Eye tile\'s reveal still fires with Gollum as the new Guide',
    e.pendingChoice?.kind === 'revealMove' || e.fellowship.hidden === false, JSON.stringify(e.pendingChoice));
}

// --- 3. Gollum's reveal-to-reduce is a real reveal ---------------------------------
{
  console.log('\n=== Gollum reveals to reduce: the figure moves and Progress resets ===');
  let s = startGame(createGame({ seed: 23 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow';
  s.fellowship.location = 'rivendell'; s.fellowship.progress = 2; s.fellowship.hidden = true;
  s.fellowship.companions = []; s.fellowship.guide = 'gollum';
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: false, revealIcon: false, numbered: true } };
  const legal = wotrAdapter.legalActions(s, 'fp');
  check('reduceReveal is offered', legal.some((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal'));
  s = wotrAdapter.applyAction(s, { kind: 'huntDamage', mode: 'reduceReveal' }, 'fp');
  check('the damage is gone (1 − 1 = 0), no Corruption taken', s.fellowship.corruption === 0, String(s.fellowship.corruption));
  check('a revealMove placement is pending for the Free Peoples',
    s.pendingChoice?.kind === 'revealMove' && s.pendingChoice.owner === 'fp', JSON.stringify(s.pendingChoice));
  const moves = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'revealMove');
  check('the player is offered somewhere to move the Ring-bearers', moves.length > 1, `${moves.length} targets`);
  const away = moves.find((a) => a.target !== 'rivendell') ?? moves[0];
  s = wotrAdapter.applyAction(s, away, 'fp');
  check(`the figure moved where the player put it (${away.target})`, s.fellowship.location === away.target);
  check('the Fellowship is revealed and Progress is reset to 0',
    s.fellowship.hidden === false && s.fellowship.progress === 0, `hidden=${s.fellowship.hidden}, progress=${s.fellowship.progress}`);
}

// --- 4. Mordor's interior regions are ordinary regions for the figure --------------
{
  console.log('\n=== the Fellowship may be declared into Gorgoroth / Barad-dûr / Nurn ===');
  let s = startGame(createGame({ seed: 24 }));
  s.phase = 'fellowship'; s.currentPlayer = 'fp';
  s.fellowship.location = 'morannon'; s.fellowship.progress = 2; s.fellowship.hidden = true;
  s.fellowship.mordor = null;
  const targets = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'declareFellowship').map((a) => a.target);
  for (const r of ['gorgoroth', 'barad-dur', 'nurn']) {
    check(`${r} is an offered declaration target`, targets.includes(r), targets.length + ' targets');
  }
  s = wotrAdapter.applyAction(s, { kind: 'declareFellowship', target: 'gorgoroth' }, 'fp');
  check('the figure stands in Gorgoroth with Progress reset', s.fellowship.location === 'gorgoroth' && s.fellowship.progress === 0,
    `${s.fellowship.location} / ${s.fellowship.progress}`);
  // ...and it can walk back out to an entrance, so it is never stranded.
  s.flags.fellowshipDeclaredThisTurn = false;
  s.fellowship.progress = 1;
  const out = wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'declareFellowship').map((a) => a.target);
  check('an entrance is reachable again from inside Mordor (never stranded)',
    out.includes('morannon') || out.includes('minas-morgul'), out.join(','));
}

// --- 5. The Grey Company: the eliminated Regular is a CASUALTY ---------------------
{
  console.log('\n=== The Grey Company: the Regular goes into casualties, not reinforcements ===');
  const { getHandler } = await import('../src/engine/handlers/registry.ts');
  const s = startGame(createGame({ seed: 25 }));
  s.regions['edoras'].units = { rohan: { regular: 2, elite: 0 } };
  s.regions['edoras'].characters = ['strider'];
  s.reinforcements.rohan.elite = 2;
  const before = { reg: s.reinforcements.rohan.regular, el: s.reinforcements.rohan.elite };
  const t = getHandler('fp-char-24').targets(s, 'fp').find((x) => x.nation === 'rohan');
  check('a Rohan upgrade is offered', !!t, JSON.stringify(t));
  getHandler('fp-char-24').applyTarget(s, 'fp', t);
  check('a Regular became an Elite on the board',
    s.regions['edoras'].units.rohan.regular === 1 && s.regions['edoras'].units.rohan.elite === 1,
    JSON.stringify(s.regions['edoras'].units.rohan));
  check('the Elite came out of reinforcements', s.reinforcements.rohan.elite === before.el - 1);
  check('the Regular did NOT come back to reinforcements (it is a casualty)',
    s.reinforcements.rohan.regular === before.reg, `${before.reg} -> ${s.reinforcements.rohan.regular}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
