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
import type { GameState, Side, RegionId } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import type { Rng } from 'digital-boardgame-framework';
import { REGIONS } from '../engine/data';
import { unitCount } from '../engine/armies';

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
  let best = legal[0]!, bestScore = -Infinity;
  for (const a of legal) {
    const s = score(state, actor, a) + rng.next() * 0.5; // tiny noise for tie-breaks
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

function score(state: GameState, actor: Side, a: WotrAction): number {
  const fs = state.fellowship;
  switch (a.kind) {
    case 'moveFellowship': return fs.corruption >= 11 ? 8 : 65;       // push hard, ease off at the brink
    case 'hideFellowship': return 85;                                  // must hide to keep moving
    case 'attack': {
      const fromU = unitCount(state, a.from), toU = unitCount(state, a.to);
      if (fromU < toU) return -50;                                     // don't attack uphill
      const def = REGIONS[a.to]!;
      const vp = def.vp;
      return (fromU - toU) * 8 + (actor === 'shadow' ? vp * 25 : vp * 6) + 20;
    }
    case 'bringMinion': return 55; // +1 die and a strong leader — high tempo
    case 'recruitUnit': return actor === 'shadow' ? 30 : 20;
    case 'moveArmy': return armyAdvanceScore(state, actor, a.from, a.to);
    case 'diplomaticAction': return 28;                                // mobilize toward At War
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

/** Prefer moving armies toward the nearest enemy Settlement (Shadow attacks FP
 *  cities/strongholds; FP repositions defensively, weaker preference). */
function armyAdvanceScore(state: GameState, actor: Side, from: RegionId, to: RegionId): number {
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  const base = actor === 'shadow' ? 14 : 8;
  // Bonus if the destination is adjacent to an enemy Settlement (closing in).
  for (const adj of REGIONS[to]!.adjacency) {
    const def = REGIONS[adj]!;
    if (def.settlement && (def.vp > 0)) {
      const ctrl = state.regions[adj]!.control ?? (def.nation ? (FP.has(def.nation) ? 'fp' : 'shadow') : null);
      if (ctrl === enemy) return base + def.vp * 6;
    }
  }
  return base;
}
const FP = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan']);

function resolveChoice(state: GameState, legal: WotrAction[]): WotrAction {
  const pc = state.pendingCombat;
  switch (state.pendingChoice!.kind) {
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
