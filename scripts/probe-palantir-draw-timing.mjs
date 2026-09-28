#!/usr/bin/env vite-node
// probe-palantir-draw-timing.mjs — The Palantír of Orthanc's draw comes at the END of
// the Action (Almanac, The Palantír of Orthanc: "The new Event card may not be drawn
// before the played Event card has been fully resolved … all rounds in such a battle
// must be completed"; and if Saruman is eliminated during the Action, "there will be
// no Event card draw at the end of this Action"). Player report 0l2a1m3v0l1p0t3r.
//
//   1. Corsairs of Umbar attacks Pelargir: no draw while the battle is on; the draw is
//      offered once it is over.
//   2. Saruman eliminated during that Action: the Palantír leaves the table, no draw.
//   3. Control: Corsairs landing on an empty coast (no battle) draws right away.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const base = () => {
  const s = startGame(createGame({ seed: 141 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event', 'army']; s.dice.fp = ['muster'];
  s.nations.southrons.active = true; s.nations.southrons.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  s.regions['umbar'].units = { southrons: { regular: 6, elite: 2 } };
  s.characters.entered.push('saruman');
  s.characters.inPlay['saruman'] = 'orthanc';
  s.cards.shadow.table.push('sh-char-21');
  s.cards.shadow.hand = ['sh-str-10'];
  return s;
};
const play = (s, to) => {
  const t = wotrAdapter.applyAction(s, { kind: 'playEvent', cardId: 'sh-str-10', die: 'event' }, 'shadow');
  const target = wotrAdapter.legalActions(t, 'shadow').find((a) => a.kind === 'eventTarget' && a.to === to);
  return target ? wotrAdapter.applyAction(t, target, 'shadow') : null;
};
/** Answer the battle's questions until it is over; report whether a Palantír draw was
 *  offered while it was still being fought. */
const fight = (s) => {
  let early = false;
  for (let i = 0; i < 200 && s.pendingCombat; i++) {
    if (s.pendingChoice?.kind === 'bonusDraw') early = true;
    const who = wotrAdapter.currentActor(s); if (!who) break;
    const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, legal[0], who);
  }
  return { s, early };
};

console.log('\n=== Corsairs attack Pelargir: the Palantír draw waits for the battle ===');
{
  const s = base();
  s.regions['pelargir'].units = { gondor: { regular: 1, elite: 0 } };
  let t = play(s, 'pelargir');
  check('the attack started a battle', !!t?.pendingCombat);
  check('no draw is offered as the battle begins', t?.pendingChoice?.kind !== 'bonusDraw', t?.pendingChoice?.kind);
  const r = fight(t);
  check('no draw is offered during the battle', !r.early);
  check('the battle is over', !r.s.pendingCombat);
  check('the draw is offered once the battle is over', r.s.pendingChoice?.kind === 'bonusDraw', r.s.pendingChoice?.kind ?? 'none');
  const hand = r.s.cards.shadow.hand.length;
  t = wotrAdapter.applyAction(r.s, { kind: 'bonusDraw', deck: 'strategy' }, 'shadow');
  check('taking it draws one card', t.cards.shadow.hand.length === hand + 1);
  check('and it is offered only once', t.pendingChoice?.kind !== 'bonusDraw', t.pendingChoice?.kind);
}

console.log('\n=== Saruman eliminated during the Action: no draw ===');
{
  const s = base();
  s.regions['pelargir'].units = { gondor: { regular: 1, elite: 0 } };
  const t = play(s, 'pelargir');
  delete t.characters.inPlay['saruman'];
  t.characters.eliminated.push('saruman');
  const r = fight(t);
  check('the Palantír left the table', !r.s.cards.shadow.table.includes('sh-char-21'));
  check('no draw is offered', r.s.pendingChoice?.kind !== 'bonusDraw', r.s.pendingChoice?.kind ?? 'none');
  check('nothing is left owed', !r.s.flags.actionEndDraw);
}

console.log('\n=== Control: a landing without a battle draws at once ===');
{
  const s = base();
  s.regions['pelargir'].units = {};
  const t = play(s, 'pelargir');
  check('no battle', !t?.pendingCombat);
  check('the draw is offered', t?.pendingChoice?.kind === 'bonusDraw', t?.pendingChoice?.kind ?? 'none');
}

console.log(failures ? `\nprobe-palantir-draw-timing: ${failures} FAILURE(S)` : '\nprobe-palantir-draw-timing OK');
process.exit(failures ? 1 : 0);
