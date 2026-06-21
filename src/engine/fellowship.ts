// Fellowship movement, declaring, hiding, and entering Mordor (rules-spec §9-11).
// Simplified for the first playable loop; the declare target is chosen by the
// caller (the AI pushes toward Mordor).
import type { GameState, RegionId, CharacterId, Nation } from './types';
import { FP_NATIONS } from './types';
import { REGIONS, levelOf, COMPANIONS } from './data';
import { resolveHunt, resolveMordorStep } from './hunt';
import { activateNation, advancePolitical } from './politics';
import { settlementController, armySide } from './armies';
import { MINION_IDS } from './minions';
import { log, notify } from './log';

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
// On-table cards that require a specific Companion to remain in the Fellowship; when
// that Companion leaves (separated/eliminated), the card is discarded (rules: the card
// stays only while its Companion is in the Fellowship).
const ONTABLE_REQUIRES: Record<string, (c: string[]) => boolean> = {
  'fp-char-06': (c) => c.includes('gimli') || c.includes('legolas'), // Axe and Bow
  'fp-char-07': (c) => c.includes('boromir'),                        // Horn of Gondor
  'fp-char-08': (c) => c.includes('gandalf-grey'),                   // Wizard's Staff
};
export function pruneFellowshipOnTableCards(state: GameState): void {
  const t = state.cards.fp.table;
  for (const id of Object.keys(ONTABLE_REQUIRES)) {
    const i = t.indexOf(id);
    if (i >= 0 && !ONTABLE_REQUIRES[id]!(state.fellowship.companions)) {
      t.splice(i, 1);
      state.cards.fp.discard.character.push(id);
      log(state, null, 'event', `${id} discarded — its Companion left the Fellowship`);
    }
  }
}

export function eliminateCompanion(state: GameState, id: CharacterId): number {
  const fs = state.fellowship;
  const i = fs.companions.indexOf(id);
  if (i < 0) return 0;
  const lvl = levelOf(id);
  fs.companions.splice(i, 1);
  // Meriadoc / Peregrin "Take Them Alive!": eliminated from the Fellowship → re-placed
  // on the map as if separated (the casualty/absorption still happens), not removed.
  if (id === 'meriadoc' || id === 'peregrin') {
    state.characters.inPlay[id] = fs.location;
    state.regions[fs.location]!.characters.push(id);
    log(state, null, 'hunt', `${COMPANIONS[id]?.name ?? id} taken alive — placed at ${fs.location}`);
  } else if (!state.characters.eliminated.includes(id)) {
    state.characters.eliminated.push(id);
  }
  reassignGuide(state);
  pruneFellowshipOnTableCards(state);
  return lvl;
}

/** Companions eligible to be the Guide: those tied for the highest Level in the
 *  Fellowship (the FP breaks ties — rules-spec §10). Empty if no Companions. */
export function eligibleGuides(state: GameState): CharacterId[] {
  const fs = state.fellowship;
  if (fs.companions.length === 0) return [];
  const max = Math.max(...fs.companions.map(levelOf));
  return fs.companions.filter((c) => levelOf(c) === max);
}

/** Set the Guide to a Companion tied for the highest Level (Fellowship phase). */
export function setGuide(state: GameState, id: CharacterId): boolean {
  if (!eligibleGuides(state).includes(id)) return false;
  state.fellowship.guide = id;
  log(state, null, 'fellowship', `Guide is now ${id}`);
  return true;
}

