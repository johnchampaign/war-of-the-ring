// The Hunt for the Ring (rules-spec §10-11). Simplified for the first playable
// loop: Hunt damage is applied to Corruption (the casualty-vs-corruption choice
// and re-roll conditions are auto-resolved here — see deviation note — and become
// real prompts / full modelling in a later increment).
import type { GameState, HuntState } from './types';
import { STANDARD_TILE_LIST, type HuntTileDef } from './data';
import { withRng } from './rng';
import { log } from './log';

/** Draw one tile from the active Hunt Pool (standard tiles). Reshuffles standard
 *  tiles when the pool empties (rules-spec §10). Returns the tile def. */
function drawTile(state: GameState): HuntTileDef {
  const h = state.hunt;
  if (h.pool.length === 0) {
    // Return all standard (drawn) tiles to the pool.
    h.pool = h.drawn.slice();
    h.drawn = [];
  }
  const idx = withRng(state, (rng) => {
    const pick = rng.int(h.pool.length);
    return h.pool.splice(pick, 1)[0]!;
  });
  h.drawn.push(idx);
  return STANDARD_TILE_LIST[idx]!;
}

/** Apply a drawn tile's effect to the Fellowship. `successes` is the Hunt-roll
 *  success count (for Eye tiles). */
function applyTile(state: GameState, tile: HuntTileDef, successes: number): void {
  const fs = state.fellowship;
  let damage = 0;
  if (typeof tile.value === 'number') damage = tile.value;
  else if (tile.value === 'eye') damage = successes;
  else if (tile.value === 'die') damage = withRng(state, (rng) => rng.rollDie(6));

  if (damage < 0) {
    fs.corruption = Math.max(0, fs.corruption + damage); // negative = heal
  } else {
    // DEVIATION (auto-resolve): apply all Hunt damage to Corruption. The
    // take-a-Companion-casualty option and re-roll conditions are modelled in a
    // later increment; here damage -> Corruption keeps the loop terminating.
    fs.corruption = Math.min(12, fs.corruption + damage);
  }
  if (tile.reveal) fs.hidden = false;
  log(state, null, 'hunt', `Hunt tile ${tile.value}${tile.reveal ? ' (reveal)' : ''} → damage ${damage}, corruption ${fs.corruption}`);
}

/** Resolve a Hunt after the Fellowship moves while NOT on the Mordor Track.
 *  Rolls Hunt Level dice (+1 each per FP die already in the Hunt Box); on ≥1
 *  success draws and applies a tile. */
export function resolveHunt(state: GameState): void {
  const h: HuntState = state.hunt;
  const level = Math.min(5, h.box);
  if (level <= 0) return;
  const bonus = h.fpDiceInBox;
  const successes = withRng(state, (rng) => {
    let s = 0;
    for (let i = 0; i < level; i++) {
      const raw = rng.rollDie(6);
      if (raw === 1) continue;            // 1 always fails
      if (raw + bonus >= 6) s++;          // success on 6+ after the +1/FP-die bonus
    }
    return s;
  });
  if (successes >= 1) applyTile(state, drawTile(state), successes);
}

/** Resolve a step on the Mordor Track: draw a tile directly (no Hunt roll).
 *  Advances one Mordor step unless the tile has a Stop icon (standard tiles
 *  don't), per rules-spec §11. */
export function resolveMordorStep(state: GameState): void {
  const fs = state.fellowship;
  if (fs.mordor === null) return;
  const tile = drawTile(state);
  applyTile(state, tile, Math.min(5, state.hunt.box));
  if (!tile.stop) fs.mordor = Math.min(5, fs.mordor + 1);
}
