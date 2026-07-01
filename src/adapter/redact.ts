// Per-seat redaction (viewFor). Hides what a viewer must not know: the opponent's
// Event-card hand + draw piles, the RNG state, and the *contents* of a pending
// choice that belongs to the opponent. The Fellowship's Progress and last-known
// position are PUBLIC in WotR (both on the board), so they aren't redacted. Log
// is default-deny: public entries + the viewer's own side-tagged entries only.
// At game over, everything is revealed (no hidden-info-dependent client scoring,
// but faithful + future-proof).
import type { GameState, Side } from '../engine/types';

export function redactStateForViewer(state: GameState, viewer: Side | null): GameState {
  const v: GameState = JSON.parse(JSON.stringify(state));
  v.rngState = 0; // never expose the RNG (it determines future Hunt draws / rolls)

  if (state.winner) return v; // game over — reveal all (rng stays hidden, irrelevant)

  for (const side of ['fp', 'shadow'] as Side[]) {
    if (side === viewer) continue;
    v.cards[side].hand = v.cards[side].hand.map(() => 'hidden');
    v.cards[side].draw.character = v.cards[side].draw.character.map(() => 'hidden');
    v.cards[side].draw.strategy = v.cards[side].draw.strategy.map(() => 'hidden');
  }

  // A pending choice belonging to the opponent: keep a non-leaky "opponent is
  // choosing" indicator (owner + kind), strip its payload.
  if (v.pendingChoice && viewer != null && v.pendingChoice.owner !== viewer) {
    v.pendingChoice = { owner: v.pendingChoice.owner, kind: v.pendingChoice.kind };
  }

  // Combat cards are chosen SIMULTANEOUSLY (face down) then revealed. While either
  // side is still selecting (attackerCard / defenderCard steps), hide the OPPONENT's
  // already-chosen-but-unrevealed card, so the second chooser can't see the first's
  // card. Once the round begins (both locked), they're public.
  if (v.pendingCombat && viewer != null && (v.pendingCombat.step === 'attackerCard' || v.pendingCombat.step === 'defenderCard')) {
    if (viewer !== v.pendingCombat.attacker) v.pendingCombat.attackerCard = null;
    if (viewer !== v.pendingCombat.defender) v.pendingCombat.defenderCard = null;
  }

  // Log: public entries (side null) + the viewer's own side-tagged entries.
  v.log = v.log.filter((e) => e.side == null || e.side === viewer);
  return v;
}
