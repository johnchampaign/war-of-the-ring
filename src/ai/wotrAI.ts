// Heuristic AI (v1). A synchronous chooser over the SAME action vocabulary as a
// human, scoring legal actions toward each side's win condition and resolving
// pending choices sensibly. It reads only public information (the redacted view):
// region contents, the Fellowship's public Corruption/Progress, dice — never the
// opponent's hand or the RNG. Deterministic given the passed rng (tie-breaks).
//
// Strategy in brief:
//  - FP: push the Fellowship toward Mordor while keeping Corruption survivable
//    (declare to advance the figure, enter Mordor, hide when revealed; trade a
//    Companion for Corruption only in the danger zone); heal via events.
//  - Shadow: allocate the Hunt hard, mobilize nations to War, muster and press
//    attacks on Free Peoples Cities/Strongholds for Military-victory VP.
import type { GameState, Side, RegionId, Nation } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { Rng } from 'digital-boardgame-framework';
import { REGIONS } from '../engine/data';
import { unitCount } from '../engine/armies';
import { combatModsFor, type CombatMods } from '../engine/combatCards';

const HEAL_EVENTS = new Set(['fp-char-09', 'fp-char-10', 'fp-char-12', 'fp-char-13']);
const CORRUPT_EVENTS = new Set(['sh-char-08', 'sh-char-12']);

