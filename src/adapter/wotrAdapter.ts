// The GameAdapter — the ONLY engine-side file that imports the framework. It maps
// flat (state, action, actor) calls onto the engine: validates + applies actions,
// drives the phase machine, and redacts per-seat views.
import type { GameAdapter } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from './wotrAction';
import {
  advance, consumeDie, passResolutionTurn, huntAllocationBounds, checkRingVictory,
} from '../engine/phases';
import { moveFellowship, hideFellowship, declareFellowship, enterMordor, separateCompanion, bringUpgrade, canBringAragorn, canBringGandalfWhite, resolveLureChoice, eligibleGuides, setGuide, pathTo, MORDOR_ENTRANCES } from '../engine/fellowship';
import { extraHunt } from '../engine/hunt';
import {
  recruit, moveArmy, canMoveArmy, armySide, settlementController, unitCount, STACKING_LIMIT,
} from '../engine/armies';
import { startBattle, attackTargets, resolveCasualties, resolveContinue, resolveRetreat, resolveRetreatTo, resolveSiegeWithdraw, retreatDestinations, canRetreat, playableCombatCards, resolvePlayCombatCard } from '../engine/combat';
import { resolveHuntDamage, reduceHuntDamageBySeparate, huntReduceCardAvailable, resolveHuntPreventDraw, resolveHuntRedraw } from '../engine/hunt';
import { advancePolitical, advanceableNations, isAtWar } from '../engine/politics';
import { shadowBarredFromRegion, threatsAndPromisesActive, palantirActive } from '../engine/persistent';
import { canBringMinion, entryRegion, bringMinion, MINION_IDS } from '../engine/minions';
import { moveCharacter, characterMoveOptions } from '../engine/charMove';
import { REGIONS, sideOfNation, EVENT_BY_ID } from '../engine/data';
import type { DieFace, Nation } from '../engine/types';
import { getHandler, canPlayCard, type EventTarget } from '../engine/handlers/registry';
import '../engine/handlers/index'; // registers the handlers (side-effect import)
import { redactStateForViewer } from './redact';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const opp = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

