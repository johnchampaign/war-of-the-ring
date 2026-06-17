// The GameAdapter — the ONLY engine-side file that imports the framework. It maps
// flat (state, action, actor) calls onto the engine: validates + applies actions,
// drives the phase machine, and redacts per-seat views.
import type { GameAdapter } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from './wotrAction';
import {
  advance, consumeDie, passResolutionTurn, huntAllocationBounds, checkRingVictory,
} from '../engine/phases';
import { moveFellowship, hideFellowship, declareFellowship, enterMordor, separateCompanion, beginSeparation, placeSeparatedCompanion, separationDestinations, separationRange, bringUpgrade, canBringAragorn, canBringGandalfWhite, resolveLureChoice, eligibleGuides, setGuide, findCharacterRegion, pathTo, MORDOR_ENTRANCES } from '../engine/fellowship';
import { extraHunt } from '../engine/hunt';
import { log } from '../engine/log';
import {
  recruit, moveArmy, moveArmySplit, canMoveArmy, moveBlockReason, armySide, settlementController, unitCount, STACKING_LIMIT,
  recruitNazgul, canRecruitNazgul, overStack, removeStackUnit,
} from '../engine/armies';
import { startBattle, attackError, attackTargets, resolveCasualties, resolveContinue, resolveRetreat, resolveRetreatTo, resolveSiegeWithdraw, resolveWhiteRider, retreatDestinations, canRetreat, playableCombatCards, resolvePlayCombatCard } from '../engine/combat';
import { resolveHuntDamage, reduceHuntDamageBySeparate, huntReduceCardAvailable, resolveHuntPreventDraw, resolveHuntRedraw, resolveCrebain } from '../engine/hunt';
import { advancePolitical, advanceableNations, isAtWar } from '../engine/politics';
import { shadowBarredFromRegion, threatsAndPromisesActive, palantirActive } from '../engine/persistent';
import { canBringMinion, entryRegion, bringMinion, MINION_IDS } from '../engine/minions';
import { moveCharacter, characterMoveOptions } from '../engine/charMove';
import { REGIONS, sideOfNation, EVENT_BY_ID } from '../engine/data';
import type { DieFace, Nation, RegionId } from '../engine/types';
import { getHandler, canPlayCard, type EventTarget } from '../engine/handlers/registry';
import '../engine/handlers/index'; // registers the handlers (side-effect import)
import { redactStateForViewer } from './redact';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const opp = (s: Side): Side => (s === 'fp' ? 'shadow' : 'fp');

// Mouth of Sauron "Messenger of the Dark Tower": once per turn a Muster die may act as
// an Army die. Available while the Mouth is in play and that hasn't been used yet.
const mouthMessengerAvailable = (state: GameState): boolean =>
  state.characters.entered.includes('mouth-of-sauron') && !state.characters.eliminated.includes('mouth-of-sauron') && !state.flags.mouthMusterUsedThisTurn;
/** Consume a die for an Army action, honoring the Mouth's Messenger (Muster→Army). */
function consumeArmyDie(state: GameState, actor: Side): boolean {
  if (consumeOneOf(state, actor, ['army', 'armyMuster', 'will'])) return true;
  if (actor === 'shadow' && mouthMessengerAvailable(state) && consumeDie(state, 'shadow', 'muster')) {
    state.flags.mouthMusterUsedThisTurn = true;
    return true;
  }
  return false;
}

// Companion political abilities (High Warden / Prince of Mirkwood / Dwarf of Erebor):
// while the Companion stands in their own unconquered Settlement, any Action die may
// advance their Nation one step. Returns the legal companionMuster actions.
const COMPANION_POLITICS: { companion: string; nation: Nation; at: (r: RegionId) => boolean }[] = [
  { companion: 'boromir', nation: 'gondor', at: (r) => REGIONS[r]!.nation === 'gondor' && (REGIONS[r]!.settlement === 'City' || REGIONS[r]!.settlement === 'Stronghold') },
  { companion: 'legolas', nation: 'elves', at: (r) => REGIONS[r]!.nation === 'elves' && REGIONS[r]!.settlement === 'Stronghold' },
  { companion: 'gimli', nation: 'dwarves', at: (r) => r === 'erebor' },
];
// Voice of Saruman: while Orthanc is Shadow-held + unbesieged and Saruman is in play, a
// Muster die may EITHER recruit one Isengard Regular in every Isengard Settlement, OR
// replace two Regular Isengard units in Orthanc with two Elites.
const isengardSettlements = (): RegionId[] => Object.keys(REGIONS).filter((id) => REGIONS[id]!.nation === 'isengard' && !!REGIONS[id]!.settlement);
const voiceOfSarumanActive = (state: GameState): boolean =>
  state.characters.entered.includes('saruman') && !state.characters.eliminated.includes('saruman')
  && settlementController(state, 'orthanc') === 'shadow' && !state.regions['orthanc']!.besieged;
const canSarumanRecruit = (state: GameState): boolean =>
  state.reinforcements.isengard.regular > 0
  && isengardSettlements().some((id) => settlementController(state, id) === 'shadow' && unitCount(state, id) < STACKING_LIMIT);
const canSarumanUpgrade = (state: GameState): boolean =>
  (state.regions['orthanc']!.units.isengard?.regular ?? 0) >= 2 && state.reinforcements.isengard.elite >= 2;
function sarumanMusterOptions(state: GameState): WotrAction[] {
  if (!voiceOfSarumanActive(state)) return [];
  const out: WotrAction[] = [];
  if (canSarumanRecruit(state)) out.push({ kind: 'sarumanMuster', mode: 'recruit' });
  if (canSarumanUpgrade(state)) out.push({ kind: 'sarumanMuster', mode: 'upgrade' });
  return out;
}
// Elven Rings (rules p.21): once per turn a player may change one of their unused
// Action dice to another face. FP can't change a die TO Will; SH can't change a die
// that's already an Eye (changing TO an Eye sends that die straight to the Hunt Box).
// FP-use flips a Ring to the Shadow side; SH-use discards it.
const ringAvailable = (state: GameState, side: Side): boolean =>
  !state.flags[side === 'fp' ? 'fpUsedElvenRingThisTurn' : 'shadowUsedElvenRingThisTurn']
  && state.elvenRings.includes(side === 'fp' ? 'fp' : 'shadow');
