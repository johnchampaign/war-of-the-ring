// The GameAdapter — the ONLY engine-side file that imports the framework. It maps
// flat (state, action, actor) calls onto the engine: validates + applies actions,
// drives the phase machine, and redacts per-seat views.
import type { GameAdapter } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from './wotrAction';
import {
  advance, consumeDie, passResolutionTurn, huntAllocationBounds, checkRingVictory,
} from '../engine/phases';
import { moveFellowship, hideFellowship, declareFellowship, enterMordor, MORDOR_ENTRANCES } from '../engine/fellowship';
import { redactStateForViewer } from './redact';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const opp = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

/** Who must act now, or null at an automatic phase (caller should advance()). */
function currentActor(state: GameState): Side | null {
  switch (state.phase) {
    case 'fellowship': return 'fp';
    case 'huntAllocation': return 'shadow';
    case 'actionResolution': return state.currentPlayer;
    default: return null;
  }
}

function legalActions(state: GameState, actor: Side): WotrAction[] {
  if (currentActor(state) !== actor) return [];
  const fs = state.fellowship;
  switch (state.phase) {
    case 'fellowship': {
      const acts: WotrAction[] = [{ kind: 'skipFellowshipPhase' }];
      if (fs.hidden && fs.mordor === null && fs.progress > 0) {
        acts.push({ kind: 'declareFellowship', target: 'morannon' });
      }
      if (fs.mordor === null && MORDOR_ENTRANCES.includes(fs.location)) {
        acts.push({ kind: 'enterMordor' });
      }
      return acts;
    }
    case 'huntAllocation': {
      const { min, max } = huntAllocationBounds(state);
      const acts: WotrAction[] = [];
      for (let d = min; d <= max; d++) acts.push({ kind: 'allocateHunt', dice: d });
      return acts.length ? acts : [{ kind: 'allocateHunt', dice: 0 }];
    }
    case 'actionResolution': {
      const dice = state.dice[actor];
      const acts: WotrAction[] = [];
      const faces = new Set(dice);
      if (actor === 'fp' && faces.has('character')) {
        if (fs.hidden) acts.push({ kind: 'moveFellowship' });
        else acts.push({ kind: 'hideFellowship' });
      }
      if (faces.has('event')) {
        if (state.cards[actor].draw.character.length) acts.push({ kind: 'drawEvent', deck: 'character' });
        if (state.cards[actor].draw.strategy.length) acts.push({ kind: 'drawEvent', deck: 'strategy' });
      }
      for (const f of faces) acts.push({ kind: 'skipDie', face: f });
      if (state.dice[actor].length < state.dice[opp(actor)].length) acts.push({ kind: 'pass' });
      return acts;
    }
    default: return [];
  }
}

function dispatch(state: GameState, action: WotrAction, actor: Side): void {
  const must = currentActor(state);
  if (must !== actor) throw new Error(`Not ${actor}'s turn (actor is ${must ?? 'none'}, phase ${state.phase})`);

  switch (action.kind) {
    case 'skipFellowshipPhase':
      requirePhase(state, 'fellowship'); state.phase = 'huntAllocation'; break;
    case 'declareFellowship':
      requirePhase(state, 'fellowship'); declareFellowship(state, action.target); state.phase = 'huntAllocation'; break;
    case 'enterMordor':
      requirePhase(state, 'fellowship');
      if (!enterMordor(state)) throw new Error('Cannot enter Mordor from here');
      state.phase = 'huntAllocation'; break;
    case 'allocateHunt': {
      requirePhase(state, 'huntAllocation');
      const { min, max } = huntAllocationBounds(state);
      if (action.dice < min || action.dice > max) throw new Error(`allocateHunt ${action.dice} out of [${min},${max}]`);
      state.hunt.box = action.dice;
      state.phase = 'actionRoll';
      break;
    }
    case 'moveFellowship':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP moves the Fellowship');
      if (!state.fellowship.hidden) throw new Error('Fellowship is revealed');
      if (!consumeDie(state, 'fp', 'character')) throw new Error('No Character die');
      moveFellowship(state); passResolutionTurn(state, actor); break;
    case 'hideFellowship':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP hides the Fellowship');
      if (!consumeDie(state, 'fp', 'character')) throw new Error('No Character die');
      hideFellowship(state); passResolutionTurn(state, actor); break;
    case 'drawEvent':
      requirePhase(state, 'actionResolution');
      if (!consumeDie(state, actor, 'event')) throw new Error('No Event die');
      drawOne(state, actor, action.deck); passResolutionTurn(state, actor); break;
    case 'skipDie':
      requirePhase(state, 'actionResolution');
      if (!consumeDie(state, actor, action.face)) throw new Error(`No ${action.face} die`);
      passResolutionTurn(state, actor); break;
    case 'pass':
      requirePhase(state, 'actionResolution');
      passResolutionTurn(state, actor); break; // yield to opponent (who has more dice)
    default: throw new Error(`Unknown action ${(action as { kind: string }).kind}`);
  }
  checkRingVictory(state);
  advance(state);
}

function requirePhase(state: GameState, phase: GameState['phase']): void {
  if (state.phase !== phase) throw new Error(`Action requires phase ${phase}, in ${state.phase}`);
}

function drawOne(state: GameState, side: Side, deck: 'character' | 'strategy'): void {
  const p = state.cards[side];
  const top = p.draw[deck].shift();
  if (top) p.hand.push(top);
  while (p.hand.length > 6) p.discard.strategy.push(p.hand.shift()!);
}

export const wotrAdapter: GameAdapter<GameState, WotrAction, Side> = {
  schemaVersion: 1,
  applyAction(state, action, actor) {
    const next = clone(state);
    dispatch(next, action, actor);
    return next;
  },
  tryApplyAction(state, action, actor) {
    try {
      return { state: this.applyAction(state, action, actor), ok: true };
    } catch (e) {
      return { state, ok: false, reason: (e as Error).message };
    }
  },
  legalActions,
  currentActor,
  viewFor: redactStateForViewer,
  result(state) {
    return state.winner ? { winners: [state.winner], reason: state.winReason ?? undefined } : null;
  },
  migrate() { throw new Error('No migrations defined (schemaVersion 1).'); },
};

/** Run automatic phases so a freshly created game rests at its first decision. */
export function startGame(state: GameState): GameState {
  const s = clone(state);
  advance(s);
  return s;
}
