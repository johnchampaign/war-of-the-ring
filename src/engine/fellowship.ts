// Fellowship movement, declaring, hiding, and entering Mordor (rules-spec §9-11).
// Simplified for the first playable loop; the declare target is chosen by the
// caller (the AI pushes toward Mordor).
import type { GameState, RegionId, CharacterId, Nation } from './types';
import { FP_NATIONS } from './types';
import { REGIONS, levelOf, COMPANIONS } from './data';
import { resolveHunt, resolveMordorStep } from './hunt';
import { activateNation } from './politics';
import { settlementController, armySide } from './armies';
import { activateOnCompanionLand } from './charMove';
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
  // "This special ability cannot be used if the Fellowship is on the Mordor Track" —
  // there he really is gone, and placing him would have dropped the figure into the
  // Mordor entrance region the Fellowship left behind. The destination is the FP's
  // choice (Progress + Level, exactly like a separation), raised by `advance` once
  // whatever eliminated him has finished resolving.
  if ((id === 'meriadoc' || id === 'peregrin') && fs.mordor === null) {
    state.flags.takenAlive = { companion: id, from: fs.location, range: fs.progress + lvl };
    log(state, null, 'hunt', `${COMPANIONS[id]?.name ?? id} is taken alive — he leaves the Fellowship as if separated`);
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

/** The dark interior of Mordor, reachable on the map only past the Morannon /
 *  Minas Morgul entrances. The Ring-bearers' figure NEVER stands here: the
 *  journey through Mordor is abstracted onto the Mordor Track, entered at an
 *  entrance (rules-spec §11). The Fellowship therefore cannot be declared into
 *  these regions — doing so used to strand the figure in Mordor with no way onto
 *  the Track and no path to the Crack of Doom (report 681l). */
export const MORDOR_INTERIOR: RegionId[] = ['gorgoroth', 'barad-dur', 'nurn'];

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
  // Log the MOVE before resolving the Hunt it triggers, so the log reads in causal
  // order ("Fellowship moved" then "Hunt roll …") rather than the reverse (report 6q0s).
  if (fs.mordor !== null) {
    // No step number here: on the Mordor Track the step advances only AFTER the tile is
    // drawn (a Stop tile holds the Fellowship in place), so naming it now printed the
    // step the Fellowship was LEAVING — the first move in Mordor read "step 0" while the
    // track, the Hunt Box and the status area all correctly showed 1 (player report).
    // `applyDrawnTile` logs the step the Fellowship actually ends on.
    log(state, null, 'fellowship', 'Fellowship moves on the Mordor Track');
    resolveMordorStep(state); // adds the FP die to the Hunt Box internally
  } else {
    fs.progress += 1;
    log(state, null, 'fellowship', `Fellowship moved (progress ${fs.progress})`);
    resolveHunt(state);       // ditto
  }
  state.flags.fellowshipDeclaredOrMovedThisTurn = true;
}

/** Hide a Revealed Fellowship (Character die). Does not move; die not added to
 *  the Hunt Box. `viaStrider` is set when the die spent was NOT a Character/Will
 *  result — only Strider's Guide ability allows that ("Guide. You may use any of
 *  your Action Die results to hide a revealed Fellowship"), and the bare "Fellowship
 *  hidden" line made it look like the rule had been broken (player report 5b303u:
 *  "Free peoples used Army/Mus die to hide fellowship"). Name the ability instead. */
export function hideFellowship(state: GameState, viaStrider = false): void {
  state.fellowship.hidden = true;
  state.flags.fellowshipDeclaredOrMovedThisTurn = true; // counts as attempting a move/hide (Mordor penalty)
  log(state, null, 'fellowship', viaStrider
    ? 'Fellowship hidden — Strider guides, so any Action die result may hide a revealed Fellowship'
    : 'Fellowship hidden');
}

/** Declare the Fellowship's position: move the figure up to `progress` regions
 *  toward `target` (BFS), reset Progress to 0, heal 1 Corruption if declared in
 *  an unconquered FP City/Stronghold. Stays Hidden. */
