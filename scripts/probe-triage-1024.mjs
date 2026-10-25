#!/usr/bin/env vite-node
// probe-triage-1024.mjs — player reports triaged 2026-10-24 (afternoon run):
//
//  1. ij541aaphyxthzkn: two battles that finish within one update each get their
//     outcome popup. The state kept only the newest battle, so the first one's summary
//     never showed. recentBattles keeps the last few, oldest first, capped.
//  2. 4v0d5l074c1e2465: a Companion leaving on the Mordor Track "separates from the
//     Fellowship and vanishes into the wastes of Mordor" — not casualty wording, since
//     it is not a casualty (Worn with Sorrow and Toil does not fire).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { removeCompanionOnMordorTrack } from '../src/engine/fellowship.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** Fight one Shadow attack out to the end, everyone taking their first legal option. */
function fight(s, from, to) {
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['army']; s.dice.fp = [];
  const atk = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'attack' && a.from === from && a.to === to);
  if (!atk) return null;
  s = wotrAdapter.applyAction(s, { ...atk, die: 'army' }, 'shadow');
  for (let i = 0; i < 200 && (s.pendingCombat || s.pendingChoice); i++) {
    const who = wotrAdapter.currentActor(s); if (!who) break;
    const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, legal[0], who);
  }
  return s;
}

console.log('\n=== 1. every finished battle is kept for its popup (ij541aaphyxthzkn) ===');
{
  let s = startGame(createGame({ seed: 151 }));
  s.nations.sauron.active = true; s.nations.sauron.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  const pairs = [['dagorlad', 'north-ithilien'], ['minas-morgul', 'south-ithilien'], ['dagorlad', 'north-ithilien'], ['minas-morgul', 'south-ithilien'], ['dagorlad', 'north-ithilien']];
  let fought = 0;
  for (const [from, to] of pairs) {
    s.regions[from].units = { sauron: { regular: 5, elite: 1 } }; s.regions[from].nazgul = 0; s.regions[from].leaders = 0;
    s.regions[to].units = { gondor: { regular: 1, elite: 0 } }; s.regions[to].leaders = 0; s.regions[to].characters = [];
    const t = fight(s, from, to);
    if (!t) break;
    s = t; fought++;
    if (fought === 2) {
      const rb = s.recentBattles ?? [];
      check('two battles: both are kept, oldest first', rb.length === 2 && rb[0].seq < rb[1].seq, rb.map((b) => `${b.seq}:${b.to}`).join(' '));
      check('the newest is lastBattle', rb[1]?.seq === s.lastBattle?.seq);
      check('the first battle is the one at North Ithilien', rb[0]?.to === 'north-ithilien');
    }
  }
  check('all five attacks were fought', fought === 5, `${fought}`);
  const rb = s.recentBattles ?? [];
  check('the list is capped at the last four', rb.length === 4 && rb[3].seq === s.lastBattle?.seq && rb[0].seq === s.lastBattle.seq - 3, rb.map((b) => b.seq).join(' '));
  const v = wotrAdapter.viewFor(s, 'fp');
  check('both players see the kept battles', (v.recentBattles ?? []).length === 4);
}

console.log('\n=== 2. leaving on the Mordor Track is not casualty wording (4v0d5l074c1e2465) ===');
{
  const s = startGame(createGame({ seed: 5 }));
  s.fellowship.mordor = 1;
  const id = s.fellowship.companions.find((c) => c === 'peregrin') ?? s.fellowship.companions[0];
  check('the Companion is removed', removeCompanionOnMordorTrack(s, id));
  const msg = s.log[s.log.length - 1]?.msg ?? '';
  check('"separates from the Fellowship and vanishes into the wastes of Mordor"', msg.includes('separates from the Fellowship and vanishes into the wastes of Mordor'), msg);
  check('no "falls" or "casualty" in the line', !/falls|casualt/i.test(msg));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
