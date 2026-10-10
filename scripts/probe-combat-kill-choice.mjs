#!/usr/bin/env vite-node
// probe-combat-kill-choice.mjs — player report 5p331i3s2a5j100w: "Blade of Westernesse,
// Fateful Strike, Heroic Death, and Black Breath need player agency." Heroic Death
// already asks; the other three picked their victim themselves. When a card can strike
// more than one figure, its owner now chooses (a 'combatKill' question after the dice).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep } from '../src/engine/combat.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

/** A battle where `side` attacks with `card`, re-rolling with a Leader/Character; search
 *  seeds until the round reaches the kill question (or report none found). */
function battle(card, attacker, setup) {
  for (let seed = 1; seed < 600; seed++) {
    const s = startGame(createGame({ seed }));
    for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
    for (const n of Object.keys(s.nations)) { s.nations[n].active = true; s.nations[n].step = 0; }
    // Two open regions side by side (no Stronghold, so nobody withdraws into a siege).
    const fp = 'dagorlad', sh = 'noman-lands';
    setup(s, fp, sh);
    if (attacker === 'fp') startBattle(s, 'fp', fp, sh); else startBattle(s, 'shadow', sh, fp);
    const pc = s.pendingCombat;
    if (!pc) continue;
    pc.attackerCard = card; pc.defenderCard = null;
    pc.step = 'cardCost';
    s.pendingChoice = null;
    combatStep(s);
    if (s.pendingChoice?.kind === 'combatKill') return s;
  }
  return null;
}
const place = (s, region, chars) => { for (const c of chars) { s.regions[region].characters.push(c); s.characters.inPlay[c] = region; if (!s.characters.entered.includes(c)) s.characters.entered.push(c); } };

console.log('\n=== Blade of Westernesse: the Free Peoples choose which Minion falls ===');
{
  const s = battle('fp-char-05', 'fp', (st, fp, sh) => {
    st.regions[fp].units = { gondor: { regular: 3, elite: 2 } }; st.regions[fp].leaders = 2; place(st, fp, ['peregrin']);
    st.fellowship.companions = st.fellowship.companions.filter((c) => c !== 'peregrin');
    st.regions[sh].units = { sauron: { regular: 4, elite: 0 } }; place(st, sh, ['witch-king', 'mouth-of-sauron']);
  });
  check('a re-roll hit raised the question', !!s);
  if (s) {
    const opts = wotrAdapter.legalActions(s, 'fp').map((a) => a.target);
    check('both Minions are offered, to the Free Peoples', s.pendingChoice.owner === 'fp' && opts.includes('witch-king') && opts.includes('mouth-of-sauron'), opts.join(','));
    const t = wotrAdapter.applyAction(s, { kind: 'combatKill', target: 'mouth-of-sauron' }, 'fp');
    check('the Mouth of Sauron falls, the Witch-king stays', t.characters.eliminated.includes('mouth-of-sauron') && !t.characters.eliminated.includes('witch-king'));
    check('the battle carries on', t.pendingChoice?.kind !== 'combatKill');
  }
}

console.log('\n=== Fateful Strike: a Nazgûl, or (with two hits) a Minion — the Free Peoples pick ===');
{
  const s = battle('fp-char-12', 'fp', (st, fp, sh) => {
    st.regions[fp].units = { gondor: { regular: 3, elite: 2 } }; st.regions[fp].leaders = 3;
    st.regions[sh].units = { sauron: { regular: 4, elite: 0 } }; st.regions[sh].nazgul = 2; place(st, sh, ['witch-king']);
  });
  check('a two-hit re-roll raised the question', !!s);
  if (s) {
    const opts = wotrAdapter.legalActions(s, 'fp').map((a) => a.target);
    check('the Witch-king and a Nazgûl are both offered', opts.includes('witch-king') && opts.includes('nazgul'), opts.join(','));
    const naz = s.regions['noman-lands'].nazgul;
    const t = wotrAdapter.applyAction(s, { kind: 'combatKill', target: 'nazgul' }, 'fp');
    check('a Nazgûl falls (the player\'s pick), the Witch-king lives', !t.characters.eliminated.includes('witch-king') && t.regions['noman-lands'].nazgul === naz - 1, `${naz} -> ${t.regions['noman-lands'].nazgul}`);
  }
}

console.log('\n=== Black Breath: the Shadow picks the Leader or the Companion ===');
{
  // Morgul Wound's Combat card is Black Breath.
  const s = battle('sh-char-12', 'shadow', (st, fp, sh) => {
    st.regions[fp].units = { gondor: { regular: 4, elite: 0 } }; st.regions[fp].leaders = 1; place(st, fp, ['meriadoc', 'peregrin']);
    st.fellowship.companions = st.fellowship.companions.filter((c) => c !== 'meriadoc' && c !== 'peregrin');
    st.regions[sh].units = { sauron: { regular: 5, elite: 2 } }; st.regions[sh].nazgul = 3;
  });
  check('a re-roll hit raised the question', !!s);
  if (s) {
    const opts = wotrAdapter.legalActions(s, 'shadow').map((a) => a.target);
    check('the Shadow is offered the Companions and the Leader', s.pendingChoice.owner === 'shadow' && opts.includes('leader') && opts.some((o) => o === 'meriadoc' || o === 'peregrin'), opts.join(','));
    const t = wotrAdapter.applyAction(s, { kind: 'combatKill', target: 'leader' }, 'shadow');
    check('the Leader falls; both Hobbits live', !t.characters.eliminated.includes('meriadoc') && !t.characters.eliminated.includes('peregrin'));
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
