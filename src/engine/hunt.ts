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
import { STANDARD_TILE_LIST, SPECIAL_TILE_BY_CARD, REGIONS, levelOf, characterDef, EVENT_BY_ID, type HuntTileDef } from './data';
import { fellowshipDieSkipsHuntBox, wornWithSorrowActive } from './persistent';
import { withRng } from './rng';
import { settlementController, armySide } from './armies';
import { log, notify } from './log';

/** Begin revealing the Fellowship (rulebook p.39): if it has Progress to spend, pause
 *  for the FP to choose where the figure moves (the `revealMove` choice — the move,
 *  Progress reset, Revealed flip, and the per-Shadow-Stronghold extra Hunt tiles are
 *  applied when it resolves, in the adapter). With no Progress there's nothing to
 *  move, so it just flips to Revealed. */
export function beginReveal(state: GameState): void {
  const fs = state.fellowship;
  if (fs.hidden && fs.progress > 0 && fs.mordor === null) {
    state.pendingChoice = { owner: 'fp', kind: 'revealMove' };
  } else {
    fs.hidden = false; fs.progress = 0;
  }
}

/** PendingChoice kinds that are steps of a Hunt still being resolved — the tile is
 *  drawn but its damage/reveal has not landed yet. Nothing may read the Fellowship's
 *  final state (Corruption, victory) until these clear, and the UI's Hunt result
 *  popup stays down while one is up (the DecisionModal is showing the same Hunt). */
export const HUNT_RESOLUTION_CHOICES: ReadonlySet<string> = new Set(['huntDamage', 'huntPreventDraw', 'huntRedraw', 'crebain']);
/** True while a Hunt is mid-resolution (see HUNT_RESOLUTION_CHOICES). */
export const huntResolutionPending = (state: GameState): boolean =>
  !!state.pendingChoice && HUNT_RESOLUTION_CHOICES.has(state.pendingChoice.kind);

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

/** Which Hunt re-roll modifiers apply in the Ring-bearers' region (rules-spec §10):
 *  one re-roll of a failed Hunt die for EACH of a Shadow-controlled Stronghold, a
 *  Shadow Army, and a Nazgûl/Witch-king there. Exported so the UI's Hunt info
 *  dialog can list them (shown concretely only while the Fellowship is revealed —
 *  its location is hidden otherwise). */
export function huntRerollSources(state: GameState): { stronghold: boolean; army: boolean; nazgul: boolean } {
  const loc = state.fellowship.location;
  const r = state.regions[loc]!;
  return {
    stronghold: REGIONS[loc]!.settlement === 'Stronghold' && settlementController(state, loc) === 'shadow',
    army: armySide(state, loc) === 'shadow',
    nazgul: r.nazgul > 0 || r.characters.includes('witch-king'),
  };
}
/** Extra failed-die re-rolls available to the Shadow this Hunt. */
function huntRerolls(state: GameState): number {
  const s = huntRerollSources(state);
  return (s.stronghold ? 1 : 0) + (s.army ? 1 : 0) + (s.nazgul ? 1 : 0);
}

/** Apply a drawn tile. Damage>0 with Companions present sets a PendingChoice;
 *  otherwise applies directly. Reveal is applied with the resolution. `opts.source`
 *  names the Event card that caused a no-roll draw (shown in the FP's damage prompt);
 *  `opts.noReduce` bars the damage-reduction options (Isildur's Bane). */
