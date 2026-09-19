#!/usr/bin/env vite-node
// probe-sorcerer-timing.mjs — the Witch-king's "Sorcerer" draw comes at the END of
// the first Combat round, not when the card is played (report 295c2a6x452j1573).
//
// Almanac (the Witch-king): the played card must be "used", and "Combat cards are
// always discarded as soon as the Combat round is over" (p.29), so the draw is "only
// after all Combat round steps are complete" — casualties, the cease/retreat decision
// and any retreat — and "before advance after combat", so the Shadow may read the card
// before deciding whether to advance.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle } from '../src/engine/combat.ts';
import { advance } from '../src/engine/phases.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const CARD = 'sh-char-05'; // a Shadow Character card (combat half: Cruel as Death)

/** Shadow (with the Witch-king) attacks Osgiliath from Minas Morgul. `defenders` sets
 *  how many Gondor Regulars hold it; the Shadow plays CARD in round one. Drives the
 *  battle through the adapter and returns the sequence of choices raised. */
function run({ defenders, cont, seed = 7 }) {
  let s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.phase = 'actionResolution';
  s.nations.gondor.step = 0; s.nations.sauron.step = 0;
  s.regions['minas-morgul'].units = { sauron: { regular: 5, elite: 0 } };
  s.regions['minas-morgul'].characters = ['witch-king'];
  s.characters.entered.push('witch-king'); s.characters.inPlay['witch-king'] = 'minas-morgul';
  s.regions['osgiliath'].units = { gondor: { regular: defenders, elite: 0 } };
  s.cards.shadow.hand = [CARD]; s.cards.fp.hand = [];
  s.dice.shadow = ['army']; s.dice.fp = ['army']; // the turn goes on after the battle (no draw phase)
  const deck = s.cards.shadow.draw.character.length;
  startBattle(s, 'shadow', 'minas-morgul', 'osgiliath');
  advance(s);
  const seq = [];
  for (let i = 0; i < 80; i++) {
    const ch = s.pendingChoice;
    if (!ch) { seq.push(`none(${s.pendingCombat?.step})`); break; }
    const actor = ch.owner;
    const legal = wotrAdapter.legalActions(s, actor);
    if (!legal.length) break;
    seq.push(ch.kind);
    let a;
    if (ch.kind === 'combatCard') a = legal.find((x) => x.cardId === (actor === 'shadow' && s.pendingCombat?.round === 0 ? CARD : null)) ?? legal[0];
    else if (ch.kind === 'combatContinue') a = legal.find((x) => x.cont === cont) ?? legal[0];
    else if (ch.kind === 'combatRetreat') a = legal.find((x) => x.retreat === false) ?? legal[0];
    else if (ch.kind === 'sorcererDraw') a = legal.find((x) => x.draw === true);
    else if (ch.kind === 'advanceChoice') { seq.push(`(round ${s.pendingCombat?.round ?? 'over'})`); break; }
    else a = legal[0];
    const res = wotrAdapter.tryApplyAction(s, a, actor);
    if (!res.ok) { seq.push(`ERR ${res.error}`); break; }
    s = res.state;
    if (ch.kind === 'combatCard' && s.pendingCombat?.round >= 1) { seq.push('round2'); break; }
  }
  return { seq, drew: deck - s.cards.shadow.draw.character.length, s };
}

{
  console.log('\n=== the attack goes on: the draw sits between round one and round two ===');
  const { seq, drew } = run({ defenders: 5, cont: true });
  const iSorc = seq.indexOf('sorcererDraw'), iCont = seq.indexOf('combatContinue');
  check('the draw is offered', iSorc >= 0, seq.join(' > '));
  check('…not while the round is still being fought (after cease/continue)', iSorc > iCont && iCont >= 0, seq.join(' > '));
  check('…and before round two\'s cards', seq.slice(iSorc).includes('combatCard'), seq.join(' > '));
  check('the card was drawn from the Character deck', drew === 1, `${drew}`);
}

{
  console.log('\n=== the battle ends in round one: the draw still comes, before the advance ===');
  const { seq, drew } = run({ defenders: 1, cont: true, seed: 3 });
  const iSorc = seq.indexOf('sorcererDraw'), iAdv = seq.indexOf('advanceChoice');
  check('the draw is offered', iSorc >= 0, seq.join(' > '));
  check('…before the advance after combat', iAdv < 0 || iSorc < iAdv, seq.join(' > '));
  check('…and the advance choice is still asked after it', iAdv > iSorc, seq.join(' > '));
  check('one card drawn', drew === 1, `${drew}`);
}

{
  console.log('\n=== ceasing the attack after round one still earns the draw ===');
  const { seq, drew } = run({ defenders: 5, cont: false });
  check('offered after the attacker ceases', seq.indexOf('sorcererDraw') > seq.indexOf('combatContinue'), seq.join(' > '));
  check('one card drawn', drew === 1, `${drew}`);
}

console.log(failures ? `\nprobe-sorcerer-timing: ${failures} FAILURE(S)` : '\nprobe-sorcerer-timing OK');
process.exit(failures ? 1 : 0);
