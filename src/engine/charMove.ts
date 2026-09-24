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
import type { GameState, RegionId, Side, Nation } from './types';
import { FP_NATIONS } from './types';
import { REGIONS, levelOf, COMPANIONS } from './data';
import { settlementController, armySide, unitCount, figureForce, activateOnCompanionLand } from './armies';
import { activateNation } from './politics';
import { log } from './log';

const FLY = 99;

/** What has already moved on the current Character die (so each figure moves at
 *  most once). `chars` = named Companions/Minions already moved (by id);
 *  `movedNazgul` = per-region count of Nazgûl in that region that have ALREADY
 *  moved this die (so the unmoved remainder of a stack can still move, but a moved
 *  Nazgûl can't relay onward). */
export interface CharMoveState { chars: string[]; movedNazgul: Record<RegionId, number> }

/** Nazgûl in `from` still free to move this die (total minus already-moved). */
export function availableNazgul(state: GameState, from: RegionId, excl?: CharMoveState): number {
  if (!state.regions[from]) return 0;
  // Nazgûl garrisoning a besieged Shadow Stronghold sit in the siege box, and they may
  // still fly out (p.25: the FP-Stronghold rule is "the only restriction" on Nazgûl
  // flight). Reading the open field alone showed zero and grounded them — player report
  // "Nazgul should be able to move from friendly Strongholds under siege".
  return figureForce(state, from, 'shadow').nazgul - (excl?.movedNazgul[from] ?? 0);
}
const COMPANION_SET = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin', 'aragorn', 'gandalf-white']);
const enemyOf = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

/** Region-step distance from→to (BFS over adjacency), or Infinity if unreachable.
 *  `stops` marks regions a WALKING figure may enter but not leave — p.24: a Companion
 *  "must stop upon entering a region containing a Stronghold controlled by the Shadow
 *  player". The engine had this exactly backwards for Character-die moves: plain BFS
 *  let a Companion path THROUGH Moria while canLand forbade LANDING there; RAW allows
 *  the landing and forbids the pass-through. (Fliers pass `stops = null`.) */
function regionDistance(from: RegionId, to: RegionId, stops: ((r: RegionId) => boolean) | null = null): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let layer = [from], d = 0;
  while (layer.length) {
    d++;
    const next: RegionId[] = [];
    for (const r of layer) {
      if (stops && r !== from && stops(r)) continue; // entered a stop-region earlier: go no further
      for (const adj of REGIONS[r]?.adjacency ?? []) {
        if (adj === to) return d;
        if (!seen.has(adj)) { seen.add(adj); next.push(adj); }
      }
    }
    layer = next;
  }
  return Infinity;
}
/** Every region within `range` steps of `from`, as region -> distance, in ONE BFS.
 *  Same rules as `regionDistance` (which stays for single-pair checks): `stops` marks
 *  regions a WALKING figure may enter but not leave, so a stop region gets a distance
 *  but is never expanded through. A region absent from the map is simply out of range.
 *
 *  The enumerators below used to call `regionDistance` once PER CANDIDATE DESTINATION —
 *  ~100 separate breadth-first searches per piece — which is why they leaned on an
 *  early-exit cap to stay affordable. One pass makes the full set cheap, so the cap no
 *  longer has to double as a performance guard.
 *
 *  MUST agree with `regionDistance`: one decides what is OFFERED, the other what is
 *  ACCEPTED, and a disagreement is an offered-then-refused move. Pinned by
 *  `scripts/probe-char-move-enumeration.mjs`. */
function reachableWithin(from: RegionId, range: number, stops: ((r: RegionId) => boolean) | null): Map<RegionId, number> {
  const dist = new Map<RegionId, number>([[from, 0]]);
  let layer: RegionId[] = [from];
  for (let d = 1; d <= range && layer.length; d++) {
    const next: RegionId[] = [];
    for (const r of layer) {
      if (stops && r !== from && stops(r)) continue; // entered a stop-region: go no further
      for (const adj of REGIONS[r]?.adjacency ?? []) {
        if (!dist.has(adj)) { dist.set(adj, d); next.push(adj); }
      }
    }
    layer = next;
  }
  return dist;
}

