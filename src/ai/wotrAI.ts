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
import type { WotrAction, MoveSel } from '../adapter/wotrAction';
import type { Rng } from 'digital-boardgame-framework';
import { REGIONS, levelOf } from '../engine/data';
import { unitCount, STACKING_LIMIT } from '../engine/armies';
import { combatModsFor, type CombatMods } from '../engine/combatCards';

const HEAL_EVENTS = new Set(['fp-char-09', 'fp-char-10', 'fp-char-12', 'fp-char-13']);
const CORRUPT_EVENTS = new Set(['sh-char-08', 'sh-char-12']);
const SHADOW_CHARS = new Set(['witch-king', 'saruman', 'mouth-of-sauron']); // the rest are FP Companions

export function chooseAction(state: GameState, actor: Side, legal: WotrAction[], rng: Rng): WotrAction {
  if (legal.length === 1) return legal[0]!;

  // --- pending choices (combat / hunt) ---
  if (state.pendingChoice) return resolveChoice(state, legal);

  // --- hunt allocation (Shadow): put a FEW dice in the Hunt Box (pressure scales with
  //     the Fellowship's progress) but keep most for actions — never dump them all,
  //     which would leave Shadow with no Action dice this turn. ---
  if (state.phase === 'huntAllocation') {
    const opts = legal.filter((a) => a.kind === 'allocateHunt') as Extract<WotrAction, { kind: 'allocateHunt' }>[];
    if (!opts.length) return legal[0]!;
    const lo = Math.min(...opts.map((a) => a.dice)), hi = Math.max(...opts.map((a) => a.dice));
    // Hunt pressure is the Shadow's win condition; the cap is the Companion count
    // (rulebook p.18). When the Fellowship is in Mordor or far along, max out the
    // Hunt box (corruption is now the priority over saving Action dice); ease off
    // when it's near its last-known spot. Uploaded games showed fast Mordor rushes
    // slipping through under-pressured Hunts.
    const fs = state.fellowship;
    const target = (fs.mordor !== null || fs.progress >= 4) ? hi : fs.progress >= 2 ? 2 : 1;
    const want = Math.max(lo, Math.min(hi, target));
    return opts.reduce((best, a) => (Math.abs(a.dice - want) < Math.abs(best.dice - want) ? a : best), opts[0]!);
  }

  // --- fellowship phase (FP): enter Mordor > declare when advanced > skip ---
  if (state.phase === 'fellowship') {
    const enter = legal.find((a) => a.kind === 'enterMordor');
    if (enter) return enter;
    // Declare when advanced. Normally push toward Mordor (the target closest to
    // Morannon). BUT when Corruption is climbing, declaring in an unconquered FP
    // City/Stronghold HEALS 1 Corruption (rulebook p.39) — the FP's main way to
    // survive the Hunt race. Prefer such a heal-spot (closest to Morannon, so we heal
    // AND keep the most ground). Analysis: the FP AI was losing the corruption race
    // even vs a random Shadow because it never healed — it just rushed to Mordor.
    const declares = legal.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' }> => a.kind === 'declareFellowship');
    const closestToMordor = (cands: typeof declares) => cands.reduce((best, a) => (dist(a.target, 'morannon') < dist(best.target, 'morannon') ? a : best), cands[0]!);
    if (declares.length && state.fellowship.progress >= 2) {
      if (state.fellowship.corruption >= 4) {
        const heals = declares.filter((a) => isHealSettlement(state, a.target));
        if (heals.length) return closestToMordor(heals);
      }
      return closestToMordor(declares);
    }
    return legal.find((a) => a.kind === 'skipFellowshipPhase') ?? legal[0]!;
  }

  // --- action resolution: score and pick the best ---
  const target = campaignTarget(state, actor); // an enemy Settlement to march on
  let best = legal[0]!, bestScore = -Infinity;
  for (const a of legal) {
    const s = score(state, actor, a, target) + rng.next() * 0.5; // tiny noise for tie-breaks
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return maybeAttackRearguard(state, actor, maybeSplitGarrison(state, actor, best)); // hold a threatened origin
}

/** Split a chosen whole-army move so it leaves a one-unit garrison behind when the
 *  origin is a VP Settlement we control with an enemy army adjacent — otherwise
 *  vacating it hands the enemy a free capture. Conservative: only plain moveArmy
 *  (never weakens an attack), only when the stack can spare a unit, and the split
 *  is always legal where the whole move was (it moves a strict subset to the same
 *  region). Leaders/Nazgûl/Characters advance with the army; a Regular (else an
 *  Elite) holds. */
function maybeSplitGarrison(state: GameState, actor: Side, action: WotrAction): WotrAction {
  if (action.kind !== 'moveArmy' || action.move) return action;
  const from = action.from, def = REGIONS[from];
  if (!def?.settlement || def.vp <= 0 || settlementCtrl(state, from) !== actor) return action;
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  if (!def.adjacency.some((adj) => armyHere(state, adj, enemy))) return action; // not threatened
  const r = state.regions[from];
  if (unitCount(state, from) < 2) return action;                                // need ≥2: leave 1, move ≥1
  const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
  const garN = nations.find((n) => r.units[n]!.regular > 0) ?? nations.find((n) => r.units[n]!.elite > 0);
  if (!garN) return action;
  const useReg = r.units[garN]!.regular > 0;
  const units: NonNullable<MoveSel['units']> = {};
  for (const n of nations) {
    const reg = r.units[n]!.regular - (n === garN && useReg ? 1 : 0);
    const eli = r.units[n]!.elite - (n === garN && !useReg ? 1 : 0);
    const u: { regular?: number; elite?: number } = {};
    if (reg > 0) u.regular = reg;
    if (eli > 0) u.elite = eli;
    if (u.regular || u.elite) units[n] = u;
  }
  const move: MoveSel = { units };
  if (r.leaders) move.leaders = r.leaders;
  if (r.nazgul) move.nazgul = r.nazgul;
  // Only the MOVING side's own characters travel with the army — never the enemy's
  // (e.g. FP Companions who separated into a besieged Shadow Stronghold this Army holds).
  const mine = r.characters.filter((c) => (actor === 'shadow') === SHADOW_CHARS.has(c) && c !== 'saruman'); // Saruman can't leave Orthanc
  if (mine.length) move.characters = mine;
  return { kind: 'moveArmy', from, to: action.to, move };
}

/** Leave a one-unit rearguard on an attack so a decisive win (which forces the
 *  attackers to advance, vacating the origin) doesn't strand a VP Settlement we
 *  control with a DIFFERENT enemy army next to it. Safe only when the rearguard
 *  comes out of the 5-dice surplus: ≥6 attackers (so ≥5 still attack — full dice)
 *  AND an overwhelming margin (≥ defender + 3), so it never weakens a close fight.
 *  Restricted to all-At-War stacks — the engine already force-holds non-belligerent
 *  units as a rearguard, so there's nothing to add (and no double-counting). */
function maybeAttackRearguard(state: GameState, actor: Side, action: WotrAction): WotrAction {
  if (action.kind !== 'attack' || action.rearguard) return action;
  const from = action.from, to = action.to, def = REGIONS[from];
  if (!def?.settlement || def.vp <= 0 || settlementCtrl(state, from) !== actor) return action;
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  if (!def.adjacency.some((adj) => adj !== to && armyHere(state, adj, enemy))) return action; // origin not threatened
  const r = state.regions[from];
  const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
  if (!nations.every((n) => state.nations[n].step === 0)) return action;                       // all attackers At War
  if (unitCount(state, from) < 6 || unitCount(state, from) < unitCount(state, to) + 3) return action; // surplus + margin
  const garN = nations.find((n) => r.units[n]!.regular > 0) ?? nations[0]!;
  const rearguard: MoveSel = { units: { [garN]: r.units[garN]!.regular > 0 ? { regular: 1 } : { elite: 1 } } };
  return { kind: 'attack', from, to, rearguard };
}

const FP = new Set(['dwarves', 'elves', 'gondor', 'north', 'rohan']);
const settlementCtrl = (state: GameState, id: RegionId): Side | null => {
  const def = REGIONS[id]!;
  if (!def.settlement) return null;
  return state.regions[id]!.control ?? (def.nation ? (FP.has(def.nation) ? 'fp' : 'shadow') : null);
};
// A region where declaring the Fellowship HEALS 1 Corruption: an unconquered FP
// City or Stronghold (rulebook p.39).
const isHealSettlement = (state: GameState, id: RegionId): boolean => {
  const def = REGIONS[id]!;
  return (def.settlement === 'City' || def.settlement === 'Stronghold')
    && !!def.nation && FP.has(def.nation) && settlementCtrl(state, id) !== 'shadow';
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
    case 'moveFellowship':
      // On the Mordor Track, NOT moving costs +1 Corruption/turn — push every turn.
      if (fs.mordor !== null) return fs.corruption >= 11 ? 40 : 95;
      // Pre-Mordor each move triggers a Hunt. Push the ring hard while Corruption is
      // low; as it climbs, ease off (spend the turn on pressure elsewhere) and rely on
      // declare-to-heal (below) to bring Corruption back down so the push can resume.
      // This adaptive push/heal/pivot rhythm — rather than rushing into every Hunt —
      // is what lets the FP survive the Hunt race.
      return Math.max(8, 72 - fs.corruption * 9);
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
    case 'moveCharacter': return moveCharacterScore(state, actor, a); // reposition Nazgûl/Companions
    case 'diplomaticAction': return diplomaticScore(state, actor, a.nation); // mobilize toward At War
    case 'companionMuster': // a Companion advances its Nation toward War (any die) — mobilization
      return state.nations[a.nation].step > 0 ? 28 : 6;                // worth it only while the Nation isn't yet At War
    case 'sarumanMuster': return a.mode === 'recruit' ? 45 : 30;       // Voice of Saruman: a big Isengard build / Elite upgrade
    case 'useElvenRing': return elvenRingScore(state, actor, a);       // change a die's face (conservatively)
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

/** Total Army figures a Nation has on the board — the weight waiting behind its
 *  Political Track position, unlocked for offense once it goes At War. */
function nationArmy(state: GameState, nation: Nation): number {
  let n = 0;
  for (const r of Object.values(state.regions)) {
    const u = r.units[nation]; if (u) n += u.regular + u.elite;
    if (r.siegeBox) { const su = r.siegeBox.units[nation]; if (su) n += su.regular + su.elite; }
  }
  return n;
}

/** Advancing a Nation on the Political Track (rulebook p.35). Going At War unlocks
 *  that Nation's Army for attack, so weight by proximity-to-War AND the size of the
 *  Army waiting behind it — finishing a big Nation's march to War is a far bigger
 *  tempo swing than mustering one more unit. A passive Nation can't pass step 1
 *  until activated, so nudging it is worth little. Replaces a flat score that let
 *  tie-break noise advance (e.g.) a stuck passive Nation over Sauron-one-from-War. */
function diplomaticScore(state: GameState, actor: Side, nation: Nation): number {
  const ns = state.nations[nation];
  if (actor === 'shadow') {
    if (!ns.active) return 12;                                          // can't reach War yet — barely worth a die
    const army = Math.min(nationArmy(state, nation), 10);
    const proximity = ns.step === 1 ? 46 : ns.step === 2 ? 30 : 20;     // one step from War is the decisive unlock
    return proximity + army * 2;
  }
  if (!ns.active) return 8;                                             // FP advances toward War reactively
  return ns.step === 1 ? 30 : 20;
}

/** March toward the campaign target, capture undefended enemy Settlements
 *  outright, and concentrate stacks. */
function armyMoveScore(state: GameState, actor: Side, from: RegionId, to: RegionId, target: RegionId | null): number {
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  let s = actor === 'shadow' ? 16 : 8;
  if (settlementCtrl(state, to) === enemy && !armyHere(state, to, enemy)) s += REGIONS[to]!.vp * 30 + 25; // capture
  if (armyHere(state, to, actor)) s += 10;                                                                // concentrate
  if (target) { s += -(dist(to, target) - dist(from, target)) * 12; if (to === target) s += 30; }         // march
  // Never march units into a stack that's already full: anything over the 10-unit
  // limit is removed (lost to reinforcements). Penalise per lost unit so the AI
  // would rather not move than over-stack and bleed its own army (player report).
  const over = Math.max(0, unitCount(state, to) + unitCount(state, from) - STACKING_LIMIT);
  if (over > 0) s -= 30 + over * 25;
  return s;
}

/** Whether to spend an Elven Ring (a scarce, side-shifting resource). Deliberately
 *  conservative: the FP only converts toward a Character die it LACKS — and only
 *  when keeping the Fellowship moving is worth handing the Ring to the Shadow (on
 *  the Mordor Track, where standing still costs +1 Corruption/turn, or when
 *  revealed and needing to hide). The Shadow only burns its Ring (gone for good)
 *  for an Eye when the Hunt is decisive (Fellowship in Mordor). Otherwise: don't. */
function elvenRingScore(state: GameState, actor: Side, a: Extract<WotrAction, { kind: 'useElvenRing' }>): number {
  const fs = state.fellowship;
  if (actor === 'fp') {
    if (a.to !== 'character') return -5;                              // FP only converts toward a Character die
    const faces = state.dice.fp;
    if (faces.includes('character') || faces.includes('will')) return -5; // already have one — don't pass a Ring to Shadow for free
    if (fs.mordor !== null) return 90;                                // Mordor Track: MUST keep moving
    if (!fs.hidden) return 55;                                        // revealed: convert so we can hide
    return -5;
  }
  return (a.to === 'eye' && fs.mordor !== null) ? 35 : -5;            // Shadow: an Eye only when the Hunt is decisive
}

/** Initiating an independent-character move with a Character die. The big win is
 *  the Shadow pouncing a Nazgûl onto a REVEALED Fellowship (Hunt pressure); other
 *  repositioning is modest so it doesn't crowd out higher-value Character-die uses. */
function moveCharacterScore(state: GameState, actor: Side, a: Extract<WotrAction, { kind: 'moveCharacter' }>): number {
  const fs = state.fellowship;
  if (actor === 'shadow' && a.char === 'nazgul') return (!fs.hidden && a.to === fs.location) ? 42 : 6;
  return 4; // separated Companions / Minions: situational
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
    case 'removeExcess':
      // Shed over-stacked units cheaply: drop a Regular before an Elite.
      return legal.find((a) => a.kind === 'removeExcess' && a.figure === 'regular') ?? legal[0]!;
    case 'separateMove': {
      // Land the separated Companion in a friendly City/Stronghold (rouses its
      // Nation) if one is in range; otherwise the farthest reachable region.
      // Nearest reachable friendly City/Stronghold whose Nation isn't yet At War
      // (rousing it is the point); otherwise stay at the Fellowship's region (moves[0]),
      // matching the old auto-separate — don't scatter the Companion uselessly.
      // Only consider PLACEMENT moves (those with a target); the AI places the
      // separated Companion immediately rather than building a travelling group.
      const moves = legal.filter((a) => a.kind === 'separateMove' && a.target != null) as Extract<WotrAction, { kind: 'separateMove' }>[];
      const settle = moves.find((a) => { const d = REGIONS[a.target!]!; return (d.settlement === 'City' || d.settlement === 'Stronghold') && !!d.nation && state.nations[d.nation as Nation]?.step > 0; });
      return settle ?? moves[0] ?? legal[0]!;
    }
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
      // Spend a cheap −1 reduction (discard an on-table card) once Corruption is
      // climbing — it costs no Companion and lowers the hit before we absorb it.
      if (wouldCorrupt >= 7) {
        const reduceCard = legal.find((a) => a.kind === 'huntDamage' && a.mode === 'reduceCard');
        if (reduceCard) return reduceCard;
      }
      // Trade a Companion (random, to keep the Guide) only when Corruption is
      // about to get dangerous; otherwise absorb.
      if (wouldCorrupt >= 8 && state.fellowship.companions.length > 0) {
        return legal.find((a) => a.kind === 'huntDamage' && a.mode === 'random') ?? legal[0]!;
      }
      return legal.find((a) => a.kind === 'huntDamage' && a.mode === 'corruption') ?? legal[0]!;
    }
    case 'combatCasualties': // keep Elites (strength): remove Regulars first
    case 'valinorCasualties': // Return to Valinor: keep Elves' Elites → remove Regulars first
    case 'eventCasualties': // direct-damage Event card: keep our Elites → remove Regulars first
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
    case 'siegeWithdraw': {
      // Defender: withdraw into the Stronghold (deny the capture / VP, force a siege)
      // unless we strongly outnumber the attacker and can win in the open.
      const hold = !pc || unitCount(state, pc.to) < unitCount(state, pc.from) + 2;
      return legal.find((a) => a.kind === 'siegeWithdraw' && a.withdraw === hold) ?? legal[0]!;
    }
    case 'siegeExtend': {
      // Attacker: press the assault (spend an Elite step) while clearly winning —
      // when we still outnumber the boxed garrison by ≥2 the extra round is worth
      // more than the Elite; otherwise stop and let the siege hold. (In an assault
      // from === to: the attacker holds the field, the garrison is in the siege box.)
      const box = pc ? state.regions[pc.to]!.siegeBox : null;
      const garrison = box ? Object.values(box.units).reduce((s, u) => s + (u?.regular ?? 0) + (u?.elite ?? 0), 0) : 0;
      const press = !!pc && !!box && unitCount(state, pc.from) >= garrison + 2;
      return legal.find((a) => a.kind === 'siegeExtend' && a.extend === press) ?? legal[0]!;
    }
    case 'lureChoice': {
      // FP: absorb as Corruption unless that nears death — then sacrifice the Companion.
      const level = (state.pendingChoice!.data as { level: number }).level;
      const deadly = state.fellowship.corruption + level >= 10;
      return legal.find((a) => a.kind === 'lureChoice' && a.mode === (deadly ? 'eliminate' : 'corruption')) ?? legal[0]!;
    }
    case 'huntPreventDraw': // FP Wizard's Staff: spend it to skip the draw when Corruption is dangerous
      return legal.find((a) => a.kind === 'huntPreventDraw' && a.prevent === (state.fellowship.corruption >= 7)) ?? legal[0]!;
    case 'huntRedraw': { // FP Mithril Coat: redraw a heavy tile
      const tile = (state.pendingChoice!.data as { tile: { value: number | string } }).tile;
      const heavy = typeof tile.value === 'number' ? tile.value >= 2 : true; // eye/die ⇒ redraw
      return legal.find((a) => a.kind === 'huntRedraw' && a.redraw === heavy) ?? legal[0]!;
    }
    case 'bonusDraw': // Shadow Palantír: take a Strategy card (army-building)
      return legal.find((a) => a.kind === 'bonusDraw' && a.deck === 'strategy') ?? legal[0]!;
    case 'guideDraw': // Gandalf the Grey: take the free card
      return legal.find((a) => a.kind === 'guideDraw' && a.draw) ?? legal[0]!;
    case 'sorcererDraw': // Witch-king: take the free card
      return legal.find((a) => a.kind === 'sorcererDraw' && a.draw) ?? legal[0]!;
    case 'retreatTo': { // retreat toward a friendly Settlement if possible
      const me: Side = state.pendingChoice!.owner;
      const friendly = legal.find((a) => a.kind === 'retreatTo' && settlementCtrl(state, a.region) === me);
      return friendly ?? legal[0]!;
    }
    case 'preCombatRetreat': { // Scouts: retreat toward a friendly Settlement if possible
      const me: Side = state.pendingChoice!.owner;
      const friendly = legal.find((a) => a.kind === 'preCombatRetreat' && settlementCtrl(state, a.region) === me);
      return friendly ?? legal[0]!;
    }
    case 'whiteRider': // only offered when there's Nazgûl Leadership to negate → forfeit
      return legal.find((a) => a.kind === 'whiteRider' && a.forfeit) ?? legal[0]!;
    case 'balrog': // extra Hunt pressure now is worth it
      return legal.find((a) => a.kind === 'balrog' && a.use) ?? legal[0]!;
    case 'crebain': { // spend the one-shot only on a hunt big enough to matter
      const level = (state.pendingChoice!.data as { level: number }).level;
      return legal.find((a) => a.kind === 'crebain' && a.use === (level >= 2)) ?? legal[0]!;
    }
    case 'revealMove': // figure moves toward Mordor (Morannon) when revealed
      return legal.reduce((best, a) => (a.kind === 'revealMove' && best.kind === 'revealMove' && dist(a.target, 'morannon') < dist(best.target, 'morannon')) ? a : best, legal[0]!);
    case 'eventTarget': return chooseEventTarget(state, legal);
    case 'musterSecond': // place the second figure of a two-figure muster (fuller build)
      return legal.find((a) => a.kind === 'recruitSecond' && !a.done) ?? legal[0]!;
    case 'armyMove2': return chooseArmyMove2(state, legal);
    case 'charMove2': return chooseCharMove(state, legal);
    case 'stormcrowLoss': // forced loss: shed a Regular, then an Elite, keep Leaders
      return legal.find((a) => a.kind === 'stormcrowLoss' && a.figure === 'regular')
        ?? legal.find((a) => a.kind === 'stormcrowLoss' && a.figure === 'elite') ?? legal[0]!;
    case 'breakingSep': { // forced separation: keep the Guide, give up the lowest-Level Companion
      const seps = legal.filter((a): a is Extract<WotrAction, { kind: 'breakingSep' }> => a.kind === 'breakingSep');
      const pool = seps.filter((a) => a.companion !== state.fellowship.guide);
      const choose = (pool.length ? pool : seps);
      return choose.reduce((best, a) => (levelOf(a.companion) < levelOf(best.companion) ? a : best), choose[0]!) ?? legal[0]!;
    }
    case 'discardCard': { // over hand-limit: drop a card that isn't one of our key heal/corruption events
      const keep = (id: string) => HEAL_EVENTS.has(id) || CORRUPT_EVENTS.has(id);
      return legal.find((a) => a.kind === 'discardCard' && !keep(a.card)) ?? legal[0]!;
    }
    default: return legal[0]!;
  }
}

