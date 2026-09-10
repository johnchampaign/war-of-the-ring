// humanlikeFP — a SCRIPTED Free Peoples opponent that plays the way the uploaded
// human games say humans play against our Shadow, used as the second gate for
// Shadow-AI changes (John, 2026-09-10: "ok" to the yardstick).
//
// Why it exists: three Shadow experiments (the wake-price waiver, the wide
// garrison term, the pre-Mordor Hunt policy) measured right against the heuristic
// FP and wrong against humans, because the heuristic FP never parks to heal,
// never storms a lone garrison, and never dawdles. Self-play cannot see the
// behaviours humans exploit. This layer adds exactly those, calibrated on the
// 121 human-FP games uploaded 2026-08-25..09-10 (see docs/ai-humanlike-yardstick.md):
//
//   - REST: humans rest-declare in a friendly City/Stronghold at Corruption 2
//     (median) and do not leave until it is 1 (median) — the heuristic leaves at 2+.
//   - PATIENCE: they enter Mordor at Corruption 2.5 (median; 82% at <= 4) — never
//     enter above 4 while a heal spot could still be reached.
//   - STORM: half of all human attacks (169 of ~340) hit a ONE-unit defender. A
//     stack of 3+ next to an enemy VP Settlement held by <= 1 unit attacks it,
//     and a 3+ stack within two regions of one marches toward it.
//
// Everything else defers to the heuristic FP (chooseAction), so the yardstick is a
// pure function of the redacted view like every other controller. It is a
// MEASUREMENT tool: it never ships as a difficulty and must not be tuned to win.
import type { GameState, RegionId, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { Rng } from 'digital-boardgame-framework';
import { REGIONS } from '../engine/data';
import { unitCount } from '../engine/armies';
import { chooseAction, settlementCtrl, armyHere, dist } from './wotrAI';

const FP_NATIONS = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan']);
const healSpot = (state: GameState, id: RegionId): boolean => {
  const d = REGIONS[id];
  return !!d && (d.settlement === 'City' || d.settlement === 'Stronghold') && !!d.nation && FP_NATIONS.has(d.nation) && settlementCtrl(state, id) !== 'shadow';
};
/** Enemy VP Settlements held by at most one unit — the storm targets. */
const softTargets = (state: GameState): RegionId[] =>
  (Object.keys(state.regions) as RegionId[]).filter((id) => (REGIONS[id]?.vp ?? 0) > 0 && settlementCtrl(state, id) === 'shadow' && unitCount(state, id) <= 1 && !state.regions[id]!.siegeBox);

export function chooseActionHumanlike(state: GameState, actor: Side, legal: WotrAction[], rng: Rng): WotrAction {
  if (actor !== 'fp' || legal.length === 1 || state.pendingChoice) return chooseAction(state, actor, legal, rng);
  const fs = state.fellowship;

  // --- Fellowship phase: PATIENCE at the gates, REST in a haven ---
  if (state.phase === 'fellowship') {
    if (fs.corruption > 4) {
      const enter = legal.find((a) => a.kind === 'enterMordor');
      if (enter) {
        const rest = legal.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' }> => a.kind === 'declareFellowship' && healSpot(state, a.target));
        // Too corrupted to enter: fall back to a heal spot if one is in reach. With
        // none in reach, defer to the heuristic (which enters) — waiting at the gate
        // with nothing to heal at is not a human habit, it is a stall (one game of
        // the first 2000-game baseline never ended that way).
        if (rest.length) return rest.reduce((b, a) => (dist(a.target, 'morannon') < dist(b.target, 'morannon') ? a : b), rest[0]!);
      }
    }
    if (fs.mordor === null && healSpot(state, fs.location) && fs.corruption >= 2) {
      const stay = legal.find((a) => a.kind === 'declareFellowship' && a.target === fs.location);
      if (stay) return stay; // rest-declare in place (heals 1)
    }
    return chooseAction(state, actor, legal, rng);
  }

  // --- Action resolution ---
  if (state.phase === 'actionResolution') {
    // REST: while healing in a haven, the Fellowship does not move until Corruption 1.
    const resting = fs.mordor === null && healSpot(state, fs.location) && fs.progress === 0 && fs.corruption >= 2;
    const filtered = resting ? legal.filter((a) => a.kind !== 'moveFellowship') : legal;

    // STORM a lone garrison with a 3+ stack.
    const soft = new Set(softTargets(state));
    if (soft.size) {
      const storms = filtered.filter((a): a is Extract<WotrAction, { kind: 'attack' }> => a.kind === 'attack' && a.from !== a.to && soft.has(a.to) && unitCount(state, a.from) >= 3);
      if (storms.length) return storms.reduce((b, a) => (REGIONS[a.to]!.vp > REGIONS[b.to]!.vp ? a : b), storms[0]!);
      // MARCH a 3+ stack toward a soft target within two regions (closer after the move).
      const marches = filtered.filter((a): a is Extract<WotrAction, { kind: 'moveArmy' }> => a.kind === 'moveArmy' && unitCount(state, a.from) >= 3 && !armyHere(state, a.to, 'shadow')
        && [...soft].some((t) => dist(a.from, t) <= 2 && dist(a.to, t) < dist(a.from, t)));
      if (marches.length) return marches[Math.floor(rng.next() * marches.length)]!;
    }
    const pick = chooseAction(state, actor, filtered.length ? filtered : legal, rng);
    return filtered.includes(pick) ? pick : chooseAction(state, actor, legal, rng);
  }
  return chooseAction(state, actor, legal, rng);
}
