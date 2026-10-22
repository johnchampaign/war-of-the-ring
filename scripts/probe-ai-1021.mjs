#!/usr/bin/env vite-node
// probe-ai-1021.mjs — AI report of 2026-10-21.
//  - uf3c8hviij917ygq: a losing defender in its own unbesieged Stronghold stands at the
//    end of a round rather than retreating out of it — the next round opens with the
//    offer to withdraw into the Stronghold (p.31), which keeps it and its VP.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('\n=== Dol Guldur attacked: the Shadow never retreats out of it ===');
let battles = 0, retreatsOut = 0, declinedRetreat = 0;
for (let seed = 1; seed <= 40; seed++) {
  let s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.nations.elves.step = 0;
  s.regions['narrows-of-the-forest'].units = { elves: { regular: 4, elite: 4 } };
  s.regions['narrows-of-the-forest'].leaders = 2;
  // Seven defenders: withdrawing at once would lose two to the siege cap, so the AI
  // fights the first round in the open, then is asked to retreat if it falls behind.
  s.regions['dol-guldur'].units = { sauron: { regular: 7, elite: 0 } };
  s.regions['dol-guldur'].nazgul = 0;
  s.dice.fp = ['army']; s.dice.shadow = [];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const atk = legal.find((a) => a.kind === 'attack' && a.from === 'narrows-of-the-forest' && a.to === 'dol-guldur');
  if (!atk) { check(`seed ${seed}: the attack is offered (setup)`, false); break; }
  s = wotrAdapter.applyAction(s, atk, 'fp');
  battles++;
  for (let i = 0; i < 80 && (s.pendingCombat || s.pendingChoice); i++) {
    const who = s.pendingChoice?.owner ?? wotrAdapter.currentActor(s);
    if (!who) break;
    const opts = wotrAdapter.legalActions(s, who);
    if (!opts.length) break;
    const a = chooseAction(s, who, opts, new Rng(seed * 7 + i));
    if (a.kind === 'combatRetreat' && who === 'shadow') { if (a.retreat) retreatsOut++; else declinedRetreat++; }
    s = wotrAdapter.applyAction(s, a, who);
    if (!s.pendingCombat && s.currentPlayer !== 'fp' && !s.pendingChoice) break;
    if (!s.pendingCombat && !s.pendingChoice) break;
  }
}
check(`the Shadow was asked to retreat at least once (${declinedRetreat + retreatsOut} times over ${battles} battles)`, declinedRetreat + retreatsOut > 0);
check('it never retreated out of Dol Guldur', retreatsOut === 0, `${retreatsOut} retreats`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