export type HuntOpts = { noReduce?: boolean; forceRandomCasualty?: boolean; source?: string };
function applyHuntTile(state: GameState, tile: HuntTileDef, successes: number, opts: HuntOpts = {}): void {
  const fs = state.fellowship;
  let damage = 0;
  if (typeof tile.value === 'number') damage = tile.value;
  else if (tile.value === 'eye') damage = successes;
  else if (tile.value === 'die') damage = withRng(state, (rng) => rng.rollDie(6));

  // Gollum's Guide ability (passive): a standard NUMBERED tile's Reveal icon does
  // not reveal the Fellowship.
  const reveal = !!tile.reveal && !(fs.guide === 'gollum' && typeof tile.value === 'number');

  // Record every draw (even 0/blank) for the UI's informational popup. Newest last,
  // capped; seq marks a new draw. Public — drawn tiles are open info.
  const prev = state.hunt.draws ?? [];
  const seq = (prev.length ? prev[prev.length - 1]!.seq : 0) + 1;
  state.hunt.draws = [...prev, { seq, value: tile.value, damage, reveal, stop: !!tile.stop, onMordor: fs.mordor !== null, roll: state.hunt.lastRoll }].slice(-16);

  if (damage < 0) { fs.corruption = Math.max(0, fs.corruption + damage); if (reveal) beginReveal(state); return; }
  if (damage === 0) { if (reveal) beginReveal(state); return; }

  // Foul Thing from the Deep: "the Free Peoples player must reduce Hunt Damage (if
  // any) by eliminating a random Companion (unless there are no Companions in the
  // Fellowship) before using the Ring" — the first reduction is FORCED and random,
  // not the FP's choice (player report: the card resolved as a plain extra Hunt).
  // Any damage left after the casualty resolves normally.
  if (opts.forceRandomCasualty && state.fellowship.companions.length > 0) {
    const victim = withRng(state, (rng) => rng.pick(fs.companions));
    const level = eliminateCompanionInline(state, victim);
    log(state, null, 'hunt', `${opts.source ?? 'Hunt'}: a random Companion is eliminated — ${victim} (damage ${damage} − ${level})`);
    damage = Math.max(0, damage - level);
    if (damage === 0) { if (reveal) beginReveal(state); return; }
  }

  // Isildur's Bane: "Hunt damage may not be reduced in any way before using the
  // Ring" — ruled (per playtester Samuel Carey, confirming the community ruling) as
  // STRAIGHT CORRUPTION: no reductions AND no Guide/Companion casualty either.
  if (opts.noReduce) {
    fs.corruption = Math.min(12, fs.corruption + damage);
    if (reveal) beginReveal(state);
    log(state, null, 'hunt', `${opts.source ?? 'Hunt'}: damage ${damage} taken as straight Corruption (${fs.corruption}) — no reduction or casualty allowed`);
    return;
  }
  // Interactive resolution when FP has any choice — a Companion to spend, a Hobbit
  // Guide to separate, or Gollum's reveal-to-reduce — otherwise apply directly.
  if (fs.companions.length > 0 || huntReductionAvailable(state)) {
    state.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal, ...(opts.source ? { source: opts.source } : {}) } };
    log(state, null, 'hunt', `Hunt damage ${damage} pending (FP decision)${opts.source ? ` — ${opts.source}` : ''}`);
  } else {
    fs.corruption = Math.min(12, fs.corruption + damage);
    if (reveal) beginReveal(state);
    log(state, null, 'hunt', `Hunt damage ${damage} -> Corruption ${fs.corruption}${opts.source ? ` — ${opts.source}` : ''}`);
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
/** The on-table reducer cards currently available to discard (each a distinct option). */
export const huntReduceCards = (state: GameState): string[] => state.cards.fp.table.filter((id) => ON_TABLE_HUNT_REDUCERS.has(id));

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
export function extraHunt(state: GameState, opts: HuntOpts = {}): void {
  const { tile, ref } = drawTile(state);
  const isEye = tile.value === 'eye';
  const isFpSpecial = 'spec' in ref && ref.spec.startsWith('fp-');
  if (isEye || isFpSpecial) { log(state, null, 'hunt', `${opts.source ?? 'Extra Hunt'}: tile discarded (Eye / FP special)`); return; }
  applyHuntTile(state, tile, Math.min(5, state.hunt.box), opts);
}

/** Challenge of the King: draw 3 Hunt tiles. If all 3 are Eyes, return them to the
 *  pool and report true (the caller eliminates Strider/Aragorn). Otherwise the drawn
 *  Eye tiles are removed from the game and the rest return to the pool. */
export function challengeOfTheKing(state: GameState): boolean {
  const refs = [drawTile(state), drawTile(state), drawTile(state)];
  const allEyes = refs.every((r) => r.tile.value === 'eye');
  for (const r of refs) {
    if (!allEyes && r.tile.value === 'eye' && 'std' in r.ref) {
      const i = state.hunt.drawn.lastIndexOf(r.ref.std); // permanently remove (don't return to pool)
      if (i >= 0) state.hunt.drawn.splice(i, 1);
    } else {
      returnTileToPool(state, r.ref);
    }
  }
  // Report the outcome so the player can see what was drawn (player request: show the
  // tiles + result, not just a silent log line).
  const face = (v: number | 'eye' | 'die') => (typeof v === 'number' ? String(v) : v === 'eye' ? '👁 Eye' : '🎲 die');
  const drew = refs.map((r) => face(r.tile.value)).join(', ');
  const removed = allEyes ? 0 : refs.filter((r) => r.tile.value === 'eye').length;
  notify(state, allEyes
    ? `Challenge of the King — drew ${drew}: all three are Eyes, so Aragorn/Strider is eliminated.`
    : `Challenge of the King — drew ${drew}${removed ? `: ${removed} Eye tile${removed === 1 ? '' : 's'} permanently removed from the Hunt` : ': no Eyes drawn, nothing removed'}.`);
  return allEyes;
}

/** Draw a Hunt tile for a card effect (The Breaking of the Fellowship): returns the
 *  tile's number (a 'die' tile is rolled), or null if it's an Eye / FP-special tile. */
export function drawHuntTileNumber(state: GameState): number | null {
  const { tile, ref } = drawTile(state);
  const isEye = tile.value === 'eye';
  const isFpSpecial = 'spec' in ref && ref.spec.startsWith('fp-');
  if (isEye || isFpSpecial) return null;
  if (typeof tile.value === 'number') return tile.value;
  return withRng(state, (rng) => rng.rollDie(6)); // 'die' tile: roll for the number
}

/** Resolve a Hunt after the Fellowship moves while NOT on the Mordor Track. If the
 *  Shadow holds Flocks of Crebain, pause for their choice to discard it for +1 to all
 *  Hunt dice; otherwise roll immediately. */
export function resolveHunt(state: GameState): void {
  const h = state.hunt;
  const level = Math.min(5, h.box);
  const bonus = h.fpDiceInBox;   // dice already in the box (before this move's die)
  if (!fellowshipDieSkipsHuntBox(state)) h.fpDiceInBox += 1; // FP die enters the Hunt Box (unless "The Last Battle")
  if (level <= 0) return;
  if (state.cards.shadow.table.includes('sh-char-16')) {
    state.pendingChoice = { owner: 'shadow', kind: 'crebain', data: { level, bonus, rerolls: huntRerolls(state) } };
    return; // defer the roll until the Shadow decides
  }
  huntRoll(state, level, bonus, huntRerolls(state));
}

/** Roll the Hunt dice (each hits on 6+ after the box bonus; 1 always fails) plus the
 *  allowed re-rolls, and draw on a success. */
function huntRoll(state: GameState, level: number, bonus: number, rerolls: number): void {
  const { successes, dice, rerollDice } = withRng(state, (rng) => {
    const faces: number[] = [], rfaces: number[] = [];
    let hits = 0;
    const failedIdx: number[] = [];
    for (let i = 0; i < level; i++) { const d = rng.rollDie(6); faces.push(d); if (d !== 1 && d + bonus >= 6) hits++; else failedIdx.push(i); }
    for (let i = 0; i < Math.min(rerolls, failedIdx.length); i++) { const d = rng.rollDie(6); rfaces.push(d); if (d !== 1 && d + bonus >= 6) hits++; }
    return { successes: hits, dice: faces, rerollDice: rfaces };
  });
  state.hunt.lastRoll = { level, bonus, dice, rerolls: rerollDice, successes, mordor: false };
  log(state, null, 'hunt', `Hunt roll: ${level} ${level === 1 ? 'die' : 'dice'}${bonus ? ` (+${bonus})` : ''} [${dice.join(',')}]${rerollDice.length ? ` re-roll [${rerollDice.join(',')}]` : ''} → ${successes} success${successes === 1 ? '' : 'es'}`,
    { level, bonus, dice, rerolls: rerollDice, successes });
  if (successes >= 1) { beginHuntDraw(state, successes, false); return; }
  // A miss: record it so the player still SEES the roll (dice + box bonus) and knows
  // the Shadow rolled and missed — not that nothing happened.
  const prev = state.hunt.draws ?? [];
  const seq = (prev.length ? prev[prev.length - 1]!.seq : 0) + 1;
  state.hunt.draws = [...prev, { seq, value: 0, damage: 0, reveal: false, onMordor: false, miss: true, roll: state.hunt.lastRoll }].slice(-16);
}

/** Resolve the Flocks of Crebain choice: optionally discard it for +1 to all Hunt
 *  dice, then make the (deferred) Hunt roll. */
export function resolveCrebain(state: GameState, use: boolean): void {
  const d = state.pendingChoice!.data as { level: number; bonus: number; rerolls: number };
  state.pendingChoice = null;
  let bonus = d.bonus;
  if (use) {
    const i = state.cards.shadow.table.indexOf('sh-char-16');
    if (i >= 0) { state.cards.shadow.table.splice(i, 1); state.cards.shadow.discard.character.push('sh-char-16'); bonus += 1; }
    log(state, null, 'hunt', 'Flocks of Crebain: +1 to all Hunt dice');
  }
  huntRoll(state, d.level, bonus, d.rerolls);
}

/** Resolve a step on the Mordor Track: draw a tile (advancing unless it's a Stop)
 *  and apply it — no Hunt roll. Wizard's Staff / Mithril Coat may intercept. */
export function resolveMordorStep(state: GameState): void {
  const fs = state.fellowship;
  if (fs.mordor === null) return;
  // Eye-tile damage on the Mordor Track = the dice in the Hunt Box, "including Free
  // Peoples dice PREVIOUSLY used for moving the Fellowship during the same turn"
  // (p.43). The Action die paying for THIS move is placed in the Hunt Box only after
  // the Hunt is resolved (p.41 — a die already there gives the +1, and the rulebook's
  // own example counts only earlier moves), so it must NOT count towards its own draw.
  // (Report: 5 dice in the box dealt 6 damage; 2 dealt 3.) No 5-cap here: that cap is
  // for rolled Hunt dice (p.41), and in Mordor no roll happens — so dice from earlier
  // Fellowship moves this turn do add up. (Report: 2 Shadow + 1 FP die dealt 2, not 3.)
  const level = state.hunt.box + state.hunt.fpDiceInBox;
  if (!fellowshipDieSkipsHuntBox(state)) state.hunt.fpDiceInBox += 1; // FP die enters the Hunt Box (unless "The Last Battle")
  // On the Mordor Track the tile is drawn automatically (no Hunt roll); record that.
  state.hunt.lastRoll = { level, bonus: 0, dice: [], rerolls: [], successes: level, mordor: true };
  beginHuntDraw(state, level, true);
}

/** After a −1 damage reduction (Hobbit-Guide separate, applied by the adapter; or
 *  Gollum reveal here): re-prompt with the lower damage, or finish if it hit 0. */
/** Apply the final (no-more-choices) Hunt outcome: remaining damage → Corruption,
 *  then reveal if the tile called for it. */
function finishHunt(state: GameState, damage: number, reveal: boolean): void {
  const fs = state.fellowship;
  state.pendingChoice = null;
  if (damage > 0) fs.corruption = Math.min(12, fs.corruption + damage);
  if (reveal) beginReveal(state); // may set the revealMove choice — after clearing this one
  // Say what the remaining damage actually cost. A long Hunt (redraw → sacrifice →
  // Guide ability) used to end on a bare "corruption N" with no arithmetic, so the
  // player couldn't check the total against what they'd spent reducing it (report).
  const taken = damage > 0 ? `${damage} Corruption taken` : 'no Corruption taken';
  // Report the tile's OUTCOME, not the transient flag: when the reveal hands the FP
  // a "where does the figure stand" choice, `hidden` is still true at this instant
  // and the line used to say "Fellowship hidden" one entry before it was revealed
  // (player report: board and status said revealed, the log said hidden).
  const revealPending = reveal && (state.pendingChoice as GameState['pendingChoice'])?.kind === 'revealMove';
  const status = reveal || !fs.hidden ? (revealPending ? 'revealed (choose where it stands)' : 'revealed') : 'hidden';
  log(state, null, 'hunt', `Hunt resolved — ${taken}; Corruption now ${fs.corruption}, Fellowship ${status}`);
}
/** Log one −1 step of a Hunt-damage reduction, so the running total is legible. */
function logReduce(state: GameState, from: number, why: string): void {
  log(state, null, 'hunt', `${why} — Hunt damage ${from} → ${Math.max(0, from - 1)}`);
}
/** Re-prompt the huntDamage choice if damage remains AND the FP could still reduce it
 *  (a Companion to sacrifice or a reduction ability); otherwise finish.
 *  `casualty` marks that a Companion has already been eliminated for THIS Hunt —
 *  p.42: "If the Free Peoples player takes a casualty, he must eliminate ONE
 *  Companion… any excess damage must still be taken as Corruption", so no second
 *  casualty is offered. Reduction abilities stay on the table, because p.42 also
 *  says a newly appointed Guide "may be used immediately, if applicable". */
function repromptOrFinish(state: GameState, damage: number, reveal: boolean, casualty = false): void {
  const fs = state.fellowship;
  // Preserve the originating card's source (and any earlier casualty) across re-prompts.
  const prev = (state.pendingChoice?.data ?? {}) as { source?: string; casualty?: boolean };
  const spent = casualty || !!prev.casualty;
  if (damage > 0 && ((!spent && fs.companions.length > 0) || huntReductionAvailable(state))) {
    state.pendingChoice = { owner: 'fp', kind: 'huntDamage', data: { damage, reveal, ...(spent ? { casualty: true } : {}), ...(prev.source ? { source: prev.source } : {}) } };
    return;
  }
  finishHunt(state, damage, reveal);
}

/** Drop Hunt damage by 1 and re-prompt/finish — called by the adapter after it
 *  separates the Hobbit Guide (separateCompanion lives in fellowship.ts; importing
 *  it here would cycle). The Guide reassigns as part of the separation. */
export function reduceHuntDamageBySeparate(state: GameState): void {
  const d = state.pendingChoice!.data as { damage: number; reveal: boolean };
  logReduce(state, d.damage, 'The Hobbit Guide leaves the Fellowship to draw off the Hunt');
  repromptOrFinish(state, d.damage - 1, d.reveal);
}

/** Resolve the FP's Hunt-damage choice (PendingChoice 'huntDamage'). */
export function resolveHuntDamage(state: GameState, mode: 'corruption' | 'guide' | 'random' | 'reduceSeparate' | 'reduceReveal' | 'reduceCard', card?: string): void {
  const fs = state.fellowship;
  const d = state.pendingChoice!.data as { damage: number; reveal: boolean; casualty?: boolean };

  // Gollum's active ability: reveal the Fellowship to reduce the damage by 1.
  // (Reveals in place mid-resolution — no figure-move/extra-Hunt here; minor deviation.)
  if (mode === 'reduceReveal') {
    fs.hidden = false;
    logReduce(state, d.damage, 'Gollum, the Guide, reveals the Fellowship to lead the Hunt astray');
    repromptOrFinish(state, d.damage - 1, false); // already revealed
    return;
  }
  // Discard an on-table reduction card (Axe and Bow / Horn of Gondor) for −1.
  if (mode === 'reduceCard') {
    // Discard the PLAYER'S chosen reducer (Axe and Bow vs Horn of Gondor is a real
    // choice — their bold keep-conditions differ); fall back to the first if unspecified.
    const i = card && ON_TABLE_HUNT_REDUCERS.has(card)
      ? state.cards.fp.table.indexOf(card)
      : state.cards.fp.table.findIndex((id) => ON_TABLE_HUNT_REDUCERS.has(id));
    if (i >= 0) {
      const id = state.cards.fp.table.splice(i, 1)[0]!;
      state.cards.fp.discard.character.push(id);
      logReduce(state, d.damage, `Discard "${EVENT_BY_ID[id]?.name ?? id}" from the table`);
    }
    repromptOrFinish(state, d.damage - 1, d.reveal);
    return;
  }
  // reduceSeparate is handled in the adapter (needs separateCompanion); it calls
  // reduceHuntDamageBySeparate. It should not reach here.

  if (mode === 'corruption') { finishHunt(state, d.damage, d.reveal); return; } // take it all as Corruption
  // guide / random: eliminate exactly ONE Companion for the whole Hunt (p.42 —
  // "he must eliminate one Companion"; "any excess damage must still be taken as
  // Corruption"). A second casualty is not a legal way to soak the remainder
  // (player report: three Companions were spent on one tile).
  if (d.casualty) throw new Error('Only one Companion may be eliminated per Hunt (p.42) — any remaining damage must be taken as Corruption.');
  if (fs.companions.length > 0) {
    const victim = mode === 'guide'
      ? (fs.companions.includes(fs.guide) ? fs.guide : fs.companions[0]!)
      : withRng(state, (rng) => rng.pick(fs.companions));
    const level = eliminateCompanionInline(state, victim);
    repromptOrFinish(state, Math.max(0, d.damage - level), d.reveal, true);
  } else {
    finishHunt(state, d.damage, d.reveal);
  }
}

// Local copy to avoid a fellowship<->hunt import cycle at module scope.
function eliminateCompanionInline(state: GameState, id: string): number {
  const fs = state.fellowship;
  const i = fs.companions.indexOf(id);
  if (i < 0) return 0;
  fs.companions.splice(i, 1);
  if (!state.characters.eliminated.includes(id)) state.characters.eliminated.push(id);
  if (wornWithSorrowActive(state)) discardFpCharacterCard(state); // Worn with Sorrow and Toil
  // Reassign Guide: highest-Level remaining Companion, else Gollum.
  const oldGuide = fs.guide;
  if (!fs.companions.includes(fs.guide)) {
    fs.guide = fs.companions.length
      ? fs.companions.reduce((b, c) => (levelOf(c) > levelOf(b) ? c : b), fs.companions[0]!)
      : 'gollum';
  }
  // Name the casualty. The log used to say only "damage N pending (FP decision)" and
  // then go quiet, so the sacrifice was invisible (player report: "it doesn't say what
  // the FP decision was — I assume Gandalf was sacrificed because he wasn't there
  // anymore"). Companion casualties are open information, so this is a public entry.
  const level = levelOf(id);
  log(state, null, 'hunt', `${charLabel(id)} is eliminated to absorb ${level} Hunt damage`
    + (fs.guide !== oldGuide ? ` — ${charLabel(fs.guide)} becomes the Guide` : ''));
  return level;
}
/** Card name for a character id, for log entries ("Gandalf the Grey", not "gandalf-grey"). */
const charLabel = (id: string): string => characterDef(id)?.name ?? id;

/** Worn with Sorrow and Toil: discard one FP Character Event card — randomly from
 *  the hand (it's hidden), else from the table if the hand has none. */
function discardFpCharacterCard(state: GameState): void {
  const cards = state.cards.fp;
  const isChar = (id: string) => EVENT_BY_ID[id]?.deck === 'Character';
  const handChars = cards.hand.filter(isChar);
  if (handChars.length) {
    const pick = withRng(state, (rng) => rng.pick(handChars));
    cards.hand.splice(cards.hand.indexOf(pick), 1);
    cards.discard.character.push(pick);
    // Name the card and make it hoverable — "(fp-char-13)" read as a mystery
    // disappearance (player report: "two cards in my hand disappeared").
    log(state, null, 'event', `Worn with Sorrow and Toil: the Companion casualty costs the Free Peoples a Character card — ${EVENT_BY_ID[pick]?.name ?? pick} is discarded`);
    state.log[state.log.length - 1]!.card = pick;
    return;
  }
  const ti = cards.table.findIndex(isChar);
  if (ti >= 0) {
    const id = cards.table.splice(ti, 1)[0]!;
    cards.discard.character.push(id);
    log(state, null, 'event', `Worn with Sorrow and Toil: FP discards a tabled Character card (${id})`);
  }
}
