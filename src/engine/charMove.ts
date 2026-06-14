// Independent (non-Fellowship) character movement via a Character Action die
// (rules-spec §5): the Shadow moves Nazgûl + Minions, the Free Peoples move
// separated Companions. Nazgûl and the Witch-king fly anywhere; the Mouth of
// Sauron moves ≤3; Saruman never leaves Orthanc; Companions move ≤ their Level.
//
// DEVIATION: the rulebook lets ONE Character die move ALL of a side's eligible
// characters (each to its own destination). We model one die as moving ONE
// piece/Nazgûl-group to one destination — controllable and avoids the "move all"
// action-space blowup. Documented in docs/rules-spec.md §5.
import type { GameState, RegionId, Side } from './types';
import { REGIONS, levelOf } from './data';
import { settlementController, armySide } from './armies';

const FLY = 99;
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

/** The movement range of a piece: Nazgûl/Witch-king fly; Saruman 0; others by Level. */
function rangeOf(char: string): number {
  if (char === 'nazgul' || char === 'witch-king') return FLY;
  if (char === 'saruman') return 0;
  return levelOf(char); // mouth-of-sauron = 3, companions = their Level
}

/** Execute a character move. `char` is 'nazgul' (a region's Nazgûl group), a
 *  Minion id, or a separated Companion id. Returns false if illegal. */
export function moveCharacter(state: GameState, side: Side, char: string, from: RegionId, to: RegionId): boolean {
  if (from === to || !REGIONS[to]) return false;
  const range = rangeOf(char);
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
function movablePieces(state: GameState, side: Side): Array<{ char: string; from: RegionId }> {
  const out: Array<{ char: string; from: RegionId }> = [];
  for (const id of Object.keys(state.regions)) {
    const r = state.regions[id]!;
    if (side === 'shadow' && r.nazgul > 0) out.push({ char: 'nazgul', from: id });
    for (const c of r.characters) {
      if (rangeOf(c) <= 0) continue; // Saruman / level-0
      const isShadowChar = c === 'witch-king' || c === 'mouth-of-sauron';
      if ((side === 'shadow' && isShadowChar) || (side === 'fp' && COMPANION_SET.has(c))) out.push({ char: c, from: id });
    }
  }
  return out;
}

/** Representative legal character moves for the Character die (a subset, like the
 *  army enumerator): each movable piece toward a small set of useful targets —
 *  the Fellowship's region (Nazgûl hunt there) and the actor's army regions. */
export function characterMoveOptions(state: GameState, side: Side, cap = 12): Array<{ char: string; from: RegionId; to: RegionId }> {
  const pieces = movablePieces(state, side);
  if (!pieces.length) return [];
  const targets = new Set<RegionId>();
  targets.add(state.fellowship.location);
  for (const id of Object.keys(state.regions)) {
    if (targets.size >= 5) break;
    if (armySide(state, id) === side) targets.add(id);
  }
  const out: Array<{ char: string; from: RegionId; to: RegionId }> = [];
  for (const p of pieces) {
    for (const to of targets) {
      if (out.length >= cap) return out;
      if (to === p.from) continue;
      if (regionDistance(p.from, to) <= rangeOf(p.char) && canLand(state, to, side)) out.push({ char: p.char, from: p.from, to });
    }
  }
  return out;
}
