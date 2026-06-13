// The six-phase turn machine (rules-spec §3). `advance` runs the automatic phases
// (recover, action roll, victory check) and stops at a phase that needs a player
// decision (fellowship, hunt allocation, action resolution). Action effects live
// in applyAction (adapter), which calls advance afterward.
//
// This is the first playable slice: the Fellowship/Hunt loop is complete enough
// that games terminate (Shadow via Corruption 12; FP via the Mordor Track).
// Armies/combat/politics/event-play are not yet wired into the action set — see
// the increment plan; the machine and seams are built to take them.
import type { GameState, Side, DieFace, Deck } from './types';
import { poolSize, rollPool } from './dice';
import { checkMilitaryVictory, checkRingVictory } from './victory';
import { combatStep } from './combat';
import { log } from './log';

const opponent = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

// --- automatic phases ----------------------------------------------------
function runRecover(state: GameState): void {
  // Carry last turn's "FP moved the Fellowship" into this turn's hunt-alloc min.
  state.flags.huntMin1ThisTurn = state.hunt.fpDiceInBox > 0;
  // Recover dice; clear the Hunt Box (FP dice return; Shadow dice/eyes cleared).
  state.dice = { fp: [], shadow: [] };
  state.usedDice = { fp: [], shadow: [] };
  state.hunt.box = 0;
  state.hunt.fpDiceInBox = 0;
  state.flags.fellowshipDeclaredOrMovedThisTurn = false;
  state.flags.fpUsedElvenRingThisTurn = false;
  state.flags.shadowUsedElvenRingThisTurn = false;
  // Draw 2 Event cards each (1 Character, 1 Strategy), trim hands to 6.
  for (const side of ['fp', 'shadow'] as Side[]) drawEventCards(state, side);
}

export function drawEventCards(state: GameState, side: Side): void {
  const p = state.cards[side];
  for (const deck of ['character', 'strategy'] as Deck[]) {
    const top = p.draw[deck].shift();
    if (top) p.hand.push(top);
  }
  while (p.hand.length > 6) p.discard.strategy.push(p.hand.shift()!); // trim oldest
}

function runActionRoll(state: GameState): void {
  // Shadow's allocated Hunt-Box dice (state.hunt.box) are NOT rolled.
  const fpCount = poolSize(state, 'fp');
  const shadowRollable = Math.max(0, poolSize(state, 'shadow') - state.hunt.box);
  state.dice.fp = rollPool(state, 'fp', fpCount);
  const shadowRoll = rollPool(state, 'shadow', shadowRollable);
  // Eyes go straight to the Hunt Box.
  const eyes = shadowRoll.filter((f) => f === 'eye').length;
  state.hunt.box += eyes;
  state.dice.shadow = shadowRoll.filter((f) => f !== 'eye');
  log(state, null, 'roll', `Rolled FP ${state.dice.fp.length}, Shadow ${state.dice.shadow.length} (+${eyes} eyes, hunt box ${state.hunt.box})`);
}

const noDiceLeft = (state: GameState): boolean =>
  state.dice.fp.length === 0 && state.dice.shadow.length === 0;

/** Run automatic phases; stop at the next phase that needs a player decision. */
export function advance(state: GameState): void {
  for (;;) {
    if (state.winner) { state.phase = 'gameOver'; return; }
    if (state.pendingChoice) return;              // await the choice owner
    if (state.pendingCombat) {                    // drive the battle sub-machine
      combatStep(state);
      if (state.pendingChoice) return;
      continue;                                   // combat finished -> resume phases
    }
    switch (state.phase) {
      case 'recover':
        runRecover(state);
        state.phase = 'fellowship';
        return; // await FP fellowship-phase decision
      case 'fellowship':
        return; // await FP
      case 'huntAllocation':
        return; // await Shadow
      case 'actionRoll':
        runActionRoll(state);
        state.phase = 'actionResolution';
        state.currentPlayer = 'fp';
        if (noDiceLeft(state)) { state.phase = 'victoryCheck'; continue; }
        // Ensure currentPlayer has dice (FP always rolls ≥4, so fine).
        return; // await current player
      case 'actionResolution':
        if (noDiceLeft(state)) { state.phase = 'victoryCheck'; continue; }
        return; // await current player
      case 'victoryCheck':
        checkMilitaryVictory(state);
        if (state.winner) { state.phase = 'gameOver'; return; }
        state.turn += 1;
        state.phase = 'recover';
        continue;
      case 'setup':
        state.phase = 'recover';
        continue;
      case 'gameOver':
        return;
    }
  }
}

/** After a resolution action, hand the turn to the opponent if they still have
 *  dice; else keep it with the actor; else advance() will move to victory check. */
export function passResolutionTurn(state: GameState, actor: Side): void {
  const opp = opponent(actor);
  if (state.dice[opp].length > 0) state.currentPlayer = opp;
  else state.currentPlayer = actor;
}

/** Remove one die of `face` from a side's pool into usedDice. Returns false if
 *  none available. */
export function consumeDie(state: GameState, side: Side, face: DieFace): boolean {
  const i = state.dice[side].indexOf(face);
  if (i < 0) return false;
  state.dice[side].splice(i, 1);
  state.usedDice[side].push(face);
  return true;
}

/** Hunt-allocation bounds for the Shadow player this turn. */
export function huntAllocationBounds(state: GameState): { min: number; max: number } {
  const companions = state.fellowship.companions.length;
  const min = state.flags.huntMin1ThisTurn ? 1 : 0;
  const max = Math.min(poolSize(state, 'shadow'), Math.max(1, companions));
  return { min, max };
}

export { checkRingVictory };
