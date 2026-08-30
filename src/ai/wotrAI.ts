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
import { unitCount, forceUnitCount, STACKING_LIMIT, charDieLeaders } from '../engine/armies';
import { sortieForce } from '../engine/combat';
import { MORDOR_ENTRANCES, separationActivates } from '../engine/fellowship';
import { combatModsFor, type CombatMods } from '../engine/combatCards';
import { SH_FORCE_DISCARD_UNLOCKS } from '../engine/persistent';

// ————— Fellowship plan (docs/ai-fellowship-plan.md) ————————————————————————
// A small, explicit machine that BIASES the scorer for a handful of Fellowship
// actions instead of reweighting them globally. Pure function of the state —
// recomputed each decision, never stored — reading only what the FP player sees.
//
// Stage 1 (RUN) was built, measured and reverted — see score → moveFellowship.
// Stage 2 (this build): HEAL. The Fellowship is RESTING in an unconquered FP
// City/Stronghold: it declares in place each Fellowship phase (−1 Corruption,
// p.39, and it stays Hidden) and does NOT move in between — every action-phase
// move is a Hunt roll that undoes the rest, and the banked Progress is thrown
// away by the next in-place declare anyway. Hysteresis without memory: enter at
// Corruption ≥ 4 (the existing heal-declare threshold); once here with no
// Progress banked (i.e. we rested last turn) keep resting down to 2, then leave.
export type FellowshipPlan = 'HEAL' | null;
export function fellowshipPlan(state: GameState): FellowshipPlan {
  const fs = state.fellowship;
  if (fs.mordor !== null || !isHealSettlement(state, fs.location)) return null;
  if (fs.corruption >= 4) return 'HEAL';
  // Exit threshold: rest all the way down to 1 (measured: exiting at 2 lifted
  // Ring wins +8% pooled over two seed families but the healed Fellowship then
  // died on the Track nearly as often as it won — corruption deaths +8%).
  if (fs.corruption >= 2 && fs.progress === 0) return 'HEAL';
  return null;
}

const HEAL_EVENTS = new Set(['fp-char-09', 'fp-char-10', 'fp-char-12', 'fp-char-13']);
const CORRUPT_EVENTS = new Set(['sh-char-08', 'sh-char-12']);
const SHADOW_CHARS = new Set(['witch-king', 'saruman', 'mouth-of-sauron']); // the rest are FP Companions

