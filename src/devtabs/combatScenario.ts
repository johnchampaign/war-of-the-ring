// Dev-only combat scenario (reached via the #combat hash route). Positions an FP
// Army adjacent to a Shadow Army in Action Resolution, with a Combat card in each
// hand and an Army die for the FP, so a single attack drives the full combat
// sub-machine through the UI — exercising the Combat-card, casualties, continue,
// and retreat DecisionModals. Not part of normal play; pure UI verification.
import type { GameState } from '../engine/types';
import { REGIONS } from '../engine/data';

/** Two adjacent plain (no-settlement) regions for a clean field battle. */
function fieldBattlePair(): { from: string; to: string } {
  for (const from of Object.keys(REGIONS)) {
    if (REGIONS[from]!.settlement) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (!REGIONS[to]!.settlement && to !== from) return { from, to };
    }
  }
  return { from: 'osgiliath', to: 'south-ithilien' }; // fallback (still valid adjacency)
}

/** Mutate a freshly-started game into a combat-ready position (in place). */
export function applyCombatScenario(state: GameState): GameState {
  const { from, to } = fieldBattlePair();
  // Clear both regions, then stage attacker (FP) and defender (Shadow).
  for (const id of [from, to]) {
    const r = state.regions[id]!;
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; r.besieged = false;
  }
  state.regions[from]!.units = { gondor: { regular: 5, elite: 1 } };
  state.regions[from]!.leaders = 2;
  state.regions[to]!.units = { sauron: { regular: 4, elite: 1 } };

  // Both nations At War so the attack is legal and reactions don't gate it.
  state.nations.gondor.active = true; state.nations.gondor.step = 0;
  state.nations.sauron.active = true; state.nations.sauron.step = 0;

  // A Combat card in each hand so the Combat-card modal appears for both sides.
  state.cards.fp.hand = ['fp-char-05', ...state.cards.fp.hand].slice(0, 6);
  state.cards.shadow.hand = ['sh-char-01', ...state.cards.shadow.hand].slice(0, 6);

  // Action Resolution, FP to act, holding an Army die (plus a spare).
  state.phase = 'actionResolution';
  state.currentPlayer = 'fp';
  state.dice.fp = ['army', 'character'];
  state.dice.shadow = ['army', 'character', 'muster'];
  state.pendingChoice = null;
  state.pendingCombat = null;
  return state;
}
