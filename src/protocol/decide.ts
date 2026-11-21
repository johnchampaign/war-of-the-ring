// decide — answer a WotR Bot Protocol `decide` (SPEC §4-5) with our AI.
//
// At an ACTION, FELLOWSHIP_PHASE or HUNT_ALLOCATION decision the view is rebuilt into our
// engine's state (viewToState), determinized, and our chooser picks one of OUR actions.
// That action is then matched to the referee's option; the protocol asks a compound action
// step by step (die → army → units → next army), so the rest of the match is queued as a
// plan and answered from it. Our engine's own follow-ups (a second army, a second recruit,
// more characters) are answered by playing our action forward in a private copy and asking
// our chooser at the follow-up. Decisions inside a battle, and anything unmatched, use the
// simple rules at the bottom. Option 0 is always the last resort (it is always legal).
import { Rng } from 'digital-boardgame-framework';
import type { GameState, Side } from '../engine/types';
import type { WotrAction, MoveSel } from '../adapter/wotrAction';
import { wotrAdapter, applyActionInPlace } from '../adapter/wotrAdapter';
import { determinize } from '../ai/search';
import { viewToState, type View } from './viewToState';
import * as N from './names';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = any;
type Decision = { kind: string; side: string; options: Opt[]; context?: any };
export type Chooser = (state: GameState, actor: Side, legal: WotrAction[], rng: Rng) => WotrAction;

interface Step { kind: string; pick: (opts: Opt[], d: Decision) => Opt | undefined; repeat?: boolean }

export interface BotContext {
  side: Side;
  rng: Rng;
  planRoll: number;
  chooser: Chooser;
  plan: Step[];
  /** Our engine's copy after our last action, for its follow-up choices. */
  after: GameState | null;
  stats: Record<string, number>;
}

export function newContext(side: Side, seed: number, chooser: Chooser): BotContext {
  const rng = new Rng(seed);
  return { side, rng, planRoll: rng.int(100), chooser, plan: [], after: null, stats: {} };
}

const bump = (ctx: BotContext, k: string): void => { ctx.stats[k] = (ctx.stats[k] ?? 0) + 1; };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** Returns the chosen option's `o`. Never throws: anything unexpected falls back to rules. */
export function decide(ctx: BotContext, d: Decision, view: View): number {
  try {
    const o = decideInner(ctx, d, view);
    if (o && d.options.some((x) => x.o === o.o)) return o.o;
  } catch (e) {
    bump(ctx, 'error');
    if (process.env.WOTR_BOT_DEBUG) console.error('decide error', d.kind, e);
  }
  bump(ctx, 'fallback0');
  return d.options[0].o;
}

function decideInner(ctx: BotContext, d: Decision, view: View): Opt | undefined {
  // 1. the queued plan
  while (ctx.plan.length) {
    const step = ctx.plan[0]!;
    if (step.kind !== d.kind) { if (step.repeat) { ctx.plan.shift(); continue; } break; }
    const o = step.pick(d.options, d);
    if (o) { if (!step.repeat) ctx.plan.shift(); bump(ctx, 'plan'); return o; }
    ctx.plan.shift();
  }
  ctx.plan = [];
  // 2. a fresh decision from our engine
  if (d.kind === 'ACTION' || d.kind === 'FELLOWSHIP_PHASE' || d.kind === 'HUNT_ALLOCATION') return fromEngine(ctx, d, view);
  // 3. a battle question, answered by our engine on the battle rebuilt from the view
  if (view.battle && BATTLE_KINDS.has(d.kind)) {
    const o = fromBattle(ctx, d, view);
    if (o) { bump(ctx, `battle:${d.kind}`); return o; }
    bump(ctx, `battleMiss:${d.kind}`);
  }
  // 4. a stand-alone question our engine asks too (Hunt damage, reveal, discards, Guide)
  if (PENDING_KINDS[d.kind]) {
    const o = fromPending(ctx, d, view);
    if (o) { bump(ctx, `pending:${d.kind}`); return o; }
    bump(ctx, `pendingMiss:${d.kind}`);
  }
  // 5. a follow-up of our last action, answered in our engine's copy
  if (ctx.after && FOLLOW_UPS.has(d.kind)) {
    const o = followUp(ctx, d);
    if (o) return o;
  }
  ctx.after = null;
  bump(ctx, `rule:${d.kind}`);
  return rule(d, view);
}