/** Who must act now, or null at an automatic phase (caller should advance()). */
function currentActor(state: GameState): Side | null {
  if (state.winner) return null;
  if (state.pendingChoice) return state.pendingChoice.owner; // combat / other choices
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
  // Combat / other pending choices take precedence over the phase.
  if (state.pendingChoice) {
    switch (state.pendingChoice.kind) {
      case 'combatCard': {
        const acts: WotrAction[] = [{ kind: 'playCombatCard', cardId: null }];
        for (const id of playableCombatCards(state, actor)) acts.push({ kind: 'playCombatCard', cardId: id });
        return acts;
      }
      case 'combatCasualties':
        return [{ kind: 'chooseCasualties', plan: 'regularsFirst' }, { kind: 'chooseCasualties', plan: 'elitesFirst' }];
      case 'combatContinue':
        return [{ kind: 'combatContinue', cont: true }, { kind: 'combatContinue', cont: false }];
      case 'siegeWithdraw':
        return [{ kind: 'siegeWithdraw', withdraw: true }, { kind: 'siegeWithdraw', withdraw: false }];
      case 'combatRetreat':
        return canRetreat(state)
          ? [{ kind: 'combatRetreat', retreat: true }, { kind: 'combatRetreat', retreat: false }]
          : [{ kind: 'combatRetreat', retreat: false }];
      case 'retreatTo':
        return retreatDestinations(state).map((region) => ({ kind: 'retreatTo', region }));
      case 'eventTarget': {
        const data = state.pendingChoice!.data as { card: string; applied: EventTarget[]; repeat: number };
        const h = getHandler(data.card);
        const opts: Extract<WotrAction, { kind: 'eventTarget' }>[] = (h?.targets?.(state, actor, data.applied) ?? []).map((t) => ({ kind: 'eventTarget' as const, card: data.card, from: t.from, to: t.to, region: t.region, companion: t.companion, mode: t.mode }));
        // Multi-target cards (repeat>1) may stop early once ≥1 target is applied.
        if ((h?.repeat ?? 1) > 1 && data.applied.length > 0) opts.push({ kind: 'eventTarget' as const, card: data.card, done: true });
        return opts;
      }
      case 'bonusDraw':
        return [{ kind: 'bonusDraw', deck: 'character' }, { kind: 'bonusDraw', deck: 'strategy' }];
      case 'lureChoice':
        return [{ kind: 'lureChoice', mode: 'corruption' }, { kind: 'lureChoice', mode: 'eliminate' }];
      case 'huntDamage': {
        const fs = state.fellowship;
        const acts: WotrAction[] = [{ kind: 'huntDamage', mode: 'corruption' }];
        if (fs.companions.length > 0) {
          acts.push({ kind: 'huntDamage', mode: 'guide' }, { kind: 'huntDamage', mode: 'random' });
        }
        // Guide damage-reduction abilities (−1 each): separate a Hobbit Guide, or
        // Gollum reveals the Fellowship.
        if (fs.guide === 'meriadoc' || fs.guide === 'peregrin') acts.push({ kind: 'huntDamage', mode: 'reduceSeparate' });
        if (fs.guide === 'gollum' && fs.hidden) acts.push({ kind: 'huntDamage', mode: 'reduceReveal' });
        if (huntReduceCardAvailable(state)) acts.push({ kind: 'huntDamage', mode: 'reduceCard' });
        return acts;
      }
      case 'huntPreventDraw':
        return [{ kind: 'huntPreventDraw', prevent: true }, { kind: 'huntPreventDraw', prevent: false }];
      case 'huntRedraw':
        return [{ kind: 'huntRedraw', redraw: true }, { kind: 'huntRedraw', redraw: false }];
      default: return [];
    }
  }
  switch (state.phase) {
    case 'fellowship': {
      const acts: WotrAction[] = [{ kind: 'skipFellowshipPhase' }];
      if (fs.hidden && fs.mordor === null && fs.progress > 0) {
        acts.push({ kind: 'declareFellowship', target: 'morannon' });
      }
      if (fs.mordor === null && MORDOR_ENTRANCES.includes(fs.location)) {
        acts.push({ kind: 'enterMordor' });
      }
      // Change the Guide: offer each Companion tied for the highest Level (besides the current Guide).
      for (const c of eligibleGuides(state)) if (c !== fs.guide) acts.push({ kind: 'changeGuide', companion: c });
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
      const hasWill = actor === 'fp' && faces.has('will'); // Will of the West = wildcard
      if (actor === 'fp' && (faces.has('character') || hasWill)) {
        if (fs.hidden) acts.push({ kind: 'moveFellowship' });
        else acts.push({ kind: 'hideFellowship' });
        if (fs.mordor === null) for (const c of fs.companions) acts.push({ kind: 'separateCompanion', companion: c });
      }
      // Move independent characters (Nazgûl/Minions for SH, separated Companions
      // for FP) — a Character die, both sides.
      if (faces.has('character') || hasWill) {
        for (const m of characterMoveOptions(state, actor)) acts.push({ kind: 'moveCharacter', ...m });
      }
      if (hasWill) for (const u of upgradeOptions(state)) acts.push(u);
      if (faces.has('event') || hasWill) {
        if (state.cards[actor].draw.character.length) acts.push({ kind: 'drawEvent', deck: 'character' });
        if (state.cards[actor].draw.strategy.length) acts.push({ kind: 'drawEvent', deck: 'strategy' });
        for (const cardId of state.cards[actor].hand) {
          if (canPlayCard(state, cardId, actor)) acts.push({ kind: 'playEvent', cardId });
        }
      }
      const hasMuster = faces.has('muster') || faces.has('armyMuster') || hasWill;
      const hasArmy = faces.has('army') || faces.has('armyMuster') || hasWill;
      if (hasMuster) {
        for (const n of advanceableNations(state, actor)) acts.push({ kind: 'diplomaticAction', nation: n });
        acts.push(...recruitTargets(state, actor));
        if (actor === 'shadow') {
          for (const m of MINION_IDS) {
            if (canBringMinion(state, m)) { const r = entryRegion(state, m); if (r) acts.push({ kind: 'bringMinion', minion: m, region: r }); }
          }
        }
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
    case 'changeGuide':
      requirePhase(state, 'fellowship');
      if (!setGuide(state, action.companion)) throw new Error('Not an eligible Guide');
      break; // free choice — stays in the Fellowship phase (may still declare/enter/skip)
    case 'declareFellowship': {
      requirePhase(state, 'fellowship');
      const fromLoc = state.fellowship.location;
      const stepsBefore = Math.min(state.fellowship.progress, pathTo(fromLoc, action.target).length);
      const traversed = [fromLoc, ...pathTo(fromLoc, action.target).slice(0, stepsBefore)];
      declareFellowship(state, action.target);
      // Balrog of Moria: a declaration that moves the Fellowship through Moria lets
      // the Shadow draw an extra Hunt tile (discarding the on-table card).
      const balrog = state.cards.shadow.table.indexOf('sh-char-17');
      if (balrog >= 0 && traversed.includes('moria')) {
        state.cards.shadow.table.splice(balrog, 1);
        state.cards.shadow.discard.character.push('sh-char-17');
        extraHunt(state);
      }
      state.phase = 'huntAllocation'; break;
    }
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
      if (!consumeOneOf(state, 'fp', ['character', 'will'])) throw new Error('No Character die');
      moveFellowship(state); passResolutionTurn(state, actor); break;
    case 'hideFellowship':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP hides the Fellowship');
      if (!consumeOneOf(state, 'fp', ['character', 'will'])) throw new Error('No Character die');
      hideFellowship(state); passResolutionTurn(state, actor); break;
    case 'separateCompanion':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP separates Companions');
      if (!consumeOneOf(state, 'fp', ['character', 'will'])) throw new Error('No Character die');
      if (!separateCompanion(state, action.companion)) throw new Error('Cannot separate that Companion');
      passResolutionTurn(state, actor); break;
    case 'bringUpgrade':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP upgrades');
      if (!consumeDie(state, 'fp', 'will')) throw new Error('No Will of the West die');
      if (!bringUpgrade(state, action.which)) throw new Error('Cannot bring that upgrade');
      passResolutionTurn(state, actor); break;
    case 'drawEvent':
      requirePhase(state, 'actionResolution');
      if (!consumeOneOf(state, actor, ['event', 'will'])) throw new Error('No Event die');
      drawOne(state, actor, action.deck); passResolutionTurn(state, actor); break;
    case 'playEvent': {
      requirePhase(state, 'actionResolution');
      const hand = state.cards[actor].hand;
      const idx = hand.indexOf(action.cardId);
      if (idx < 0) throw new Error('Card not in hand');
      const h = getHandler(action.cardId);
      if (!h || !canPlayCard(state, action.cardId, actor)) throw new Error('Card not playable');
      if (!consumeOneOf(state, actor, ['event', 'will'])) throw new Error('No Event die');
      // Palantír of Orthanc grants a bonus draw — captured BEFORE this play so the
      // card doesn't trigger off its own play.
      const palantirWasActive = actor === 'shadow' && palantirActive(state);
      hand.splice(idx, 1);
      // Interactive card: pause for the player's target choice; the card is held
      // (out of hand) until the eventTarget resolves.
      const opts = h.targets ? h.targets(state, actor) : null;
      if (opts && opts.length > 0) {
        h.apply?.(state, actor); // immediate part (if any) runs before the interactive follow-up
        state.pendingChoice = { owner: actor, kind: 'eventTarget', data: { card: action.cardId, repeat: h.repeat ?? 1, left: h.repeat ?? 1, applied: [], palantir: palantirWasActive } };
        break;
      }
      h.apply?.(state, actor);
      const deck = EVENT_BY_ID[action.cardId]!.deck === 'Character' ? 'character' : 'strategy';
      if (h.onTable) state.cards[actor].table.push(action.cardId);
      else state.cards[actor].discard[deck].push(action.cardId);
      if (palantirWasActive) state.pendingChoice = { owner: 'shadow', kind: 'bonusDraw', data: {} };
      guideEventDraw(state, actor, deck); // Gandalf the Grey's Guide ability
      passResolutionTurn(state, actor); break;
    }
    case 'eventTarget': {
      requireChoice(state, 'eventTarget', actor);
      const data = state.pendingChoice!.data as { card: string; left: number; applied: EventTarget[]; palantir?: boolean };
      const h = getHandler(data.card);
      if (!h?.applyTarget) throw new Error('Not an interactive card');
      if (!action.done) {
        const target: EventTarget = { from: action.from, to: action.to, region: action.region, companion: action.companion, mode: action.mode };
        h.applyTarget(state, actor, target);
        data.applied.push(target);
        data.left -= 1;
        // Multi-target card with moves left and still-legal targets? Re-prompt (hold the
        // card) — unless an attack just started a battle (the combat driver takes over).
        if (!state.pendingCombat && data.left > 0 && (h.targets?.(state, actor, data.applied)?.length ?? 0) > 0) break;
      }
      state.pendingChoice = null;
      const deck = EVENT_BY_ID[data.card]!.deck === 'Character' ? 'character' : 'strategy';
      state.cards[actor].discard[deck].push(data.card);
      if (data.palantir) state.pendingChoice = { owner: 'shadow', kind: 'bonusDraw', data: {} };
      if (!state.pendingCombat) guideEventDraw(state, actor, deck); // Gandalf the Grey's Guide ability
      // A card that started a battle (Grond / Uruk-hai) hands off to the combat
      // driver, which resumes the turn itself — don't pass it here.
      if (!state.pendingCombat) passResolutionTurn(state, actor);
      break;
    }
    case 'lureChoice':
      requireChoice(state, 'lureChoice', actor); resolveLureChoice(state, action.mode); break; // turn already passed
    case 'bonusDraw': {
      requireChoice(state, 'bonusDraw', actor); // Palantír of Orthanc bonus draw
      drawOne(state, actor, action.deck);
      state.pendingChoice = null; break; // the turn already passed when the Event resolved
    }
    case 'diplomaticAction': {
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (actor === 'fp' && threatsAndPromisesActive(state) && !state.nations[action.nation].active) throw new Error('Threats and Promises bars advancing a passive Nation');
      if (!consumeOneOf(state, actor, ['muster', 'armyMuster', 'will'])) throw new Error('No Muster die');
      advancePolitical(state, action.nation, 1); passResolutionTurn(state, actor); break;
    }
    case 'recruitUnit':
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (!consumeOneOf(state, actor, ['muster', 'armyMuster', 'will'])) throw new Error('No Muster die');
      if (!recruit(state, action.nation, action.region, action.regular, action.elite)) throw new Error('Illegal recruit');
      passResolutionTurn(state, actor); break;
    case 'bringMinion':
      requirePhase(state, 'actionResolution');
      if (actor !== 'shadow') throw new Error('Only Shadow brings Minions');
      if (!consumeOneOf(state, actor, ['muster', 'armyMuster', 'will'])) throw new Error('No Muster die');
      if (!bringMinion(state, action.minion, action.region)) throw new Error('Cannot bring that Minion');
      passResolutionTurn(state, actor); break;
    case 'moveArmy':
      requirePhase(state, 'actionResolution');
      if (!consumeOneOf(state, actor, ['army', 'armyMuster', 'will'])) throw new Error('No Army die');
      if (!moveArmy(state, action.from, action.to, actor)) throw new Error('Illegal move');
      passResolutionTurn(state, actor); break;
    case 'attack':
      requirePhase(state, 'actionResolution');
      if (armySide(state, action.from) !== actor) throw new Error('No attacking army');
      if (actor === 'shadow' && shadowBarredFromRegion(state, action.to)) throw new Error('Region protected from Shadow');
      if (!consumeOneOf(state, actor, ['army', 'armyMuster', 'will'])) throw new Error('No Army die');
      startBattle(state, actor, action.from, action.to); break; // finishCombat resumes the turn
    // --- interactive combat choices (resolving state.pendingChoice) ---
    case 'playCombatCard':
      requireChoice(state, 'combatCard', actor); resolvePlayCombatCard(state, action.cardId); break;
    case 'chooseCasualties':
      requireChoice(state, 'combatCasualties', actor); resolveCasualties(state, action.plan); break;
    case 'combatContinue':
      requireChoice(state, 'combatContinue', actor); resolveContinue(state, action.cont); break;
    case 'combatRetreat':
      requireChoice(state, 'combatRetreat', actor); resolveRetreat(state, action.retreat); break;
    case 'siegeWithdraw':
      requireChoice(state, 'siegeWithdraw', actor); resolveSiegeWithdraw(state, action.withdraw); break;
    case 'retreatTo':
      requireChoice(state, 'retreatTo', actor); resolveRetreatTo(state, action.region); break;
    case 'moveCharacter': {
      requirePhase(state, 'actionResolution');
      if (!consumeOneOf(state, actor, ['character', 'will'])) throw new Error('No Character die');
      if (!moveCharacter(state, actor, action.char, action.from, action.to)) throw new Error('Illegal character move');
      passResolutionTurn(state, actor); break;
    }
    case 'huntDamage':
      requireChoice(state, 'huntDamage', actor);
      if (action.mode === 'reduceSeparate') {
        // The Hobbit Guide leaves the Fellowship (separateCompanion reassigns the
        // Guide); hunt damage drops by 1, then re-prompt / finish.
        separateCompanion(state, state.fellowship.guide);
        reduceHuntDamageBySeparate(state);
      } else {
        resolveHuntDamage(state, action.mode);
      }
      break;
    case 'huntPreventDraw':
      requireChoice(state, 'huntPreventDraw', actor); resolveHuntPreventDraw(state, action.prevent); break;
    case 'huntRedraw':
      requireChoice(state, 'huntRedraw', actor); resolveHuntRedraw(state, action.redraw); break;
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

function requireChoice(state: GameState, kind: string, actor: Side): void {
  if (!state.pendingChoice || state.pendingChoice.kind !== kind) throw new Error(`No pending ${kind} choice`);
  if (state.pendingChoice.owner !== actor) throw new Error('Not your choice');
}

function consumeOneOf(state: GameState, side: Side, faces: DieFace[]): boolean {
  for (const f of faces) if (consumeDie(state, side, f)) return true;
  return false;
}

/** Will-of-the-West upgrade options currently available (FP). */
function upgradeOptions(state: GameState): WotrAction[] {
  const out: WotrAction[] = [];
  if (canBringAragorn(state)) out.push({ kind: 'bringUpgrade', which: 'aragorn' });
  if (canBringGandalfWhite(state)) out.push({ kind: 'bringUpgrade', which: 'gandalf-white' });
  return out;
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

/** Army-move options: every legal adjacent move for each of the side's stacks (so
 *  the AI can steer direction), capped. */
function moveTargets(state: GameState, side: Side, cap = 28): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const from of Object.keys(state.regions)) {
    if (armySide(state, from) !== side) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (canMoveArmy(state, from, to, side)) { out.push([from, to]); if (out.length >= cap) return out; }
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

/** Gandalf the Grey's Guide ability: after the FP plays an Event card while Gandalf
 *  is the Guide, draw a card from the deck matching that card's type. (Applied
 *  automatically — it's an always-beneficial "may"; matches the Palantír handling.) */
function guideEventDraw(state: GameState, actor: Side, deck: 'character' | 'strategy'): void {
  if (actor === 'fp' && state.fellowship.guide === 'gandalf-grey') drawOne(state, 'fp', deck);
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
