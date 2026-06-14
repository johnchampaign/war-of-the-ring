// The Political Track (rules-spec §8). step 0 = "At War"; passive nations can't
// reach step 0 until activated.
import type { GameState, Nation } from './types';
import { sideOfNation } from './data';
import { threatsAndPromisesActive } from './persistent';
import { log } from './log';

export const isAtWar = (state: GameState, n: Nation): boolean => state.nations[n].step === 0;

export function activateNation(state: GameState, n: Nation): void {
  if (!state.nations[n].active) {
    state.nations[n].active = true;
    log(state, null, 'politics', `${n} activated`);
  }
}

/** Advance a nation toward At War. Passive nations stop one short of At War. */
export function advancePolitical(state: GameState, n: Nation, steps = 1): void {
  const ns = state.nations[n];
  const floor = ns.active ? 0 : 1;
  const newStep = Math.max(floor, ns.step - steps);
  if (newStep !== ns.step) {
    ns.step = newStep;
    log(state, null, 'politics', `${n} advances to step ${ns.step}${ns.step === 0 ? ' (At War)' : ''}`);
  }
}

/** Automatic political reaction when a nation's army is attacked. */
export function onArmyAttacked(state: GameState, n: Nation): void {
  activateNation(state, n);
  advancePolitical(state, n, 1);
}

/** Automatic reaction when one of a nation's Settlements is captured. */
export function onSettlementCaptured(state: GameState, n: Nation): void {
  activateNation(state, n);
  advancePolitical(state, n, 1);
}

/** Nations of a side that can still be advanced on the track (diplomatic action). */
export function advanceableNations(state: GameState, side: 'fp' | 'shadow'): Nation[] {
  // Threats and Promises: the FP cannot advance a passive Nation via a Muster die.
  const barPassiveFp = side === 'fp' && threatsAndPromisesActive(state);
  return (Object.keys(state.nations) as Nation[]).filter((n) => {
    if (sideOfNation(n) !== side) return false;
    const ns = state.nations[n];
    if (barPassiveFp && !ns.active) return false;
    const floor = ns.active ? 0 : 1;
    return ns.step > floor; // can move at least one step (FP passive must activate first via events/companions)
  });
}
