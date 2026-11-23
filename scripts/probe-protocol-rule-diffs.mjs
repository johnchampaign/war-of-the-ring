#!/usr/bin/env vite-node
// probe-protocol-rule-diffs.mjs — rule differences found by following another engine's games.
//
// PR #1's protocol bot follows a referee's game on our engine, and every place the two engines
// disagreed got a switch (followOptions in data.ts). Checked against the card texts and the
// Almanac, these were bugs in OUR engine and are now fixed for every game:
//  - Only a side's own Characters lead its Army: a Companion of no Nation left in a region a
//    Shadow Army entered used to add his Leadership to the Shadow's re-roll.
//  - Mighty Attack forfeits the Leadership of one participating Companion: Aragorn's 2 when he
//    is the only one (it cost 1 whoever was there).
//  - Mighty Attack / Andúril turn the miss into a hit BEFORE the Leader re-roll.
//  - Relentless Assault / Onslaught may take every unit of the Army (Almanac).
//  - The "move any or all of the Nazgûl" cards have room for all eight figures.
//  - Mûmakil's "more total hits" counts the Free Peoples pre-Combat attack hits.
// And John's calls on rules-legal readings we did not offer (2026-11-23):
//  - a Muster die may recruit into a full region; the owner then sends the excess back (p.26);
//  - The Nazgûl Strike! may be declined outright ("you may"; Almanac).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { forceLeadership } from '../src/engine/armies.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { REGIONS } from '../src/engine/data.ts';
import { combatModsFor } from '../src/engine/combatCards.ts';
import { getHandler } from '../src/engine/handlers/registry.ts';
import '../src/engine/handlers/index.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const state = startGame(createGame({ seed: 7 }));

console.log('\n=== Leadership: own side only ===');
{
  const shadow = { units: { sauron: { regular: 3, elite: 0 } }, leaders: 0, nazgul: 1, characters: ['gandalf-grey', 'meriadoc'] };
  check('Gandalf the Grey and Merry add nothing to a Shadow Army', forceLeadership(state, shadow, 'shadow') === 1, `got ${forceLeadership(state, shadow, 'shadow')}`);
  const fp = { units: { gondor: { regular: 3, elite: 0 } }, leaders: 1, nazgul: 0, characters: ['gandalf-grey', 'aragorn'] };
  check('…and still lead their own Army (1 + 1 + 2)', forceLeadership(state, fp, 'fp') === 4, `got ${forceLeadership(state, fp, 'fp')}`);
}

console.log('\n=== Mighty Attack: the forfeited Companion\'s Leadership ===');
{
  const alone = combatModsFor('fp-char-06', { ownCharacters: ['aragorn'] });
  check('Aragorn alone forfeits 2', alone?.ownLeadershipPenalty === 2, `got ${alone?.ownLeadershipPenalty}`);
  const both = combatModsFor('fp-char-06', { ownCharacters: ['aragorn', 'legolas'] });
  check('with Legolas there, the cheaper 1', both?.ownLeadershipPenalty === 1, `got ${both?.ownLeadershipPenalty}`);
  check('still one miss turned to a hit', both?.guaranteedHits === 1);
}

console.log('\n=== Nazgûl cards: room for every figure ===');
{
  const h = getHandler('sh-char-08b');
  check('The Nazgûl Strike! allows 16 steps (8 figures x pick + destination)', (h?.repeat ?? 0) >= 16, `repeat ${h?.repeat}`);
}