function elvenRingOptions(state: GameState, side: Side): WotrAction[] {
  if (state.phase !== 'actionResolution' || !ringAvailable(state, side)) return [];
  const present = [...new Set(state.dice[side])] as DieFace[];
  const targets: DieFace[] = side === 'fp'
    ? ['character', 'army', 'muster', 'armyMuster', 'event']           // FP: not Will, not Eye
    : ['character', 'army', 'muster', 'armyMuster', 'event', 'eye'];   // SH: Eye → Hunt Box
  const out: WotrAction[] = [];
  for (const from of present) {
    if (side === 'shadow' && from === 'eye') continue; // can't change a die already showing an Eye
    for (const to of targets) if (to !== from) out.push({ kind: 'useElvenRing', from, to });
  }
  return out;
}
function companionMusterOptions(state: GameState): WotrAction[] {
  const out: WotrAction[] = [];
  for (const pa of COMPANION_POLITICS) {
    const r = findCharacterRegion(state, pa.companion);
    const ns = state.nations[pa.nation];
    const canAdvance = ns.step > (ns.active ? 0 : 1);
    if (r && pa.at(r) && settlementController(state, r) === 'fp' && canAdvance) {
      out.push({ kind: 'companionMuster', companion: pa.companion, nation: pa.nation });
    }
  }
  return out;
}

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