/** The p.24 hard stop for walking Companions: a Shadow-controlled Stronghold region —
 *  besieged or not. A Free Peoples siege leaves the Stronghold in Shadow hands, and
 *  neither p.24 ("must stop upon entering a region containing a Stronghold controlled
 *  by the Shadow player") nor the Almanac makes an exception for it; the old
 *  "unbesieged" clause let Companions walk straight through a besieged Minas Morgul
 *  (player report 3i1b184d0s0k093u). Nazgûl/Minions never use it (they may not enter
 *  FP Strongholds at all — the canLand rule — and Nazgûl fly besides). */
function companionStop(state: GameState) {
  return (r: RegionId): boolean =>
    REGIONS[r]!.settlement === 'Stronghold' && settlementController(state, r) === 'shadow';
}

/** p.24/p.25: a region holding a figure's OWN Stronghold while an enemy Army besieges
 *  it is sealed — "they can never leave or enter a region containing a friendly
 *  Stronghold besieged by an enemy Army". In this engine the garrison (and its
 *  Characters) live in the siege box, so LEAVING is already impossible; this is the
 *  ENTER half. Nazgûl are the one exemption: p.25 says the FP-Stronghold rule below is
 *  "the only restriction" on their flight. */
function friendlyStrongholdBesieged(state: GameState, to: RegionId, side: Side): boolean {
  return REGIONS[to]!.settlement === 'Stronghold'
    && !!state.regions[to]!.besieged
    && settlementController(state, to) === side;
}
const NAZGUL_FIGURE = new Set(['nazgul', 'witch-king']);

/** Whether a figure may END a move in `to`. The two sides' Stronghold rules differ
 *  (p.24) and were wrongly shared: a SHADOW figure may not enter an FP-controlled
 *  Stronghold unless besieged — a genuine prohibition — while an FP Companion MAY
 *  enter a Shadow Stronghold region; it merely must STOP there (handled by the
 *  distance search), so landing is legal.
 *  Both sides, though, are sealed OUT of their own besieged Stronghold (p.24/p.25) —
 *  Gwaihir / We Prove the Swifter print the exception ("allowed to end in a Stronghold
 *  under siege"), which arrives as `opts.siegeOk`. */
/** The LEAVE half of the p.24/p.25 seal: a Companion (and, p.25, the Mouth of Sauron)
 *  "can never leave or enter a region containing a friendly Stronghold besieged by an
 *  enemy Army". Nazgûl and the Witch-king fly out freely (p.25 makes the FP-Stronghold
 *  rule the only restriction on their flight).
 *
 *  This used to need no code: a boxed figure was simply invisible to the enumerators,
 *  so it could not be picked in the first place. That accident also grounded the Nazgûl
 *  who ARE allowed out and hid boxed Companions from every menu, so `figureForce` now
 *  makes boxed figures visible — and the rule has to be stated outright instead. */
function canLeave(state: GameState, from: RegionId, side: Side, char?: string): boolean {
  if (char && NAZGUL_FIGURE.has(char)) return true;
  return !friendlyStrongholdBesieged(state, from, side);
}

function canLand(state: GameState, to: RegionId, side: Side, char?: string, opts: RangeOpts = {}): boolean {
  const nazgul = !!char && NAZGUL_FIGURE.has(char);
  if (!nazgul && !opts.siegeOk && friendlyStrongholdBesieged(state, to, side)) return false;
  if (side === 'fp') return true; // Companions land anywhere they can reach; the stop rule limits reach, not landing
  const def = REGIONS[to]!;
  if (def.settlement === 'Stronghold' && settlementController(state, to) === enemyOf(side) && !state.regions[to]!.besieged) return false;
  return true;
}

// activateOnCompanionLand lives in armies.ts (Army moves need it too); re-exported here.
export { activateOnCompanionLand } from './armies';

