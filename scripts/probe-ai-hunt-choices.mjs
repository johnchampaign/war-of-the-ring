#!/usr/bin/env vite-node
// probe-ai-hunt-choices.mjs — the 2026-08-19 player-report pair on how the Free
// Peoples AI plays the Hunt:
//
//   1. WHERE THE FIGURE LANDS ON A REVEAL. "F&S (in Dimrill Dale) moved and were
//      found. They chose to move to N Anduin Vale. IMO they gained no benefit from
//      moving there (no closer to Mordor, and threatened with rerolls from the troops
//      and Nazgul in Dol Guldur). A better move would've been to Parth Celebrant
//      (closer to Mordor, Rohan and Gondor, and they could always double back to
//      Lorien for a quick rest)." North Anduin Vale, Parth Celebrant and South Anduin
//      Vale are ALL 5 regions from Morannon, so the old distance-only pick took
//      whichever the action list happened to list first — and two of the three sit
//      against Dol Guldur.
//   2. SPENDING COMPANIONS ON THE MORDOR TRACK. "Why enter Mordor with all those
//      companions (allowing me to fill the hunt box) if you're not going to use them?
//      I would've used Strider to cancel the damage." A Companion in the Fellowship
//      can never be separated once it is on the Track (p.43), so its only remaining
//      use is absorbing Hunt damage — and the old policy hoarded them until
//      Corruption 8+.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const decide = (state) => chooseAction(state, 'fp', wotrAdapter.legalActions(state, 'fp'), new Rng(7));

// --- 1. the reveal move prefers a quiet neighbourhood among equal-distance targets ---
console.log('\n=== a revealed Fellowship lands away from the Hunt re-roll sources ===');
{
  // The reported board: revealed at Dimrill Dale with Progress 1, so the candidates are
  // its neighbours. Dol Guldur holds Sauron's army and a Nazgûl (both of which follow
  // the Fellowship into an adjacent region for free); Lorien is an FP Stronghold, so it
  // is not a legal reveal target but it IS the rest-heal that Parth Celebrant borders.
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.fellowship.location = 'dimrill-dale';
  state.fellowship.progress = 1;
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  state.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  state.regions['dol-guldur'].units = { sauron: { regular: 5, elite: 1 } };
  state.regions['dol-guldur'].nazgul = 1;

  const targets = wotrAdapter.legalActions(state, 'fp').map((a) => a.target);
  check('all three Anduin/Celebrant options are on the table',
    ['north-anduin-vale', 'parth-celebrant', 'south-anduin-vale'].every((r) => targets.includes(r)),
    JSON.stringify(targets));

  const pick = decide(state);
  check('the AI moves to Parth Celebrant, not against Dol Guldur',
    pick.kind === 'revealMove' && pick.target === 'parth-celebrant', JSON.stringify(pick));

  // Ground truth for the tie-break: it must not be buying safety with distance.
  const after = wotrAdapter.applyAction(state, pick, 'fp');
  check('the figure actually moved and Progress reset', after.fellowship.location === 'parth-celebrant' && after.fellowship.progress === 0,
    `${after.fellowship.location} progress ${after.fellowship.progress}`);
  check('the Fellowship is revealed', after.fellowship.hidden === false);
}
{
  // Distance still leads: with a strictly closer target available, the quiet
  // neighbourhood must NOT outrank it.
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.fellowship.location = 'dimrill-dale';
  state.fellowship.progress = 1;
  state.fellowship.hidden = true;
  state.fellowship.mordor = null;
  state.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  state.regions['parth-celebrant'].units = { sauron: { regular: 2, elite: 0 } }; // now the clean one is dirty
  const pick = decide(state);
  const closest = ['north-anduin-vale', 'parth-celebrant', 'south-anduin-vale'];
  check('an occupied target is dropped for an equally close clean one',
    pick.kind === 'revealMove' && closest.includes(pick.target) && pick.target !== 'parth-celebrant', JSON.stringify(pick));
}

