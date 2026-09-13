#!/usr/bin/env vite-node
// probe-corsairs-landing.mjs — Corsairs of Umbar MOVES the Army and then fights
// (player report 5l014y5s1w3p1c1k, John's call 2026-09-13). Two consequences the
// old "attack out of Umbar" model could not produce:
//
//   * the whole force is committed before the dice, so on victory it stays put —
//     there is no "advance or hold back?" to answer, because it is already there;
//   * landing where a Shadow Army is already BESIEGING a Stronghold merges with it,
//     and the combined force assaults the garrison.
//
// The second needs no illegal board state: a besieged Stronghold already keeps the
// two sides apart (garrison in the siege box, besieger in the open field), so the
// merge is an ordinary move and the fight is an ordinary assault.
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
  s.dice.shadow = ['event']; s.dice.fp = [];
  s.nations.southrons.active = true; s.nations.southrons.step = 0;
  s.nations.gondor.active = true; s.nations.gondor.step = 0;
  s.regions['umbar'].units = { southrons: { regular: 6, elite: 2 } };
  s.cards.shadow.hand = ['sh-str-10'];
  return s;
};
const play = (s, to) => {
  const p = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-10');
  if (!p) return null;
  let t = wotrAdapter.applyAction(s, { ...p, die: 'event' }, 'shadow');
  const target = wotrAdapter.legalActions(t, 'shadow').find((a) => a.kind === 'eventTarget' && a.to === to);
  return target ? wotrAdapter.applyAction(t, target, 'shadow') : null;
};
/** Drive a battle to its end, answering whatever either side is asked. */
const settle = (s) => {
  for (let i = 0; i < 200 && (s.pendingCombat || s.pendingChoice); i++) {
    const who = wotrAdapter.currentActor(s); if (!who) break;
    const legal = wotrAdapter.legalActions(s, who); if (!legal.length) break;
    s = wotrAdapter.applyAction(s, legal[0], who);
  }
  return s;
};

console.log('\n=== landing on a defended coast: everything is committed, nothing is asked afterwards ===');
{
  const s = base();
  s.regions['pelargir'].units = { gondor: { regular: 1, elite: 0 } };
  let t = play(s, 'pelargir');
  check('the card offers Pelargir', !!t, t ? 'yes' : 'no target');
  if (t) {
    check('a battle started', !!t.pendingCombat, t.pendingCombat ? 'yes' : 'none');
    t = settle(t);
    const asked = t.pendingChoice?.kind;
    check('no advance-or-hold question is ever raised', asked !== 'advanceChoice', asked ?? 'none');
    const there = t.regions['pelargir'].units.southrons;
    check('the Corsairs stand in Pelargir when they win', !!there && (there.regular + there.elite) > 0, JSON.stringify(t.regions['pelargir'].units));
    check('...and Umbar is empty behind them', !t.regions['umbar'].units.southrons || (t.regions['umbar'].units.southrons.regular + t.regions['umbar'].units.southrons.elite) === 0, JSON.stringify(t.regions['umbar'].units));
  }
}

console.log('\n=== landing beside a besieging Army: the Corsairs join it and assault ===');
{
  const s = base();
  // Dol Amroth under siege: the garrison is boxed, a Shadow Army holds the field.
  const da = s.regions['dol-amroth'];
  da.units = { southrons: { regular: 2, elite: 0 } };
  da.besieged = true;
  da.siegeBox = { units: { gondor: { regular: 1, elite: 0 } }, leaders: 0, nazgul: 0, characters: [] };
  let t = play(s, 'dol-amroth');
  check('the card offers the besieged Stronghold', !!t, t ? 'yes' : 'no target');
  if (t) {
    const field = t.regions['dol-amroth'].units.southrons;
    check('the Corsairs merged with the besiegers', !!field && (field.regular + field.elite) > 2, JSON.stringify(field));
    check('an assault on the garrison began', !!t.pendingCombat, t.pendingCombat ? `${t.pendingCombat.from} → ${t.pendingCombat.to}` : 'none');
    check('...fought inside the one region', t.pendingCombat?.from === t.pendingCombat?.to);
  }
}

console.log('\n=== an empty coast is still just a move ===');
{
  const s = base();
  s.regions['anfalas'].units = {};
  const t = play(s, 'anfalas');
  check('the Army lands with no battle', !!t && !t.pendingCombat && (t.regions['anfalas'].units.southrons?.regular ?? 0) > 0);
}
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
