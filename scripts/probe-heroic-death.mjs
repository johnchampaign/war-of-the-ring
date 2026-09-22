#!/usr/bin/env vite-node
// probe-heroic-death.mjs — Heroic Death is the Free Peoples' CHOICE (player reports
// rfibkew6mp9hi2fi, 5p331i3s2a5j100w, 0m181w0r2w4b2z25). Card Text Reference:
//   "Before you remove casualties inflicted by your opponent's Combat roll and Leader
//    re-roll, you MAY eliminate one of your Leaders to cancel one hit, or eliminate
//    one Companion to cancel a number of hits equal to or less than the Companion's
//    Level."
// It used to be applied silently: a Leader was always spent, a Companion never could
// be, and a battle with only a Companion present cancelled the hit for free.
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { startBattle, combatStep, resolvePlayCombatCard, resolveHeroicDeath } from '../src/engine/combat.ts';
import { EVENT_BY_ID } from '../src/engine/data.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { Rng } from 'digital-boardgame-framework';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const HD = Object.keys(EVENT_BY_ID).find((id) => EVENT_BY_ID[id]?.combat?.title === 'Heroic Death');
check('a Heroic Death card exists', !!HD, HD);

/** Shadow (5 Isengard Elites) out of Orthanc into the Fords, FP defending with `fp`. */
function battle(seed, { leaders = 1, chars = ['boromir'], regulars = 3 } = {}) {
  const s = startGame(createGame({ seed }));
  for (const r of Object.values(s.regions)) { r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; delete r.siegeBox; r.besieged = false; }
  s.nations.isengard.step = 0; s.nations.rohan.step = 0;
  s.regions['orthanc'].units = { isengard: { regular: 0, elite: 5 } };
  s.regions['fords-of-isen'].units = { rohan: { regular: regulars, elite: 0 } };
  s.regions['fords-of-isen'].leaders = leaders;
  s.regions['fords-of-isen'].characters = [...chars];
  s.cards.shadow.hand = [];
  s.cards.fp.hand = [HD];
  startBattle(s, 'shadow', 'orthanc', 'fords-of-isen');
  for (let i = 0; i < 40 && s.pendingCombat; i++) {
    combatStep(s);
    const ch = s.pendingChoice;
    if (!ch) continue;
    if (ch.kind === 'combatCard') { resolvePlayCombatCard(s, ch.owner === 'fp' ? HD : null); continue; }
    return s;
  }
  return s;
}
/** First seed whose round-1 Shadow roll scores at least `min` hits. */
function scoring(min, opts) {
  for (let seed = 1; seed < 200; seed++) {
    const s = battle(seed, opts);
    if (s.pendingChoice?.kind === 'heroicDeath' && s.pendingChoice.data.hits >= min) return s;
  }
  return null;
}

{
  console.log('\n=== The Free Peoples are asked, with every legal victim and "no one" ===');
  const s = scoring(2);
  check('a heroicDeath prompt, owned by the FP', s?.pendingChoice?.owner === 'fp', s?.pendingChoice?.kind);
  const legal = s ? wotrAdapter.legalActions(s, 'fp') : [];
  const opts = legal.filter((a) => a.kind === 'heroicDeath').map((a) => a.sacrifice ?? 'none');
  check('Leader, Boromir and no one are offered', ['leader', 'boromir', 'none'].every((o) => opts.includes(o)) && opts.length === 3, opts.join(','));
}
{
  console.log('\n=== Declining costs nothing and cancels nothing ===');
  const s = scoring(1);
  const hits = s.pendingCombat.atkHits;
  resolveHeroicDeath(s, undefined);
  check('Leader kept', s.regions['fords-of-isen'].leaders === 1);
  check('Boromir kept', s.regions['fords-of-isen'].characters.includes('boromir'));
  check('hits unchanged', s.pendingCombat.atkHits === hits, `${hits} -> ${s.pendingCombat.atkHits}`);
}
{
  console.log('\n=== A Leader cancels one hit ===');
  const s = scoring(2);
  const hits = s.pendingCombat.atkHits;
  resolveHeroicDeath(s, 'leader');
  check('the Leader is gone', s.regions['fords-of-isen'].leaders === 0);
  check('one hit cancelled', s.pendingCombat.atkHits === hits - 1, `${hits} -> ${s.pendingCombat.atkHits}`);
}
{
  console.log('\n=== A Companion cancels up to his Level ===');
  const s = scoring(2);
  const hits = s.pendingCombat.atkHits;
  resolveHeroicDeath(s, 'boromir');
  check('Boromir is eliminated', !s.regions['fords-of-isen'].characters.includes('boromir') && s.characters.eliminated.includes('boromir'));
  check('Leader untouched', s.regions['fords-of-isen'].leaders === 1);
  check('two hits cancelled (Level 2)', s.pendingCombat.atkHits === hits - 2, `${hits} -> ${s.pendingCombat.atkHits}`);
}
{
  console.log('\n=== No Leader, only a Companion: no free cancel (report 0m181w0r2w4b2z25) ===');
  const s = scoring(1, { leaders: 0 });
  const legal = s ? wotrAdapter.legalActions(s, 'fp').filter((a) => a.kind === 'heroicDeath').map((a) => a.sacrifice ?? 'none') : [];
  check('only Boromir or no one', legal.length === 2 && legal.includes('boromir') && legal.includes('none'), legal.join(','));
}
{
  console.log('\n=== The AI sacrifices to save an Army from destruction ===');
  const s = scoring(2, { regulars: 1, leaders: 1 });
  const a = chooseAction(wotrAdapter.viewFor(s, 'fp'), 'fp', wotrAdapter.legalActions(s, 'fp'), new Rng(7));
  check('the AI does not decline', a.kind === 'heroicDeath' && !!a.sacrifice, JSON.stringify(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall Heroic Death checks passed');
process.exit(failures ? 1 : 0);