/** Regions within `n` adjacency-steps of `from` (excludes `from`). */
function regionsWithin(from: RegionId, n: number): RegionId[] {
  const seen = new Set<RegionId>([from]); let layer: RegionId[] = [from]; const out: RegionId[] = [];
  for (let d = 0; d < n; d++) {
    const next: RegionId[] = [];
    for (const r of layer) for (const a of REGIONS[r]?.adjacency ?? []) if (!seen.has(a)) { seen.add(a); next.push(a); out.push(a); }
    layer = next;
  }
  return out;
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
      case 'whiteRider':
        return [{ kind: 'whiteRider', forfeit: true }, { kind: 'whiteRider', forfeit: false }];
      case 'balrog':
        return [{ kind: 'balrog', use: true }, { kind: 'balrog', use: false }];
      case 'crebain':
        return [{ kind: 'crebain', use: true }, { kind: 'crebain', use: false }];
      case 'combatRetreat':
        return canRetreat(state)
          ? [{ kind: 'combatRetreat', retreat: true }, { kind: 'combatRetreat', retreat: false }]
          : [{ kind: 'combatRetreat', retreat: false }];
      case 'retreatTo':
        return retreatDestinations(state).map((region) => ({ kind: 'retreatTo', region }));
      case 'eventTarget': {
        const data = state.pendingChoice!.data as { card: string; applied: EventTarget[]; repeat: number };
        const h = getHandler(data.card);
        const opts: Extract<WotrAction, { kind: 'eventTarget' }>[] = (h?.targets?.(state, actor, data.applied) ?? []).map((t) => ({ kind: 'eventTarget' as const, card: data.card, from: t.from, to: t.to, region: t.region, nation: t.nation, companion: t.companion, mode: t.mode, figure: t.figure, slot: t.slot, eye: t.eye }));
        // Multi-target cards (repeat>1) may stop early once ≥1 target is applied.
        if ((h?.repeat ?? 1) > 1 && (data.applied.length > 0 || h?.optionalFromStart) && !h?.noDone) opts.push({ kind: 'eventTarget' as const, card: data.card, done: true });
        return opts;
      }
      case 'bonusDraw':
        return [{ kind: 'bonusDraw', deck: 'character' }, { kind: 'bonusDraw', deck: 'strategy' }, { kind: 'bonusDraw', deck: 'none' }];
      case 'guideDraw':
        return [{ kind: 'guideDraw', draw: true }, { kind: 'guideDraw', draw: false }];
      case 'sorcererDraw':
        return [{ kind: 'sorcererDraw', draw: true }, { kind: 'sorcererDraw', draw: false }];
      case 'lureChoice':
        return [{ kind: 'lureChoice', mode: 'corruption' }, { kind: 'lureChoice', mode: 'eliminate' }];
      case 'stormcrowLoss': {
        // FP chooses which unit of the targeted Nation to eliminate (Stormcrow).
        const data = state.pendingChoice!.data as { nation: Nation };
        const acts: WotrAction[] = [];
        for (const id of Object.keys(state.regions)) {
          const u = state.regions[id]!.units[data.nation];
          if (u && u.regular > 0) acts.push({ kind: 'stormcrowLoss', region: id, nation: data.nation, figure: 'regular' });
          if (u && u.elite > 0) acts.push({ kind: 'stormcrowLoss', region: id, nation: data.nation, figure: 'elite' });
        }
        return acts;
      }
      case 'breakingSep': {
        // FP chooses which Companion to separate (The Breaking of the Fellowship).
        return state.fellowship.companions.filter((c) => c !== 'gollum').map((companion) => ({ kind: 'breakingSep', companion }));
      }
      case 'discardCard':
        // Over the hand limit: choose which Event card to discard.
        return [...new Set(state.cards[actor].hand)].map((card) => ({ kind: 'discardCard', card }));
      case 'huntDamage': {
        const fs = state.fellowship;
        const acts: WotrAction[] = [{ kind: 'huntDamage', mode: 'corruption' }];
        if (fs.companions.length > 0) {
          acts.push({ kind: 'huntDamage', mode: 'guide' }, { kind: 'huntDamage', mode: 'random' });
        }
        // Guide damage-reduction abilities (−1 each): separate a Hobbit Guide, or
        // Gollum reveals the Fellowship. The Hobbit "separate −1" is NOT available in
        // Mordor — Companions can't be separated there (rulebook p.43); eliminate one
        // as a casualty instead (the 'guide'/'random' options give the same −1 for a
        // Level-1 Hobbit).
        if ((fs.guide === 'meriadoc' || fs.guide === 'peregrin') && fs.mordor === null) acts.push({ kind: 'huntDamage', mode: 'reduceSeparate' });
        if (fs.guide === 'gollum' && fs.hidden) acts.push({ kind: 'huntDamage', mode: 'reduceReveal' });
        if (huntReduceCardAvailable(state)) acts.push({ kind: 'huntDamage', mode: 'reduceCard' });
        return acts;
      }
      case 'musterSecond': {
        const data = state.pendingChoice!.data as { figure: 'regular' | 'leader'; first: string };
        return recruitSecondTargets(state, actor, data.figure, data.first);
      }
      case 'removeExcess': {
        const data = state.pendingChoice!.data as { region: RegionId };
        const r = state.regions[data.region]!;
        const acts: WotrAction[] = [];
        for (const n of Object.keys(r.units) as Nation[]) {
          if (r.units[n]!.regular > 0) acts.push({ kind: 'removeExcess', nation: n, figure: 'regular' });
          if (r.units[n]!.elite > 0) acts.push({ kind: 'removeExcess', nation: n, figure: 'elite' });
        }
        return acts;
      }
      case 'armyMove2': {
        const data = state.pendingChoice!.data as { src: string; dest: string };
        const acts: WotrAction[] = [{ kind: 'armyMove2', done: true }];
        for (const [from, to] of moveTargets(state, actor)) {
          if (from === data.src || from === data.dest) continue; // a different army
          acts.push({ kind: 'armyMove2', from, to });
        }
        return acts;
      }
      case 'revealMove': {
        // The FP chooses where the figure moves (up to Progress); never ending in an
        // FP-controlled City/Stronghold (rulebook p.39).
        const fs = state.fellowship;
        const acts: WotrAction[] = [];
        for (const r of regionsWithin(fs.location, fs.progress)) {
          const def = REGIONS[r]!;
          if ((def.settlement === 'City' || def.settlement === 'Stronghold') && settlementController(state, r) === 'fp') continue;
          acts.push({ kind: 'revealMove', target: r });
        }
        return acts.length ? acts : [{ kind: 'revealMove', target: fs.location }]; // fallback: reveal in place
      }
      case 'separateMove': {
        // The FP board-clicks where the separated Companion lands (within range).
        const data = state.pendingChoice.data as { companion: string; from: RegionId; range: number };
        return separationDestinations(state, data.from, data.range).map((target) => ({ kind: 'separateMove' as const, companion: data.companion, target }));
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
      // Declare the Fellowship in ANY region within Progress region-steps of its
      // last-known position (the figure moves there; the player chooses — not a
      // forced march toward Mordor). The hidden Fellowship sneaks through anywhere,
      // including Shadow-Stronghold regions (Moria, Mordor), so no region is excluded.
      if (fs.hidden && fs.mordor === null && fs.progress > 0) {
        for (const r of regionsWithin(fs.location, fs.progress)) acts.push({ kind: 'declareFellowship', target: r });
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
      // Strider's Guide ability: a revealed Fellowship can be hidden with ANY die.
      if (actor === 'fp' && !fs.hidden && fs.guide === 'strider' && state.dice.fp.length > 0
        && !acts.some((a) => a.kind === 'hideFellowship')) {
        acts.push({ kind: 'hideFellowship' });
      }
      // Move independent characters (Nazgûl/Minions for SH, separated Companions
      // for FP) — a Character die, both sides.
      if (faces.has('character') || hasWill) {
        for (const m of characterMoveOptions(state, actor)) acts.push({ kind: 'moveCharacter', ...m });
      }
      if (hasWill) for (const u of upgradeOptions(state)) acts.push(u);
      // Drawing an Event card needs an Event (Palantír) or Will die.
      if (faces.has('event') || hasWill) {
        if (state.cards[actor].draw.character.length) acts.push({ kind: 'drawEvent', deck: 'character' });
        if (state.cards[actor].draw.strategy.length) acts.push({ kind: 'drawEvent', deck: 'strategy' });
      }
      // Playing an Event card (rulebook p.22): an Event/Will die plays ANY card; a
      // Character die plays a Character-deck card; an Army/Muster die plays a
      // Strategy-deck (Army/Muster) card.
      {
        const evtDie = faces.has('event') || hasWill;
        const charDie = faces.has('character');
        const stratDie = faces.has('army') || faces.has('muster') || faces.has('armyMuster');
        for (const cardId of state.cards[actor].hand) {
          const deck = EVENT_BY_ID[cardId]?.deck;
          const byType = (deck === 'Character' && charDie) || (deck === 'Strategy' && stratDie);
          if ((evtDie || byType) && canPlayCard(state, cardId, actor)) acts.push({ kind: 'playEvent', cardId });
        }
      }
      // The Ents Awake: FP may play one Character Event without an Action die.
      if (actor === 'fp' && state.flags.fpFreeCharEventThisTurn && !(faces.has('event') || hasWill)) {
        for (const cardId of state.cards.fp.hand) {
          if (EVENT_BY_ID[cardId]?.deck === 'Character' && canPlayCard(state, cardId, 'fp')) acts.push({ kind: 'playEvent', cardId });
        }
      }
      const hasMuster = faces.has('muster') || faces.has('armyMuster') || hasWill;
      const hasArmy = faces.has('army') || faces.has('armyMuster') || hasWill
        || (actor === 'shadow' && faces.has('muster') && mouthMessengerAvailable(state)); // Mouth's Messenger
      if (hasMuster) {
        for (const n of advanceableNations(state, actor)) acts.push({ kind: 'diplomaticAction', nation: n });
        acts.push(...recruitTargets(state, actor));
        if (actor === 'shadow') {
          for (const m of MINION_IDS) {
            if (canBringMinion(state, m)) { const r = entryRegion(state, m); if (r) acts.push({ kind: 'bringMinion', minion: m, region: r }); }
          }
          acts.push(...sarumanMusterOptions(state));
        }
      }
      if (hasArmy) {
        for (const [from, to] of moveTargets(state, actor)) acts.push({ kind: 'moveArmy', from, to });
        for (const [from, to] of attackTargets(state, actor)) acts.push({ kind: 'attack', from, to });
      } else if (faces.has('character')) {
        // Character die: move OR attack with one army containing a Leader/Nazgûl/Character.
        const leaderArmy = (from: string) => { const r = state.regions[from]!; return r.leaders > 0 || r.nazgul > 0 || r.characters.length > 0; };
        for (const [from, to] of moveTargets(state, actor)) if (leaderArmy(from)) acts.push({ kind: 'moveArmy', from, to });
        for (const [from, to] of attackTargets(state, actor)) if (leaderArmy(from)) acts.push({ kind: 'attack', from, to });
      }
      // Companion political abilities: any Action die advances their Nation.
      if (actor === 'fp' && state.dice.fp.length > 0) acts.push(...companionMusterOptions(state));
      acts.push(...elvenRingOptions(state, actor)); // Elven Rings: change a die's face

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

  // Snapshot so we can tag this action's log entries with the die it spent (Ira #9).
  const usedBefore = state.usedDice?.[actor]?.length ?? 0;
  const logBefore = state.log.length;

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
      state.phase = 'huntAllocation';
      // Declaring through a Shadow-controlled Stronghold draws a Hunt tile per such
      // Stronghold on the path (rules p.38). (If a tile's damage opens an FP choice,
      // any further Strongholds' tiles are deferred — see deviation log; very rare.)
      for (const r of traversed) {
        if (state.pendingChoice) break;
        if (REGIONS[r]!.settlement === 'Stronghold' && settlementController(state, r) === 'shadow') extraHunt(state);
      }
      // Balrog of Moria: a declaration that moves the Fellowship through Moria lets the
      // Shadow CHOOSE to discard the on-table card to draw an extra Hunt tile.
      if (!state.pendingChoice && state.cards.shadow.table.includes('sh-char-17') && traversed.includes('moria')) {
        state.pendingChoice = { owner: 'shadow', kind: 'balrog', data: {} };
      }
      break;
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
      if (!consumePreferred(state, 'fp', ['character', 'will'], action.die)) throw new Error('No Character die');
      moveFellowship(state); passResolutionTurn(state, actor); break;
    case 'hideFellowship': {
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP hides the Fellowship');
      // Strider's Guide ability lets any die hide; otherwise a Character/Will die.
      const hideFaces = state.fellowship.guide === 'strider' ? [...new Set(state.dice.fp)] : (['character', 'will'] as DieFace[]);
      if (!consumePreferred(state, 'fp', hideFaces, action.die)) throw new Error('No usable die');
      hideFellowship(state); passResolutionTurn(state, actor); break;
    }
    case 'separateCompanion': {
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP separates Companions');
      if (state.fellowship.mordor !== null) throw new Error('Companions cannot be separated in Mordor');
      if (!state.fellowship.companions.includes(action.companion)) throw new Error('Cannot separate that Companion');
      // Range is fixed at separation time; remove the Companion, then the player
      // board-clicks the destination (Ira Fay #5) via the separateMove choice.
      const range = separationRange(state, action.companion);
      const from = state.fellowship.location;
      if (!consumePreferred(state, 'fp', ['character', 'will'], action.die)) throw new Error('No Character die');
      beginSeparation(state, action.companion);
      state.pendingChoice = { owner: 'fp', kind: 'separateMove', data: { companion: action.companion, from, range } };
      break;
    }
    case 'separateMove': {
      requireChoice(state, 'separateMove', 'fp');
      const data = state.pendingChoice!.data as { companion: string; from: RegionId; range: number };
      const dests = separationDestinations(state, data.from, data.range);
      const dest = dests.includes(action.target) ? action.target : data.from;
      placeSeparatedCompanion(state, data.companion, dest);
      state.pendingChoice = null;
      passResolutionTurn(state, actor); break;
    }
    case 'bringUpgrade':
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Only FP upgrades');
      if (!consumeDie(state, 'fp', 'will')) throw new Error('No Will of the West die');
      if (!bringUpgrade(state, action.which)) throw new Error('Cannot bring that upgrade');
      passResolutionTurn(state, actor); break;
    case 'drawEvent':
      requirePhase(state, 'actionResolution');
      if (!consumePreferred(state, actor, ['event', 'will'], action.die)) throw new Error('No Event die');
      drawOne(state, actor, action.deck); passResolutionTurn(state, actor); break;
    case 'playEvent': {
      requirePhase(state, 'actionResolution');
      const hand = state.cards[actor].hand;
      const idx = hand.indexOf(action.cardId);
      if (idx < 0) throw new Error('Card not in hand');
      const h = getHandler(action.cardId);
      if (!h || !canPlayCard(state, action.cardId, actor)) throw new Error('Card not playable');
      // The Ents Awake free play: an FP Character Event costs no die (consumes the flag).
      const freePlay = actor === 'fp' && state.flags.fpFreeCharEventThisTurn && EVENT_BY_ID[action.cardId]!.deck === 'Character';
      // Which dice can pay for this card: its type die (Character / Army-Muster),
      // plus the Event (Palantír) and Will wildcards (rulebook p.22). The type die is
      // preferred so the scarce Event die is saved unless the player picks it.
      const playDeck = EVENT_BY_ID[action.cardId]?.deck;
      const playFaces: DieFace[] = playDeck === 'Character'
        ? ['character', 'event', 'will']
        : ['army', 'armyMuster', 'muster', 'event', 'will'];
      if (freePlay) state.flags.fpFreeCharEventThisTurn = false;
      else if (!consumePreferred(state, actor, playFaces, action.die)) throw new Error('No usable die to play this card');
      // Palantír of Orthanc grants a bonus draw — captured BEFORE this play so the
      // card doesn't trigger off its own play.
      const palantirWasActive = actor === 'shadow' && palantirActive(state);
      // Name the played card in the log (playing an Event reveals it — public info).
      log(state, null, 'event', `${actor === 'fp' ? 'Free Peoples' : 'Shadow'} plays ${EVENT_BY_ID[action.cardId]?.name ?? action.cardId}`);
      hand.splice(idx, 1);
      // Run the immediate part FIRST, then check the remaining targets — so the choice
      // offered matches the post-apply state (an apply may consume the very
      // reinforcements a later choice would draw from, e.g. A New Power is Rising).
      h.apply?.(state, actor);
      // Interactive card: pause for the player's target choice; the card is held
      // (out of hand) until the eventTarget resolves.
      const opts = h.targets ? h.targets(state, actor) : null;
      if (opts && opts.length > 0) {
        state.pendingChoice = { owner: actor, kind: 'eventTarget', data: { card: action.cardId, repeat: h.repeat ?? 1, left: h.repeat ?? 1, applied: [], palantir: palantirWasActive } };
        break;
      }
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
        const target: EventTarget = { from: action.from, to: action.to, region: action.region, nation: action.nation, companion: action.companion, mode: action.mode, figure: action.figure, slot: action.slot, eye: action.eye };
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
      // Post-resolution effect that may itself raise a follow-up choice (e.g. a
      // Fellowship move's Hunt) — run last so its PendingChoice isn't cleared above.
      if (!state.pendingCombat) h.finalize?.(state, actor, data.applied);
      break;
    }
    case 'lureChoice':
      requireChoice(state, 'lureChoice', actor); resolveLureChoice(state, action.mode); break; // turn already passed
    case 'stormcrowLoss': {
      requireChoice(state, 'stormcrowLoss', actor); // FP eliminates one unit of the targeted Nation
      const u = state.regions[action.region]!.units[action.nation];
      if (u && u[action.figure] > 0) { u[action.figure] -= 1; state.reinforcements[action.nation][action.figure] += 1; }
      log(state, null, 'event', `Stormcrow: Free Peoples lose a ${action.nation} ${action.figure === 'elite' ? 'Elite' : 'Regular'} in ${action.region}`);
      state.pendingChoice = null; break; // the turn already passed when the Event resolved
    }
    case 'discardCard': {
      requireChoice(state, 'discardCard', actor); // discard down to the 6-card limit (player's choice)
      const p = state.cards[actor];
      const i = p.hand.indexOf(action.card);
      if (i >= 0) {
        p.hand.splice(i, 1);
        const deck = EVENT_BY_ID[action.card]?.deck === 'Character' ? 'character' : 'strategy';
        p.discard[deck].push(action.card);
        log(state, actor, 'event', `${actor === 'fp' ? 'Free Peoples' : 'Shadow'} discards ${EVENT_BY_ID[action.card]?.name ?? action.card} (over the 6-card limit)`);
      }
      state.pendingChoice = null; break; // advance() re-checks and re-prompts if still over 6
    }
    case 'breakingSep': {
      requireChoice(state, 'breakingSep', actor); // FP separates a chosen Companion to the Fellowship's region
      const data = state.pendingChoice!.data as { left: number };
      const dest = state.fellowship.location;
      if (beginSeparation(state, action.companion)) placeSeparatedCompanion(state, action.companion, dest);
      data.left -= 1;
      if (data.left > 0 && state.fellowship.companions.some((c) => c !== 'gollum')) break; // re-prompt for the next
      state.pendingChoice = null; break; // the turn already passed when the Event resolved
    }
    case 'bonusDraw': {
      requireChoice(state, 'bonusDraw', actor); // Palantír of Orthanc bonus draw (or decline)
      if (action.deck !== 'none') drawOne(state, actor, action.deck);
      state.pendingChoice = null; break; // the turn already passed when the Event resolved
    }
    case 'guideDraw': {
      requireChoice(state, 'guideDraw', actor); // Gandalf the Grey Guide draw (or decline)
      if (action.draw) drawOne(state, 'fp', (state.pendingChoice!.data as { deck: 'character' | 'strategy' }).deck);
      state.pendingChoice = null; break;
    }
    case 'sorcererDraw': {
      requireChoice(state, 'sorcererDraw', actor); // Witch-king Sorcerer draw (or decline) — combat resumes via advance()
      if (action.draw) drawOne(state, 'shadow', (state.pendingChoice!.data as { deck: 'character' | 'strategy' }).deck);
      state.pendingChoice = null; break;
    }
    case 'diplomaticAction': {
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (actor === 'fp' && threatsAndPromisesActive(state) && !state.nations[action.nation].active) throw new Error('Threats and Promises bars advancing a passive Nation');
      if (!consumePreferred(state, actor, ['muster', 'armyMuster', 'will'], action.die)) throw new Error('No Muster die');
      advancePolitical(state, action.nation, 1); passResolutionTurn(state, actor); break;
    }
    case 'companionMuster': {
      requirePhase(state, 'actionResolution');
      if (actor !== 'fp') throw new Error('Not your ability');
      const pa = COMPANION_POLITICS.find((p) => p.companion === action.companion);
      const r = pa && findCharacterRegion(state, pa.companion);
      if (!pa || !r || !pa.at(r) || settlementController(state, r) !== 'fp') throw new Error('Companion ability condition not met');
      if (!consumePreferred(state, 'fp', [...new Set(state.dice.fp)], action.die)) throw new Error('No Action die');
      advancePolitical(state, pa.nation, 1); passResolutionTurn(state, actor); break;
    }
    case 'useElvenRing': {
      requirePhase(state, 'actionResolution');
      if (!ringAvailable(state, actor)) throw new Error('No Elven Ring available');
      if (actor === 'fp' && action.to === 'will') throw new Error('Cannot change a die to Will of the West');
      if (actor === 'shadow' && action.from === 'eye') throw new Error('Cannot change a die already showing an Eye');
      const di = state.dice[actor].indexOf(action.from);
      if (di < 0) throw new Error(`No ${action.from} die to change`);
      state.dice[actor].splice(di, 1);
      if (actor === 'shadow' && action.to === 'eye') state.hunt.box += 1; // straight to the Hunt Box (not an action)
      else state.dice[actor].push(action.to);
      // Flip (FP → Shadow) or discard (SH → used) one Ring, and mark the per-turn use.
      const ri = state.elvenRings.indexOf(actor === 'fp' ? 'fp' : 'shadow');
      if (ri >= 0) state.elvenRings[ri] = actor === 'fp' ? 'shadow' : 'used';
      state.flags[actor === 'fp' ? 'fpUsedElvenRingThisTurn' : 'shadowUsedElvenRingThisTurn'] = true;
      break; // free action — the player still acts this turn (no turn pass)
    }
    case 'sarumanMuster': {
      requirePhase(state, 'actionResolution');
      if (actor !== 'shadow' || !voiceOfSarumanActive(state)) throw new Error('Voice of Saruman not available');
      if (action.mode === 'upgrade' ? !canSarumanUpgrade(state) : !canSarumanRecruit(state)) throw new Error('Voice of Saruman option not available');
      if (!consumePreferred(state, 'shadow', ['muster', 'armyMuster', 'will'], action.die)) throw new Error('No Muster die');
      if (action.mode === 'upgrade') {
        const u = state.regions['orthanc']!.units.isengard!; // ≥2 Regulars (checked above)
        u.regular -= 2; u.elite += 2;
        state.reinforcements.isengard.regular += 2; state.reinforcements.isengard.elite -= 2;
      } else {
        for (const id of isengardSettlements()) {
          if (settlementController(state, id) === 'shadow') recruit(state, 'isengard', id, 1, 0, { ignoreAtWar: true });
        }
      }
      passResolutionTurn(state, actor); break;
    }
    case 'recruitUnit': {
      requirePhase(state, 'actionResolution');
      if (sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
      if (!consumePreferred(state, actor, ['muster', 'armyMuster', 'will'], action.die)) throw new Error('No Muster die');
      if (!placeFigure(state, actor, action.nation, action.region, firstFigure(action))) throw new Error('Illegal recruit');
      // A two-figure muster: the second figure goes to a SEPARATE Settlement (RAW p.26).
      if (action.then) state.pendingChoice = { owner: actor, kind: 'musterSecond', data: { figure: action.then, first: action.region } };
      else passResolutionTurn(state, actor);
      break;
    }
    case 'recruitSecond': {
      requireChoice(state, 'musterSecond', actor);
      const data = state.pendingChoice!.data as { figure: 'regular' | 'leader'; first: RegionId };
      state.pendingChoice = null;
      if (!action.done) {
        if (action.region === data.first) throw new Error('Second figure must go to a different Settlement');
        if (action.nation && sideOfNation(action.nation) !== actor) throw new Error('Not your nation');
        if (!placeFigure(state, actor, action.nation ?? 'sauron', action.region!, data.figure)) throw new Error('Illegal second recruit');
      }
      passResolutionTurn(state, actor);
      break;
    }
    case 'bringMinion':
      requirePhase(state, 'actionResolution');
      if (actor !== 'shadow') throw new Error('Only Shadow brings Minions');
      if (!consumePreferred(state, actor, ['muster', 'armyMuster', 'will'], action.die)) throw new Error('No Muster die');
      if (!bringMinion(state, action.minion, action.region)) throw new Error('Cannot bring that Minion');
      passResolutionTurn(state, actor); break;
    case 'moveArmy': {
      requirePhase(state, 'actionResolution');
      // An Army die moves any army; a Character die may move ONE army that
      // contains a Leader/Nazgûl/Character (rules-spec §6).
      const src = state.regions[action.from]!;
      const leaderArmy = src.leaders > 0 || src.nazgul > 0 || src.characters.length > 0;
      let viaArmyDie = false;
      if (action.die && consumeDie(state, actor, action.die)) viaArmyDie = action.die !== 'character';
      else if (consumeArmyDie(state, actor)) viaArmyDie = true;
      else if (leaderArmy && consumeDie(state, actor, 'character')) viaArmyDie = false;
      else throw new Error('No Army die');
      const moved = action.move
        ? moveArmySplit(state, action.from, action.to, actor, action.move, !viaArmyDie)
        : moveArmy(state, action.from, action.to, actor);
      if (!moved) {
        const reason = moveBlockReason(state, action.from, action.to, actor);
        throw new Error(reason ?? (action.move
          ? 'That split is not legal — a Character-die army move must include a Leader/Nazgûl/Character with the moving units, and at least one Army unit must move.'
          : 'Illegal move.'));
      }
      // An Army die may move a SECOND different army (rulebook p.27); a Character die moves only one.
      // Over-stacking (>10) prompts the player to remove the excess first (p.26).
      afterMove(state, actor, action.to, viaArmyDie ? { kind: 'armyMove2', src: action.from, dest: action.to } : { kind: 'pass' });
      break;
    }
    case 'armyMove2': {
      requireChoice(state, 'armyMove2', actor);
      const data = state.pendingChoice!.data as { src: RegionId; dest: RegionId };
      state.pendingChoice = null;
      if (!action.done) {
        // "Cannot move the same Army twice": the second move must be a different army.
        if (action.from === data.dest || action.from === data.src) throw new Error('Cannot move the same army twice');
        const ok2 = action.move
          ? moveArmySplit(state, action.from!, action.to!, actor, action.move, false)
          : moveArmy(state, action.from!, action.to!, actor);
        if (!ok2) {
          const reason = moveBlockReason(state, action.from!, action.to!, actor);
          throw new Error(reason ?? 'That second move is not legal (check the stacking limit and the moving nation\'s political status).');
        }
        afterMove(state, actor, action.to!, { kind: 'pass' }); // the 2nd move may also over-stack
      } else {
        passResolutionTurn(state, actor);
      }
      break;
    }
    case 'removeExcess': {
      requireChoice(state, 'removeExcess', actor);
      const data = state.pendingChoice!.data as { region: RegionId; next: MoveNext };
      if (!removeStackUnit(state, data.region, action.nation, action.figure)) throw new Error('No such unit to remove');
      if (overStack(state, data.region) > 0) break; // still over the limit — keep prompting
      state.pendingChoice = null;
      applyMoveNext(state, actor, data.next);
      break;
    }
    case 'attack': {
      requirePhase(state, 'actionResolution');
      if (armySide(state, action.from) !== actor) throw new Error('No attacking army');
      if (actor === 'shadow' && shadowBarredFromRegion(state, action.to)) throw new Error('Region protected from Shadow');
      // An Army die attacks any army; a Character die may attack with ONE army that
      // contains a Leader/Nazgûl/Character (rulebook p.28).
      const src = state.regions[action.from]!;
      const leaderArmy = src.leaders > 0 || src.nazgul > 0 || src.characters.length > 0;
      const faces = new Set(state.dice[actor]);
      const hasArmyDie = faces.has('army') || faces.has('armyMuster') || (actor === 'fp' && faces.has('will'))
        || (actor === 'shadow' && faces.has('muster') && mouthMessengerAvailable(state));
      const viaCharacterDie = action.die ? action.die === 'character' : (!hasArmyDie && leaderArmy && faces.has('character'));
      const aErr = attackError(state, action.from, actor, action.rearguard, viaCharacterDie);
      if (aErr) throw new Error(aErr);
      if (action.die) { if (!consumeDie(state, actor, action.die)) throw new Error('No Army die'); }
      else if (viaCharacterDie) { if (!consumeDie(state, actor, 'character')) throw new Error('No Army die'); }
      else if (!consumeArmyDie(state, actor)) throw new Error('No Army die');
      startBattle(state, actor, action.from, action.to, { rearguard: action.rearguard }); break; // finishCombat resumes the turn
    }
    // --- interactive combat choices (resolving state.pendingChoice) ---
    case 'playCombatCard': {
      requireChoice(state, 'combatCard', actor);
      resolvePlayCombatCard(state, action.cardId);
      // Witch-king "Sorcerer": Shadow plays a Combat card in the first round with the
      // Witch-king in the battle → flag an optional matching-deck Event draw, which the
      // combat driver pauses for (sorcererDraw choice) before the round resolves.
      const pc = state.pendingCombat;
      if (actor === 'shadow' && action.cardId && pc && pc.round === 0 && !pc.sorcererAsked) {
        const shR = pc.attacker === 'shadow' ? pc.from : pc.to;
        if (state.regions[shR]!.characters.includes('witch-king')) {
          pc.sorcererDeck = EVENT_BY_ID[action.cardId]!.deck === 'Character' ? 'character' : 'strategy';
        }
      }
      break;
    }
    case 'chooseCasualties':
      requireChoice(state, 'combatCasualties', actor); resolveCasualties(state, action.plan); break;
    case 'combatContinue':
      requireChoice(state, 'combatContinue', actor); resolveContinue(state, action.cont); break;
    case 'combatRetreat':
      requireChoice(state, 'combatRetreat', actor); resolveRetreat(state, action.retreat); break;
    case 'siegeWithdraw':
      requireChoice(state, 'siegeWithdraw', actor); resolveSiegeWithdraw(state, action.withdraw); break;
    case 'whiteRider':
      requireChoice(state, 'whiteRider', actor); resolveWhiteRider(state, action.forfeit); break;
    case 'crebain':
      requireChoice(state, 'crebain', actor); resolveCrebain(state, action.use); break; // makes the deferred Hunt roll
    case 'balrog': {
      requireChoice(state, 'balrog', actor);
      state.pendingChoice = null;
      const i = state.cards.shadow.table.indexOf('sh-char-17');
      if (action.use && i >= 0) {
        state.cards.shadow.table.splice(i, 1);
        state.cards.shadow.discard.character.push('sh-char-17');
        extraHunt(state); // may set a huntDamage choice for the FP
      }
      break; // Hunt Allocation phase was already set
    }
    case 'retreatTo':
      requireChoice(state, 'retreatTo', actor); resolveRetreatTo(state, action.region); break;
    case 'moveCharacter': {
      requirePhase(state, 'actionResolution');
      if (!consumePreferred(state, actor, ['character', 'will'], action.die)) throw new Error('No Character die');
      if (!moveCharacter(state, actor, action.char, action.from, action.to)) throw new Error('Illegal character move');
      passResolutionTurn(state, actor); break;
    }
    case 'huntDamage':
      requireChoice(state, 'huntDamage', actor);
      if (action.mode === 'reduceSeparate') {
        // The Hobbit Guide leaves the Fellowship (separateCompanion reassigns the
        // Guide); hunt damage drops by 1, then re-prompt / finish. Guard against
        // Mordor, where separateCompanion returns false — without this check the
        // reduction would apply for free (no Companion removed).
        if (!separateCompanion(state, state.fellowship.guide)) throw new Error('The Guide cannot be separated here (Companions cannot be separated in Mordor) — eliminate a Companion as a casualty instead.');
        reduceHuntDamageBySeparate(state);
      } else {
        resolveHuntDamage(state, action.mode);
      }
      break;
    case 'revealMove': {
      requireChoice(state, 'revealMove', 'fp');
      const fs = state.fellowship;
      const fromLoc = fs.location;
      const path = pathTo(fromLoc, action.target);
      const steps = Math.min(fs.progress, path.length);
      const traversed = [fromLoc, ...path.slice(0, steps)];
      if (steps > 0) fs.location = path[steps - 1]!;
      fs.progress = 0;
      fs.hidden = false;
      state.pendingChoice = null;
      // Revealing through a Shadow Stronghold draws a Hunt tile per such Stronghold on
      // the traced path (rulebook p.39). (If a tile opens an FP choice, further
      // Strongholds' tiles defer — same as declaration; deviation log.)
      for (const r of traversed) {
        if (state.pendingChoice) break;
        if (REGIONS[r]!.settlement === 'Stronghold' && settlementController(state, r) === 'shadow') extraHunt(state);
      }
      break; // checkRingVictory + advance run at dispatch end
    }
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
  // Tag the entries this action just logged with the die it spent, so the UI (turn
  // summary, log) can show "which die" the player used. The last face appended to
  // usedDice this dispatch is the die consumed; nothing appended = a free/phase action.
  const used = state.usedDice?.[actor] ?? [];
  if (used.length > usedBefore) {
    const spent = used[used.length - 1];
    for (let i = logBefore; i < state.log.length; i++) {
      if (state.log[i]!.die === undefined) state.log[i]!.die = spent;
    }
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
/** Spend the player's explicitly-chosen die (the die-picker) when it's one of the
 *  usable faces and available; otherwise auto-pick (specific die first). */
function consumePreferred(state: GameState, side: Side, faces: DieFace[], preferred?: DieFace): boolean {
  if (preferred && faces.includes(preferred) && consumeDie(state, side, preferred)) return true;
  return consumeOneOf(state, side, faces);
}

/** Will-of-the-West upgrade options currently available (FP). */
function upgradeOptions(state: GameState): WotrAction[] {
  const out: WotrAction[] = [];
  if (canBringAragorn(state)) out.push({ kind: 'bringUpgrade', which: 'aragorn' });
  if (canBringGandalfWhite(state)) out.push({ kind: 'bringUpgrade', which: 'gandalf-white' });
  return out;
}

type Figure = 'regular' | 'elite' | 'leader' | 'nazgul';
/** Which single figure a first-figure recruit action places. */
function firstFigure(a: Extract<WotrAction, { kind: 'recruitUnit' }>): Figure {
  if (a.nazgul) return 'nazgul';
  if (a.leader) return 'leader';
  if (a.elite) return 'elite';
  return 'regular';
}
/** Place one muster figure. For the Shadow a 'leader' figure is a Nazgûl, which
 *  goes into a Sauron Stronghold (rules-spec §6). */
function placeFigure(state: GameState, side: Side, nation: Nation, region: string, figure: Figure): boolean {
  switch (figure) {
    case 'regular': return recruit(state, nation, region, 1, 0);
    case 'elite': return recruit(state, nation, region, 0, 1);
    case 'nazgul': return recruitNazgul(state, region);
    case 'leader': return side === 'shadow' ? recruitNazgul(state, region) : recruit(state, nation, region, 0, 0, { leader: 1 });
  }
}

/** Free, friendly, At-War Settlement regions of `nation` (recruit targets). */
function recruitRegions(state: GameState, side: Side, nation: Nation, cap = 4): string[] {
  const out: string[] = [];
  for (const id of Object.keys(state.regions)) {
    const def = REGIONS[id]!;
    if (def.nation !== nation || !def.settlement) continue;
    if (settlementController(state, id) !== side || armySide(state, id) === opp(side)) continue;
    if (state.regions[id]!.besieged) continue; // can't muster into a besieged Stronghold (p.26)
    if (unitCount(state, id) >= STACKING_LIMIT) continue;
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

/** Recruit options for a Muster die — the first figure of each legal bundle
 *  (rules-spec §6): up to 2 Regulars, up to 2 Leaders/Nazgûl, 1 Regular + 1 Leader,
 *  1 Elite. A `then` marks a two-figure bundle whose second figure is placed in a
 *  SEPARATE Settlement (the 'recruitSecond' choice). Declining the second yields
 *  the lesser single-figure muster. Capped to keep the action list tractable. */
function recruitTargets(state: GameState, side: Side): WotrAction[] {
  const out: WotrAction[] = [];
  const naz = (state.reinforcements.sauron as { nazgul?: number }).nazgul ?? 0;
  for (const nation of Object.keys(state.nations) as Nation[]) {
    if (out.length >= 24) break;
    if (sideOfNation(nation) !== side || !isAtWar(state, nation)) continue;
    const pool = state.reinforcements[nation] as { regular: number; elite: number; leader?: number };
    const fpLead = side === 'fp' ? (pool.leader ?? 0) : 0;
    const canLead = side === 'shadow' ? naz > 0 : fpLead >= 1;
    // Offer EVERY eligible settlement of the Nation (not just the first) so you can
    // choose where to muster — e.g. The Shire vs Bree (Ira Fay #10b).
    for (const id of recruitRegions(state, side, nation, 4)) {
      if (out.length >= 24) break;
      if (pool.regular >= 1) out.push({ kind: 'recruitUnit', nation, region: id, regular: 1, elite: 0, then: 'regular' });
      if (pool.elite >= 1) out.push({ kind: 'recruitUnit', nation, region: id, regular: 0, elite: 1 });
      // 1 Regular + 1 Leader/Nazgûl, and 2 Leaders/Nazgûl. Shadow's "Leader" is a Nazgûl.
      if (pool.regular >= 1 && canLead) out.push({ kind: 'recruitUnit', nation, region: id, regular: 1, elite: 0, then: 'leader' });
      if (side === 'fp' && fpLead >= 1) out.push({ kind: 'recruitUnit', nation, region: id, regular: 0, elite: 0, leader: 1, then: 'leader' });
    }
  }
  // Shadow Nazgûl muster (Sauron Strongholds): up to 2 Nazgûl.
  if (side === 'shadow' && naz > 0) {
    const sr = Object.keys(state.regions).find((r) => canRecruitNazgul(state, r));
    if (sr) out.push({ kind: 'recruitUnit', nation: 'sauron', region: sr, regular: 0, elite: 0, nazgul: 1, then: 'leader' });
  }
  return out;
}

/** Second-figure placements for a two-figure muster: the same figure type, in a
 *  Settlement other than the first (RAW: separate Settlements). */
function recruitSecondTargets(state: GameState, side: Side, figure: 'regular' | 'leader', first: string): WotrAction[] {
  const out: WotrAction[] = [{ kind: 'recruitSecond', done: true }];
  if (figure === 'leader' && side === 'shadow') {
    for (const r of Object.keys(state.regions)) if (r !== first && canRecruitNazgul(state, r)) { out.push({ kind: 'recruitSecond', nation: 'sauron', region: r, figure }); break; }
    return out;
  }
  for (const nation of Object.keys(state.nations) as Nation[]) {
    if (sideOfNation(nation) !== side || !isAtWar(state, nation)) continue;
    const pool = state.reinforcements[nation] as { regular: number; leader?: number };
    if (figure === 'regular' ? pool.regular < 1 : (pool.leader ?? 0) < 1) continue;
    for (const r of recruitRegions(state, side, nation, 3)) if (r !== first) { out.push({ kind: 'recruitSecond', nation, region: r, figure }); break; }
    if (out.length >= 8) break;
  }
  return out;
}

// What happens once a move (and any over-stack removal) is fully resolved: either
// offer the Army die's optional second move, or pass the resolution turn.
type MoveNext = { kind: 'armyMove2'; src: RegionId; dest: RegionId } | { kind: 'pass' };

/** After a move lands, prompt to remove any units over the 10-stacking limit
 *  (rulebook p.26) before continuing; otherwise continue immediately. */
function afterMove(state: GameState, actor: Side, to: RegionId, next: MoveNext): void {
  if (overStack(state, to) > 0) {
    state.pendingChoice = { owner: actor, kind: 'removeExcess', data: { region: to, next } };
    return;
  }
  applyMoveNext(state, actor, next);
}

function applyMoveNext(state: GameState, actor: Side, next: MoveNext): void {
  if (next.kind === 'armyMove2') state.pendingChoice = { owner: actor, kind: 'armyMove2', data: { src: next.src, dest: next.dest } };
  else passResolutionTurn(state, actor);
}

/** Army-move options: every legal adjacent move for each of the side's stacks (so
 *  the AI can steer direction), capped. */
function moveTargets(state: GameState, side: Side): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const from of Object.keys(state.regions)) {
    if (armySide(state, from) !== side) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (canMoveArmy(state, from, to, side)) out.push([from, to]); // every legal move (incl. merging onto a friendly army); no cap — the UI needs them all
    }
  }
  return out;
}

function drawOne(state: GameState, side: Side, deck: 'character' | 'strategy'): void {
  const p = state.cards[side];
  const top = p.draw[deck].shift();
  if (top) p.hand.push(top);
  // Over-limit is resolved by the player's discard choice (engine enforceHandLimit).
}

/** Gandalf the Grey's Guide ability: after the FP plays an Event card while Gandalf is
 *  the Guide, the FP MAY draw a card from the matching deck — offered as a prompt. If a
 *  choice is already pending (rare chained effect), fall back to drawing automatically. */
function guideEventDraw(state: GameState, actor: Side, deck: 'character' | 'strategy'): void {
  if (actor !== 'fp' || state.fellowship.guide !== 'gandalf-grey') return;
  if (state.pendingChoice) { drawOne(state, 'fp', deck); return; }
  state.pendingChoice = { owner: 'fp', kind: 'guideDraw', data: { deck } };
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
