// Fellowship movement, declaring, hiding, and entering Mordor (rules-spec §9-11).
// Simplified for the first playable loop; the declare target is chosen by the
// caller (the AI pushes toward Mordor).
import type { GameState, RegionId, CharacterId } from './types';
import { REGIONS, levelOf, COMPANIONS } from './data';
import { resolveHunt, resolveMordorStep } from './hunt';
import { log } from './log';

/** Highest-Level Companion in the Fellowship becomes Guide; Gollum if none. */
export function reassignGuide(state: GameState): void {
  const fs = state.fellowship;
  if (fs.companions.length === 0) { fs.guide = 'gollum'; return; }
  if (fs.companions.includes(fs.guide)) return; // current guide still present
  let best = fs.companions[0]!;
  for (const c of fs.companions) if (levelOf(c) > levelOf(best)) best = c;
  fs.guide = best;
}

/** Eliminate a Companion from the Fellowship (permanent), reassigning the Guide.
 *  Returns the eliminated Companion's Level. */
export function eliminateCompanion(state: GameState, id: CharacterId): number {
  const fs = state.fellowship;
  const i = fs.companions.indexOf(id);
  if (i < 0) return 0;
  fs.companions.splice(i, 1);
  if (!state.characters.eliminated.includes(id)) state.characters.eliminated.push(id);
  reassignGuide(state);
  log(state, null, 'hunt', `${COMPANIONS[id]?.name ?? id} eliminated; guide now ${fs.guide}`);
  return levelOf(id);
}

export const MORDOR_ENTRANCES: RegionId[] = ['morannon', 'minas-morgul'];

/** BFS shortest-path next-hops from `from` to `to` over region adjacency
 *  (impassable borders are already excluded from adjacency). Returns the ordered
 *  list of regions to step through (excluding `from`, including `to`), or [] if
 *  unreachable. */
export function pathTo(from: RegionId, to: RegionId): RegionId[] {
  if (from === to) return [];
  const prev: Record<string, string> = {};
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length) {
    const next: string[] = [];
    for (const r of frontier) {
      for (const n of REGIONS[r]?.adjacency ?? []) {
        if (seen.has(n)) continue;
        seen.add(n); prev[n] = r;
        if (n === to) {
          const path = [to];
          let cur = to;
          while (prev[cur] !== from) { cur = prev[cur]!; path.unshift(cur); }
          return path;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return [];
}

/** Move the Fellowship (Character die / event). Must be Hidden and not blocked.
 *  Advances Progress (or a Mordor step), runs the Hunt, then adds the FP die to
 *  the Hunt Box (raising subsequent Hunt rolls and returned next turn). */
export function moveFellowship(state: GameState): void {
  const fs = state.fellowship;
  if (!fs.hidden) return;
  if (fs.mordor !== null) {
    resolveMordorStep(state); // adds the FP die to the Hunt Box internally
  } else {
    fs.progress += 1;
    resolveHunt(state);       // ditto
  }
  state.flags.fellowshipDeclaredOrMovedThisTurn = true;
  log(state, null, 'fellowship', `Fellowship moved (progress ${fs.progress}, mordor ${fs.mordor ?? '-'})`);
}

/** Hide a Revealed Fellowship (Character die). Does not move; die not added to
 *  the Hunt Box. */
export function hideFellowship(state: GameState): void {
  state.fellowship.hidden = true;
  log(state, null, 'fellowship', 'Fellowship hidden');
}

/** Declare the Fellowship's position: move the figure up to `progress` regions
 *  toward `target` (BFS), reset Progress to 0, heal 1 Corruption if declared in
 *  an unconquered FP City/Stronghold. Stays Hidden. */
export function declareFellowship(state: GameState, target: RegionId): void {
  const fs = state.fellowship;
  if (!fs.hidden || fs.mordor !== null) return;
  const path = pathTo(fs.location, target);
  const steps = Math.min(fs.progress, path.length);
  if (steps > 0) fs.location = path[steps - 1]!;
  fs.progress = 0;
  // Heal in an unconquered FP City/Stronghold.
  const def = REGIONS[fs.location]!;
  if ((def.settlement === 'City' || def.settlement === 'Stronghold')
    && def.nation && ['dwarves', 'elves', 'gondor', 'north', 'rohan'].includes(def.nation)
    && state.regions[fs.location]!.control !== 'shadow') {
    fs.corruption = Math.max(0, fs.corruption - 1);
  }
  log(state, null, 'fellowship', `Fellowship declared at ${fs.location} (corruption ${fs.corruption})`);
}

/** Enter Mordor: only when the figure is at Morannon or Minas Morgul. Places the
 *  Ring-bearers on Mordor step 0. */
export function enterMordor(state: GameState): boolean {
  const fs = state.fellowship;
  if (fs.mordor !== null || !MORDOR_ENTRANCES.includes(fs.location)) return false;
  fs.mordor = 0;
  fs.progress = 0;
  log(state, null, 'fellowship', 'Fellowship entered Mordor');
  return true;
}