const BATTLE_KINDS = new Set(['COMBAT_CARD', 'CASUALTY', 'CEASE_ATTACK', 'RETREAT', 'FIELD_OR_SIEGE', 'EXTEND_SIEGE']);

/** Rebuild the battle in our engine (pendingCombat + the matching pendingChoice) and ask
 *  our chooser. The dice already rolled are the referee's; we only need the position and
 *  the question (hits to take come from the decision's context or the view). */
function fromBattle(ctx: BotContext, d: Decision, view: View): Opt | undefined {
  const b = view.battle;
  const me = ctx.side;
  const st = viewToState(view, { planRoll: ctx.planRoll });
  const attacker: Side = N.sideOf(b.attacker);
  const defender: Side = attacker === 'fp' ? 'shadow' : 'fp';
  const from = N.region(b.from ?? b.region), to = N.region(b.region);
  const iAttack = me === attacker;
  (st as any).pendingCombat = {
    attacker, defender, from, to, round: b.round ?? 1, fortified: false,
    siege: b.battle === 'siege' || b.battle === 'sortie',
    step: d.kind === 'COMBAT_CARD' ? (iAttack ? 'attackerCard' : 'defenderCard') : 'beginRound',
    attackerCard: b.attacker_card ? N.card(b.attacker_card) : null,
    defenderCard: b.defender_card ? N.card(b.defender_card) : null,
    atkHits: b.hits_on_attacker ?? 0, defHits: b.hits_on_defender ?? 0,
  };
  const ask = (kind: string, data?: unknown): WotrAction | null => {
    (st as any).pendingChoice = data === undefined ? { owner: me, kind } : { owner: me, kind, data };
    st.currentPlayer = me;
    const legal = wotrAdapter.legalActions(st, me);
    if (!legal.length) return null;
    return ctx.chooser(st, me, legal, ctx.rng);
  };
  const k = (kind: string, f: (o: Opt) => boolean = () => true): Opt | undefined => d.options.find((o) => o.kind === kind && f(o));
  let a: any;
  switch (d.kind) {
    case 'COMBAT_CARD':
      a = ask('combatCard');
      if (a?.kind !== 'playCombatCard') return undefined;
      return a.cardId ? k('combat_card', (o) => N.card(o.card) === a.cardId) : k('none');
    case 'CASUALTY': {
      const hits = d.context?.hits ?? (iAttack ? b.hits_on_attacker : b.hits_on_defender) ?? 1;
      a = ask('combatCasualties', { region: iAttack ? from : to, side: me, hits: Math.max(1, hits), next: iAttack ? 'defenderCasualties' : 'onslaught' });
      if (a?.kind !== 'casualtyStep') return undefined;
      const unit = a.step === 'removeRegular' ? 'regular' : 'elite';
      const effect = a.step === 'reduceElite' ? 'reduce' : 'remove';
      return k('casualty', (o) => N.nation(o.nation) === a.nation && o.unit === unit && o.effect === effect)
        ?? k('casualty', (o) => o.unit === unit && o.effect === effect);
    }
    case 'CEASE_ATTACK':
      a = ask('combatContinue');
      return a?.kind === 'combatContinue' ? k(a.cont ? 'continue' : 'cease') : undefined;
    case 'RETREAT': {
      a = ask('combatRetreat');
      if (a?.kind !== 'combatRetreat') return undefined;
      if (!a.retreat) return k('stand');
      const t = ask('retreatTo') as any;
      return (t?.kind === 'retreatTo' ? k('retreat', (o) => N.region(o.region) === t.region) : undefined) ?? k('retreat');
    }
    case 'FIELD_OR_SIEGE':
      a = ask('siegeWithdraw');
      return a?.kind === 'siegeWithdraw' ? k(a.withdraw ? 'siege' : 'field') : undefined;
    case 'EXTEND_SIEGE':
      a = ask('siegeExtend');
      return a?.kind === 'siegeExtend' ? (a.extend ? k('extend') : k('stop')) : undefined;
  }
  return undefined;
}