const HOBBITS = new Set(['meriadoc', 'peregrin']);
/** Range modifiers granted by an Event card ("as if their Level were 4", "two extra
 *  regions"). Only ever applied to Companions — a card that boosts a walking figure
 *  never boosts a flier. */
export interface RangeOpts { extraMove?: number; levelOverride?: number;
  /** Gwaihir / We Prove the Swifter: "allowed to end in a Stronghold under siege". */
  siegeOk?: boolean;
  /** The Companions travelling TOGETHER on this move. Only Shadowfax reads it (see
   *  rangeOf); defaults to the moving figure on its own. */
  group?: readonly string[] }
/** The movement range of a piece: Nazgûl/Witch-king fly; Saruman 0; others by Level.
 *  Gandalf the White's Shadowfax: Level 4 when alone or with a single Hobbit. */
function rangeOf(state: GameState, char: string, from: RegionId, opts: RangeOpts = {}): number {
  if (char === 'nazgul' || char === 'witch-king') return FLY;
  if (char === 'saruman') return 0;
  const bonus = opts.extraMove ?? 0;
  if (opts.levelOverride !== undefined) return opts.levelOverride + bonus;
  if (char === 'gandalf-white') {
    // Shadowfax reads the company he keeps ON THE ROAD ("if he is alone or accompanied
    // by only one Hobbit"), not the company he leaves behind. This used to read every
    // Companion standing in the origin region, so Gandalf could not ride out four
    // regions while Boromir & co. stayed put (player report 0s3m315p1k6m6d3u).
    const others = (opts.group ?? [char]).filter((c) => c !== 'gandalf-white' && COMPANION_SET.has(c));
    const aloneOrOneHobbit = others.length === 0 || (others.length === 1 && HOBBITS.has(others[0]!));
    return (aloneOrOneHobbit ? 4 : levelOf('gandalf-white')) + bonus;
  }
  return levelOf(char) + bonus; // mouth-of-sauron = 3, companions = their Level
}

/** Execute a character move. `char` is 'nazgul' (a region's Nazgûl group), a
 *  Minion id, or a separated Companion id. Returns false if illegal. */
