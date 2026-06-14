// The Hunt for the Ring (rules-spec §10-11). Hunt damage is now resolved
// INTERACTIVELY: the Free Peoples player chooses to absorb it as Corruption or to
// take a Companion casualty (the Guide, or a random Companion) — a real
// PendingChoice (replaces the D6 auto-resolution). Re-roll conditions (a
// Shadow-controlled Stronghold / Shadow Army / Nazgûl in the Ring-bearers'
// region) are modelled. The Guide's Hunt abilities are applied: Meriadoc/Peregrin
// may separate to reduce damage by 1; Gollum suppresses a numbered tile's Reveal
// and may reveal to reduce damage by 1 — all as `huntDamage` choice options.
// Still deferred: "play on the table" damage-cancel cards (Axe & Bow, Mithril
// Coat — they land with the on-table event-handler increment).
import type { GameState } from './types';
import { STANDARD_TILE_LIST, SPECIAL_TILE_BY_CARD, REGIONS, levelOf, type HuntTileDef } from './data';
import { withRng } from './rng';
import { settlementController, armySide } from './armies';
import { log } from './log';

type TileRef = { std: number } | { spec: string };

/** Draw one tile from the active Hunt Pool — standard tiles (indices) PLUS any
 *  special tiles in the pool (card ids; present only once the Fellowship is on
 *  the Mordor Track). When the combined pool empties, all drawn tiles reshuffle.
 *  Returns the tile and a `ref` so a redraw (Mithril Coat) can return it. */
function drawTile(state: GameState): { tile: HuntTileDef; ref: TileRef } {
  const h = state.hunt;
  if (!h.specialsDrawn) h.specialsDrawn = []; // tolerate pre-field snapshots
  if (h.pool.length + h.specialsInPool.length === 0) {
    h.pool = h.drawn.slice(); h.drawn = [];
    h.specialsInPool = h.specialsDrawn.slice(); h.specialsDrawn = [];
  }
  const n = h.pool.length + h.specialsInPool.length;
  if (n === 0) return { tile: STANDARD_TILE_LIST[0]!, ref: { std: 0 } }; // exhausted safety net
  const pick = withRng(state, (rng) => rng.int(n));
  if (pick < h.pool.length) {
    const idx = h.pool.splice(pick, 1)[0]!;
    h.drawn.push(idx);
    return { tile: STANDARD_TILE_LIST[idx]!, ref: { std: idx } };
  }
  const cardId = h.specialsInPool.splice(pick - h.pool.length, 1)[0]!;
  h.specialsDrawn.push(cardId);
  return { tile: SPECIAL_TILE_BY_CARD[cardId]!, ref: { spec: cardId } };
}

/** Return a just-drawn tile to the active pool (Mithril Coat's "return the first
 *  tile to the Hunt Pool"). */
function returnTileToPool(state: GameState, ref: TileRef): void {
  const h = state.hunt;
  if ('std' in ref) { const i = h.drawn.lastIndexOf(ref.std); if (i >= 0) h.drawn.splice(i, 1); h.pool.push(ref.std); }
  else { const i = h.specialsDrawn.lastIndexOf(ref.spec); if (i >= 0) h.specialsDrawn.splice(i, 1); h.specialsInPool.push(ref.spec); }
}

/** Extra failed-die re-rolls available to the Shadow this Hunt (rules-spec §10):
 *  +1 each for a Shadow-controlled Stronghold, a Shadow Army, and a Nazgûl in the
 *  Ring-bearers' region. */
function huntRerolls(state: GameState): number {
  const loc = state.fellowship.location;
  const r = state.regions[loc]!;
  let rr = 0;
  if (REGIONS[loc]!.settlement === 'Stronghold' && settlementController(state, loc) === 'shadow') rr++;
  if (armySide(state, loc) === 'shadow') rr++;
  if (r.nazgul > 0 || r.characters.includes('witch-king')) rr++;
  return rr;
}