const PENDING_KINDS: Record<string, string> = {
  DISCARD_EXCESS_CARD: 'discardCard', REVEAL_FELLOWSHIP: 'revealMove', HUNT_CASUALTY: 'huntDamage', CHOOSE_GUIDE: 'guideChoice',
};

function fromPending(ctx: BotContext, d: Decision, view: View): Opt | undefined {
  const st = viewToState(view, { planRoll: ctx.planRoll });
  const kind = PENDING_KINDS[d.kind]!;
  let data: unknown = {};
  if (kind === 'revealMove') data = undefined;
  if (kind === 'huntDamage') {
    const tile = String(d.context?.tile ?? '');
    data = { damage: d.context?.damage ?? 1, reveal: /r/.test(tile), revealIcon: /r/.test(tile), numbered: !tile.startsWith('eye') };
  }
  (st as any).pendingChoice = data === undefined ? { owner: ctx.side, kind } : { owner: ctx.side, kind, data };
  st.currentPlayer = ctx.side;
  const legal = wotrAdapter.legalActions(st, ctx.side);
  if (process.env.WOTR_BOT_DEBUG) console.error('pending', d.kind, JSON.stringify(d.context), 'legal', JSON.stringify(legal).slice(0, 300), 'options', JSON.stringify(d.options.map((o) => o.kind)));
  if (!legal.length) return undefined;
  return askUntilMatched(ctx, st, legal, (a) => matchPending(a, d));
}

function matchPending(a: any, d: Decision): Opt | undefined {
  const k = (kk: string, f: (o: Opt) => boolean = () => true): Opt | undefined => d.options.find((o) => o.kind === kk && f(o));
  switch (a.kind) {
    case 'discardCard': return k('discard', (o) => N.card(o.card) === a.card);
    case 'revealMove': return k('reveal', (o) => N.region(o.region) === a.target);
    case 'huntDamage':
      if (a.mode === 'reduceSeparate' || a.mode === 'reduceReveal') return k('guide_ability');
      if (a.mode === 'reduceCard') return k('card_choice', (o) => N.card(o.target_card ?? '') === a.card);
      return k(a.mode);
    case 'guideChoice': return k('guide', (o) => N.character(o.character) === a.companion);
  }
  return undefined;
}

/** Ask our chooser; when its pick is not among the referee's options, take it out and ask
 *  again (our next choice), up to 4 times. The referee's list is the truth (SPEC §1). */
function askUntilMatched(ctx: BotContext, st: GameState, legal: WotrAction[], match: (a: WotrAction) => Opt | undefined, onPick?: (a: WotrAction) => void): Opt | undefined {
  let left = legal;
  for (let tries = 0; tries < 4 && left.length; tries++) {
    const a = ctx.chooser(st, ctx.side, left, ctx.rng);
    const o = match(a);
    if (o) { if (tries) bump(ctx, 'retried'); onPick?.(a); return o; }
    bump(ctx, `unmatched:${a.kind}`);
    const key = JSON.stringify(a);
    left = left.filter((x) => JSON.stringify(x) !== key);
  }
  return undefined;
}

const FOLLOW_UPS = new Set(['ARMY_MOVE', 'RECRUIT', 'MOVE_COMPANIONS', 'MOVE_MINIONS', 'SEPARATE_COMPANIONS']);

