// Independent (non-Fellowship) character movement via a Character Action die
// (rules-spec §5): the Shadow moves Nazgûl + Minions, the Free Peoples move
// separated Companions. Nazgûl and the Witch-king fly anywhere; the Mouth of
// Sauron moves ≤3; Saruman never leaves Orthanc; Companions move ≤ their Level.
//
// RAW: one Character die moves ALL of a side's eligible characters, each once, to
// its own destination. Modelled as a sequence — the first `moveCharacter` spends
// the die, then a `charMove2` PendingChoice offers moving another not-yet-moved
// figure (or done). `CharMoveState` tracks what has already moved this die so each
// figure moves at most once (relay guard). The one residual simplification is the
// engine's group-granularity (a region's Nazgûl move as a group, not figure by
// figure); see docs/rules-spec.md §5.
import type { GameState, RegionId, Side } from './types';
import { REGIONS, levelOf } from './data';
import { settlementController, armySide } from './armies';

const FLY = 99;

/** What has already moved on the current Character die (so each figure moves at
 *  most once). `chars` = named Companions/Minions already moved (by id);
 *  `movedNazgul` = per-region count of Nazgûl in that region that have ALREADY
 *  moved this die (so the unmoved remainder of a stack can still move, but a moved
 *  Nazgûl can't relay onward). */
export interface CharMoveState { chars: string[]; movedNazgul: Record<RegionId, number> }

/** Nazgûl in `from` still free to move this die (total minus already-moved). */
export function availableNazgul(state: GameState, from: RegionId, excl?: CharMoveState): number {
  return (state.regions[from]?.nazgul ?? 0) - (excl?.movedNazgul[from] ?? 0);
}
const COMPANION_SET = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin', 'aragorn', 'gandalf-white']);
const enemyOf = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

/** Region-step distance from→to (BFS over adjacency), or Infinity if unreachable. */
function regionDistance(from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let layer = [from], d = 0;
  while (layer.length) {
    d++;
    const next: RegionId[] = [];
    for (const r of layer) for (const adj of REGIONS[r]?.adjacency ?? []) {
      if (adj === to) return d;
      if (!seen.has(adj)) { seen.add(adj); next.push(adj); }
    }
    layer = next;
  }
  return Infinity;
}

/** A character/Nazgûl of `side` may not land in an enemy-controlled Stronghold
 *  unless it's under siege by that side (a besieged Stronghold is enterable). */
function canLand(state: GameState, to: RegionId, side: Side): boolean {
  const def = REGIONS[to]!;
  if (def.settlement === 'Stronghold' && settlementController(state, to) === enemyOf(side) && !state.regions[to]!.besieged) return false;
  return true;
}

const HOBBITS = new Set(['meriadoc', 'peregrin']);
/** The movement range of a piece: Nazgûl/Witch-king fly; Saruman 0; others by Level.
 *  Gandalf the White's Shadowfax: Level 4 when alone or with a single Hobbit. */
function rangeOf(state: GameState, char: string, from: RegionId): number {
  if (char === 'nazgul' || char === 'witch-king') return FLY;
  if (char === 'saruman') return 0;
  if (char === 'gandalf-white') {
    const others = state.regions[from]!.characters.filter((c) => c !== 'gandalf-white' && COMPANION_SET.has(c));
    const aloneOrOneHobbit = others.length === 0 || (others.length === 1 && HOBBITS.has(others[0]!));
    return aloneOrOneHobbit ? 4 : levelOf('gandalf-white');
  }
  return levelOf(char); // mouth-of-sauron = 3, companions = their Level
}

/** Execute a character move. `char` is 'nazgul' (a region's Nazgûl group), a
 *  Minion id, or a separated Companion id. Returns false if illegal. */
export function moveCharacter(state: GameState, side: Side, char: string, from: RegionId, to: RegionId, count?: number): boolean {
  if (from === to || !REGIONS[to]) return false;
  const range = rangeOf(state, char, from);
  if (range <= 0) return false;
  if (regionDistance(from, to) > range) return false;
  if (!canLand(state, to, side)) return false;
  const src = state.regions[from]!, dst = state.regions[to]!;

  if (char === 'nazgul') {
    if (side !== 'shadow' || src.nazgul <= 0) return false;
    // RAW: move any number of Nazgûl from the stack (default = all). The caller
    // caps `count` to the unmoved remainder so a moved Nazgûl can't relay onward.
    const n = count === undefined ? src.nazgul : Math.min(Math.max(0, Math.floor(count)), src.nazgul);
    if (n <= 0) return false;
    dst.nazgul += n; src.nazgul -= n;
    return true;
  }
  // A character figure (Minion or Companion): verify it belongs to this side and
  // is actually in `from`.
  const ownsChar = side === 'shadow' ? (char === 'witch-king' || char === 'mouth-of-sauron') : COMPANION_SET.has(char);
  const i = src.characters.indexOf(char);
  if (!ownsChar || i < 0) return false;
  src.characters.splice(i, 1);
  dst.characters.push(char);
  if (state.characters.inPlay[char]) state.characters.inPlay[char] = to;
  return true;
}