/** Apply a drawn tile. Damage>0 with Companions present sets a PendingChoice;
 *  otherwise applies directly. Reveal is applied with the resolution. */
function applyHuntTile(state: GameState, tile: HuntTileDef, successes: number): void {
  const fs = state.fellowship;
  let damage = 0;
  if (typeof tile.value === 'number') damage = tile.value;
  else if (tile.value === 'eye') damage = successes;
  else if (tile.value === 'die') damage = withRng(state, (rng) => rng.rollDie(6));

  // Gollum's Guide ability (passive): a standard NUMBERED tile's Reveal icon does
  // not reveal the Fellowship.
  const reveal = !!tile.reveal && !(fs.guide === 'gollum' && typeof tile.value === 'number');

  if (damage < 0) { fs.corruption = Math.max(0, fs.corruption + damage); if (reveal) fs.hidden = false; return; }
  if (damage === 0) { if (reveal) fs.hidden = false; return; }

  // Interactive resolution when FP has any choice — a Companion to spend, a Hobbit
  // Guide to separate, or Gollum's reveal-to-reduce — otherwise apply directly.
  if (fs.companions.length > 0 || huntReductionAvailable(state)) {
    state.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal } };
    log(state, null, 'hunt', `Hunt damage ${damage} pending (FP decision)`);
  } else {
    fs.corruption = Math.min(12, fs.corruption + damage);
    if (reveal) fs.hidden = false;
    log(state, null, 'hunt', `Hunt damage ${damage} -> Corruption ${fs.corruption}`);
  }
}

// On-table cards the FP may discard to reduce Hunt damage by 1 (Axe and Bow,
// Horn of Gondor). They reach cards.fp.table via their onTable event handlers.
const ON_TABLE_HUNT_REDUCERS = new Set(['fp-char-06', 'fp-char-07']);
const hasOnTableReducer = (state: GameState): boolean =>
  state.cards.fp.table.some((id) => ON_TABLE_HUNT_REDUCERS.has(id));

/** A damage reduction the FP could use right now: a Hobbit Guide separate,
 *  Gollum reveal-to-reduce, or an on-table reduction card. */
export function huntReductionAvailable(state: GameState): boolean {
  const fs = state.fellowship;
  return fs.guide === 'meriadoc' || fs.guide === 'peregrin'
    || (fs.guide === 'gollum' && fs.hidden) || hasOnTableReducer(state);
}
export const huntReduceCardAvailable = hasOnTableReducer;

// On-table cards that intercept the draw itself: Wizard's Staff (prevent the
// draw, decided BLIND, before the tile) and Mithril Coat (redraw, decided after
// seeing the tile). Both reach cards.fp.table via their onTable handlers.
const WIZARD_STAFF = 'fp-char-08', MITHRIL_COAT = 'fp-char-05';
const hasWizardStaff = (s: GameState) => s.cards.fp.table.includes(WIZARD_STAFF);
const hasMithrilCoat = (s: GameState) => s.cards.fp.table.includes(MITHRIL_COAT);
function discardTableCard(state: GameState, id: string): void {
  const t = state.cards.fp.table; const i = t.indexOf(id);
  if (i >= 0) { t.splice(i, 1); state.cards.fp.discard.character.push(id); }
}

/** Begin the tile draw. Wizard's Staff (if on the table) prompts a BLIND
 *  prevent-the-draw choice first; otherwise draw immediately. */
function beginHuntDraw(state: GameState, successes: number, onMordor: boolean): void {
  if (hasWizardStaff(state)) {
    state.pendingChoice = { owner: 'fp', kind: 'huntPreventDraw', data: { successes, onMordor } };
    return;
  }
  doHuntDraw(state, successes, onMordor);
}
/** Draw a tile; Mithril Coat (if on the table) prompts a redraw choice after the
 *  tile is seen; otherwise apply it. */