export function chooseAction(state: GameState, actor: Side, legal: WotrAction[], rng: Rng): WotrAction {
  if (legal.length === 1) return legal[0]!;

  // --- pending choices (combat / hunt) ---
  if (state.pendingChoice) return resolveChoice(state, legal);

  // --- hunt allocation (Shadow): allocate the maximum offered ---
  if (state.phase === 'huntAllocation') {
    return legal.reduce((best, a) =>
      (a.kind === 'allocateHunt' && (best.kind !== 'allocateHunt' || a.dice > best.dice)) ? a : best, legal[0]!);
  }

  // --- fellowship phase (FP): enter Mordor > declare when advanced > skip ---
  if (state.phase === 'fellowship') {
    const enter = legal.find((a) => a.kind === 'enterMordor');
    if (enter) return enter;
    const declare = legal.find((a) => a.kind === 'declareFellowship');
    if (declare && state.fellowship.progress >= 2) return declare;
    return legal.find((a) => a.kind === 'skipFellowshipPhase') ?? legal[0]!;
  }

  // --- action resolution: score and pick the best ---
  const target = campaignTarget(state, actor); // an enemy Settlement to march on
  let best = legal[0]!, bestScore = -Infinity;
  for (const a of legal) {
    const s = score(state, actor, a, target) + rng.next() * 0.5; // tiny noise for tie-breaks
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

const FP = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan']);
const settlementCtrl = (state: GameState, id: RegionId): Side | null => {
  const def = REGIONS[id]!;
  if (!def.settlement) return null;
  return state.regions[id]!.control ?? (def.nation ? (FP.has(def.nation) ? 'fp' : 'shadow') : null);
};
const armyHere = (state: GameState, id: RegionId, side: Side): boolean => {
  const r = state.regions[id]!;
  return (Object.keys(r.units) as Nation[]).some((n) => FP.has(n) === (side === 'fp') && (r.units[n]!.regular + r.units[n]!.elite) > 0);
};

/** BFS distance between two regions over adjacency (Infinity if unreachable). */
function dist(from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const seen = new Set([from]); let frontier = [from], d = 0;
  while (frontier.length) {
    d++; const next: RegionId[] = [];
    for (const r of frontier) for (const a of REGIONS[r]?.adjacency ?? []) {
      if (seen.has(a)) continue; if (a === to) return d; seen.add(a); next.push(a);
    }
    frontier = next;
  }
  return Infinity;
}

/** The enemy Settlement (vp>0) worth marching on: nearest to one of our armies,
 *  weighted by VP. Cached per state object (one campaign target per decision). */
const targetCache = new WeakMap<object, RegionId | null>();
function campaignTarget(state: GameState, actor: Side): RegionId | null {
  if (targetCache.has(state)) return targetCache.get(state)!;
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  const myArmies = Object.keys(state.regions).filter((id) => armyHere(state, id, actor));
  let best: RegionId | null = null, bestScore = -Infinity;
  for (const id of Object.keys(state.regions)) {
    const def = REGIONS[id]!;
    if (def.vp <= 0 || settlementCtrl(state, id) !== enemy) continue;
    const d = myArmies.reduce((m, a) => Math.min(m, dist(a, id)), Infinity);
    if (d === Infinity) continue;
    const s = def.vp * 4 - d;
    if (s > bestScore) { bestScore = s; best = id; }
  }
  targetCache.set(state, best);
  return best;
}

function score(state: GameState, actor: Side, a: WotrAction, target: RegionId | null): number {
  const fs = state.fellowship;
  switch (a.kind) {
    case 'moveFellowship': return fs.corruption >= 11 ? 8 : 65;       // push hard, ease off at the brink
    case 'hideFellowship': return 85;                                  // must hide to keep moving
    case 'separateCompanion': {                                        // rouse a passive nation
      const passiveFp = (['dwarves', 'gondor', 'north', 'rohan'] as Nation[]).some((n) => state.nations[n].step > 0 && !state.nations[n].active);
      return passiveFp && fs.corruption < 6 ? 40 : 12;
    }
    case 'attack': {
      const fromU = unitCount(state, a.from), toU = unitCount(state, a.to);
      if (fromU < toU) return -50;                                     // don't attack uphill
      return (fromU - toU) * 8 + REGIONS[a.to]!.vp * 25 + 25;
    }
    case 'bringUpgrade': return 70; // Aragorn / Gandalf the White: +1 FP die
    case 'bringMinion': return 55; // +1 die and a strong leader — high tempo
    case 'recruitUnit': return actor === 'shadow' ? 38 : 20; // build the war stacks
    case 'moveArmy': return armyMoveScore(state, actor, a.from, a.to, target);
    case 'diplomaticAction': return 32;                                // mobilize toward At War
    case 'playEvent':
      if (actor === 'fp' && HEAL_EVENTS.has(a.cardId)) return fs.corruption >= 6 ? 95 : 25;
      if (actor === 'shadow' && CORRUPT_EVENTS.has(a.cardId)) return 70;
      return 35;
    case 'drawEvent': return 12;
    case 'skipDie': return 1;
    case 'pass': return 0;
    default: return 2;
  }
}

/** March toward the campaign target, capture undefended enemy Settlements
 *  outright, and concentrate stacks. */
function armyMoveScore(state: GameState, actor: Side, from: RegionId, to: RegionId, target: RegionId | null): number {
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  let s = actor === 'shadow' ? 16 : 8;
  if (settlementCtrl(state, to) === enemy && !armyHere(state, to, enemy)) s += REGIONS[to]!.vp * 30 + 25; // capture
  if (armyHere(state, to, actor)) s += 10;                                                                // concentrate
  if (target) { s += -(dist(to, target) - dist(from, target)) * 12; if (to === target) s += 30; }         // march
  return s;
}

function combatCardValue(m: CombatMods | null): number {
  if (!m) return 0;
  return (m.rollBonus ?? 0) * 2 + (m.extraAttackDice ?? 0) + (m.bonusHitsIfAny ?? 0) * 2
    + (m.bonusHitsIfOutnumber ?? 0) + (m.enemyRollPenalty ?? 0) * 2 + (m.maxDiceEnemy != null ? 2 : 0)
    + (m.cancelEnemyCard ? 3 : 0) + (m.negateEnemyReroll ? 2 : 0) + (m.cancelHits ?? 0) * 2;
}

function resolveChoice(state: GameState, legal: WotrAction[]): WotrAction {
  const pc = state.pendingCombat;
  switch (state.pendingChoice!.kind) {
    case 'combatCard': {
      // Play the most valuable combat card, or none if nothing helps enough.
      let best: WotrAction = { kind: 'playCombatCard', cardId: null }, bestVal = 1.5;
      for (const a of legal) {
        if (a.kind !== 'playCombatCard' || a.cardId == null) continue;
        const v = combatCardValue(combatModsFor(a.cardId));
        if (v > bestVal) { bestVal = v; best = a; }
      }
      return best;
    }
    case 'huntDamage': {
      const damage = (state.pendingChoice!.data as { damage: number }).damage;
      const wouldCorrupt = state.fellowship.corruption + damage;
      // Trade a Companion (random, to keep the Guide) only when Corruption is
      // about to get dangerous; otherwise absorb.
      if (wouldCorrupt >= 8 && state.fellowship.companions.length > 0) {
        return legal.find((a) => a.kind === 'huntDamage' && a.mode === 'random') ?? legal[0]!;
      }
      return legal.find((a) => a.kind === 'huntDamage' && a.mode === 'corruption') ?? legal[0]!;
    }
    case 'combatCasualties': // keep Elites (strength): remove Regulars first
      return legal.find((a) => a.kind === 'chooseCasualties' && a.plan === 'regularsFirst') ?? legal[0]!;
    case 'combatContinue': {
      const cont = !!pc && unitCount(state, pc.from) >= unitCount(state, pc.to);
      return legal.find((a) => a.kind === 'combatContinue' && a.cont === cont) ?? legal[0]!;
    }
    case 'combatRetreat': {
      const losing = !!pc && unitCount(state, pc.to) < unitCount(state, pc.from);
      const want = legal.find((a) => a.kind === 'combatRetreat' && a.retreat === losing);
      return want ?? legal[0]!;
    }
    default: return legal[0]!;
  }
}