// --- 2. Hunt damage on the Mordor Track is paid with Companions --------------------
console.log('\n=== on the Mordor Track the AI spends Companions, not Corruption ===');
const mordorHit = (damage, corruption, companions, guide) => {
  const state = startGame(createGame({ seed: 11 }));
  state.phase = 'actionResolution';
  state.fellowship.mordor = 0;
  state.fellowship.hidden = true;
  state.fellowship.corruption = corruption;
  state.fellowship.companions = [...companions];
  state.fellowship.guide = guide;
  state.cards.fp.table = []; // no on-table −1 reducers in play
  state.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal: false } };
  return state;
};
{
  // The reported hit: Corruption 4, a 3-damage tile, Strider (Level 3) guiding.
  const state = mordorHit(3, 4, ['strider', 'legolas', 'gimli', 'meriadoc', 'peregrin'], 'strider');
  const pick = decide(state);
  check('a 3 is answered with the Level-3 Guide, not 3 Corruption',
    pick.kind === 'huntDamage' && pick.mode === 'guide', JSON.stringify(pick));

  const after = wotrAdapter.applyAction(state, pick, 'fp');
  check('Strider is gone', !after.fellowship.companions.includes('strider'));
  // Read the Hunt's own log line: resolving the choice also ends the action, and this
  // stripped-down state then rolls the turn over (which bills the Mordor Track's own
  // +1 for a turn with no Fellowship move) — that Corruption is not the tile's.
  const line = after.log.map((e) => e.msg).find((m) => m.startsWith('Hunt resolved')) ?? '';
  check('the tile cost no Corruption — the Level-3 casualty covered all 3', line.includes('no Corruption taken'), line);
}
{
  // A small hit spends a body too — but not necessarily the Guide, who is the only one
  // who can cover a big tile later.
  const state = mordorHit(1, 0, ['strider', 'meriadoc', 'peregrin'], 'strider');
  const pick = decide(state);
  check('even a 1 at Corruption 0 is paid with a Companion',
    pick.kind === 'huntDamage' && (pick.mode === 'random' || pick.mode === 'guide'), JSON.stringify(pick));
}
{
  // The 2026-08-20 report: "T5: F&S (w/7 corruption) moved, drew Shelob and rolled a 6.
  // Then (I guess) sacrificed a random companion (merry for -1) and lost. Should've
  // sacrificed the guide (strider for -3) and would've survived." A random draw absorbs
  // as little as 1; the Guide is always the highest-Level Companion left.
  const state = mordorHit(6, 7, ['strider', 'meriadoc', 'peregrin'], 'strider');
  const pick = decide(state);
  check('a lethal 6 at Corruption 7 spends the Guide, not a random Hobbit',
    pick.kind === 'huntDamage' && pick.mode === 'guide', JSON.stringify(pick));
  // Resolve the rest of the hit (the excess over the casualty re-prompts, p.42).
  let after = wotrAdapter.applyAction(state, pick, 'fp');
  while (after.pendingChoice?.kind === 'huntDamage') {
    after = wotrAdapter.applyAction(after, decide(after), 'fp');
  }
  const line = after.log.map((e) => e.msg).find((m) => m.startsWith('Hunt resolved')) ?? '';
  check('the Ring-bearers survive it — Strider absorbed 3 of the 6, so 10 not 13', line.includes('Corruption now 10'), line);
}
{
  // The reverse: a hit SMALLER than the Guide's Level wastes his absorption, so a
  // cheap body goes instead — unless a random draw could still be lethal.
  const state = mordorHit(1, 3, ['strider', 'meriadoc', 'peregrin'], 'strider');
  const pick = decide(state);
  check('a 1 with a Level-3 Guide spends a random body, not Strider',
    pick.kind === 'huntDamage' && pick.mode === 'random', JSON.stringify(pick));
}
{
  // With nobody left the damage has to be Corruption — and the AI must not stall.
  const state = mordorHit(2, 5, [], 'gollum');
  const pick = decide(state);
  check('an empty Fellowship takes the Corruption', pick.kind === 'huntDamage' && pick.mode === 'corruption', JSON.stringify(pick));
}
{
  // OFF the Track the bodies are spent too. Hoarding Companions only banks Corruption
  // that has to be paid back by declaring in a City to heal, and that detour is what
  // stalls the Ring run (measured: Free Peoples 54.8% -> 66.3% over 400 games per arm).
  // A 3 at Corruption 4 takes the Level-3 Guide and costs no Corruption at all.
  const state = mordorHit(3, 4, ['strider', 'legolas', 'gimli'], 'strider');
  state.fellowship.mordor = null;
  state.fellowship.location = 'lorien';
  const pick = decide(state);
  check('outside Mordor a mid-hit now spends the Guide, not Corruption',
    pick.kind === 'huntDamage' && pick.mode === 'guide', JSON.stringify(pick));
}
{
  // The one exception: at 0-2 Corruption a single point is cheaper than a Companion,
  // who can still rouse a Nation by separating. A 1 at Corruption 0 off the Track is
  // taken on the Corruption dial.
  const state = mordorHit(1, 0, ['strider', 'legolas', 'gimli'], 'strider');
  state.fellowship.mordor = null;
  state.fellowship.location = 'lorien';
  const pick = decide(state);
  check('outside Mordor a cheap early hit is still taken as Corruption',
    pick.kind === 'huntDamage' && pick.mode === 'corruption', JSON.stringify(pick));
}

console.log(failures === 0 ? '\nprobe OK' : `\nPROBE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