function doHuntDraw(state: GameState, successes: number, onMordor: boolean): void {
  const { tile, ref } = drawTile(state);
  if (hasMithrilCoat(state)) {
    state.pendingChoice = { owner: 'fp', kind: 'huntRedraw', data: { tile, ref, successes, onMordor } };
    return;
  }
  applyDrawnTile(state, tile, successes, onMordor);
}
/** Advance the Mordor Track (unless the tile is a Stop) then apply the tile. */
function applyDrawnTile(state: GameState, tile: HuntTileDef, successes: number, onMordor: boolean): void {
  const fs = state.fellowship;
  if (onMordor && fs.mordor !== null && !tile.stop) fs.mordor = Math.min(5, fs.mordor + 1);
  applyHuntTile(state, tile, successes);
}

/** Resolve the BLIND prevent-the-draw choice (Wizard's Staff). */
export function resolveHuntPreventDraw(state: GameState, prevent: boolean): void {
  const d = state.pendingChoice!.data as { successes: number; onMordor: boolean };
  state.pendingChoice = null;
  if (prevent) { discardTableCard(state, WIZARD_STAFF); log(state, null, 'hunt', 'Wizard’s Staff prevents the Hunt tile draw'); return; }
  doHuntDraw(state, d.successes, d.onMordor);
}
/** Resolve the redraw choice (Mithril Coat): redraw (return the first tile, draw
 *  a second, apply it) or keep the first. */
export function resolveHuntRedraw(state: GameState, redraw: boolean): void {
  const d = state.pendingChoice!.data as { tile: HuntTileDef; ref: TileRef; successes: number; onMordor: boolean };
  state.pendingChoice = null;
  if (redraw) {
    discardTableCard(state, MITHRIL_COAT);
    returnTileToPool(state, d.ref);
    const { tile } = drawTile(state);
    log(state, null, 'hunt', 'Mithril Coat and Sting: redrew the Hunt tile');
    applyDrawnTile(state, tile, d.successes, d.onMordor);
  } else {
    applyDrawnTile(state, d.tile, d.successes, d.onMordor);
  }
}
export const huntPreventAvailable = hasWizardStaff;

/** An "extra" Hunt from an Event card (Orc Patrol / Isildur's Bane / Foul Thing):
 *  draw a tile; if it's an Eye or a Free-Peoples special tile, discard it without
 *  effect; otherwise apply it as a successful Hunt (which may prompt FP). */
export function extraHunt(state: GameState): void {
  const { tile, ref } = drawTile(state);
  const isEye = tile.value === 'eye';
  const isFpSpecial = 'spec' in ref && ref.spec.startsWith('fp-');
  if (isEye || isFpSpecial) { log(state, null, 'hunt', 'extra Hunt tile discarded (Eye / FP special)'); return; }
  applyHuntTile(state, tile, Math.min(5, state.hunt.box));
}

/** Resolve a Hunt after the Fellowship moves while NOT on the Mordor Track. */
export function resolveHunt(state: GameState): void {
  const h = state.hunt;
  const level = Math.min(5, h.box);
  const bonus = h.fpDiceInBox;     // dice already in the box (before this move's die)
  h.fpDiceInBox += 1;              // this move's FP die enters the Hunt Box
  if (level <= 0) return;
  const rerolls = huntRerolls(state);
  const successes = withRng(state, (rng) => {
    let hits = 0, failed = 0;
    for (let i = 0; i < level; i++) { const d = rng.rollDie(6); if (d !== 1 && d + bonus >= 6) hits++; else failed++; }
    for (let i = 0; i < Math.min(rerolls, failed); i++) { const d = rng.rollDie(6); if (d !== 1 && d + bonus >= 6) hits++; }
    return hits;
  });
  if (successes >= 1) beginHuntDraw(state, successes, false);
}

/** Resolve a step on the Mordor Track: draw a tile (advancing unless it's a Stop)
 *  and apply it — no Hunt roll. Wizard's Staff / Mithril Coat may intercept. */
export function resolveMordorStep(state: GameState): void {
  const fs = state.fellowship;
  if (fs.mordor === null) return;
  state.hunt.fpDiceInBox += 1; // the FP die still enters the Hunt Box
  beginHuntDraw(state, Math.min(5, state.hunt.box), true);
}