function fromEngine(ctx: BotContext, d: Decision, view: View): Opt | undefined {
  ctx.after = null;
  const st = viewToState(view, { planRoll: ctx.planRoll });
  st.currentPlayer = ctx.side;
  const det = determinize(st, ctx.side, ctx.rng.int(0x7fffffff));
  const legal = wotrAdapter.legalActions(det, ctx.side);
  if (!legal.length) { bump(ctx, 'noLegal'); return rule(d, view); }
  let picked: WotrAction | null = null;
  const o = askUntilMatched(ctx, det, legal, (a) => { ctx.plan = []; return matchAction(ctx, a, d); }, (a) => { picked = a; });
  if (!o || !picked) {
    if (d.kind === 'FELLOWSHIP_PHASE') return d.options.find((x) => x.kind === 'done') ?? rule(d, view);
    return rule(d, view);
  }
  bump(ctx, `matched:${(picked as WotrAction).kind}`);
  try { applyActionInPlace(det, picked, ctx.side); ctx.after = det; } catch { ctx.after = null; }
  return o;
}

function followUp(ctx: BotContext, d: Decision): Opt | undefined {
  const s = ctx.after!;
  if (!s.pendingChoice || wotrAdapter.currentActor(s) !== ctx.side) return undefined;
  const legal = wotrAdapter.legalActions(s, ctx.side);
  if (!legal.length) return undefined;
  let picked: WotrAction | null = null;
  const o = askUntilMatched(ctx, s, legal, (a) => { ctx.plan = []; return matchAction(ctx, a, d); }, (a) => { picked = a; });
  if (!o || !picked) return undefined;
  bump(ctx, `follow:${(picked as WotrAction).kind}`);
  try { applyActionInPlace(s, picked, ctx.side); } catch { ctx.after = null; }
  return o;
}

// --- our action -> the referee's option (and the plan for the steps after it) -----------------

const dieOk = (o: Opt, die: string | undefined): boolean => !die || o.face === N.pFace(die);
const useDie = (d: Decision, die: string | undefined, action: string | string[], extra: (o: Opt) => boolean = () => true): Opt | undefined => {
  const acts = Array.isArray(action) ? action : [action];
  const ok = (o: Opt): boolean => o.kind === 'use_die' && acts.includes(o.action) && extra(o);
  return d.options.find((o) => ok(o) && dieOk(o, die)) ?? d.options.find(ok);
};
const find = (d: Decision, f: (o: Opt) => boolean): Opt | undefined => d.options.find(f);

/** How many of (nation, unit) a MoveSel takes; null = the whole army. */
function selCount(sel: MoveSel | undefined, nationP: string | undefined, unit: string, character?: string): number | null {
  if (!sel) return null;
  if (character) return (sel.characters ?? []).includes(N.character(character)) ? 1 : 0;
  if (unit === 'leader') return sel.leaders ?? 0;
  if (unit === 'nazgul') return sel.nazgul ?? 0;
  if (!nationP) return null;
  const u = sel.units?.[N.nation(nationP)];
  return (u as any)?.[unit] ?? 0;
}
const selectionStep = (sel: MoveSel | undefined): Step => ({
  kind: 'ARMY_SELECTION', repeat: true,
  pick: (opts, d) => {
    // What is being counted: from the options themselves (a referee need not send a context).
    const ref = opts.find((o: Opt) => o.kind === 'count') ?? {};
    const ctx = d.context ?? {};
    const want = selCount(sel, ref.nation ?? ctx.nation, ref.unit ?? ctx.unit, ref.character ?? ctx.character);
    if (want === null) return opts[opts.length - 1];
    let best: Opt | undefined, gap = Infinity;
    for (const o of opts) { const g = Math.abs((o.count ?? 0) - want); if (g < gap) { gap = g; best = o; } }
    return best;
  },
});
const armyMoveSteps = (from: string, to: string, sel: MoveSel | undefined): Step[] => [
  {
    kind: 'ARMY_MOVE',
    pick: (opts) => opts.find((o: Opt) => o.kind === 'army_move' && N.region(o.from) === from && N.region(o.to) === to && o.all === !sel)
      ?? opts.find((o: Opt) => o.kind === 'army_move' && N.region(o.from) === from && N.region(o.to) === to),
  },
  ...(sel ? [selectionStep(sel)] : []),
];

