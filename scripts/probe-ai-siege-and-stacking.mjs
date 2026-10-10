#!/usr/bin/env vite-node
// probe-ai-siege-and-stacking.mjs — the Shadow AI holds the sieges it lays, and stops
// feeding units into stacks that throw them away.
//  - Player report q0vopcx9p3bcejso: the Shadow kept moving its Army in and out of an
//    FP-held Orthanc, never assaulting. A besieging Army that strikes OUT and wins must
//    not advance everyone (that lifts the siege): it holds, or — onto an enemy
//    Settlement — leaves the garrison's size plus one behind.
//  - Player report 3t5w710l563l4s4t: the Shadow removed 9 of its own units to the
//    stacking limit. Event recruits go where they fit, and an Army does not march into a
//    siege stack that is already full.
import { Rng } from 'digital-boardgame-framework';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { chooseAction } from '../src/ai/wotrAI.ts';
import { REGIONS } from '../src/engine/data.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const fresh = () => {
  const s = startGame(createGame({ seed: 23 }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  for (const n of ['sauron', 'isengard', 'southrons', 'gondor', 'rohan', 'elves']) { s.nations[n].active = true; s.nations[n].step = 0; }
  return s;
};
const besiege = (s, id, shadowUnits, fpBox) => {
  const r = s.regions[id];
  r.control = 'fp'; r.besieged = true;
  r.units = shadowUnits; r.leaders = 0; r.nazgul = 0; r.characters = [];
  r.siegeBox = { units: fpBox, leaders: 1, nazgul: 0, characters: [] };
};
const decide = (s) => chooseAction(s, 'shadow', wotrAdapter.legalActions(s, 'shadow'), new Rng(5));

console.log('\n=== Striking out of a siege: the siege holds ===');
{
  const s = fresh();
  besiege(s, 'orthanc', { isengard: { regular: 4, elite: 1 } }, { rohan: { regular: 1, elite: 4 } });
  s.regions['fords-of-isen'].units = {}; s.regions['fords-of-isen'].leaders = 0;
  s.pendingChoice = { owner: 'shadow', kind: 'advanceChoice', data: { from: 'orthanc', to: 'fords-of-isen' } };
  const a = decide(s);
  check('into open ground: the Army stays to hold the siege', a.kind === 'advanceChoice' && a.advance === false, JSON.stringify(a));
}
{
  // A besieged Stronghold next to an FP Settlement: advance onto it, but hold the siege.
  const pair = Object.entries(REGIONS).flatMap(([id, d]) => d.settlement === 'Stronghold' && d.nation && ['gondor', 'rohan', 'elves', 'dwarves', 'north'].includes(d.nation)
    ? d.adjacency.filter((t) => REGIONS[t]?.settlement && REGIONS[t].settlement !== 'Stronghold' && ['gondor', 'rohan', 'elves', 'dwarves', 'north'].includes(REGIONS[t].nation)).map((t) => [id, t]) : [])[0];
  const [from, to] = pair;
  const s = fresh();
  besiege(s, from, { sauron: { regular: 5, elite: 3 } }, { [REGIONS[from].nation]: { regular: 2, elite: 0 } });
  s.regions[to].units = {}; s.regions[to].leaders = 0; s.regions[to].control = 'fp';
  s.pendingChoice = { owner: 'shadow', kind: 'advanceChoice', data: { from, to } };
  const a = decide(s);
  const moved = Object.values(a.move?.units ?? {}).reduce((t, u) => t + (u.regular ?? 0) + (u.elite ?? 0), 0);
  check(`onto ${REGIONS[to].name}: advances only part`, a.kind === 'advanceChoice' && a.advance === true && !!a.move, JSON.stringify(a));
  check('…leaving at least the garrison plus one besieging', 8 - moved >= 3, `${8 - moved} stay`);
  const after = wotrAdapter.applyAction(s, a, 'shadow');
  check(`…and ${REGIONS[from].name} is still besieged`, after.regions[from].besieged === true);
}

console.log('\n=== Event recruits go where they fit ===');
{
  const s = fresh();
  s.dice.shadow = ['event']; s.dice.fp = [];
  // Pits of Mordor: two Sauron Regulars in each of three Sauron Strongholds. Morannon is full.
  s.regions.morannon.units = { sauron: { regular: 10, elite: 0 } };
  s.cards.shadow.hand = ['sh-str-24'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-24');
  let t = wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'shadow');
  const picks = [];
  for (let i = 0; i < 3 && t.pendingChoice?.kind === 'eventTarget'; i++) {
    const a = decide(t); picks.push(a.region ?? (a.done ? 'done' : '?'));
    t = wotrAdapter.applyAction(t, a, 'shadow');
  }
  check('Pits of Mordor skips the full Morannon', !picks.includes('morannon'), picks.join(', '));
}

console.log('\n=== No march into a full siege stack ===');
{
  const s = fresh();
  s.dice.shadow = ['army']; s.dice.fp = [];
  besiege(s, 'helms-deep', { isengard: { regular: 6, elite: 4 } }, { rohan: { regular: 2, elite: 0 } });
  s.regions.westemnet.units = { isengard: { regular: 4, elite: 0 } }; s.regions.westemnet.leaders = 0;
  const a = decide(s);
  const into = (a.kind === 'moveArmy' || a.kind === 'armyMove2') && a.to === 'helms-deep';
  check('the Westemnet Army does not join the full Helm\'s Deep siege', !into, JSON.stringify(a));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