/** After a −1 damage reduction (Hobbit-Guide separate, applied by the adapter; or
 *  Gollum reveal here): re-prompt with the lower damage, or finish if it hit 0. */
function repromptOrFinish(state: GameState, damage: number, reveal: boolean): void {
  const fs = state.fellowship;
  if (damage > 0) {
    state.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal } };
    return;
  }
  if (reveal) fs.hidden = false;
  state.pendingChoice = null;
  log(state, null, 'hunt', `Hunt reduced to 0; hidden ${fs.hidden}`);
}

/** Drop Hunt damage by 1 and re-prompt/finish — called by the adapter after it
 *  separates the Hobbit Guide (separateCompanion lives in fellowship.ts; importing
 *  it here would cycle). The Guide reassigns as part of the separation. */
export function reduceHuntDamageBySeparate(state: GameState): void {
  const d = state.pendingChoice!.data as { damage: number; reveal: boolean };
  repromptOrFinish(state, d.damage - 1, d.reveal);
}

/** Resolve the FP's Hunt-damage choice (PendingChoice 'huntDamage'). */
export function resolveHuntDamage(state: GameState, mode: 'corruption' | 'guide' | 'random' | 'reduceSeparate' | 'reduceReveal' | 'reduceCard'): void {
  const fs = state.fellowship;
  const d = state.pendingChoice!.data as { damage: number; reveal: boolean };

  // Gollum's active ability: reveal the Fellowship to reduce the damage by 1.
  if (mode === 'reduceReveal') {
    fs.hidden = false;
    repromptOrFinish(state, d.damage - 1, false); // already revealed
    return;
  }
  // Discard an on-table reduction card (Axe and Bow / Horn of Gondor) for −1.
  if (mode === 'reduceCard') {
    const i = state.cards.fp.table.findIndex((id) => ON_TABLE_HUNT_REDUCERS.has(id));
    if (i >= 0) {
      const id = state.cards.fp.table.splice(i, 1)[0]!;
      state.cards.fp.discard.character.push(id);
      log(state, null, 'hunt', `discard ${id} to reduce Hunt damage by 1`);
    }
    repromptOrFinish(state, d.damage - 1, d.reveal);
    return;
  }
  // reduceSeparate is handled in the adapter (needs separateCompanion); it calls
  // reduceHuntDamageBySeparate. It should not reach here.

  state.pendingChoice = null;
  let remaining = d.damage;
  if (mode !== 'corruption' && fs.companions.length > 0) {
    const victim = mode === 'guide'
      ? (fs.companions.includes(fs.guide) ? fs.guide : fs.companions[0]!)
      : withRng(state, (rng) => rng.pick(fs.companions));
    const level = eliminateCompanionInline(state, victim);
    remaining = Math.max(0, remaining - level); // excess still becomes Corruption
  }
  if (remaining > 0) fs.corruption = Math.min(12, fs.corruption + remaining);
  if (d.reveal) fs.hidden = false;
  log(state, null, 'hunt', `Hunt resolved (mode ${mode}); corruption ${fs.corruption}, hidden ${fs.hidden}`);
}

// Local copy to avoid a fellowship<->hunt import cycle at module scope.
function eliminateCompanionInline(state: GameState, id: string): number {
  const fs = state.fellowship;
  const i = fs.companions.indexOf(id);
  if (i < 0) return 0;
  fs.companions.splice(i, 1);
  if (!state.characters.eliminated.includes(id)) state.characters.eliminated.push(id);
  // Reassign Guide: highest-Level remaining Companion, else Gollum.
  if (!fs.companions.includes(fs.guide)) {
    fs.guide = fs.companions.length
      ? fs.companions.reduce((b, c) => (levelOf(c) > levelOf(b) ? c : b), fs.companions[0]!)
      : 'gollum';
  }
  return levelOf(id);
}
