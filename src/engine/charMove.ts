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
 *  most once). `chars` = named Companions/Minions already moved (by id); `frozen`
 *  = regions whose Nazgûl already moved this die — their group can't move again
 *  (relay guard; also freezes any Nazgûl that were merged into a moved group, a
 *  consequence of the group-granularity model). */
export interface CharMoveState { chars: string[]; frozen: RegionId[] }

function isExcluded(p: { char: string; from: RegionId }, excl?: CharMoveState): boolean {
  if (!excl) return false;
  return p.char === 'nazgul' ? excl.frozen.includes(p.from) : excl.chars.includes(p.char);
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
export function moveCharacter(state: GameState, side: Side, char: string, from: RegionId, to: RegionId): boolean {
  if (from === to || !REGIONS[to]) return false;
  const range = rangeOf(state, char, from);
  if (range <= 0) return false;
  if (regionDistance(from, to) > range) return false;
  if (!canLand(state, to, side)) return false;
  const src = state.regions[from]!, dst = state.regions[to]!;

  if (char === 'nazgul') {
    if (side !== 'shadow' || src.nazgul <= 0) return false;
    dst.nazgul += src.nazgul; src.nazgul = 0;
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

/** The actor's independent characters and where each sits: 'nazgul' groups (by
 *  region) plus Minion / Companion figures. */
function movablePieces(state: GameState, side: Side, excl?: CharMoveState): Array<{ char: string; from: RegionId }> {
  const out: Array<{ char: string; from: RegionId }> = [];
  for (const id of Object.keys(state.regions)) {
    const r = state.regions[id]!;
    if (side === 'shadow' && r.nazgul > 0) out.push({ char: 'nazgul', from: id });
    for (const c of r.characters) {
      if (rangeOf(state, c, id) <= 0) continue; // Saruman / level-0
      const isShadowChar = c === 'witch-king' || c === 'mouth-of-sauron';
      if ((side === 'shadow' && isShadowChar) || (side === 'fp' && COMPANION_SET.has(c))) out.push({ char: c, from: id });
    }
  }
  return excl ? out.filter((p) => !isExcluded(p, excl)) : out;
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