export function chooseAction(state: GameState, actor: Side, legal: WotrAction[], rng: Rng): WotrAction {
  if (legal.length === 1) return legal[0]!;

  // --- pending choices (combat / hunt) ---
  if (state.pendingChoice) return resolveChoice(state, legal);

  // --- hunt allocation (Shadow): ALL-OR-NOTHING. Max the Hunt Box once the Ring is
  //     the live threat (Mordor Track), otherwise spend nothing and keep the dice
  //     for actions. Every intermediate setting measured worse — see below. ---
  if (state.phase === 'huntAllocation') {
    const opts = legal.filter((a) => a.kind === 'allocateHunt') as Extract<WotrAction, { kind: 'allocateHunt' }>[];
    if (!opts.length) return legal[0]!;
    const lo = Math.min(...opts.map((a) => a.dice)), hi = Math.max(...opts.map((a) => a.dice));
    // Hunt dice ARE Action dice — the exchange rate decides everything, and it is
    // brutal pre-Mordor: measured self-play (300g) a flat 2-per-turn baseline gave
    // Shadow 105/300 vs 143/300 for spending nothing. The Shadow's edge is board
    // tempo (muster/march/attack), not speculative Hunt rolls at low dice counts.
    //
    // NB the old heuristic scaled with fs.progress — that signal is near-useless
    // here. Allocation happens in phase 3, right after the FP's phase-2 declare
    // RESETS progress, and progress only accrues from phase-5 moves. Instrumented
    // over 60 games: progress was 0 in 864 of 1137 allocations, 1 in 272, and >=2
    // exactly ONCE — so the escalation rungs were dead code and the Shadow drifted
    // through the game at ~0.69 dice.
    const fs = state.fellowship;
    const raw = (fs.mordor !== null || fs.progress >= 4) ? hi : 0;
    // On the Mordor Track the Ring is the clock, so max out — but only to what a
    // roll can USE. A Hunt roll rolls `Math.min(5, hunt.box)` dice (hunt.ts), so a
    // 6th/7th die is STRICTLY wasted: it cannot help the Hunt, it only disarms us
    // (player report: the AI dumped SEVEN and nearly had no actions). Holding back
    // BELOW 5 in Mordor was also measured and it loses — the Ring gets through.
    const HUNT_ROLL_CAP = 5;
    const target = Math.min(raw, HUNT_ROLL_CAP);
    const want = Math.max(lo, Math.min(hi, target));
    return opts.reduce((best, a) => (Math.abs(a.dice - want) < Math.abs(best.dice - want) ? a : best), opts[0]!);
  }

  // --- fellowship phase (FP): enter Mordor > declare when advanced > skip ---
  if (state.phase === 'fellowship') {
    const enter = legal.find((a) => a.kind === 'enterMordor');
    // UNCONDITIONAL, and measured to be right (2026-08-24). Player report: "if you
    // are at 6 corruption, no companions, you ought to abandon the ring game and
    // push for a military win" — does the AI weigh its odds before the one-way door?
    // It does not, and gating it does not pay. Two 2000-game A/Bs (2 seed families)
    // against the 1089/2000 baseline:
    //   refuse at Corruption >= 8       : FP 1090 (+1), Ring 1004 (unchanged) — the
    //     gate only relabels the death: corruption deaths -9, Shadow military +9.
    //   refuse at <=1 Companion & Corr>=3: FP 1083 (-6), Ring 1004->986, FP military
    //     85->96. It DOES produce the requested pivot, and the pivot loses: the Ring
    //     wins it forfeits outnumber the military wins it buys.
    // Why: the FP AI's military conversion is only 85/2000 (4.2%) — 92% of its wins
    // are the Ring — so even a grim Mordor run beats what it can do with the board.
    // "Abandon the Ring" cannot be right until FP military play is much stronger;
    // that is the real gap, not the entry decision. Entry telemetry also inverts the
    // report's premise: Corruption is the weaker signal, Companions the stronger one
    // (Corr 7 with 6 Companions = 75% Ring; Corr 3 with <=1 Companion = 0%).
    if (enter) return enter;
    // Declare when advanced. Normally push toward Mordor (the target closest to
    // Morannon). BUT when Corruption is climbing, declaring in an unconquered FP
    // City/Stronghold HEALS 1 Corruption (rulebook p.39) — the FP's main way to
    // survive the Hunt race. Prefer such a heal-spot (closest to Morannon, so we heal
    // AND keep the most ground). Analysis: the FP AI was losing the corruption race
    // even vs a random Shadow because it never healed — it just rushed to Mordor.
    const declares = legal.filter((a): a is Extract<WotrAction, { kind: 'declareFellowship' }> => a.kind === 'declareFellowship');
    const closestToMordor = (cands: typeof declares) => cands.reduce((best, a) => (dist(a.target, 'morannon') < dist(best.target, 'morannon') ? a : best), cands[0]!);
    // A declared position feeds the Hunt: ending in a region with a Shadow
    // Stronghold, a Shadow Army, or Nazgûl grants the Shadow a failed-die re-roll
    // on every Hunt there (huntRerollSources) — never end a heal-declare in one
    // (player report: the AI declared in Moria and handed the Shadow a re-roll).
    const noRerolls = (t: RegionId): boolean => huntClean(state, t);
    // NB no Progress requirement. Declaring IN PLACE at Progress 0 is legal precisely
    // so a Fellowship sitting in a friendly City/Stronghold can rest and heal (p.39),
    // and `declares` only ever contains targets already within Progress — so a
    // progress>=2 gate here bought no safety and created a DEADLOCK: high Corruption
    // stopped the pushing, Progress stayed at 0, the gate then refused the rest-heal,
    // Corruption never came down and the Fellowship froze for good. Instrumented over
    // 200 games: 249 legal rest-heals refused, in 50 of them (a quarter of all games).
    // HEAL (fellowshipPlan): keep rest-declaring down to Corruption 2, not just
    // while ≥ 4 — the hysteresis half of the plan's heal state.
    if (declares.length && (state.fellowship.corruption >= 4 || fellowshipPlan(state) === 'HEAL')) {
      const heals = declares.filter((a) => isHealSettlement(state, a.target) && noRerolls(a.target));
      if (heals.length) return closestToMordor(heals);
    }
    // The entrances (Morannon / Minas Morgul) are always worth declaring at —
    // entering Mordor requires the declared figure to stand there.
    const entries = declares.filter((a) => MORDOR_ENTRANCES.includes(a.target));
    if (entries.length) return closestToMordor(entries);
    // ESCAPE a re-roll region: the Hunt re-rolls against the Fellowship's LAST
    // KNOWN position, so a figure left standing with a Shadow Army / Nazgûl (e.g.
    // after a reveal there) feeds every Hunt until it declares somewhere clean. Any
    // clean target within Progress that loses no ground toward Mordor is worth it
    // (player report: Progress 3, sat in a region with a Shadow Army and Nazgûl,
    // "should've declared somewhere empty so it could move without hunt re-rolls").
    if (!noRerolls(state.fellowship.location) && state.fellowship.progress >= 1) {
      const here = dist(state.fellowship.location, 'morannon');
      const clean = declares.filter((a) => a.target !== state.fellowship.location && noRerolls(a.target) && dist(a.target, 'morannon') <= here);
      if (clean.length) return closestToMordor(clean);
    }
    // Fellowship-plan BANK (stage 3, tried and REVERTED 2026-08-16): suppress this
    // distance declare while Corruption <= 3 and the gates are > 2 steps beyond
    // the bank — "travel hidden, accumulate". Two seed families x 2000 games on
    // top of the shipped HEAL: Ring 1466 -> 1353 (-7.7%), Mordor entries -6%,
    // military +14.5%, FP 46.3% -> 45.6%; push-declares halved, so it fired as
    // designed. Same finding as b845127 (the blanket version), now with the
    // Corruption gate: these declares are not a leak, they are the WALK — each
    // moves the figure a heal-spot closer, and hoarding Progress means fewer
    // Mordor entries, not safer ones. Record in docs/ai-fellowship-plan.md.
    // Mid-journey declares are held to a high bar: a full bank (Progress 4+), a
    // safe target, AND ≥3 regions actually gained toward Morannon — a short hop
    // (Old Ford, player report) gifts the Shadow its "Play if the Fellowship is
    // not in a FP Settlement…" cards and burns Progress that also extends
    // separated-Companion movement. But declaring NEVER mid-journey tested worse
    // (2000-game A/B: corruption deaths 318→519, FP 46.9%→43.7% — the figure sat
    // too far back and the Ring died in transit), so distance-buying declares stay.
    if (state.fellowship.progress >= 4) {
      const here = dist(state.fellowship.location, 'morannon');
      const gains = declares.filter((a) => noRerolls(a.target) && here - dist(a.target, 'morannon') >= 3);
      if (gains.length) return closestToMordor(gains);
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

/** Is `from` a VP Settlement of ours that a departing Army must not simply abandon?
 *  ONE shared test: `maybeSplitGarrison` uses it to leave a garrison behind, and
 *  `armyMoveScore` uses it to price the move — they must never disagree, or the score
 *  charges for abandoning ground the split actually holds (or vice versa). The reach
 *  is deliberately wider than one region's march: the Shadow closes fast, and a
 *  Stronghold left open two moves away is a free capture (player report: "they
 *  abandoned Minas Tirith to hold….nothing"). */
function garrisonWorthy(state: GameState, actor: Side, from: RegionId): boolean {
  const def = REGIONS[from];
  if (!def?.settlement || def.vp <= 0 || settlementCtrl(state, from) !== actor) return false;
  return enemyNear(state, from, actor === 'fp' ? 'shadow' : 'fp', 4);
}

/** Split a chosen whole-army move so it leaves a one-unit garrison behind when the
 *  origin is a VP Settlement we control with an enemy army within reach — otherwise
 *  vacating it hands the enemy a free capture. Conservative: only plain moveArmy
 *  (never weakens an attack), only when the stack can spare a unit, and the split
 *  is always legal where the whole move was (it moves a strict subset to the same
 *  region). Leaders/Nazgûl/Characters advance with the army; a Regular (else an
 *  Elite) holds. */
function maybeSplitGarrison(state: GameState, actor: Side, action: WotrAction): WotrAction {
  // Both army-move kinds: the Army die's FIRST move and its optional SECOND
  // (armyMove2, p.27). The second move used to skip this entirely, and
  // armyMoveScore only charges the vacate penalty when the stack is too small to
  // split (`unitCount < 2`) — it assumes THIS function will garrison anything
  // bigger. So a 2+ stack could march out of a threatened Stronghold on the second
  // move with neither a garrison nor a penalty: measured over 250 self-play games,
  // every one of the Shadow's VP Settlements captured while standing empty had
  // marched its garrison out, with an FP Army already inside the 4-region warning
  // radius (player report: "the ai is completely unprepared for the free ppl to
  // push for a military attack").
  if ((action.kind !== 'moveArmy' && action.kind !== 'armyMove2') || action.move) return action;
  // armyMove2's from/to are optional (its "done" variant carries neither).
  const from = action.from, to = action.to;
  if (!from || !to) return action;
  if (!garrisonWorthy(state, actor, from)) return action;
  const r = state.regions[from];
  if (unitCount(state, from) < 2) return action;                                // need ≥2: leave 1, move ≥1
  const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
  // Only the mover's OWN Leader figures: FP Leaders for the Free Peoples, Nazgûl for
  // the Shadow. Packing both pools named the ENEMY's figures whenever any were sharing
  // the region (a lone Nazgûl under an FP Army, a stranded FP Leader under a Shadow
  // one), which moveArmySplit now refuses outright — the garrison split would simply
  // fail and the AI would march the whole stack out, the very thing it is avoiding.
  // Only the MOVING side's own characters travel with the army — never the enemy's
  // (e.g. FP Companions who separated into a besieged Shadow Stronghold this Army holds).
  const mine = r.characters.filter((c) => (actor === 'shadow') === SHADOW_CHARS.has(c) && c !== 'saruman'); // Saruman can't leave Orthanc
  const buildSplit = (garN: Nation, useReg: boolean): MoveSel => {
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
    if (actor === 'fp' && r.leaders) move.leaders = r.leaders;
    if (actor === 'shadow' && r.nazgul) move.nazgul = r.nazgul;
    if (mine.length) move.characters = mine;
    return move;
  };
  // With no Army-type die left the adapter will spend a CHARACTER die, and a
  // Character-die split must keep a Leader/Nazgûl/Character among the MOVERS
  // (moveArmySplit refuses otherwise). Garrisoning the army's only qualifying
  // figure — an Isengard Elite while Saruman is in play — built exactly such an
  // illegal split (the 2000-game soak caught 3 refusals: e.g. Minas Tirith held
  // by {Isengard 1E, Southrons 3E} garrisoned the Isengard Elite and marched the
  // leaderless Southrons). Try each garrison candidate (Regulars first, as
  // before) and take the first whose movers stay legal; if none do, march the
  // whole stack rather than propose an action the engine must refuse.
  const armyDieLeft = state.dice[actor].some((f) => f === 'army' || f === 'armyMuster' || f === 'will');
  const candidates: Array<{ n: Nation; useReg: boolean }> = [
    ...nations.filter((n) => r.units[n]!.regular > 0).map((n) => ({ n, useReg: true })),
    ...nations.filter((n) => r.units[n]!.elite > 0).map((n) => ({ n, useReg: false })),
  ];
  for (const c of candidates) {
    const move = buildSplit(c.n, c.useReg);
    const sel = { units: move.units ?? {}, leaders: move.leaders ?? 0, nazgul: move.nazgul ?? 0, characters: move.characters ?? [] };
    if (armyDieLeft || charDieLeaders(state, sel, actor, false) >= 1) {
      return { ...action, from, to, move };
    }
  }
  return action;
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
  // from === to is an assault or a sortie: the region's units belong to the OTHER side of
  // that battle, so a rearguard built from them would be nonsense. (RAW does let a sortie
  // leave a rearguard in the Stronghold — the AI just declines to, an AI-strength gap.)
  if (action.from === action.to) return action;
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

/** Nothing in `id` feeds the Hunt: a Shadow-controlled Stronghold, a Shadow Army and a
 *  Nazgûl each grant the Shadow one failed-die re-roll on EVERY Hunt while the
 *  Ring-bearers' figure stands there (huntRerollSources, rules-spec §10). Shared by the
 *  declare logic and by the reveal move — both put the figure down for several turns. */
const huntClean = (state: GameState, id: RegionId): boolean => {
  const r = state.regions[id]!;
  return !(REGIONS[id]!.settlement === 'Stronghold' && settlementCtrl(state, id) === 'shadow')
    && !armyHere(state, id, 'shadow')
    && r.nazgul === 0 && !r.characters.includes('witch-king');
};
/** How many neighbours of `id` hold a re-roll source that could simply WALK IN. A region
 *  that is clean today but sits next door to a Shadow Stronghold's garrison is a re-roll
 *  region as soon as the Shadow spends one move on it. */
const huntThreat = (state: GameState, id: RegionId): number =>
  (REGIONS[id]!.adjacency as RegionId[]).filter((a) => state.regions[a] && !huntClean(state, a)).length;
/** Lexicographic "is a better rank than" over an ordered list of tie-breakers. */
const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

/** Is an enemy Army within `n` regions of `id`? Bounded outward walk rather than a
 *  dist() call per region — this runs inside the per-action scoring loop. */
function enemyNear(state: GameState, id: RegionId, enemy: Side, n: number): boolean {
  const seen = new Set<RegionId>([id]);
  let layer: RegionId[] = [id];
  for (let d = 0; d < n; d++) {
    const next: RegionId[] = [];
    for (const r of layer) for (const a of REGIONS[r]?.adjacency ?? []) {
      if (seen.has(a)) continue;
      seen.add(a); next.push(a);
      if (armyHere(state, a, enemy)) return true;
    }
    layer = next;
  }
  return false;
}

/** A VP Settlement we hold that is standing EMPTY with an enemy Army close enough to
 *  walk in. Measured over 30 self-play games, this is how most Settlements actually
 *  change hands — 59% of the FP's losses and 78% of the Shadow's were captured with
 *  zero defenders present, not stormed. Plugging these is worth more than any
 *  battlefield tuning. */
function undefendedVP(state: GameState, id: RegionId, actor: Side, reach = 2): boolean {
  const def = REGIONS[id];
  if (!def || (def.vp ?? 0) <= 0) return false;
  if (settlementCtrl(state, id) !== actor) return false;
  if (unitCount(state, id) > 0) return false;
  return enemyNear(state, id, actor === 'fp' ? 'shadow' : 'fp', reach);
}

/** BFS distance between two regions over adjacency (Infinity if unreachable).
 *  Memoised: region adjacency is a static property of the map, never of the game
 *  state, so a pair's distance is fixed for the whole process. Without the cache the
 *  per-army targeting below would re-walk the map on every candidate action. */
const distMemo = new Map<string, number>();
function dist(from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const key = `${from}>${to}`;
  const hit = distMemo.get(key);
  if (hit !== undefined) return hit;
  const seen = new Set([from]); let frontier = [from], d = 0, found = Infinity;
  outer: while (frontier.length) {
    d++; const next: RegionId[] = [];
    for (const r of frontier) for (const a of REGIONS[r]?.adjacency ?? []) {
      if (seen.has(a)) continue;
      if (a === to) { found = d; break outer; }
      seen.add(a); next.push(a);
    }
    frontier = next;
  }
  distMemo.set(key, found);
  return found;
}

/** How close the enemy is to their Military victory, 0..1. The thresholds are
 *  asymmetric (p.44): the Free Peoples win on 4 VP, the Shadow on 10. Used to make
 *  defence urgent once the enemy is genuinely closing — a player reported the Shadow
 *  "needs to recognize a free people military push. i was able to get 8 victory points
 *  as free people. that cant happen." At 0 this multiplies out to exactly the
 *  previously-measured weights, so early-game behaviour is unchanged. */
/** Is the Fellowship PARKED — sitting in an unconquered Free Peoples City/Stronghold
 *  healing rather than advancing? p.39 lets it heal one Corruption there every turn,
 *  so while it does, the Ring clock has stopped and the Shadow's military clock is the
 *  only one still running: the answer is to press, hard.
 *  Reads nothing hidden — the Fellowship figure's declared position and its Progress
 *  are both on the board and public (see redact.ts), so this is the same read a human
 *  Shadow makes. */
function fellowshipStalled(state: GameState): boolean {
  const fs = state.fellowship;
  if (fs.mordor !== null) return false;            // on the Track the Ring clock runs fast
  if (fs.progress >= 2) return false;              // it is travelling, not resting
  const d = REGIONS[fs.location];
  return !!d && (d.settlement === 'City' || d.settlement === 'Stronghold')
    && !!d.nation && FP.has(d.nation) && settlementCtrl(state, fs.location) !== 'shadow';
}

function enemyPressure(state: GameState, actor: Side): number {
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  const need = enemy === 'fp' ? 4 : 10;
  return Math.max(0, Math.min(1, (state.victoryPoints?.[enemy] ?? 0) / need));
}

/** The POLITICAL price of hitting `id` right now, in "reinforcement figures the enemy
 *  Nation would unlock", discounted by how many steps it still is from At War. Zero once
 *  the Nation IS At War — by then there is nothing left to wake.
 *
 *  Capturing a Settlement advances (and activates) the Nation that owns it, and attacking
 *  an Army advances every Nation with units in the region — politics.ts
 *  onSettlementCaptured / onArmyAttacked. A Nation that reaches At War may finally recruit
 *  its whole reinforcement pool, and its Armies may finally march and attack (armies.ts).
 *  So a cheap prize taken off a sleeping Nation is bought with that Nation's entire war
 *  effort, and the scorer had NO term for it at all: a 1-VP City read as a free 1 VP.
 *
 *  Player report: "the ai seems obsessed with taking pelgair. It marched in an army from
 *  mordor. this wakes up gondor and lets you muster in the strongholds. But it wont muster
 *  up enough leadership before it leaves to TAKE gondor. Its a losing strategy." Exactly
 *  right. Charging ONE FLAT price per Nation does the discrimination by itself: the same
 *  subtraction swamps a 1-VP City and still leaves a 2-VP Stronghold worth waking them
 *  for — which is the human rule of thumb, don't rouse Gondor for anything less than
 *  Minas Tirith.
 *
 *  MEASURED, two seed families x 1000 games per arm (4000 games in all), heuristic v
 *  heuristic. Shadow wins 794/2000 (39.7%) -> 890/2000 (44.5%), the same direction in
 *  both families (+64, +32); Shadow military victories 444 -> 531. Free Peoples military
 *  victories fall 154 -> 111 even though the FP scorer is UNTOUCHED — a Free Peoples
 *  Nation cannot march or attack until it is At War (armies.ts), so the Shadow had been
 *  handing the FP the very army it was then beaten with. That is the other standing
 *  player report ("the ai is completely unprepared for the free ppl to push for a
 *  military attack") answered at its root rather than by defending harder.
 *
 *  The rule is symmetric — taking a Shadow Settlement advances that Shadow Nation toward
 *  At War the same way — and the symmetric version was built and measured FIRST: Shadow
 *  839/2000 (42.0%), i.e. worse than charging the Shadow alone, because the FP arm cost
 *  the Free Peoples 49 military victories to buy back only 4 Ring wins. The positions are
 *  not symmetric even though the rule is: the Shadow chooses when its own Nations go to
 *  War and advances them with Muster dice regardless, so the FP is mostly paying a price
 *  for something that was going to happen anyway. Hence the Shadow-only guard below. */
// TRIED AND REVERTED (2026-08-31): waiving this price for the campaign plan's
// current objective Nation ("waking the objective IS the plan"). It was aimed at
// a real reported exploit — a fully passive FP board is permanently attack-proof
// (Luke Martens: "if you don't bring any of your factions to war the AI won't
// attack you"; the fix measured +24% Shadow attacks vs a passive-FP policy). But
// always-on it LOSES: two seed families x 2000 games vs e92900e, FP 1398->1467
// and 1400->1438, Shadow corruption wins 541->480 and 543->489. Mechanism:
// attacking a passive Nation ACTIVATES it (onArmyAttacked), so the exemption
// hands the FP its mobilization early and diverts Shadow dice from the Hunt to
// armies — the Ring game pays for the military game. A retry should be a
// narrow anti-turtle TRIGGER (waive only when no FP Nation is At War by
// mid-game, i.e. the opponent is provably turtling), not a standing exemption.
function wakePrice(state: GameState, actor: Side, id: RegionId, attacking = false): number {
  // SHADOW ONLY — measured, see the note above. The rule is symmetric but the two
  // sides' positions are not, and charging the Free Peoples for it cost them more
  // than it saved.
  if (actor !== 'shadow') return 0;
  const theirs = (n: Nation): boolean => FP.has(n); // actor is the Shadow, so "theirs" is any FP Nation
  const priceOf = (n: Nation): number => {
    const ns = state.nations[n];
    if (!ns || ns.step === 0) return 0;
    const p = state.reinforcements[n];
    return ((p?.regular ?? 0) + (p?.elite ?? 0) + (p?.leader ?? 0)) / ns.step;
  };
  const woken = new Set<Nation>();
  const def = REGIONS[id];
  // A Fortification (Osgiliath) belongs to no Nation and rouses nobody (armies.ts).
  if (def?.nation && def.settlement && def.settlement !== 'Fortification' && theirs(def.nation)) woken.add(def.nation);
  if (attacking) {
    const r = state.regions[id];
    for (const f of [r?.units, r?.siegeBox?.units]) {
      for (const n of Object.keys(f ?? {}) as Nation[]) {
        const u = f![n];
        if (u && u.regular + u.elite > 0 && theirs(n)) woken.add(n);
      }
    }
  }
  let total = 0;
  for (const n of woken) total += priceOf(n);
  return total;
}
// Weights for `wakePrice` at the two scales it is charged on: the action scorer
// (capture ~vp*30+25, attack ~vp*25+25) and the campaign-target ranking (~vp*4).
const WAKE_W_ACTION = 8;
const WAKE_W_TARGET = 0.8;

/** The enemy Settlement (vp>0) worth marching on: nearest to one of our armies,
 *  weighted by VP. Cached per state object (one campaign target per decision). */
const targetCache = new WeakMap<object, RegionId | null>();
// ————— Shadow campaign plans (Luke Martens, 2026-08-30) ————————————————————
// "You need 10 points... instead of running an optimization algorithm, hard
// code a few routes... a shopping list: if a die can fit in place, use it for
// Rohan; if you can't, use it for your next task." Each plan is an ordered
// 10-VP route; the current objective is the first target not yet held, and an
// army much closer to a LATER objective serves that one instead (his plan-B
// fall-through). The roll is fixed at setup (state.shadowPlanRoll) so the
// opening varies game to game but every decision stays a pure function of the
// state; no roll (old save) -> null -> the planless targeting below.
const SHADOW_PLANS: RegionId[][] = [
  // A (roll 0-39): Rohan (3) -> Gondor (5) -> an Elven Stronghold (2).
  ['helms-deep', 'edoras', 'minas-tirith', 'pelargir', 'dol-amroth', 'lorien'],
  // B (roll 40-74): Gondor first, then Rohan, then Lorien.
  ['minas-tirith', 'pelargir', 'dol-amroth', 'helms-deep', 'edoras', 'lorien'],
  // C (roll 75-99): the northern "DEW line" — Dale, Erebor, Woodland Realm — then south.
  ['dale', 'erebor', 'woodland-realm', 'lorien', 'rivendell'],
];
function shadowPlan(state: GameState): RegionId[] | null {
  const roll = state.shadowPlanRoll;
  if (roll == null) return null;
  return SHADOW_PLANS[roll < 40 ? 0 : roll < 75 ? 1 : 2]!;
}
/** The plan's live objectives: targets not yet Shadow-held, in plan order. */
function planObjectives(state: GameState): RegionId[] {
  const plan = shadowPlan(state);
  return plan ? plan.filter((t) => settlementCtrl(state, t) !== 'shadow') : [];
}
/** Luke's fall-through: this army serves the FIRST objective unless a later one
 *  is decisively closer (>=4 regions), so a second front forms naturally. */
function planTargetFor(state: GameState, from: RegionId, primary: RegionId | null): RegionId | null {
  if (!primary) return primary;
  const objs = planObjectives(state);
  if (objs.length < 2 || objs[0] !== primary) return primary;
  for (const later of objs.slice(1, 3)) {
    if (dist(from, later) + 4 <= dist(from, primary)) return later;
  }
  return primary;
}

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
    // An enemy Settlement standing EMPTY is a walk-in: VP for no battle and no
    // losses. Rank it above a defended one of the same worth so the AI actually
    // takes the opening rather than massing next to it (player report: six armies
    // sat in Lórien while Dol Guldur and Moria stood undefended).
    // ...minus the political price of waking its Nation (wakePrice), so the campaign
    // aims at ground whose Nation is already At War before it aims at a sleeping one.
    const s = def.vp * 4 - d + (armyHere(state, id, enemy) ? 0 : def.vp * 3)
      - wakePrice(state, actor, id) * WAKE_W_TARGET;
    if (s > bestScore) { bestScore = s; best = id; }
  }
  // Shadow campaign plan: the plan's first live objective replaces the greedy
  // pick — EXCEPT a walk-in (an empty enemy VP Settlement within 2 of one of our
  // armies) is free points now and always worth the detour.
  if (actor === 'shadow') {
    const objs = planObjectives(state);
    if (objs.length) {
      const walkIn = best && !armyHere(state, best, enemy)
        && myArmies.some((a) => dist(a, best!) <= 2);
      targetCache.set(state, walkIn ? best : objs[0]!);
      return walkIn ? best : objs[0]!;
    }
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
      // Pre-Mordor each move triggers a Hunt, so the push eases as Corruption climbs
      // and leans on declare-to-heal to bring it back down. But the old curve
      // (72 - 9x, floor 8) fell off a cliff: by Corruption 5 the Fellowship move lost
      // to almost any army action, so the FP banked no more Progress — and Progress is
      // the ONLY way to reach a Mordor entrance and declare there. The Ring simply
      // stopped moving (player report: "in the beginning it makes quite a lot of
      // regions but then it drops the ball… it has no realistic chance to win
      // non-military"). His diagnosis is right — past Corruption ~5 this score loses
      // to almost any army action and the Fellowship stops banking the Progress that
      // is the ONLY way to reach a Mordor entrance. But reweighting THIS action does
      // not fix it. Two 2000-game A/Bs against the 48.3% / 671-Ring baseline:
      //   78 - 4x, floor 38 : Ring 814, but Corruption deaths 330->1156, military wins
      //                       999->30, FP 40.7% — the FP stops playing the board and
      //                       just sprints into the Hunt.
      //   72 - 9x, floor 25 : Ring 683 (+12, noise), Corruption 388, FP 46.7% — pays
      //                       1.6 points for nothing.
      // Left at the measured-best curve. The real gap is that the AI cannot PLAN the
      // Mordor run (bank Progress, time heal-declares, spend Companions deliberately);
      // it weighs one action at a time, and no single weight buys foresight.
      //   Hunt-box aware (free move on an empty box, ease as it fills): tried and
      //     REVERTED. 2000 games on top of the heal fix — Ring 761->1071 but Corruption
      //     658, military wins across both sides 849->271, FP 50.0%->56.1%, median 15
      //     ->13 turns. Reading the box is sound (it is public, and an empty box really
      //     does skip the roll), but rating a free move at 92 let the push dominate
      //     whenever the box was empty, and 86% of games collapsed into a Ring race.
      //     The lesson repeats: anything that lifts this score's CEILING unbalances the
      //     game, because it competes globally against every other FP action.
      //
      //   Per-turn QUOTA (guarantee the Ring one die per turn at 82, then fall back to
      //     the curve): tried and REVERTED, and it failed hardest of the three —
      //     military wins 849->66, Corruption 390->847, FP 50.0%->54.5%, median 15->11
      //     turns. The reasoning that it was safe ("only one die, so it cannot starve
      //     the board") was simply wrong: one die EVERY turn, in a game that lasts
      //     11-15 turns, is a large share of the FP's dice, and the game ends in a Ring
      //     race before armies matter.
      //
      // Three attempts, one conclusion: every intervention that makes the Fellowship
      // move MORE OFTEN collapses the game into a Ring race, whether it raises the
      // ceiling, flattens the curve, or reserves a die. The heal fix (above) worked
      // because it removed a DEADLOCK — it unsticks a specific frozen state without
      // changing how often the Fellowship moves in a healthy game. The remaining gap is
      // planning (bank Progress -> heal -> make the run), which no per-action number
      // can express.
      //
      //   Fellowship-plan RUN state (docs/ai-fellowship-plan.md, stage 1): a pure
      //     function of public state — "within 2 steps of a Mordor entrance after
      //     banked Progress" — that lifted THIS score to 88, let an Elven Ring buy the
      //     Character die, traded Companions from Corruption 6, and let an entrance
      //     declare beat a rest-heal. Tried and REVERTED (2 x 2000 games vs the
      //     d1795a1 baseline, FP 876 / Ring 630 / military 810 / median 15):
      //       ungated:              Ring 752, corruption 851, military 397, median 11
      //       gated Corruption<=6:  Ring 760, corruption 815, military 425, median 11
      //     The machine did what it was built to do (Mordor entries 1225->1598, mean
      //     entry turn 11.2->9.0) and the game became a Ring race decided by turn 11.
      //     The window is not narrow: Minas Tirith is 3 from Minas Morgul, so RUN was
      //     on for most of the mid-game. Same lesson, fifth time — the bias must be
      //     narrower still, or attach to something other than move frequency.
      //
      // HEAL (fellowshipPlan, stage 2): while resting in a heal-spot, do not move
      // — a move is a Hunt roll that undoes the rest, and the next in-place declare
      // discards the Progress anyway. This LOWERS move frequency, the opposite of
      // every reverted experiment.
      if (fellowshipPlan(state) === 'HEAL') return 5;
      return Math.max(8, 72 - fs.corruption * 9);
    case 'hideFellowship': return 85;                                  // must hide to keep moving
    case 'separateCompanion': {                                        // rouse a passive nation
      const passiveFp = (['dwarves', 'gondor', 'north', 'rohan'] as Nation[]).some((n) => state.nations[n].step > 0 && !state.nations[n].active);
      // Every Companion who leaves is one less body to absorb Hunt damage (p.42), so
      // the Fellowship keeps a core of four. Without this the AI stripped it turn
      // after turn while any Nation stayed passive (player report: "they take a bunch
      // of guys out of the fellowship… it doesn't help the cause").
      if (fs.companions.length <= 4) return 2;
      // At the gates of Mordor a Companion is worth far more INSIDE the Fellowship:
      // the Mordor Track's Hunt is relentless and Companions are the bodies that
      // absorb it (p.42). Separation is impossible once on the Track (beginSeparation
      // refuses), so what a player sees as "it separated everyone as soon as they got
      // to Mordor" is the AI emptying the Fellowship on the doorstep — the worst
      // possible moment (player report).
      if (fs.mordor !== null || MORDOR_ENTRANCES.includes(fs.location)) return 1;
      return passiveFp && fs.corruption < 6 ? 40 : 12;
    }
    case 'attack': {
      // SORTIE (p.32): we're the boxed garrison attacking the besiegers, so from === to
      // and the REGION's units are theirs, not ours — unitCount(a.from) would measure the
      // enemy. Sallying out forfeits the Stronghold's 6-to-hit protection, and if the
      // whole garrison dies the Stronghold falls outright, so only go when clearly
      // stronger; breaking the siege is worth the Stronghold's VP.
      const sortieBox = sortieForce(state, a.from, actor);
      if (sortieBox) {
        const mine = forceUnitCount(sortieBox), theirs = unitCount(state, a.to);
        if (theirs === 0 || mine < theirs * 2) return -60;
        return (mine - theirs) * 8 + REGIONS[a.to]!.vp * 20 + 10;
      }
      const fromU = unitCount(state, a.from), toU = unitCount(state, a.to);
      if (fromU < toU) return -50;                                     // don't attack uphill
      // Fortified targets (City first round, Stronghold siege every round) mean the
      // attacker hits on 6s while the defender hits on 5s — a near-even force just
      // bleeds. Require a real margin before assaulting a defended fortification.
      const fortified = a.from !== a.to && !!REGIONS[a.to]!.settlement && REGIONS[a.to]!.settlement !== 'Town' && toU > 0;
      if (fortified && fromU < toU * 2) return -40;
      // Assault (from===to): the garrison is in the SIEGE BOX (toU counts ourselves);
      // storming also hits on 6s vs the defender's 5s — same margin rule.
      if (a.from === a.to) {
        const box = state.regions[a.to]!.siegeBox;
        const gar = box ? Object.values(box.units).reduce((s2, u) => s2 + (u?.regular ?? 0) + (u?.elite ?? 0), 0) : 0;
        if (gar > 0 && fromU < gar * 2) return -40;
      }
      let atk = (fromU - toU) * 8 + REGIONS[a.to]!.vp * 25 + 25 - wakePrice(state, actor, a.to, true) * WAKE_W_ACTION;
      // Stage the Ringwraiths first (player report): a big fortified fight with thin
      // Leadership, a Character die still in hand, and Nazgûl elsewhere to bring —
      // ease THIS attack below the fly-in scores so the wraiths arrive before the
      // dice are rolled. Tightly gated; the attack fires as normal next activation.
      if (actor === 'shadow' && (fortified || a.from === a.to) && state.dice.shadow.includes('character')) {
        const r = state.regions[a.from]!;
        const lead = r.nazgul + (r.characters.includes('witch-king') ? 2 : 0);
        const wraithsElsewhere = Object.entries(state.regions)
          .some(([id, rr]) => id !== a.from && (rr.nazgul > 0 || rr.characters.includes('witch-king')));
        if (lead < 3 && wraithsElsewhere) atk -= 30;
      }
      return atk;
    }
    // Aragorn / Gandalf the White: +1 FP Action die, permanently — worth more than
    // any single action, so it outranks even the Fellowship push (72 at Corruption
    // 0), which previously stole the Will die whenever it was the last one left
    // (player feedback: "your two Prime Directives should be getting GtW and
    // Aragorn out ASAP for the extra dice").
    case 'bringUpgrade': return 90;
    case 'bringMinion': return 55 - (target ? Math.min(10, dist(a.region, target)) : 0); // +1 die and a strong leader — placed toward the front
    case 'recruitUnit': return recruitScore(state, actor, a, target); // build the war stacks WHERE THEY MATTER
    case 'moveArmy': return armyMoveScore(state, actor, a.from, a.to, target);
    case 'moveCharacter': return moveCharacterScore(state, actor, a, target); // reposition Nazgûl/Companions
    case 'diplomaticAction': return diplomaticScore(state, actor, a.nation); // mobilize toward At War
    case 'companionMuster': // a Companion advances its Nation toward War (any die) — mobilization
      return state.nations[a.nation].step > 0 ? 28 : 6;                // worth it only while the Nation isn't yet At War
    case 'sarumanMuster': return a.mode === 'recruit' ? 45 : 30;       // Voice of Saruman: a big Isengard build / Elite upgrade
    case 'useElvenRing': return elvenRingScore(state, actor, a);       // change a die's face (conservatively)
    case 'playEvent': {
      // A heal card at ZERO Corruption heals nothing — playing it burns a card and a
      // die for literally no effect (player report: "why did they play a card that
      // didn't do anything? they had no corruption"). 25 was low but still won the
      // argmax on a quiet turn 1. Below every real option, so it is never chosen.
      if (actor === 'fp' && HEAL_EVENTS.has(a.cardId)) {
        if (fs.corruption === 0) return -5;
        return fs.corruption >= 6 ? 95 : 25;
      }
      if (actor === 'shadow' && CORRUPT_EVENTS.has(a.cardId)) return 70;
      // Wormtongue only LOCKS Rohan's activation — once Rohan is already active
      // (let alone At War) the table effect is moot, and the card's combat half
      // (Foul Stench: cancels the FP Leader re-roll) is its remaining value. Don't
      // burn it as a dead event (player report: "should have kept it for Combat").
      if (a.cardId === 'sh-char-22' && state.nations.rohan.active) return 1;
      // Flocks of Crebain buys +1 on a Hunt ROLL, and on the Mordor Track no Hunt roll
      // ever happens (p.43: the tile is drawn automatically) — so on the table there it
      // is simply dead. Keep it for its combat half instead (player report: "SP played
      // Flocks of Crebain while I was in Mordor (no effect)").
      if (a.cardId === 'sh-char-16' && fs.mordor !== null) return 1;
      // Worn with Sorrow and Toil only bites "if a Companion IN THE FELLOWSHIP is taken
      // as a casualty" — and a Companion can never rejoin the Fellowship, so with the
      // Fellowship down to the Ring-bearers the trigger can never fire again for the
      // rest of the game. Keep it for its combat half (Words of Power) instead (player
      // report: "SP played Worn with Sorrow & Toil when there were no Companions in the
      // Fellowship. No effect.").
      if (a.cardId === 'sh-char-15' && fs.companions.length === 0) return 1;
      // Threats and Promises only bars the FP from advancing a PASSIVE Nation with a
      // Muster die — once every FP Nation is active it's a dead table card; keep it
      // for its combat half (Devilry of Orthanc). Same trap as Wormtongue (player
      // report: "played Threats & Promises after the Witch-King activated all FP nations").
      if (a.cardId === 'sh-str-05' && (['dwarves', 'elves', 'gondor', 'north', 'rohan'] as Nation[]).every((n) => state.nations[n].active)) return 1;
      // A card with a strong COMBAT box (Deadly Strife etc.) is usually worth more
      // held for battle than played as its event — burning it is weak play (player
      // report: "Return to Valinor for the top half is VERY weak").
      return 35 - combatCardValue(combatModsFor(a.cardId)) * 3;
    }
    case 'forceDiscardCard':
      // Shadow: burning a die + two hand cards to lift A Power too Great / Tom
      // Bombadil is worth it ONLY when the ban actually blocks the campaign —
      // i.e. our current march target is one of the barred regions.
      if (actor === 'shadow' && a.via === 'cards') {
        return target && (SH_FORCE_DISCARD_UNLOCKS[a.cardId] ?? []).includes(target) ? 45 : 1;
      }
      return 20; // FP: lifting Palantír / Denethor's Folly is generally good value
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

/** Muster where it matters: into/near an existing army or near the campaign target —
 *  not a lone Nazgûl in an empty rear Stronghold (player report: "spent musters on
 *  nazgul in barad-dur (with no army) and angmar"). */
function recruitScore(state: GameState, actor: Side, a: Extract<WotrAction, { kind: 'recruitUnit' }>, target: RegionId | null): number {
  let s = actor === 'shadow' ? 30 : 16;
  if (armyHere(state, a.region, actor)) s += 10;                       // reinforce a real stack
  if (target) s += Math.max(0, 12 - dist(a.region, target) * 2);       // near the front
  // GARRISON. Mustering into an empty VP Settlement we hold is the cheapest possible
  // defence — it conjures a defender on the spot, so no army has to leave the front to
  // cover it. Weighted above the march-toward-the-target term, because losing a
  // Stronghold hands the enemy 2 VP outright while a slightly slower advance costs
  // nothing so concrete.
  // Scaled by how close the enemy is to their VP threshold: with the board quiet this
  // is exactly the weight measured when the term was introduced, but once they are
  // genuinely closing, covering our own Settlements outranks pressing the attack.
  if (undefendedVP(state, a.region, actor)) s += ((REGIONS[a.region]!.vp ?? 0) * 20 + 30) * (1 + 1.5 * enemyPressure(state, actor));
  return s;
}

/** March toward the campaign target, capture undefended enemy Settlements
 *  outright, and concentrate stacks. */
function armyMoveScore(state: GameState, actor: Side, from: RegionId, to: RegionId, target: RegionId | null): number {
  const enemy: Side = actor === 'fp' ? 'shadow' : 'fp';
  // Luke's fall-through: an army decisively closer to a LATER plan objective
  // marches on that one instead of trekking across the map to objective #1.
  if (actor === 'shadow') target = planTargetFor(state, from, target);
  let s = actor === 'shadow' ? 16 : 8;
  // While the Ring is parked the Shadow is racing an opponent who has stopped racing:
  // lean into captures and marching, which is how a human punishes a resting Fellowship.
  // MEASURED NEUTRAL in self-play (2000 games): Shadow military wins 609->617, FP
  // 50.0%->49.7% — noise. Kept anyway, with the reason stated so it is not mistaken
  // for a validated win: the condition is live (it fires on 5.0% of Shadow decisions,
  // in 187 of 200 games), but self-play cannot really exercise it, because the FP AI
  // leaves as soon as Corruption drops under 4 while a HUMAN parks for as long as the
  // rest is worth it. Against a human this should bite considerably harder than the
  // numbers here suggest. If a later measurement shows it doing nothing against human
  // play either, delete it — an unearned multiplier is a liability.
  const pressing = actor === 'shadow' && fellowshipStalled(state);
  if (settlementCtrl(state, to) === enemy && !armyHere(state, to, enemy)) {
    s += (REGIONS[to]!.vp * 30 + 25) * (pressing ? 1.4 : 1);                                // capture
    s -= wakePrice(state, actor, to) * WAKE_W_ACTION;                                       // ...at the political price of it
  }
  if (armyHere(state, to, actor)) s += 10;                                                                // concentrate
  // Re-garrison one of our own VP Settlements that is sitting empty within an enemy's
  // reach. Scored BELOW the equivalent capture so the AI still prefers taking ground to
  // sitting on it — this is meant to stop free walk-ins, not to turn the AI turtle.
  if (undefendedVP(state, to, actor)) s += (REGIONS[to]!.vp * 18 + 12) * (1 + 1.5 * enemyPressure(state, actor));
  // VACATING a VP Settlement we hold is a cost, not a free move — the score used to
  // weigh only the destination, so a whole-army march out of a Stronghold read as
  // pure profit and the AI walked away from ground it was winning on (player report:
  // "they abandoned Minas Tirith to hold….nothing"). Charged only when the region is
  // ACTUALLY left open: a stack of 2+ keeps the Settlement via the garrison split
  // (same `garrisonWorthy` test, so score and split can't disagree), while a lone
  // unit marching off really does hand it over.
  if (garrisonWorthy(state, actor, from) && unitCount(state, from) < 2) {
    s -= (REGIONS[from]!.vp * 14 + 10) * (1 + 1.5 * enemyPressure(state, actor));
  }
  // March toward the campaign target — and press harder when that target is standing
  // OPEN, so closing on a free capture outweighs the odds and ends the AI's habit of
  // parking next to an undefended Stronghold (player reports of both sides going quiet).
  if (target) {
    const open = settlementCtrl(state, target) === enemy && !armyHere(state, target, enemy);
    s += -(dist(to, target) - dist(from, target)) * (open ? 20 : 12) * (pressing ? 1.5 : 1);
    if (to === target) s += 30;
  }
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
/** How much a Shadow Ringwraith gains by flying INTO the army staged against the
 *  campaign target before the attack goes in (player report: "the AI should have
 *  used [C] to move all the nazgul to the siege before attacking Minas Tirith —
 *  re-rolls, plus extra cards with the Witch-king"). Nazgûl fly any distance on a
 *  Character die, each adds a Leader re-roll die (cap 5, p.30), and the
 *  Witch-king adds Leadership 2. 0 when it wouldn't help: not our army, not the
 *  target's doorstep, or the re-roll cap is already met. */
function nazgulStagingBonus(state: GameState, char: string, to: RegionId, target: RegionId | null): number {
  if (!target || (char !== 'nazgul' && char !== 'witch-king')) return 0;
  if (!armyHere(state, to, 'shadow')) return 0;
  // The staging army: besieging the target (assaults launch from the target region
  // itself) or standing adjacent, ready to attack into it.
  const atDoor = to === target ? !!state.regions[to]!.siegeBox : (REGIONS[to]!.adjacency as RegionId[]).includes(target);
  if (!atDoor) return 0;
  const r = state.regions[to]!;
  const lead = r.nazgul + (r.characters.includes('witch-king') ? 2 : 0);
  if (lead >= 5) return 0;                        // the re-roll cap is met — more adds nothing
  return char === 'witch-king' ? 62 : 56;         // WK: Leadership 2 + his card strength
}

function moveCharacterScore(state: GameState, actor: Side, a: Extract<WotrAction, { kind: 'moveCharacter' }>, target: RegionId | null): number {
  const fs = state.fellowship;
  if (actor === 'shadow') {
    const staging = nazgulStagingBonus(state, a.char, a.to, target);
    if (staging > 0) return staging;
    if (a.char === 'nazgul') return (!fs.hidden && a.to === fs.location) ? 42 : 6;
    return 4; // Minions: situational
  }
  // A separated Companion used to score a flat 4 for every destination, so it never
  // went anywhere worth going and simply stood where it was dropped (player report:
  // the FP "take a bunch of guys out of the fellowship anddddd forgot about them").
  // Give the two things a loose Companion is actually FOR real weight:
  const def = REGIONS[a.to]!;
  //  1. walking into a friendly City/Stronghold of a Nation that is not yet At War
  //     rouses it (activateNation on entry) — the whole point of separating.
  if ((def.settlement === 'City' || def.settlement === 'Stronghold')
    && !!def.nation && FP.has(def.nation) && settlementCtrl(state, a.to) !== 'shadow'
    && state.nations[def.nation]!.step > 0) return 34;
  //  2. joining one of our Armies adds its Leadership to every battle it fights.
  if (armyHere(state, a.to, 'fp')) return 18;
  return 4;
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
      const moves = legal.filter((a) => a.kind === 'separateMove' && a.target != null) as Extract<WotrAction, { kind: 'separateMove' }>[];
      // RAW p.39: ONE action separates a whole GROUP. The AI used to ignore the
      // group-add options (companion set, no target) and place a single Companion,
      // so sending two to the same place cost two Character dice (player report:
      // Merry, then Pippin, both to the Woodland Realm). Add a travelling companion
      // while the Fellowship can still spare one — four must remain to absorb Hunt
      // damage, the same core the separateCompanion score protects.
      const adds = legal.filter((a) => a.kind === 'separateMove' && a.companion && a.target == null) as Extract<WotrAction, { kind: 'separateMove' }>[];
      if (adds.length && state.fellowship.companions.length > 4) {
        // Send the LOWEST-Level companion along: high-Level Companions are worth more
        // in the Fellowship (they absorb more Hunt damage) and as separate agents.
        return adds.reduce((best, a) => (levelOf(a.companion!) < levelOf(best.companion!) ? a : best), adds[0]!);
      }
      // The rouse-target filter must demand a FREE PEOPLES Settlement. It only
      // checked "Stronghold + nation not At War", which was harmless while Shadow
      // Strongholds were unreachable — the moment the p.24 fix made them legal
      // landing spots, the AI began separating Companions INTO Dol Guldur and Moria
      // (measured: 4 of 19 placements over 100 games), mistaking them for targets.
      const settle = moves.find((a) => { const d = REGIONS[a.target!]!; return (d.settlement === 'City' || d.settlement === 'Stronghold') && !!d.nation && FP.has(d.nation) && settlementCtrl(state, a.target!) !== 'shadow' && state.nations[d.nation as Nation]?.step > 0; });
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
      // LETHAL DAMAGE: take EVERY reduction on offer before conceding the game. At 12
      // Corruption the Free Peoples lose outright (p.44), so a reduction whose only
      // price is the Fellowship's hiding place — Gollum revealing, a Hobbit Guide
      // stepping out — is free by comparison. Each reduction re-prompts, so this keeps
      // firing until the hit is survivable and then hands back to the normal policy.
      // (Player report, from the SHADOW seat: "I think the FP cheated itself out of a
      // win… Gollum could've used his guide ability to reveal F&S and reduce the damage
      // by 1, thus giving the FP a ring victory." It was on Mordor step 4 with an empty
      // Fellowship, so every casualty branch below was inapplicable and the AI walked
      // into 12 Corruption with a live out in hand.)
      if (wouldCorrupt >= 12) {
        const lifeline = legal.find((a) => a.kind === 'huntDamage' && a.mode === 'reduceCard')
          ?? legal.find((a) => a.kind === 'huntDamage' && a.mode === 'reduceReveal')
          ?? legal.find((a) => a.kind === 'huntDamage' && a.mode === 'reduceSeparate');
        if (lifeline) return lifeline;
      }
      // Spend a cheap −1 reduction (discard an on-table card) once Corruption is
      // climbing — it costs no Companion and lowers the hit before we absorb it.
      if (wouldCorrupt >= 7) {
        const reduceCard = legal.find((a) => a.kind === 'huntDamage' && a.mode === 'reduceCard');
        if (reduceCard) return reduceCard;
      }
      // Gandalf gambit (playtester suggestion): on a meaty hit, sacrifice Gandalf
      // the Grey as the casualty — it absorbs the damage AND unlocks Gandalf the
      // White (a stronger piece + the die he brings). Only while Corruption is not
      // yet critical (the sacrifice covers the whole hit regardless of his Level).
      if (damage >= 2 && state.fellowship.guide === 'gandalf-grey' && wouldCorrupt < 10) {
        const guide = legal.find((a) => a.kind === 'huntDamage' && a.mode === 'guide');
        if (guide) return guide;
      }
      // ON THE MORDOR TRACK, SPEND THE BODIES. A Companion inside the Fellowship can
      // never be separated again once it enters Mordor (p.43), so from here on their
      // ONLY remaining use is soaking Hunt damage — hoarding them just means dying with
      // them in hand while Corruption (the 12-step death clock) runs. Take the casualty
      // on every hit; on a big one spend the GUIDE, who is the highest-Level Companion
      // left (the engine re-assigns the Guide down the Levels) and so is the only body
      // that can cover a 3 without spilling the excess into Corruption.
      // (Player report: "why enter Mordor with all those companions if you're not going
      // to use them? I would've used Strider to cancel the damage.")
      // WHICH body to spend: RAW gives exactly two options (p.42) — take the GUIDE, or
      // draw a RANDOM Companion. The Guide is always the highest-Level Companion left
      // (the engine re-assigns down the Levels), so he absorbs the most; a random draw
      // can come back a Level-1 Hobbit. Take him whenever the hit is at least as big as
      // his Level (no absorption is wasted, and it is the largest reduction on offer) —
      // or whenever a random draw could still leave the Ring-bearers dead at 12.
      // Otherwise spend a cheap body and keep the big one for a bigger hit.
      // (Player report: 6 damage at 7 Corruption drew Merry for −1 and lost the game;
      // Strider, the Guide, would have absorbed 3 and the Fellowship would have lived.)
      const guideIn = state.fellowship.companions.includes(state.fellowship.guide);
      const guideLevel = guideIn ? levelOf(state.fellowship.guide) : 0;
      const randomMightKill = wouldCorrupt - 1 >= 12; // a random Companion absorbs as little as 1
      const takeGuide = guideIn && (damage >= guideLevel || randomMightKill);
      const casualty = (): WotrAction | undefined => (takeGuide
        ? legal.find((a) => a.kind === 'huntDamage' && a.mode === 'guide')
        : legal.find((a) => a.kind === 'huntDamage' && a.mode === 'random'))
        ?? legal.find((a) => a.kind === 'huntDamage' && (a.mode === 'guide' || a.mode === 'random'));
      if (state.fellowship.mordor !== null && state.fellowship.companions.length > 0) {
        const cas = casualty();
        if (cas) return cas;
      }
      // OFF THE TRACK, SPEND THE BODIES TOO. The old policy hoarded Companions until
      // Corruption reached 8 on the theory that they are worth more alive (separations
      // rouse Nations, Aragorn is still crownable). Measured, that theory is wrong: the
      // Corruption it banks has to be paid back by DECLARING in a friendly City to heal,
      // and that detour is what stalls the Ring run. (Player report: "isn't it always
      // better to take a companion than damage — unless you are planning to heal?")
      //
      // A/B over 400 games per arm, two seed families, both sides heuristic —
      // Free Peoples win rate by the Corruption level at which bodies start being spent:
      //   >= 8 (old) 54.8%  |  >= 5  58.3%  |  >= 3  66.3%  |  >= 2  65.5%  |  always 66.8%
      // Everything from 3 down is tied inside the noise, and the mechanism is visible in
      // the telemetry: heal-declares 486 -> 198, stalled pre-Mordor turns 45% -> 13%,
      // mean Mordor entry turn 10.6 -> 8.0, Mordor entries 282/400 -> 390/400.
      //
      // Take 3 rather than "always": at 0-2 Corruption a single point is cheap and the
      // Companion still has a job (a separation that rouses a Nation is the Free Peoples'
      // only military path), which is the reporter's own caveat — "unless it's planning
      // on using them in the war effort". Above that, the body is the cheaper currency.
      if (wouldCorrupt >= 3 && state.fellowship.companions.length > 0) {
        return casualty() ?? legal[0]!;
      }
      return legal.find((a) => a.kind === 'huntDamage' && a.mode === 'corruption') ?? legal[0]!;
    }
    case 'combatCasualties': // keep Elites (strength): spend Regulars first
    case 'eventCasualties': { // direct-damage Event card: same preference
      // Casualties are now allocated one hit at a time (p.30). Keep the old policy —
      // Elites are worth more than Regulars, so shed a Regular whenever one is left,
      // and only then reduce an Elite. Never take the two-hits-for-one-Elite option:
      // it costs an extra hit AND the unit, which is only ever worth it for a human
      // playing around a siege requirement.
      const steps = legal.filter((a) => a.kind === 'casualtyStep') as Extract<WotrAction, { kind: 'casualtyStep' }>[];
      if (steps.length) {
        return steps.find((a) => a.step === 'removeRegular')
          ?? steps.find((a) => a.step === 'reduceElite')
          ?? steps[0]!;
      }
      return legal.find((a) => a.kind === 'chooseCasualties' && a.plan === 'regularsFirst') ?? legal[0]!;
    }
    case 'valinorCasualties': // Return to Valinor: keep Elves' Elites → remove Regulars first
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
    case 'besiegerAdvance': {
      // Advancing is what turns a repelled attack into a siege — decline and the
      // garrison simply walks back out and nothing was gained. Always advance.
      return legal.find((a2) => a2.kind === 'besiegerAdvance' && a2.advance) ?? legal[0]!;
    }
    case 'combatCardCost': {
      // Sizing a variable-cost combat card. Forfeiting Nazgûl Leadership (Dread and
      // Despair) costs re-roll dice we may not be using, so spend freely; self-inflicted
      // hits (Relentless Assault, Onslaught) cost real units, so only buy them when the
      // army is big enough that a couple of losses will not decide the battle.
      const d = state.pendingChoice!.data as { kind: 'selfHits' | 'nazgulLeadership'; min: number; max: number; postCasualty?: boolean };
      const me: Side = state.pendingChoice!.owner;
      const mine = pc ? unitCount(state, me === pc.attacker ? pc.from : pc.to) : 0;
      let want: number;
      if (d.kind === 'nazgulLeadership') {
        want = d.max;                                  // the forfeit buys enemy dice off; take it all
      } else {
        // SELF-HITS (Relentless Assault, Onslaught). A Combat roll is min(5, units)
        // dice, so a hit paid out of a stack of 5 or fewer BUYS A BONUS BY THROWING
        // AWAY A DIE — and the unit is gone for the rest of the game either way.
        // Only spend what sits ABOVE the 5-dice cap, where the figure costs no dice.
        // (Until the cardCost step became reachable this branch never ran; the first
        // soak that exercised it swung 2000 games by ~140 FP wins, the Shadow bleeding
        // 2 units a battle for a one-round edge.)
        want = Math.max(0, Math.min(d.max, mine - 5));
      }
      want = Math.max(d.min, Math.min(d.max, want));
      return legal.find((a2) => a2.kind === 'combatCardCost' && a2.amount === want) ?? legal[0]!;
    }
    case 'nazgulStrike': {
      // Tear down a Hunt-defence card when one is on the table — those blunt every
      // FUTURE Hunt, worth more than one roll now — otherwise take the roll.
      const guards = new Set(['fp-char-06', 'fp-char-07', 'fp-char-08']); // Axe and Bow / Horn of Gondor / Wizard's Staff
      const rip = legal.find((a) => a.kind === 'nazgulStrike' && a.discard && guards.has(a.discard));
      return rip ?? legal.find((a) => a.kind === 'nazgulStrike' && !a.discard) ?? legal[0]!;
    }
    case 'advanceChoice': {
      const adv = legal.find((a) => a.kind === 'advanceChoice' && a.advance) ?? legal[0]!;
      // Advance the force — but leave ONE unit when marching out would hand the
      // enemy the origin. Log mining (530 uploaded games, 2026-08-30) found the
      // single biggest human exploit was exactly this seam: attack FROM a VP
      // Stronghold, win, advance everything, and the human walks into the empty
      // origin. 81 of 83 empty-Orthanc captures in human-FP military wins came
      // this way (Saruman still inside for 77); the FP AI mirrors it at Helm's
      // Deep / Pelargir / Lórien. maybeSplitGarrison can't help — it guards MOVES,
      // and this vacating happens inside the battle's advance step.
      const d = state.pendingChoice!.data as { from: RegionId; to: RegionId };
      const owner: Side = state.pendingChoice!.owner;
      if (adv.kind === 'advanceChoice' && adv.advance && garrisonWorthy(state, owner, d.from)) {
        const r = state.regions[d.from]!;
        const nations = (Object.keys(r.units) as Nation[]).filter((n) => (r.units[n]!.regular + r.units[n]!.elite) > 0);
        const total = nations.reduce((s2, n) => s2 + r.units[n]!.regular + r.units[n]!.elite, 0);
        if (total >= 2) {
          const garN = nations.find((n) => r.units[n]!.regular > 0) ?? nations[0]!;
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
          if (owner === 'fp' && r.leaders) move.leaders = r.leaders;
          if (owner === 'shadow' && r.nazgul) move.nazgul = r.nazgul;
          const mine = r.characters.filter((c) => (owner === 'shadow') === SHADOW_CHARS.has(c) && c !== 'saruman'); // Saruman never leaves Orthanc
          if (mine.length) move.characters = mine;
          return { kind: 'advanceChoice', advance: true, move };
        }
      }
      return adv;
    }
    case 'advanceHoldBack':
      // Keep the whole Army forward — the ground was just taken and holding it is
      // what wins the game. (Garrisoning the ORIGIN is maybeSplitGarrison's job, on
      // the move that vacates it.)
      return legal.find((a) => a.kind === 'advanceHoldBack') ?? legal[0]!;
    case 'relieveAdvance': {
      // Reliever: march into the Stronghold we just freed, so the two forces defend as
      // one behind its walls — but not if the combined stack would breach the 10-unit
      // limit, since the excess is destroyed outright for no gain (nothing is captured
      // here; the region was friendly all along).
      const d = state.pendingChoice!.data as { from: RegionId; to: RegionId };
      const join = unitCount(state, d.from) + unitCount(state, d.to) <= STACKING_LIMIT;
      return legal.find((a) => a.kind === 'relieveAdvance' && a.advance === join) ?? legal[0]!;
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
    case 'revealMove': {
      // The figure goes toward Mordor — but the reveal PARKS it, and the Hunt re-rolls
      // against wherever it stands until the Fellowship declares again. So among targets
      // EQUALLY close to Morannon the neighbourhood decides the next few Hunts: prefer a
      // region with no re-roll source standing in it, then one with nothing next door
      // that can walk in, then one near an unconquered FP City/Stronghold to rest-heal in.
      // (Player report: revealed at Dimrill Dale, the AI stepped into North Anduin Vale —
      // the same 5 regions from Morannon as Parth Celebrant, but hard against Dol Guldur's
      // army and Nazgûl and facing away from Lorien's rest-heal.)
      const moves = legal.filter((a): a is Extract<WotrAction, { kind: 'revealMove' }> => a.kind === 'revealMove');
      if (!moves.length) return legal[0]!;
      const healSpots = (Object.keys(state.regions) as RegionId[]).filter((id) => isHealSettlement(state, id));
      const healDist = (t: RegionId): number => healSpots.reduce((m, h) => Math.min(m, dist(t, h)), Infinity);
      const rank = (t: RegionId): number[] => [dist(t, 'morannon'), huntClean(state, t) ? 0 : 1, huntThreat(state, t), healDist(t)];
      let best = moves[0]!, bestRank = rank(best.target);
      for (const a of moves.slice(1)) {
        const r = rank(a.target);
        if (lexLess(r, bestRank)) { best = a; bestRank = r; }
      }
      return best;
    }
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
  // Same garrison split the first move gets — armyMoveScore's vacate penalty is
  // written on the assumption that it runs.
  return best ? maybeSplitGarrison(state, owner, best) : done;
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
    if (owner === 'shadow') s += nazgulStagingBonus(state, a.char, a.to, target);                 // join the army staged on the target
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
    // Nazgûl-move cards (Nazgûl Search / The Nazgûl Strike!): the whole POINT is
    // landing on the Fellowship (reveal / extra Hunt fires only if a Nazgûl shares
    // its region) — aim there, not at the army campaign target (player report:
    // "put 4 Nazgûl in Dimrill Dale" after a declare in Parth Celebrant).
    if (a.companion === 'nazgul' && a.region) {
      // ONE Nazgûl on the Fellowship is the whole prize — the Hunt re-roll and the
      // reveal/extra-Hunt triggers are all presence-gated, so a second Ringwraith
      // in the region adds nothing, and every one sent is an Army somewhere losing
      // its Leadership and its Character-die move. Score below 'done' (-1) once the
      // target already holds a Nazgûl / the Witch-king, so the chain STOPS instead
      // of piling all five onto the same square (player report: 'moved all 5 Nazgul
      // to fords of bruin... counterproductive', with the reasons itemised).
      const r = state.regions[a.region]!;
      if (r.nazgul > 0 || r.characters.includes('witch-king')) return -5;
      return 120 - dist(a.region, state.fellowship.location) * 20;
    }
    // Place the (group of) Companion(s) — do this rather than piling the whole
    // Fellowship in. A landing spot that ACTIVATES a passive FP Nation outranks
    // mere proximity to the campaign target: that is what a long Companion move
    // is for (player report: We Prove the Swifter carried Merry 7 regions to Dol
    // Guldur when Dale was in reach and would have woken the North).
    if (a.companion && a.region) {
      const rouse = owner === 'fp' && a.companion !== 'nazgul' && separationActivates(state, a.companion as never, a.region)
        && settlementCtrl(state, a.region) !== 'shadow' ? 40 : 0;
      return 110 + rouse - (target ? dist(a.region, target) : 0);
    }
    if (a.companion) return 100 - levelOf(a.companion) * 10;          // separate the lowest-Level Companion
    if (a.mode === 'attack' && a.to) return 60 + REGIONS[a.to]!.vp * 20;
    if (a.to) return 30 - (target ? dist(a.to, target) : 0);          // move toward the target
    // Recruit placements: same region, Regular-or-Elite — take the Elite (two
    // player reports: Riders of Rohan / Dain's Ironfoot Guard mustered Regulars).
    // A half-point tiebreak, so WHERE to recruit still outranks WHAT to recruit.
    if (a.region) return 20 - (target ? dist(a.region, target) : 0) + (a.figure === 'elite' ? 0.5 : 0);
    return 10;
  };
  return ets.reduce((best, a) => (score(a) > score(best) ? a : best), ets[0]!);
}