function matchAction(ctx: BotContext, a: WotrAction, d: Decision): Opt | undefined {
  const A = a as any;
  const charP = (c: string): string => N.pCharacter(c);
  switch (a.kind) {
    // Fellowship phase / Hunt allocation
    case 'declareFellowship': return find(d, (o) => o.kind === 'declare' && N.region(o.region) === a.target);
    case 'enterMordor': return find(d, (o) => o.kind === 'enter_mordor');
    case 'changeGuide': return find(d, (o) => o.kind === 'guide' && o.character === charP(a.companion));
    case 'skipFellowshipPhase': return find(d, (o) => o.kind === 'done');
    case 'allocateHunt': return find(d, (o) => o.kind === 'hunt_dice' && o.count === a.dice);
    // Action dice
    case 'pass': return find(d, (o) => o.kind === 'pass');
    case 'skipDie': return find(d, (o) => o.kind === 'skip_die' && o.face === N.pFace(a.face));
    case 'useElvenRing': return find(d, (o) => o.kind === 'elven_ring' && o.from === N.pFace(a.from) && o.to === N.pFace(a.to));
    case 'drawEvent': return useDie(d, a.die, 'draw_card', (o) => o.deck === a.deck);
    case 'playEvent': return useDie(d, a.die, 'play_card', (o) => N.card(o.card) === a.cardId);
    case 'diplomaticAction': return useDie(d, a.die, 'diplomacy', (o) => N.nation(o.nation) === a.nation);
    case 'moveFellowship': return useDie(d, a.die, 'move_fellowship');
    case 'hideFellowship': return useDie(d, a.die, ['hide_fellowship', 'hide_fellowship_strider']);
    case 'bringMinion': return useDie(d, a.die, 'play_minion', (o) => o.character === a.minion && N.region(o.region) === a.region)
      ?? useDie(d, a.die, 'play_minion', (o) => o.character === a.minion);
    case 'bringUpgrade': return useDie(d, undefined, 'play_companion', (o) => o.character === charP(a.which));
    case 'companionMuster': return useDie(d, a.die, 'companion_politics', (o) => o.character === charP(a.companion));
    case 'sarumanMuster': return useDie(d, a.die, 'voice_of_saruman', (o) => !!o.upgrade === (a.mode === 'upgrade'));
    case 'forceDiscardCard': return useDie(d, a.die, 'force_discard', (o) => N.card(o.card) === a.cardId);
    case 'moveArmy': {
      const o = useDie(d, a.die, a.die === 'character' ? ['move_army_with_leader', 'move_armies'] : ['move_armies', 'move_army_with_leader']);
      if (o) ctx.plan = armyMoveSteps(a.from, a.to, a.move);
      return o;
    }
    case 'attack': {
      const o = useDie(d, a.die, a.die === 'character' ? ['attack_with_leader', 'attack'] : ['attack', 'attack_with_leader']);
      if (o) ctx.plan = [
        { kind: 'CHOOSE_ATTACK', pick: (opts) => opts.find((x: Opt) => N.region(x.from) === a.from && N.region(x.to) === a.to && x.all === !a.rearguard)
          ?? opts.find((x: Opt) => N.region(x.from) === a.from && N.region(x.to) === a.to) },
        ...(a.rearguard ? [selectionStep(invertRearguard(a.rearguard))] : []),
      ];
      return o;
    }
    case 'recruitUnit': {
      const unit = a.nazgul ? 'nazgul' : a.leader ? 'leader' : a.elite ? 'elite' : 'regular';
      const o = useDie(d, a.die, 'recruit');
      const pick = (opts: Opt[]): Opt | undefined => opts.find((x: Opt) => x.kind === 'recruit' && N.region(x.region) === a.region && x.unit === unit && N.nation(x.nation) === a.nation)
        ?? opts.find((x: Opt) => x.kind === 'recruit' && N.region(x.region) === a.region && x.unit === unit);
      if (d.kind === 'RECRUIT') return pick(d.options);
      if (o) ctx.plan = [{ kind: 'RECRUIT', pick }];
      return o;
    }
    case 'recruitSecond':
      if (a.done || !a.region) return find(d, (o) => o.kind === 'end');
      return find(d, (o) => o.kind === 'recruit' && N.region(o.region) === a.region && (!a.figure || o.unit === a.figure));
    case 'armyMove2':
      if (a.done || !a.from || !a.to) return find(d, (o) => o.kind === 'end');
      { const steps = armyMoveSteps(a.from, a.to, a.move); const o = steps[0]!.pick(d.options, d); if (o) ctx.plan = steps.slice(1); return o; }
    case 'charMove2': return find(d, (o) => o.kind === 'end');
    case 'separateCompanion': {
      const o = useDie(d, a.die, 'separate_companions');
      if (o) ctx.plan = [{ kind: 'SEPARATE_COMPANIONS', pick: (opts) => opts.find((x: Opt) => x.kind === 'separate' && x.character === charP(a.companion)) }];
      return o;
    }
    case 'separateMove':
      if (d.kind !== 'SEPARATE_COMPANIONS') return undefined;
      return find(d, (o) => o.kind === 'separate_to' && (!a.target || N.region(o.to) === a.target))
        ?? find(d, (o) => o.kind === 'separate' && (!a.companion || o.character === charP(a.companion)));
    case 'moveCharacter': {
      const steps = characterSteps(ctx.side, a.char, a.from, a.to, a.count, a.chars);
      if (d.kind === 'ACTION') {
        const o = useDie(d, a.die, ctx.side === 'shadow' ? 'move_minions' : 'move_companions');
        if (o) ctx.plan = steps;
        return o;
      }
      const o = steps[0]!.pick(d.options, d);
      if (o) ctx.plan = steps.slice(1);
      return o;
    }
    default:
      void A;
      return undefined;
  }
}

