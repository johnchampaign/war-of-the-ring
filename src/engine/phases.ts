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
import { pruneTableCards } from './persistent';
import { armySide } from './armies';
import { REGIONS, sideOfNation, EVENT_BY_ID } from './data';
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
  state.flags.mouthMusterUsedThisTurn = false;
  state.flags.fpFreeCharEventThisTurn = false;
  // Draw 2 Event cards each (1 Character, 1 Strategy), trim hands to 6.
  for (const side of ['fp', 'shadow'] as Side[]) drawEventCards(state, side);
}

export function drawEventCards(state: GameState, side: Side): void {
  const p = state.cards[side];
  for (const deck of ['character', 'strategy'] as Deck[]) {
    const top = p.draw[deck].shift();
    if (top) p.hand.push(top);
  }
  // Over the 6-card limit is resolved by the player's CHOICE (enforceHandLimit), not
  // by silently trimming the oldest.
}

/** If a player holds more than 6 Event cards, pause for them to discard down to 6
 *  (their choice; the adapter routes the card to the matching deck's discard). The
 *  Free Peoples player discards first. */
function enforceHandLimit(state: GameState): boolean {
  for (const side of ['fp', 'shadow'] as Side[]) {
    if (state.cards[side].hand.length > 6) {
      state.pendingChoice = { owner: side, kind: 'discardCard', data: {} };
      return true;
    }
  }
  return false;
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
  log(state, null, 'roll', `Rolled FP ${state.dice.fp.length}, Shadow ${state.dice.shadow.length} (+${eyes} eyes, hunt box ${state.hunt.box})`,
    { fp: [...state.dice.fp], shadow: [...state.dice.shadow], eyes, huntBox: state.hunt.box });
}

const noDiceLeft = (state: GameState): boolean =>
  state.dice.fp.length === 0 && state.dice.shadow.length === 0;

/** Discard on-table cards whose play condition ceased (rulebook p.22) — checked
 *  after every state transition via advance(). */
function sweepTableCards(state: GameState): void {
  pruneTableCards(
    state,
    armySide,
    (r) => { const n = REGIONS[r]?.nation; return n ? sideOfNation(n) : null; },
    (s, side, id) => {
      const deck = EVENT_BY_ID[id]?.deck === 'Character' ? 'character' : 'strategy';
      s.cards[side].discard[deck].push(id);
      log(s, null, 'event', `${EVENT_BY_ID[id]?.name ?? id} is discarded — its play condition no longer holds (p.22)`);
    },
  );
}

/** Run automatic phases; stop at the next phase that needs a player decision. */
export function advance(state: GameState): void {
  sweepTableCards(state);
  for (;;) {
    if (state.winner) { state.phase = 'gameOver'; return; }
    if (state.pendingChoice) return;              // await the choice owner
    if (state.pendingCombat) {                    // drive the battle sub-machine
      combatStep(state);
      if (state.pendingChoice) return;
      continue;                                   // combat finished -> resume phases
    }
    if (enforceHandLimit(state)) return;          // over 6 cards -> pause to discard (choice)
    switch (state.phase) {
      case 'recover':
        runRecover(state);
        state.phase = 'fellowship';
        continue; // loop top enforces the hand limit (discard choice) before awaiting FP
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
        // Mordor Track: if the Fellowship is on the Track and the FP didn't move or hide
        // it this turn, the Ring-bearers take 1 Corruption (rules p.43).
        if (state.fellowship.mordor !== null && !state.flags.fellowshipDeclaredOrMovedThisTurn) {
          state.fellowship.corruption = Math.min(12, state.fellowship.corruption + 1);
          log(state, null, 'hunt', 'Mordor Track: +1 Corruption (no Fellowship move/hide this turn)');
          checkRingVictory(state);
        }
        if (!state.winner) checkMilitaryVictory(state);
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