/** Resolve Lure of the Ring (FP's choice on the randomly-selected Companion). */
export function resolveLureChoice(state: GameState, mode: 'corruption' | 'eliminate'): void {
  const d = state.pendingChoice!.data as { companion: CharacterId; level: number };
  if (mode === 'corruption') state.fellowship.corruption = Math.min(12, state.fellowship.corruption + d.level);
  else eliminateCompanion(state, d.companion);
  state.pendingChoice = null;
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
  state.flags.fellowshipDeclaredOrMovedThisTurn = true; // counts as attempting a move/hide (Mordor penalty)
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

/** Nations a Companion can activate (its own, or all FP if its card shows "any"). */
function activatableNations(id: CharacterId): Nation[] {
  const n = COMPANIONS[id]?.nation;
  if (!n || n === 'any') return [...FP_NATIONS];
  return [n as Nation];
}

/** Would placing `companion` at `region` rouse a Free Peoples nation toward War?
 *  True when `region` is a City/Stronghold of a nation the Companion can activate
 *  that isn't already At War. Used to highlight the rousing destinations on the
 *  map when a Companion separates (so it isn't a hidden consequence). */
export function separationActivates(state: GameState, companion: CharacterId, region: RegionId): boolean {
  const dn = REGIONS[region]?.nation as Nation | null;
  if (!dn || !activatableNations(companion).includes(dn)) return false;
  const st = REGIONS[region]?.settlement;
  if (st !== 'City' && st !== 'Stronghold') return false;
  return (state.nations[dn]?.step ?? 0) > 0; // not yet At War — the rouse still matters
}

/** BFS for the nearest region within `maxMove` steps satisfying `pred`. */
function nearestMatch(from: RegionId, maxMove: number, pred: (id: RegionId) => boolean): RegionId | null {
  if (pred(from)) return from;
  const seen = new Set([from]);
  let frontier = [from];
  for (let depth = 1; depth <= maxMove && frontier.length; depth++) {
    const next: RegionId[] = [];
    for (const r of frontier) for (const a of REGIONS[r]?.adjacency ?? []) {
      if (seen.has(a)) continue;
      seen.add(a);
      if (pred(a)) return a;
      next.push(a);
    }
    frontier = next;
  }
  return null;
}

/** Separate one Companion from the Fellowship (Character die; forbidden on the
 *  Mordor Track). The Companion moves up to (Progress + Level) regions toward the
 *  nearest City/Stronghold of a Nation it can activate that isn't yet At War, and
 *  activates + advances that Nation on arrival. Separation is permanent. */
export function separateCompanion(state: GameState, id: CharacterId,
  opts: { extraMove?: number; levelOverride?: number } = {}): boolean {
  const fs = state.fellowship;
  if (fs.mordor !== null || !fs.companions.includes(id)) return false;
  const maxMove = fs.progress + (opts.levelOverride ?? levelOf(id)) + (opts.extraMove ?? 0);
  const nations = activatableNations(id);
  const isTarget = (r: RegionId): boolean => {
    const def = REGIONS[r]!;
    return !!def.nation && nations.includes(def.nation as Nation)
      && (def.settlement === 'City' || def.settlement === 'Stronghold')
      && settlementController(state, r) !== 'shadow'
      && state.nations[def.nation as Nation].step > 0; // activation still useful
  };
  const dest = nearestMatch(fs.location, maxMove, isTarget) ?? fs.location;
  beginSeparation(state, id);
  placeSeparatedCompanion(state, id, dest);
  return true;
}

/** The Companion's move range when separating: Progress + Level (+ any bonus). */
export function separationRange(state: GameState, id: CharacterId, opts: { extraMove?: number; levelOverride?: number } = {}): number {
  return state.fellowship.progress + (opts.levelOverride ?? levelOf(id)) + (opts.extraMove ?? 0);
}

/** Legal landing regions within `maxMove` of `from`, excluding a not-besieged enemy
 *  Stronghold. Includes `from` itself (a move of 0). For the board-click destination
 *  choice when separating a Companion (computed after it's removed from the Box). */
export function separationDestinations(state: GameState, from: RegionId, maxMove: number): RegionId[] {
  const landable = (r: RegionId): boolean => {
    const def = REGIONS[r]!;
    return !(def.settlement === 'Stronghold' && settlementController(state, r) === 'shadow' && !state.regions[r]!.besieged);
  };
  const out: RegionId[] = landable(from) ? [from] : [];
  const seen = new Set<RegionId>([from]);
  let layer: RegionId[] = [from], d = 0;
  while (layer.length && d < maxMove) {
    d++; const next: RegionId[] = [];
    for (const r of layer) for (const a of REGIONS[r]!.adjacency) {
      if (!seen.has(a)) { seen.add(a); next.push(a); if (landable(a)) out.push(a); }
    }
    layer = next;
  }
  return out;
}

/** Remove `id` from the Fellowship (reassigning the Guide). The caller then places
 *  it with placeSeparatedCompanion once the destination is chosen. */
export function beginSeparation(state: GameState, id: CharacterId): boolean {
  const fs = state.fellowship;
  if (fs.mordor !== null || !fs.companions.includes(id)) return false;
  fs.companions.splice(fs.companions.indexOf(id), 1);
  reassignGuide(state);
  return true;
}

/** Place an already-removed Companion at `dest`, rousing its Nation if it lands in a
 *  City/Stronghold of one it can activate. */
export function placeSeparatedCompanion(state: GameState, id: CharacterId, dest: RegionId): void {
  const fs = state.fellowship;
  state.characters.inPlay[id] = dest;
  state.regions[dest]!.characters.push(id);
  const nations = activatableNations(id);
  const dn = REGIONS[dest]!.nation as Nation | null;
  if (dn && nations.includes(dn) && (REGIONS[dest]!.settlement === 'City' || REGIONS[dest]!.settlement === 'Stronghold')) {
    activateNation(state, dn, { viaCompanion: true }); advancePolitical(state, dn, 1);
    const nm = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    notify(state, `${COMPANIONS[id]?.name ?? id} rouses the ${nm(dn)} to war — ${nm(dn)} ${state.nations[dn].step === 0 ? 'is now At War' : 'advances on the Political Track'}.`);
  }
  pruneFellowshipOnTableCards(state);
  log(state, null, 'fellowship', `${COMPANIONS[id]?.name ?? id} separated to ${dest}; guide now ${fs.guide}`);
}

/** Place a GROUP of already-removed Companions (separated together with one Character
 *  die — RAW p.39) at `dest`. They travel as one group; if they land in a City/
 *  Stronghold of a Nation that ANY of them can activate, that Nation is roused ONCE
 *  (not once per Companion). The group's move range (Progress + highest Level) is
 *  enforced by the caller. */
export function placeSeparatedGroup(state: GameState, ids: CharacterId[], dest: RegionId): void {
  const fs = state.fellowship;
  for (const id of ids) { state.characters.inPlay[id] = dest; state.regions[dest]!.characters.push(id); }
  const dn = REGIONS[dest]!.nation as Nation | null;
  if (dn && (REGIONS[dest]!.settlement === 'City' || REGIONS[dest]!.settlement === 'Stronghold')
    && ids.some((id) => activatableNations(id).includes(dn))) {
    activateNation(state, dn, { viaCompanion: true }); advancePolitical(state, dn, 1);
    const nm = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    notify(state, `The Companions rouse the ${nm(dn)} to war — ${nm(dn)} ${state.nations[dn].step === 0 ? 'is now At War' : 'advances on the Political Track'}.`);
  }
  pruneFellowshipOnTableCards(state);
  log(state, null, 'fellowship', `${ids.map((id) => COMPANIONS[id]?.name ?? id).join(', ')} separated to ${dest}; guide now ${fs.guide}`);
}

/** Enter Mordor: only when the figure is at Morannon or Minas Morgul. Places the
 *  Ring-bearers on Mordor step 0. */
export function enterMordor(state: GameState): boolean {
  const fs = state.fellowship;
  if (fs.mordor !== null || !MORDOR_ENTRANCES.includes(fs.location)) return false;
  fs.mordor = 0;
  fs.progress = 0;
  // Special tiles in play now join the active Hunt Pool (rules-spec §11).
  if (state.hunt.specialsInPlay.length) {
    state.hunt.specialsInPool.push(...state.hunt.specialsInPlay);
    state.hunt.specialsInPlay = [];
  }
  log(state, null, 'fellowship', 'Fellowship entered Mordor');
  return true;
}

// --- Will-of-the-West upgrades (Aragorn, Gandalf the White) ----------------
const ARAGORN_CITIES: RegionId[] = ['minas-tirith', 'dol-amroth', 'pelargir'];
const GANDALF_WHITE_REGIONS: RegionId[] = ['fangorn', 'grey-havens', 'rivendell', 'lorien', 'woodland-realm'];

export function findCharacterRegion(state: GameState, id: CharacterId): RegionId | null {
  for (const r of Object.keys(state.regions)) if (state.regions[r]!.characters.includes(id)) return r;
  return null;
}

export function canBringAragorn(state: GameState): boolean {
  if (state.characters.entered.includes('aragorn')) return false;
  const r = findCharacterRegion(state, 'strider');
  return !!r && ARAGORN_CITIES.includes(r) && settlementController(state, r) !== 'shadow';
}

/** Where Gandalf the White may enter: if Gandalf the Grey is on the map he is
 *  replaced in place (single option); otherwise the player CHOOSES Fangorn or an
 *  unconquered Elven Stronghold (card text). */
export function gandalfWhiteCandidates(state: GameState): RegionId[] {
  const grey = findCharacterRegion(state, 'gandalf-grey');
  if (grey) return [grey]; // replace him in place — no choice
  return GANDALF_WHITE_REGIONS.filter((r) => REGIONS[r] && settlementController(state, r) !== 'shadow' && armySide(state, r) !== 'shadow');
}
function gandalfWhiteRegion(state: GameState): RegionId | null {
  return gandalfWhiteCandidates(state)[0] ?? null;
}

export function canBringGandalfWhite(state: GameState): boolean {
  if (state.characters.entered.includes('gandalf-white')) return false;
  if (state.fellowship.companions.includes('gandalf-grey')) return false; // must have left/been lost
  if (!MINION_IDS.some((m) => state.characters.entered.includes(m))) return false;
  return gandalfWhiteRegion(state) !== null;
}

/** Bring an upgrade into play via a Will-of-the-West die. */
export function bringUpgrade(state: GameState, which: 'aragorn' | 'gandalf-white', dest?: RegionId): boolean {
  if (which === 'aragorn') {
    if (!canBringAragorn(state)) return false;
    const r = findCharacterRegion(state, 'strider')!;
    const arr = state.regions[r]!.characters;
    arr.splice(arr.indexOf('strider'), 1); arr.push('aragorn');
    state.characters.entered.push('aragorn');
    log(state, null, 'muster', `Strider becomes Aragorn at ${r} (+1 FP die next turn)`);
  } else {
    if (!canBringGandalfWhite(state)) return false;
    const grey = findCharacterRegion(state, 'gandalf-grey');
    const target = (dest && gandalfWhiteCandidates(state).includes(dest)) ? dest : gandalfWhiteRegion(state)!;
    if (grey) { const a = state.regions[grey]!.characters; a.splice(a.indexOf('gandalf-grey'), 1); }
    state.regions[target]!.characters.push('gandalf-white');
    state.characters.entered.push('gandalf-white');
    log(state, null, 'muster', `Gandalf the White enters at ${target} (+1 FP die next turn)`);
  }
  return true;
}
