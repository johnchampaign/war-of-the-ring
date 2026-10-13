#!/usr/bin/env vite-node
// probe-ai-fp-reports-1013.mjs — Free Peoples AI reports of 2026-10-12/13.
//  - 50184k4453066d3n: revealed in North Ithilien, the figure goes to Minas Morgul (an
//    entrance), not Dagorlad — distances run to the NEARER Mordor entrance.
//  - 4v503t4g6f496w49: Progress 1 in Dagorlad already reaches the Morannon, so the
//    Fellowship does not move again.
//  - 5w0j532f3c4x4p6w / 0p5c0p1n2b6y0f4r: a Hobbit Guide separates to take 1 off the hit
//    rather than falling as the casualty.
//  - 6i5t4m4t5g3w5o4y / 4m2o4b5x323q1i14 / 0b6o1772366f0i44: on a 1-damage hit, with a
//    Will of the West die in hand and a Minion in play, Gandalf the Grey takes it.
//  - (follow-up) and no Companion separates there either.
//  - 5y710h445c4l222i: Gollum reveals the Fellowship to soak 1 once Corruption climbs.
//  - 591g3k3a234p0321: Advantageous Position is not played when the Shadow already hits
//    only on 6s.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fpTurn = () => {
  const s = startGame(createGame({ seed: 41 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  return s;
};
const decide = (s) => chooseAction(s, 'fp', wotrAdapter.legalActions(s, 'fp'), new Rng(3));

console.log('\n=== Mordor approach ===');
{
  const s = fpTurn();
  s.fellowship.location = 'north-ithilien'; s.fellowship.progress = 1; s.fellowship.hidden = true;
  s.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s);
  check('revealed from North Ithilien: into Minas Morgul', legal.some((x) => x.target === 'minas-morgul') && a.target === 'minas-morgul', `${legal.map((x) => x.target).join(',')} -> ${a.target}`);
}
{
  const s = fpTurn();
  s.fellowship.location = 'dagorlad'; s.fellowship.progress = 1; s.fellowship.hidden = true;
  s.dice.fp = ['character']; s.dice.shadow = ['army'];
  const legal = wotrAdapter.legalActions(s, 'fp');
  const a = decide(s);
  check('Progress 1 in Dagorlad: no further move', legal.some((x) => x.kind === 'moveFellowship') && a.kind !== 'moveFellowship', JSON.stringify(a).slice(0, 100));
  // …nor does it strip the Fellowship on the doorstep: the Companions are the bodies
  // that absorb the Mordor Track's Hunt.
  check('…and no Companion separates on the doorstep', a.kind !== 'separateCompanion', JSON.stringify(a).slice(0, 100));
}

console.log('\n=== Hunt damage ===');
const hunt = (guide, damage, corruption, dice = []) => {
  const s = fpTurn();
  s.fellowship.guide = guide; s.fellowship.corruption = corruption; s.dice.fp = dice;
  if (guide === 'meriadoc') s.fellowship.companions = s.fellowship.companions.filter((c) => !['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli'].includes(c));
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal: false, numbered: true } };
  return decide(s);
};
{
  const a = hunt('meriadoc', 1, 4);
  check('Merry the Guide, 1 damage at Corruption 4: he separates (−1), no casualty', a.mode === 'reduceSeparate', JSON.stringify(a));
}
{
  const s0 = fpTurn();
  if (!s0.characters.entered.includes('saruman')) s0.characters.entered.push('saruman');
  const s = s0;
  s.fellowship.corruption = 2; s.dice.fp = ['will', 'character'];
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 1, reveal: false, numbered: true } };
  const a = decide(s);
  check('Gandalf the Grey Guide, 1 damage, Will die + Saruman in play: Gandalf takes it', a.mode === 'guide', JSON.stringify(a));
  s.dice.fp = ['character'];
  const b = decide(s);
  check('…without the Will die: he does not', b.mode !== 'guide', JSON.stringify(b));
}

{
  // Report 5y710h445c4l222i: Gollum as Guide reveals the Fellowship to take 1 off a hit.
  const s = fpTurn();
  s.fellowship.guide = 'gollum'; s.fellowship.companions = []; s.fellowship.hidden = true; s.fellowship.corruption = 5;
  s.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage: 2, reveal: false, numbered: true } };
  const a = decide(s);
  check('Gollum guiding, 2 damage at Corruption 5: he reveals the Fellowship (−1)', a.mode === 'reduceReveal', JSON.stringify(a));
}

console.log('\n=== Advantageous Position ===');
{
  const ADV = Object.keys(EVENT_BY_ID).filter((id) => EVENT_BY_ID[id]?.combat?.title === 'Advantageous Position' && id.startsWith('fp-'))[0];
  const s = startGame(createGame({ seed: 41 }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  for (const n of Object.keys(s.nations)) { s.nations[n].step = 0; s.nations[n].active = true; }
  // A Shadow attack on Pelargir (a Gondor City): the attacker hits on 6 in round one.
  s.regions['west-harondor'].units = { southrons: { regular: 5, elite: 1 } };
  s.regions['pelargir'].units = { gondor: { regular: 2, elite: 1 } }; s.regions['pelargir'].leaders = 1;
  s.cards.fp.hand = [ADV]; s.cards.shadow.hand = [];
  startBattle(s, 'shadow', 'west-harondor', 'pelargir');
  let played = 'no prompt';
  for (let i = 0; i < 20 && s.pendingCombat; i++) {
    const ch = s.pendingChoice;
    if (ch?.kind === 'combatCard' && ch.owner === 'fp') {
      const a = chooseAction(s, 'fp', wotrAdapter.legalActions(s, 'fp'), new Rng(1));
      played = a.cardId ?? 'none'; break;
    }
    if (ch) break;
    combatStep(s);
  }
  check('defending Pelargir in round one, it keeps Advantageous Position', !!ADV && played === 'none', `${ADV}: ${played}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