/** Use the Army die's optional SECOND move (rulebook p.27) when a different army
 *  can make real progress — march toward the campaign target, capture, or
 *  concentrate. Scored exactly like a first move; only taken when it beats the
 *  flat base value (i.e. it does something), else stop. */
function chooseArmyMove2(state: GameState, legal: WotrAction[]): WotrAction {
  const owner: Side = state.pendingChoice!.owner;
  const done = legal.find((a) => a.kind === 'armyMove2' && a.done) ?? legal[0]!;
  const moves = legal.filter((a): a is Extract<WotrAction, { kind: 'armyMove2' }> => a.kind === 'armyMove2' && !a.done && !!a.from && !!a.to);
  if (!moves.length) return done;
  const target = campaignTarget(state, owner);
  const base = owner === 'shadow' ? 16 : 8; // armyMoveScore's flat base — only move if we beat it
  let best: WotrAction | null = null, bestS = base;
  for (const m of moves) { const s = armyMoveScore(state, owner, m.from!, m.to!, target); if (s > bestS) { bestS = s; best = m; } }
  return best ?? done;
}

/** Resolve the Character-die move chain (RAW: one die moves all eligible
 *  characters). Move figures one at a time while it clearly helps — Nazgûl onto a
 *  revealed Fellowship, anyone drifting toward the campaign target — else stop. */