/** Move a GROUP of separated Companions together to one destination. RAW p.24: "a
 *  group of Companions in the same region can be moved to a common destination at a
 *  distance equal to or less than the highest Level in the group" — so a Level-1
 *  Hobbit travels with a Level-4 Gandalf. Returns false if illegal. */
export function moveCompanionGroup(state: GameState, side: Side, from: RegionId, to: RegionId, chars: string[]): boolean {
  if (side !== 'fp' || from === to || !REGIONS[to] || chars.length === 0) return false;
  const src = state.regions[from]!;
  let range = 0;
  for (const c of chars) {
    if (!COMPANION_SET.has(c) || !src.characters.includes(c)) return false;
    range = Math.max(range, rangeOf(state, c, from));
  }
  if (range <= 0 || regionDistance(from, to) > range) return false;
  if (!canLand(state, to, side)) return false;
  const dst = state.regions[to]!;
  for (const c of chars) {
    src.characters.splice(src.characters.indexOf(c), 1);
    dst.characters.push(c);
    if (state.characters.inPlay[c]) state.characters.inPlay[c] = to;
  }
  return true;
}

/** The actor's independent characters and where each sits: 'nazgul' groups (by
 *  region) plus Minion / Companion figures. */
function movablePieces(state: GameState, side: Side, excl?: CharMoveState): Array<{ char: string; from: RegionId }> {
  const out: Array<{ char: string; from: RegionId }> = [];
  for (const id of Object.keys(state.regions)) {
    const r = state.regions[id]!;
    if (side === 'shadow' && availableNazgul(state, id, excl) > 0) out.push({ char: 'nazgul', from: id });
    for (const c of r.characters) {
      if (rangeOf(state, c, id) <= 0) continue; // Saruman / level-0
      if (excl?.chars.includes(c)) continue;    // already moved this die
      const isShadowChar = c === 'witch-king' || c === 'mouth-of-sauron';
      if ((side === 'shadow' && isShadowChar) || (side === 'fp' && COMPANION_SET.has(c))) out.push({ char: c, from: id });
    }
  }
  return out;
}

/** The actor's movable independent characters sitting in `from` ('nazgul' for a
 *  Nazgûl group, plus any Minion/Companion figures that can still move). For the
 *  board UI's click-to-move. */
export function movableCharsAt(state: GameState, side: Side, from: RegionId, excl?: CharMoveState): string[] {
  return movablePieces(state, side, excl).filter((p) => p.from === from).map((p) => p.char);
}

/** Any eligible character still has a legal move (used to decide whether to keep
 *  prompting the Character-die move chain or end the turn). */
export function remainingCharMoves(state: GameState, side: Side, excl?: CharMoveState): boolean {
  return movablePieces(state, side, excl).some((p) => characterDestinations(state, side, p.char, p.from).length > 0);
}

/** Every legal destination region for `char` moving from `from` — the full set
 *  (unlike characterMoveOptions, which caps a curated subset for the AI). For the
 *  board UI: highlight these when the player picks a character to move. */
export function characterDestinations(state: GameState, side: Side, char: string, from: RegionId): RegionId[] {
  const range = rangeOf(state, char, from);
  if (range <= 0) return [];
  const out: RegionId[] = [];
  for (const to of Object.keys(state.regions)) {
    if (to === from) continue;
    if (regionDistance(from, to) <= range && canLand(state, to, side)) out.push(to);
  }
  return out;
}

/** Representative legal character moves for the Character die (a subset, like the
 *  army enumerator): each movable piece toward a small set of useful targets —
 *  the Fellowship's region (Nazgûl hunt there) and the actor's army regions. */
export function characterMoveOptions(state: GameState, side: Side, cap = 18, excl?: CharMoveState): Array<{ char: string; from: RegionId; to: RegionId }> {
  const pieces = movablePieces(state, side, excl);
  if (!pieces.length) return [];
  // Restricted target set for FAR-RANGING pieces (Nazgûl/Witch-king/Minion) — toward
  // the Fellowship or a friendly Army — keeps that (large) action space bounded.
  const restricted = new Set<RegionId>([state.fellowship.location]);
  for (const id of Object.keys(state.regions)) {
    if (restricted.size >= 6) break;
    if (armySide(state, id) === side) restricted.add(id);
  }
  const isCompanion = (c: string): boolean => side === 'fp' && COMPANION_SET.has(c);
  const allRegions = Object.keys(state.regions);
  const out: Array<{ char: string; from: RegionId; to: RegionId }> = [];
  for (const p of pieces) {
    const range = rangeOf(state, p.char, p.from);
    // A separated Companion (small Level range) may move to ANY region in range (RAW);
    // Nazgûl/Minions (fly / range ≤3 but many destinations) use the restricted set.
    const candidates: Iterable<RegionId> = isCompanion(p.char) ? allRegions : restricted;
    for (const to of candidates) {
      if (out.length >= cap) return out;
      if (to === p.from) continue;
      if (regionDistance(p.from, to) <= range && canLand(state, to, side)) out.push({ char: p.char, from: p.from, to });
    }
  }
  return out;
}