export function declareFellowship(state: GameState, target: RegionId): void {
  const fs = state.fellowship;
  if (!fs.hidden || fs.mordor !== null) return;
  // Once per turn only. The Fellowship phase deliberately stays OPEN after a
  // declaration (so the FP may still change the Guide or enter Mordor), which used
  // to let the FP declare again and again in place — healing 1 Corruption each
  // time (report 4r4z).
  if (state.flags.fellowshipDeclaredThisTurn) return;
  if (MORDOR_INTERIOR.includes(target)) return; // never strand the figure inside Mordor (report 681l)
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
    // Worn with Sorrow and Toil (sh-char-15) carries its own printed discard
    // clause: "discard this card from the table if the Fellowship is declared in a
    // City or Stronghold controlled by the Free Peoples" — exactly this branch's
    // condition. (The TTS-mod transcription omits the clause; player report + card
    // scans confirm it.) Event-triggered here, not a pruneTableCards condition: the
    // trigger is the DECLARE itself, not a state that persists.
    const t = state.cards.shadow.table;
    const i = t.indexOf('sh-char-15');
    if (i >= 0) {
      t.splice(i, 1);
      state.cards.shadow.discard.character.push('sh-char-15');
      log(state, null, 'event', 'Worn with Sorrow and Toil is discarded — the Fellowship declared in a Free Peoples haven');
    }
  }
  state.flags.fellowshipDeclaredThisTurn = true;
  log(state, null, 'fellowship', `Fellowship declared at ${fs.location} (corruption ${fs.corruption})`);
}

/** Nations a Companion can activate (its own, or all FP if its card shows "any"). */
function activatableNations(id: CharacterId): Nation[] {
  const n = COMPANIONS[id]?.nation;
  if (!n || n === 'any') return [...FP_NATIONS];
  return [n as Nation];
}

/** Would placing `companion` at `region` ACTIVATE a passive Free Peoples nation?
 *  True when `region` is a City/Stronghold of a nation the Companion can activate
 *  that is still passive. Used to highlight the activation destinations on the map
 *  when a Companion separates (so it isn't a hidden consequence). Presence activates
 *  only — it never advances the Political Track. */
