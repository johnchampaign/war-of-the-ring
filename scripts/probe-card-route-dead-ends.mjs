#!/usr/bin/env vite-node
// probe-card-route-dead-ends.mjs — tracing a card's route on the map never strands the
// Army. Shadows Gather moves one Shadow Army up to three regions, ENDING where another
// Shadow Army stands; the map used to offer every walkable neighbour, so a player could
// spend all three steps into empty country where the card could neither stop nor go on
// — no "Stop here", only cancel (player report kglsmlh727juow8r, "my game cannot
// progress"). Two invariants, over every origin the card offers:
//   1. every walk the map offers can still end at an offered destination;
//   2. every offered destination is still reachable by some walk (nothing hidden).
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { cardRouteNextSteps, cardPathBlockReason } from '../src/engine/armies.ts';
import { REGIONS } from '../src/engine/data.ts';
import { FP_NATIONS } from '../src/engine/types.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const state = (seed) => {
  const s = startGame(createGame({ seed }));
  s.phase = 'actionResolution'; s.currentPlayer = 'shadow'; s.pendingChoice = null;
  s.dice.shadow = ['event']; s.dice.fp = [];
  for (const n of ['sauron', 'isengard', 'southrons']) { s.nations[n].active = true; s.nations[n].step = 0; }
  s.cards.shadow.hand = ['sh-str-07'];
  const play = wotrAdapter.legalActions(s, 'shadow').find((a) => a.kind === 'playEvent' && a.cardId === 'sh-str-07');
  return play ? wotrAdapter.applyAction(s, { ...play, die: 'event' }, 'shadow') : null;
};

for (const seed of [131, 7, 2026]) {
  console.log(`\n=== Shadows Gather from the opening position (seed ${seed}) ===`);
  const s = state(seed);
  check('Shadows Gather asks for a move', s?.pendingChoice?.kind === 'eventTarget');
  if (!s) continue;
  const view = wotrAdapter.viewFor(s, 'shadow');
  const legs = wotrAdapter.legalActions(s, 'shadow').filter((a) => a.kind === 'eventTarget' && a.from && a.to);
  let walks = 0, strandedNow = 0, strandedBefore = 0, hidden = 0;
  for (const from of [...new Set(legs.map((a) => a.from))]) {
    const ends = legs.filter((a) => a.from === from).map((a) => a.to);
    const budget = Math.max(...legs.filter((a) => a.from === from).map((a) => a.range ?? 3));
    const nations = Object.keys(view.regions[from]?.units ?? {}).filter((n) => !FP_NATIONS.includes(n));
    const reached = new Set();
    const walk = (route) => {
      walks++;
      const head = route.length ? route[route.length - 1] : from;
      if (route.length && ends.includes(head)) reached.add(head);
      const steps = cardRouteNextSteps(view, from, route, ends, budget, 'shadow', nations);
      if (route.length && !ends.includes(head) && steps.size === 0) strandedNow++;
      // The old offer: any open neighbour, whether or not the card could end beyond it.
      if (route.length < budget) for (const n of REGIONS[head].adjacency) {
        const path = [...route, n];
        if (!cardPathBlockReason(view, from, path, 'shadow', nations) && !steps.has(n)) {
          const dead = (p) => { const h = p[p.length - 1]; if (ends.includes(h)) return false; if (p.length >= budget) return true;
            return REGIONS[h].adjacency.every((m) => cardPathBlockReason(view, from, [...p, m], 'shadow', nations) || dead([...p, m])); };
          if (dead(path)) strandedBefore++;
        }
      }
      for (const n of steps) walk([...route, n]);
    };
    walk([]);
    hidden += ends.filter((e) => !reached.has(e)).length;
  }
  check('no offered walk strands the Army', strandedNow === 0, `${walks} walks traced`);
  check('every offered destination is still reachable on the map', hidden === 0, hidden ? `${hidden} hidden` : '');
  console.log(`       (the old map offered ${strandedBefore} dead-end steps here)`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall ok');
process.exit(failures ? 1 : 0);
