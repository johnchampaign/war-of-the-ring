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
import {
  recruit, moveArmy, canMoveArmy, armySide, settlementController, unitCount, STACKING_LIMIT,
} from '../engine/armies';
import { resolveBattle, attackTargets } from '../engine/combat';
import { advancePolitical, advanceableNations, isAtWar } from '../engine/politics';
import { REGIONS, sideOfNation } from '../engine/data';
import type { DieFace, Nation } from '../engine/types';
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
      const faces = new Set(state.dice[actor]);
      const acts: WotrAction[] = [];
      if (actor === 'fp' && faces.has('character')) {
        if (fs.hidden) acts.push({ kind: 'moveFellowship' });
        else acts.push({ kind: 'hideFellowship' });
      }
      if (faces.has('event')) {
        if (state.cards[actor].draw.character.length) acts.push({ kind: 'drawEvent', deck: 'character' });
        if (state.cards[actor].draw.strategy.length) acts.push({ kind: 'drawEvent', deck: 'strategy' });
      }
      const hasMuster = faces.has('muster') || faces.has('armyMuster');
      const hasArmy = faces.has('army') || faces.has('armyMuster');
      if (hasMuster) {
        for (const n of advanceableNations(state, actor)) acts.push({ kind: 'diplomaticAction', nation: n });
        acts.push(...recruitTargets(state, actor));
      }
      if (hasArmy) {
        for (const [from, to] of moveTargets(state, actor)) acts.push({ kind: 'moveArmy', from, to });
        for (const [from, to] of attackTargets(state, actor)) acts.push({ kind: 'attack', from, to });
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
    case 'diplomaticAction': {
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (!consumeOneOf(state, actor, ['muster', 'armyMuster'])) throw new Error('No Muster die');
      advancePolitical(state, action.nation, 1); passResolutionTurn(state, actor); break;
    }
    case 'recruitUnit':
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (!consumeOneOf(state, actor, ['muster', 'armyMuster'])) throw new Error('No Muster die');
      if (!recruit(state, action.nation, action.region, action.regular, action.elite)) throw new Error('Illegal recruit');
      passResolutionTurn(state, actor); break;
    case 'moveArmy':
      requirePhase(state, 'actionResolution');
      if (!consumeOneOf(state, actor, ['army', 'armyMuster'])) throw new Error('No Army die');
      if (!moveArmy(state, action.from, action.to, actor)) throw new Error('Illegal move');
      passResolutionTurn(state, actor); break;
    case 'attack':
      requirePhase(state, 'actionResolution');
      if (armySide(state, action.from) !== actor) throw new Error('No attacking army');
      if (!consumeOneOf(state, actor, ['army', 'armyMuster'])) throw new Error('No Army die');
      resolveBattle(state, actor, action.from, action.to); passResolutionTurn(state, actor); break;
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

function consumeOneOf(state: GameState, side: Side, faces: DieFace[]): boolean {
  for (const f of faces) if (consumeDie(state, side, f)) return true;
  return false;
}

/** Representative recruit options: one Regular into a friendly free At-War
 *  Settlement per eligible nation (capped). */
function recruitTargets(state: GameState, side: Side): WotrAction[] {
  const out: WotrAction[] = [];
  for (const nation of Object.keys(state.nations) as Nation[]) {
    if (out.length >= 6) break;
    if (sideOfNation(nation) !== side || !isAtWar(state, nation)) continue;
    const pool = state.reinforcements[nation];
    if (pool.regular <= 0) continue;
    for (const id of Object.keys(state.regions)) {
      const def = REGIONS[id]!;
      if (def.nation !== nation || !def.settlement) continue;
      if (settlementController(state, id) !== side) continue;
      if (armySide(state, id) === opp(side)) continue;
      if (unitCount(state, id) >= STACKING_LIMIT) continue;
      out.push({ kind: 'recruitUnit', nation, region: id, regular: 1, elite: 0 });
      break; // one settlement per nation in the representative set
    }
  }
  return out;
}

/** Representative army-move options: stacks moving to an adjacent free region. */
function moveTargets(state: GameState, side: Side, cap = 8): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const from of Object.keys(state.regions)) {
    if (out.length >= cap) break;
    if (armySide(state, from) !== side) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (canMoveArmy(state, from, to, side)) { out.push([from, to]); break; }
    }
  }
  return out;
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
