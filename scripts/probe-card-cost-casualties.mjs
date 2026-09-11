#!/usr/bin/env vite-node
// probe-card-cost-casualties.mjs — the hits a Combat card costs you, and the hits
// Onslaught's counter-attack scores, are casualties like any others: the owner of the
// dying units chooses Regulars-first or Elites-first (player report 384n4g074t2k4d01,
// "I cannot choose how to apply casualties for Relentless Assault and Onslaught").
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
// A mixed Shadow stack (Regulars AND Elites) makes the absorption a real choice.
const s0 = startGame(createGame({ seed: 81 }));
s0.phase = 'actionResolution'; s0.currentPlayer = 'shadow'; s0.dice.shadow = ['army']; s0.dice.fp = []; s0.pendingChoice = null;
s0.regions['dagorlad'].units = { sauron: { regular: 4, elite: 3 } }; s0.regions['dagorlad'].nazgul = 1;
s0.regions['osgiliath'].units = { gondor: { regular: 3, elite: 2 } }; s0.regions['osgiliath'].leaders = 1;
s0.cards.shadow.hand = ['sh-str-04', ...s0.cards.shadow.hand];  // The Day Without Dawn — combat half: Relentless Assault
for (const n of ['sauron', 'gondor']) { s0.nations[n].active = true; s0.nations[n].step = 0; } // At War, so the attack is legal

console.log('\n=== paying Relentless Assault asks HOW the self-hits land ===');
let s = wotrAdapter.applyAction(s0, { kind: 'attack', from: 'dagorlad', to: 'osgiliath', die: 'army' }, 'shadow');
let guard = 30, sawCost = false, sawChoice = false, elitesHit = false;
while (s.pendingChoice && guard-- > 0) {
  const owner = s.pendingChoice.owner;
  const legal = wotrAdapter.legalActions(s, owner);
  const kind = s.pendingChoice.kind;
  if (kind === 'combatCard') {
    const play = legal.find((a) => a.kind === 'playCombatCard' && a.cardId === 'sh-str-04');
    s = wotrAdapter.applyAction(s, play ?? legal[0], owner); continue;
  }
  if (kind === 'combatCardCost') {
    sawCost = true;
    const max = legal.filter((a) => a.kind === 'combatCardCost').reduce((b, a) => Math.max(b, a.amount), 0);
    check('the cost offers a range to choose from (up to 2)', max === 2, `max ${max}`);
    s = wotrAdapter.applyAction(s, { kind: 'combatCardCost', amount: max }, owner);
    // The very next prompt must be the PAYER choosing how to absorb those hits.
    if (s.pendingChoice?.kind === 'combatCasualties' && s.pendingChoice.owner === 'shadow' && s.pendingCombat?.step === 'cardCost') {
      sawChoice = true;
      const steps = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'casualtyStep');
      check('the payer is asked how to absorb the card cost', steps.length > 1, steps.map((a) => a.step).join(','));
      const elite = steps.find((a) => a.step === 'reduceElite' || a.step === 'removeElite');
      const before = s.regions['dagorlad'].units.sauron.elite;
      if (elite) {
        s = wotrAdapter.applyAction(s, elite, 'shadow');
        const after = s.regions['dagorlad'].units.sauron?.elite ?? 0;
        elitesHit = after < before;
        check('choosing an Elite actually spends the Elite', elitesHit, `elites ${before} -> ${after}`);
      }
    }
    continue;
  }
  s = wotrAdapter.applyAction(s, legal[0], owner);
}
check('the card cost was charged at all', sawCost);
check('...and it was a choice, not an auto-application', sawChoice);
check('the battle ran to a conclusion', !s.pendingCombat && s.pendingChoice === null, `pending ${s.pendingChoice?.kind ?? 'none'}, combat ${!!s.pendingCombat}`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
