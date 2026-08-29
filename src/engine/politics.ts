// The Political Track (rules-spec §8). step 0 = "At War"; passive nations can't
// reach step 0 until activated.
import type { GameState, Nation } from './types';
import { sideOfNation } from './data';
import type { RegionId } from './types';
import { threatsAndPromisesActive, wormtongueAllowsActivation } from './persistent';
import { log } from './log';

export const isAtWar = (state: GameState, n: Nation): boolean => state.nations[n].step === 0;

/** Activate a Nation. `trigger` carries the activation source so persistent cards
 *  (Wormtongue) can veto it; default (no trigger) is a generic activation. */
export function activateNation(state: GameState, n: Nation, trigger: { region?: RegionId; viaCompanion?: boolean; viaAttack?: boolean } = {}): void {
  if (!wormtongueAllowsActivation(state, n, trigger)) return; // Wormtongue: Rohan stays passive
  if (!state.nations[n].active) {
    state.nations[n].active = true;
    log(state, null, 'politics', `${n} activated`);
  }
}

/** Advance a nation toward At War. Passive nations stop one short of At War.
 *  `trigger` carries the advance's SOURCE so a persistent card can react to it
 *  (Threats and Promises discards itself on an attack- or Companion-driven advance). */
export function advancePolitical(state: GameState, n: Nation, steps = 1, trigger: { viaAttack?: boolean; viaCompanion?: boolean } = {}): void {
  const ns = state.nations[n];
  const floor = ns.active ? 0 : 1;
  const newStep = Math.max(floor, ns.step - steps);
  if (newStep !== ns.step) {
    ns.step = newStep;
    log(state, null, 'politics', `${n} advances to step ${ns.step}${ns.step === 0 ? ' (At War)' : ''}`);
    if (sideOfNation(n) === 'fp' && (trigger.viaAttack || trigger.viaCompanion)) discardThreatsAndPromises(state, !!trigger.viaAttack);
  }
}

/** sh-str-05 "Threats and Promises", printed discard clause (card text, verbatim):
 *  "You must discard this card from the table as soon as a Free Peoples Nation
 *  advances on the Political Track either due to an attack or due to a Companion's
 *  special ability." Event-triggered, not a pruneTableCards condition — the trigger is
 *  the advance itself, not a state that persists (same shape as Worn with Sorrow's
 *  declare clause). Player report: the card sat on the table through an attack that
 *  advanced the Elves. */
function discardThreatsAndPromises(state: GameState, viaAttack: boolean): void {
  const t = state.cards.shadow.table;
  const i = t.indexOf('sh-str-05');
  if (i < 0) return;
  t.splice(i, 1);
  state.cards.shadow.discard.strategy.push('sh-str-05');
  log(state, null, 'event', `Threats and Promises is discarded — a Free Peoples Nation advanced ${viaAttack ? 'through an attack' : "through a Companion's ability"}`);
}

/** Automatic political reaction when a nation's army is attacked (in `region`). An
 *  attack is the only army trigger that can rouse Rohan while Wormtongue is in play. */
export function onArmyAttacked(state: GameState, n: Nation, region?: RegionId): void {
  activateNation(state, n, { region, viaAttack: true });
  advancePolitical(state, n, 1, { viaAttack: true });
}

/** Automatic reaction when one of a nation's Settlements (in `region`) is captured.
 *  `viaAttack` distinguishes a battle capture (an attack — can rouse Rohan under
 *  Wormtongue) from a walk-in occupation of an undefended Settlement (which cannot). */
export function onSettlementCaptured(state: GameState, n: Nation, region?: RegionId, viaAttack = false): void {
  activateNation(state, n, { region, viaAttack });
  advancePolitical(state, n, 1, { viaAttack });
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