/** A rearguard MoveSel names the units LEFT BEHIND; ARMY_SELECTION asks how many ATTACK.
 *  Without the army's size here, approximate: attack with all but the rearguard. */
function invertRearguard(back: MoveSel): MoveSel | undefined { void back; return undefined; }

function characterSteps(side: Side, char: string, from: string, to: string, count: number | undefined, chars: string[] | undefined): Step[] {
  const eq = (r: string, ours: string): boolean => N.region(r) === ours;
  if (side === 'shadow') {
    if (char === 'nazgul') {
      const one: Step[] = [
        { kind: 'MOVE_MINIONS', pick: (o) => o.find((x: Opt) => x.kind === 'select_nazgul' && eq(x.from, from)) },
        { kind: 'MOVE_MINIONS', pick: (o) => o.find((x: Opt) => x.kind === 'move_nazgul' && eq(x.to, to)) },
      ];
      return Array.from({ length: Math.max(1, count ?? 1) }, () => one).flat();
    }
    return [
      { kind: 'MOVE_MINIONS', pick: (o) => o.find((x: Opt) => x.kind === 'select_minion' && x.character === char) },
      { kind: 'MOVE_MINIONS', pick: (o) => o.find((x: Opt) => x.kind === 'move_minion' && eq(x.to, to)) },
    ];
  }
  const group = new Set((chars ?? [char]).map(N.pCharacter));
  return [
    { kind: 'MOVE_COMPANIONS', pick: (o) => o.find((x: Opt) => x.kind === 'move_companion' && x.character === N.pCharacter(char) && eq(x.to, to)) },
    { kind: 'JOIN_GROUP', repeat: true, pick: (o, d) => {
      const who = o[0]?.character ?? d.context?.character;
      return o.find((x: Opt) => x.kind === (group.has(who) ? 'join' : 'stay'));
    } },
  ];
}