function chooseCharMove(state: GameState, legal: WotrAction[]): WotrAction {
  const owner: Side = state.pendingChoice!.owner;
  const moves = legal.filter((a): a is Extract<WotrAction, { kind: 'moveCharacter' }> => a.kind === 'moveCharacter');
  const target = campaignTarget(state, owner);
  const fs = state.fellowship;
  const scoreMove = (a: Extract<WotrAction, { kind: 'moveCharacter' }>): number => {
    let s = 0;
    if (owner === 'shadow' && a.char === 'nazgul' && !fs.hidden && a.to === fs.location) s += 30; // press a revealed Fellowship
    if (target) s += -(dist(a.to, target) - dist(a.from, target)) * 4;                            // drift toward the target
    return s;
  };
  let best: WotrAction | null = null, bestS = 0; // only move when strictly positive; otherwise stop
  for (const m of moves) { const s = scoreMove(m); if (s > bestS) { bestS = s; best = m; } }
  return best ?? legal.find((a) => a.kind === 'charMove2' && a.done) ?? legal[0]!;
}

/** Pick an interactive event-card target: prefer an attack/move toward the campaign
 *  target; for a Companion separation keep the strong ones (separate the lowest Level). */
function chooseEventTarget(state: GameState, legal: WotrAction[]): WotrAction {
  const ets = legal.filter((a) => a.kind === 'eventTarget') as Extract<WotrAction, { kind: 'eventTarget' }>[];
  if (ets.length === 0) return legal[0]!;
  const owner: Side = state.pendingChoice!.owner;
  const target = campaignTarget(state, owner);
  const score = (a: typeof ets[number]): number => {
    if (a.done) return -1;                                            // stop multi-move only if nothing better
    // There Is Another Way (Gollum): hide is a safe benefit; moving pushes but risks the Hunt.
    if (a.mode === 'hide') return 50;
    if (a.mode === 'none') return 5;
    if (a.mode === 'move' && !a.to && !a.region) return 25;
    if (a.companion && a.region) return 110 - (target ? dist(a.region, target) : 0); // place the (group of) Companion(s) — do this rather than piling the whole Fellowship in
    if (a.companion) return 100 - levelOf(a.companion) * 10;          // separate the lowest-Level Companion
    if (a.mode === 'attack' && a.to) return 60 + REGIONS[a.to]!.vp * 20;
    if (a.to) return 30 - (target ? dist(a.to, target) : 0);          // move toward the target
    if (a.region) return 20 - (target ? dist(a.region, target) : 0);
    return 10;
  };
  return ets.reduce((best, a) => (score(a) > score(best) ? a : best), ets[0]!);
}