console.log('\n=== Muster into a full region (p.26: the limit is checked after the action) ===');
{
  const s = startGame(createGame({ seed: 9 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['muster']; s.dice.fp = [];
  s.nations.sauron.step = 0; s.nations.sauron.active = true;      // At War
  s.regions['barad-dur'].units = { sauron: { regular: 10, elite: 0 } };
  const regBefore = s.reinforcements.sauron.regular;
  const elite = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'recruitUnit' && a.region === 'barad-dur' && a.elite === 1);
  check('an Elite into the full Barad-dûr is offered', !!elite);
  const r1 = elite ? wotrAdapter.tryApplyAction(s, elite, 'shadow') : { ok: false, reason: 'not offered' };
  check('the muster is accepted', r1.ok, r1.ok ? '' : r1.reason);
  const s1 = r1.ok ? r1.state : s;
  check('the owner is asked which unit goes back', s1.pendingChoice?.kind === 'removeExcess' && s1.pendingChoice.owner === 'shadow', s1.pendingChoice?.kind ?? 'none');
  const back = wotrAdapter.legalActions(s1, 'shadow').find((a) => a.kind === 'removeExcess' && a.figure === 'regular');
  const r2 = back ? wotrAdapter.tryApplyAction(s1, back, 'shadow') : { ok: false, reason: 'no Regular to send back' };
  const s2 = r2.ok ? r2.state : s1;
  const u = s2.regions['barad-dur'].units.sauron;
  check('9 Regulars and 1 Elite remain (an upgrade)', u.regular === 9 && u.elite === 1, JSON.stringify(u));
  check('the Regular went back to reinforcements', s2.reinforcements.sauron.regular === regBefore + 1, `${regBefore} -> ${s2.reinforcements.sauron.regular}`);
}

console.log('\n=== The Nazgûl Strike!: "neither" is always an answer ===');
{
  const s = startGame(createGame({ seed: 10 }));
  s.pendingChoice = { owner: 'shadow', kind: 'nazgulStrike', data: { cards: [] } };
  const opts = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'nazgulStrike');
  check('the Hunt and "neither" are offered with no table card', opts.length === 2 && opts.some((a) => a.decline), JSON.stringify(opts));
}

console.log('\n=== ⚙ "Combat card question: every round" (state.prefs via setPreference) ===');
{
  const fresh = () => {
    const s = startGame(createGame({ seed: 11 }));
    for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
    s.cards.fp.hand = []; s.cards.shadow.hand = [];
    return s;
  };
  const [to, def] = Object.entries(REGIONS).find(([, d]) => !d.settlement && d.nation === 'rohan');
  const from = def.adjacency[0];
  const fight = (s) => {
    s.nations.rohan.step = 0; s.nations.sauron.step = 0;
    s.regions[to].units = { rohan: { regular: 2, elite: 0 } };
    s.regions[from].units = { sauron: { regular: 4, elite: 0 } };
    startBattle(s, 'shadow', from, to);
    if (!s.pendingChoice && s.pendingCombat) combatStep(s);
    return s.pendingChoice;
  };
  const plain = fight(fresh());
  check('no card in hand: the defender is not asked by default', !(plain?.kind === 'combatCard' && plain.owner === 'fp'), plain ? `${plain.kind}/${plain.owner}` : 'none');
  const s = fresh();
  s.phase = 'actionResolution'; s.currentPlayer = 'fp'; s.pendingChoice = null;
  s.dice.fp = ['character']; s.dice.shadow = ['army'];      // mid-phase, so nothing advances
  const r = wotrAdapter.tryApplyAction(s, { kind: 'setPreference', alwaysAskCombatCard: true }, 'fp');
  check('setPreference is accepted from the player to act', r.ok, r.ok ? '' : r.reason);
  check('...and is never offered as a move (no AI picks it)', !wotrAdapter.legalActions(s, 'fp').some((a) => a.kind === 'setPreference'));
  const t = r.ok ? r.state : s;
  check('it leaves the same player to act', wotrAdapter.currentActor(t) === 'fp');
  check('...and changes nothing else (same phase, same hands)', t.phase === 'actionResolution' && t.cards.fp.hand.length === 0 && t.cards.shadow.hand.length === 0, `${t.phase}`);
  const asked = fight(t);
  check('with it on, the defender is asked even holding nothing', asked?.kind === 'combatCard' && asked.owner === 'fp', asked ? `${asked.kind}/${asked.owner}` : 'none');
  check('...and "no card" is the answer on offer', JSON.stringify(wotrAdapter.legalActions(t, 'fp')) === JSON.stringify([{ kind: 'playCombatCard', cardId: null }]));
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall ok');