export function moveCharacter(state: GameState, side: Side, char: string, from: RegionId, to: RegionId, count?: number): boolean {
  if (from === to || !REGIONS[to]) return false;
  const range = rangeOf(state, char, from);
  if (range <= 0) return false;
  const stops = side === 'fp' ? companionStop(state) : null; // walking Companions stop at Shadow Strongholds (p.24)
  if (regionDistance(from, to, stops) > range) return false;
  if (!canLeave(state, from, side, char)) return false;
  if (!canLand(state, to, side, char)) return false;
  // Both ends go through `figureForce`: a figure garrisoning a besieged friendly
  // Stronghold is in its siege box, and a figure ARRIVING in a region whose friendly
  // Stronghold is besieged joins that garrison — never the besieger holding the field.
  const src = figureForce(state, from, side), dst = figureForce(state, to, side);

  if (char === 'nazgul') {
    if (side !== 'shadow' || src.nazgul <= 0) return false;
    // RAW: move any number of Nazgûl from the stack (default = all). The caller
    // caps `count` to the unmoved remainder so a moved Nazgûl can't relay onward.
    const n = count === undefined ? src.nazgul : Math.min(Math.max(0, Math.floor(count)), src.nazgul);
    if (n <= 0) return false;
    dst.nazgul += n; src.nazgul -= n;
    log(state, null, 'army', `Moved ${n} Nazgûl ${from} -> ${to}`);
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
  activateOnCompanionLand(state, side, [char], to); // ends movement in a City/Stronghold?
  log(state, null, 'army', `Moved ${char} ${from} -> ${to}`);
  return true;
}

/** Move a GROUP of separated Companions together to one destination. RAW p.24: "a
 *  group of Companions in the same region can be moved to a common destination at a
 *  distance equal to or less than the highest Level in the group" — so a Level-1
 *  Hobbit travels with a Level-4 Gandalf. Returns false if illegal. */
export function moveCompanionGroup(state: GameState, side: Side, from: RegionId, to: RegionId, chars: string[], opts: RangeOpts = {}): boolean {
  if (side !== 'fp' || from === to || !REGIONS[to] || chars.length === 0) return false;
  const src = figureForce(state, from, side);
  let range = 0;
  for (const c of chars) {
    if (!COMPANION_SET.has(c) || !src.characters.includes(c)) return false;
    range = Math.max(range, rangeOf(state, c, from, { ...opts, group: chars }));
  }
  // Companion GROUPS walk too: the p.24 Shadow-Stronghold stop applies (side is
  // always 'fp' here — the guard above rejects anything else).
  if (range <= 0 || regionDistance(from, to, companionStop(state)) > range) return false;
  if (!canLeave(state, from, side, chars[0])) return false;
  if (!canLand(state, to, side, chars[0], opts)) return false;
  // Gwaihir / We Prove the Swifter (`opts.siegeOk`) are exactly the cards that land
  // Companions in a friendly besieged Stronghold: they belong with the garrison inside,
  // not in the open field the besieging Shadow Army holds (player report).
  const dst = figureForce(state, to, side);
  for (const c of chars) {
    src.characters.splice(src.characters.indexOf(c), 1);
    dst.characters.push(c);
    if (state.characters.inPlay[c]) state.characters.inPlay[c] = to;
  }
  activateOnCompanionLand(state, side, chars, to); // group ends movement in a City/Stronghold?
  log(state, null, 'army', `Moved ${chars.join(', ')} ${from} -> ${to}`);
  return true;
}

/** The actor's independent characters and where each sits: 'nazgul' groups (by
 *  region) plus Minion / Companion figures. */
function movablePieces(state: GameState, side: Side, excl?: CharMoveState): Array<{ char: string; from: RegionId }> {
  const out: Array<{ char: string; from: RegionId }> = [];
  for (const id of Object.keys(state.regions)) {
    if (side === 'shadow' && availableNazgul(state, id, excl) > 0) out.push({ char: 'nazgul', from: id });
    // The actor's figures may be boxed in a besieged friendly Stronghold; `figureForce`
    // picks the side of the region they actually stand on. Reading `r.characters` alone
    // made a boxed Companion vanish from every move/attack menu the moment the siege
    // began (player report: "my Companions in Moria … disappeared").
    const r = figureForce(state, id, side);
    for (const c of r.characters) {
      if (rangeOf(state, c, id) <= 0) continue; // Saruman / level-0
      if (excl?.chars.includes(c)) continue;    // already moved this die
      // Sealed inside his own besieged Stronghold (p.24/p.25) — he is on the board and
      // drawn there, he simply has no legal move, so he must not be OFFERED one. The
      // modal used to list him and light up destinations, then the engine refused the
      // move (player report 1a3800000w2k534x, Gandalf boxed in Moria).
      if (!canLeave(state, id, side, c)) continue;
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
export function characterDestinations(state: GameState, side: Side, char: string, from: RegionId, opts: RangeOpts = {}): RegionId[] {
  const range = rangeOf(state, char, from, opts);
  if (range <= 0) return [];
  // MUST agree with moveCharacter/moveCompanionGroup — one decides what is OFFERED,
  // the other what is ACCEPTED (player report: the modal highlighted regions for a
  // Gandalf boxed in Moria, then the engine silently refused the move).
  if (!canLeave(state, from, side, char)) return [];
  const stops = side === 'fp' ? companionStop(state) : null;
  const within = reachableWithin(from, range, stops);
  const out: RegionId[] = [];
  for (const to of Object.keys(state.regions)) {
    if (to === from) continue;
    if (within.has(to) && canLand(state, to, side, char, opts)) out.push(to);
  }
  return out;
}

/** Bounded target set for FAR-RANGING pieces (Nazgûl fly the whole map; the Witch-king
 *  and the Mouth have long legs): the Fellowship's region, then the actor's OWN Army
 *  regions, BIGGEST ARMY FIRST. A flier's true destination set is the entire board, and
 *  the AI's action space has to stay finite, so this list is capped — but which armies
 *  make the cut is now decided by size rather than by whatever order
 *  `Object.keys(state.regions)` happens to return. With 6+ of the actor's own army
 *  regions the old order silently dropped some of them, so whether a Nazgûl could be
 *  sent to join a given army came down to region-id ordering. */
function farTargets(state: GameState, side: Side, max = 6): Set<RegionId> {
  const out = new Set<RegionId>([state.fellowship.location]);
  const mine = Object.keys(state.regions)
    .filter((id) => armySide(state, id) === side)
    // Biggest army first; region id breaks ties so the set is deterministic.
    .sort((a, b) => unitCount(state, b) - unitCount(state, a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const id of mine) {
    if (out.size >= max) break;
    out.add(id);
  }
  return out;
}

/** Representative legal character moves for the Character die — a bounded SUBSET,
 *  like the army enumerator. Each movable piece is offered moves toward a small set of
 *  useful targets (the Fellowship's region, the actor's own Army regions); separated
 *  Companions, whose range is their Level, are offered every region they can reach.
 *
 *  The cap is spread FAIRLY across the pieces. It used to fill one flat array and
 *  `return` the instant it hit `cap`, so the whole budget went to whichever pieces came
 *  first in region-key order and the pieces at the back were offered NOTHING — a figure
 *  with legal moves simply had none in `legalActions`, which for the AI means a piece it
 *  can never move. A reported Nazgûl position sat on exactly 18 options with the cap at
 *  18: one more friendly Army region and the Nazgûl in North Anduin Vale would have
 *  dropped off the list entirely. Now every piece contributes its first destination
 *  before any piece contributes its second (round-robin), so the cap trims the TAIL of
 *  each piece's list instead of erasing whole pieces, and the budget can never fall
 *  below one option per piece. `scripts/probe-char-move-enumeration.mjs`. */
export function characterMoveOptions(state: GameState, side: Side, cap = 18, excl?: CharMoveState): Array<{ char: string; from: RegionId; to: RegionId }> {
  const pieces = movablePieces(state, side, excl);
  if (!pieces.length) return [];
  const restricted = farTargets(state, side);
  const isCompanion = (c: string): boolean => side === 'fp' && COMPANION_SET.has(c);
  const allRegions = Object.keys(state.regions);
  // Each piece's own destination list, built in full first (one BFS per piece — see
  // reachableWithin) so the budget below can be shared out instead of raced for.
  const perPiece = pieces.map((p) => {
    const range = rangeOf(state, p.char, p.from);
    // A separated Companion (small Level range) may move to ANY region in range (RAW);
    // Nazgûl/Minions (fly / range <= 3 but many destinations) use the restricted set.
    const candidates: Iterable<RegionId> = isCompanion(p.char) ? allRegions : restricted;
    // Same stop-aware distance the APPLY path uses (moveCharacter), or this offers
    // walks through Moria/Morannon that the engine then refuses — the soak caught
    // exactly that (offer/apply disagreement) the moment the stop rule was added.
    const stops = isCompanion(p.char) ? companionStop(state) : null;
    const within = range > 0 ? reachableWithin(p.from, range, stops) : null;
    const tos: RegionId[] = [];
    if (within) {
      for (const to of candidates) {
        if (to === p.from) continue;
        if (within.has(to) && canLand(state, to, side, p.char)) tos.push(to);
      }
    }
    return { piece: p, tos };
  });
  // Never budget below one option per piece: a piece with a legal move must always have
  // one offered, even when there are more pieces than the nominal cap.
  const budget = Math.max(cap, perPiece.length);
  const out: Array<{ char: string; from: RegionId; to: RegionId }> = [];
  const deepest = perPiece.reduce((m, e) => Math.max(m, e.tos.length), 0);
  for (let i = 0; i < deepest && out.length < budget; i++) {
    for (const { piece, tos } of perPiece) {
      if (i >= tos.length) continue;
      out.push({ char: piece.char, from: piece.from, to: tos[i]! });
      if (out.length >= budget) break;
    }
  }
  return out;
}