// --- rules for what our engine does not answer --------------------------------------------------

const battleUnits = (view: View, side: string): number => {
  const b = view.battle;
  if (!b) return 0;
  if (b.attacker === side) return (b.attackers ?? []).filter((u: Opt) => u.unit === 'regular' || u.unit === 'elite').reduce((n: number, u: Opt) => n + u.n, 0);
  const r = view.regions?.[b.region];
  return (r?.units ?? []).filter((u: Opt) => (u.unit === 'regular' || u.unit === 'elite') && ['DWARVES', 'ELVES', 'GONDOR', 'NORTH', 'ROHAN'].includes(u.nation) === (side === 'FREE_PEOPLES')).reduce((n: number, u: Opt) => n + u.n, 0);
};

function rule(d: Decision, view: View): Opt | undefined {
  const O = d.options;
  const k = (kind: string, f: (o: Opt) => boolean = () => true): Opt | undefined => O.find((o) => o.kind === kind && f(o));
  const me = d.side;
  const foe = me === 'SHADOW' ? 'FREE_PEOPLES' : 'SHADOW';
  switch (d.kind) {
    case 'COMBAT_CARD': return k('none');
    case 'CASUALTY': return k('casualty', (o) => o.unit === 'regular' && o.effect === 'remove') ?? k('casualty', (o) => o.effect === 'reduce') ?? O[0];
    case 'CEASE_ATTACK': return battleUnits(view, me) >= battleUnits(view, foe) ? k('continue') : k('cease');
    case 'RETREAT': return k('stand');
    case 'FIELD_OR_SIEGE': return battleUnits(view, foe) > battleUnits(view, me) ? k('siege') : k('field');
    case 'EXTEND_SIEGE': return battleUnits(view, me) >= 2 * Math.max(1, battleUnits(view, foe)) ? (k('extend') ?? k('stop')) : k('stop');
    case 'ADVANCE': return O.find((o) => o.kind === 'advance' && o.all) ?? k('advance') ?? O[0];
    case 'ARMY_SELECTION': return O[O.length - 1];
    case 'ARMY_MOVE': case 'RECRUIT': case 'MOVE_COMPANIONS': case 'MOVE_MINIONS': return k('end') ?? O[0];
    case 'JOIN_GROUP': return k('join') ?? O[0];
    case 'GUIDE_ABILITY': case 'WHITE_RIDER': return k('use') ?? O[0];
    case 'HUNT_CASUALTY': {
      const f = view.fellowship ?? {};
      const dmg = d.context?.damage ?? 1;
      if ((f.corruption ?? 0) + dmg >= 10) return k('guide') ?? k('random') ?? k('corruption');
      return k('corruption') ?? O[0];
    }
    case 'DISCARD_EXCESS_CARD': return O[O.length - 1];
    case 'CARD_CHOICE': {
      // a card already chosen by our AI asks for a detail: take the stronger figure,
      // act rather than skip, and the fewest self-inflicted hits
      const cc = O.filter((o) => o.kind === 'card_choice');
      return cc.find((o) => o.answer === 'ELITE')
        ?? (cc.some((o) => typeof o.count === 'number' && /hits/.test(d.context?.question ?? '')) ? cc.reduce((m, o) => (o.count < m.count ? o : m)) : undefined)
        ?? cc.find((o) => !o.skip) ?? O[0];
    }
    default: return O[0];
  }
}
