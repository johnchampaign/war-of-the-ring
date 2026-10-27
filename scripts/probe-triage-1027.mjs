#!/usr/bin/env vite-node
// probe-triage-1027.mjs — player report 072s2y37376u6l0s: "The Free Peoples player may
// nominate a new Guide … when, during the course of a turn, the composition of the
// Fellowship changes (due to a Character being separated or eliminated)" (p.38). The
// engine named the highest-Level Companion itself and never asked; now a Level tie
// after a Companion leaves raises a `guideChoice` prompt, and no tie asks nothing.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { eliminateCompanion, beginSeparation } from '../src/engine/fellowship.ts';
import { advance } from '../src/engine/phases.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const board = () => startGame(createGame({ seed: 7 }));

console.log('\n=== no Level tie: nothing to ask ===');
{
  const s = board();
  check('starts with Gandalf the Grey as Guide', s.fellowship.guide === 'gandalf-grey', s.fellowship.guide);
  eliminateCompanion(s, 'strider');
  advance(s);
  check('Strider gone, Gandalf alone at Level 3: no prompt', s.pendingChoice?.kind !== 'guideChoice', s.pendingChoice?.kind);
  check('Gandalf stays Guide', s.fellowship.guide === 'gandalf-grey');
  eliminateCompanion(s, 'gandalf-grey');
  advance(s);
  check('Gandalf gone too, three Level-2 Companions: the FP is asked', s.pendingChoice?.kind === 'guideChoice', s.pendingChoice?.kind);
  check('the prompt is the Free Peoples\'', s.pendingChoice?.owner === 'fp');
  const opts = wotrAdapter.legalActions(s, 'fp');
  const names = opts.map((a) => a.companion);
  check('offers exactly the Level-2 Companions', names.length === 3 && ['legolas', 'gimli', 'boromir'].every((c) => names.includes(c)), names.join(','));
  check('the stand-in Guide is offered first (keep)', names[0] === s.fellowship.guide, `${names[0]} vs ${s.fellowship.guide}`);
  const pick = names.find((c) => c !== s.fellowship.guide);
  const t = wotrAdapter.applyAction(s, { kind: 'guideChoice', companion: pick }, 'fp');
  check(`picking ${pick} makes him the Guide`, t.fellowship.guide === pick, t.fellowship.guide);
  check('and the prompt is gone', t.pendingChoice?.kind !== 'guideChoice', t.pendingChoice?.kind);
  check('a Level-1 Companion is refused', !wotrAdapter.tryApplyAction(s, { kind: 'guideChoice', companion: 'meriadoc' }, 'fp').ok);
  check('the Shadow cannot answer it', !wotrAdapter.tryApplyAction(s, { kind: 'guideChoice', companion: pick }, 'shadow').ok);
  const ai = chooseAction(s, 'fp', opts, { next: () => 0.5, nextInt: () => 0 });
  check('the AI keeps the Guide who stepped in', ai.kind === 'guideChoice' && ai.companion === s.fellowship.guide, JSON.stringify(ai));
}

console.log('\n=== a separation that leaves the Guide but a tie still asks ===');
{
  const s = board();
  // Gandalf and Strider tie at Level 3: separating Strider leaves Gandalf alone — no ask.
  beginSeparation(s, 'strider');
  s.pendingChoice = null; advance(s);
  check('Strider separated: Gandalf alone at Level 3, no prompt', s.pendingChoice?.kind !== 'guideChoice', s.pendingChoice?.kind);
  // Strider as Guide, then Boromir leaves: Gandalf and Strider still tie — the FP may switch.
  const u = board();
  u.fellowship.guide = 'strider';
  beginSeparation(u, 'boromir');
  u.pendingChoice = null; advance(u);
  check('Boromir separated with Gandalf and Strider tied: the FP is asked', u.pendingChoice?.kind === 'guideChoice', u.pendingChoice?.kind);
  const names = wotrAdapter.legalActions(u, 'fp').map((a) => a.companion);
  check('Strider (keep) and Gandalf offered', names.join(',') === 'strider,gandalf-grey', names.join(','));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
if (failures) process.exit(1);