export function separationActivates(state: GameState, companion: CharacterId, region: RegionId): boolean {
  const dn = REGIONS[region]?.nation as Nation | null;
  if (!dn || !activatableNations(companion).includes(dn)) return false;
  const st = REGIONS[region]?.settlement;
  if (st !== 'City' && st !== 'Stronghold') return false;
  return !state.nations[dn]?.active; // still passive — activation still matters
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
 *  activates that Nation on arrival (never advances the track). Separation is permanent. */
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
      && !state.nations[def.nation as Nation].active; // still passive — activation useful
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
export function separationDestinations(state: GameState, from: RegionId, maxMove: number,
  opts: { siegeOk?: boolean } = {}): RegionId[] {
  // p.24 permits ENTERING the Shadow-Stronghold region — the figure merely stops
  // there (blocksFurther below). Forbidding the landing as well was our own
  // over-restriction, now lifted so a Companion may end its separation in e.g. Moria,
  // exactly as at the table.
  // What a Companion may NOT do (p.24) is "leave or enter a region containing a
  // friendly Stronghold besieged by an enemy Army" — so a separating Companion cannot
  // drop into an FP Stronghold the Shadow is besieging. Gwaihir / We Prove the Swifter
  // print the exception ("allowed to end in a Stronghold under siege") → `siegeOk`.
  // `from` itself always stands: the rule is "leave or ENTER", and a Companion who
  // separates inside a besieged Minas Tirith simply stays there (he may not leave) —
  // excluding it too would leave that separation with no legal destination at all.
  const landable = (r: RegionId): boolean =>
    r === from || !!opts.siegeOk
    || !(REGIONS[r]!.settlement === 'Stronghold' && state.regions[r]!.besieged && settlementController(state, r) === 'fp');
  // p.24: Companions "can enter or leave a region that contains Shadow units, but
  // MUST STOP upon entering a region containing a Stronghold controlled by the Shadow
  // player." The search used to expand straight through such a region, so a Companion
  // could be sent PAST a Shadow Stronghold to somewhere beyond it (player report:
  // separated to Dimrill Dale through Moria). A Shadow Stronghold is now a hard stop:
  // reachable in itself, never a corridor.
  const blocksFurther = (r: RegionId): boolean =>
    REGIONS[r]!.settlement === 'Stronghold' && settlementController(state, r) === 'shadow' && !state.regions[r]!.besieged;
  const out: RegionId[] = landable(from) ? [from] : [];
  const seen = new Set<RegionId>([from]);
  let layer: RegionId[] = [from], d = 0;
  while (layer.length && d < maxMove) {
    d++; const next: RegionId[] = [];
    for (const r of layer) {
      // ...but only when the move ENTERED it. The rule is "must stop upon ENTERING";
      // starting there is fine ("can enter or LEAVE a region that contains Shadow
      // units"). Blocking the origin too left a Companion separating inside Moria with
      // no legal destination at all — the 40-game soak caught it as a stall.
      if (r !== from && blocksFurther(r)) continue; // movement ended here — expand no further
      for (const a of REGIONS[r]!.adjacency) {
        if (!seen.has(a)) { seen.add(a); next.push(a); if (landable(a)) out.push(a); }
      }
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

/** Separation ON THE MORDOR TRACK. Rulebook p.44: "Companions in the Fellowship can
 *  never be separated… Anything that would normally separate a Companion removes him
 *  from the game instead." The Almanac applies this to the separation Event cards by
 *  name — "I Will Go Alone": "This card may be played on the Mordor Track, but
 *  separating Companions from the Fellowship here simply removes them from play (but
 *  the Corruption healing takes effect)"; Gwaihir likewise ("sometimes done to bring
 *  Gollum into play for his Guide abilities"). The card was refused outright instead
 *  (player report). Not a casualty — no Hunt damage is absorbed and Worn with Sorrow
 *  does not fire. Returns whether the Companion was removed. */
export function removeCompanionOnMordorTrack(state: GameState, id: CharacterId): boolean {
  const fs = state.fellowship;
  if (fs.mordor === null || !fs.companions.includes(id)) return false;
  fs.companions.splice(fs.companions.indexOf(id), 1);
  if (!state.characters.eliminated.includes(id)) state.characters.eliminated.push(id);
  const oldGuide = fs.guide;
  reassignGuide(state);
  log(state, null, 'fellowship', `${COMPANIONS[id]?.name ?? id} leaves the Fellowship on the Mordor Track and is removed from play`
    + (fs.guide !== oldGuide ? ` — ${COMPANIONS[fs.guide]?.name ?? fs.guide} becomes the Guide` : ''));
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
    // A Companion ending movement in a Nation's City/Stronghold ACTIVATES it (rulebook
    // p.34) — it does NOT advance the Political Track. Advancing is a separate explicit
    // action (Boromir/Legolas/Gimli's "use any Action die to advance", i.e. companionMuster).
    const wasPassive = !state.nations[dn].active;
    activateNation(state, dn, { viaCompanion: true });
    if (wasPassive && state.nations[dn].active) {
      const nm = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      notify(state, `${COMPANIONS[id]?.name ?? id} activates the ${nm(dn)}.`);
    }
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
    // Presence ACTIVATES the Nation (p.34); it does not advance the Political Track.
    const wasPassive = !state.nations[dn].active;
    activateNation(state, dn, { viaCompanion: true });
    if (wasPassive && state.nations[dn].active) {
      const nm = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      notify(state, `The Companions activate the ${nm(dn)}.`);
    }
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
    // Re-key the on-map index too — the roster read a stale 'strider' at his old
    // region after the crowning (player report).
    delete state.characters.inPlay['strider'];
    state.characters.inPlay['aragorn'] = r;
    log(state, null, 'muster', `Strider becomes Aragorn at ${r} — Will of the West die (+1 FP die next turn)`);
    // p.35: a Companion capable of activating a Nation activates it when he "ends his
    // movement OR ENTERS PLAY in one of its Cities or Strongholds". Aragorn can only be
    // crowned at Minas Tirith, Dol Amroth or Pelargir, so the Almanac states it flatly:
    // "If Gondor is not activated, it will be activated when Aragorn is brought into
    // play." Strider could not do this, so the crowning was the moment it had to fire —
    // and it never did (player report: "Aragorn does not activate Gondor").
    activateOnCompanionLand(state, 'fp', ['aragorn'], r);
  } else {
    if (!canBringGandalfWhite(state)) return false;
    const grey = findCharacterRegion(state, 'gandalf-grey');
    const target = (dest && gandalfWhiteCandidates(state).includes(dest)) ? dest : gandalfWhiteRegion(state)!;
    if (grey) { const a = state.regions[grey]!.characters; a.splice(a.indexOf('gandalf-grey'), 1); }
    state.regions[target]!.characters.push('gandalf-white');
    state.characters.entered.push('gandalf-white');
    delete state.characters.inPlay['gandalf-grey'];
    state.characters.inPlay['gandalf-white'] = target;
    // Name the die in the text as well as the chip: when the placement is deferred to
    // the `placeGandalf` choice, this line is written in a LATER dispatch that spends
    // no die, so the adapter's die-chip stamping has nothing to attach and the entry
    // showed only its green MUSTER kind tag — read by a player as "FP used a [M] to
    // bring GtW" when a Will of the West die had in fact been spent (p.21).
    log(state, null, 'muster', `Gandalf the White enters at ${target} — Will of the West die (+1 FP die next turn)`);
    activateOnCompanionLand(state, 'fp', ['gandalf-white'], target); // "…or enters play" (p.35) — an Elven Stronghold rouses the Elves
  }
  return true;
}
