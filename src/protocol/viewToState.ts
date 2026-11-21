// viewToState — rebuild our engine's GameState from a WotR Bot Protocol view (SPEC §7).
//
// The view is exactly what the deciding side may know, so the state built here is that
// side's view in our engine's terms: the opponent's hand, draw piles and face-down
// discards are `hidden-<deck>` markers (as in our own redacted views), and our own draw
// piles hold the cards not seen elsewhere (unordered). Feed it to determinize() (search.ts)
// before playing anything forward. Battles in progress are not rebuilt: decisions inside
// a battle are answered from the view (decide.ts).
import type { GameState, Side, Nation, RegionId, Deck, DieFace } from '../engine/types';
import { createGame } from '../engine/setup';
import { startGame } from '../adapter/wotrAdapter';
import { deckOf, EVENT_BY_ID, MINIONS, REGION_IDS } from '../engine/data';
import * as N from './names';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type View = any;

let TEMPLATE: string | null = null;
const template = (): GameState => {
  TEMPLATE ??= JSON.stringify(startGame(createGame({ seed: 1 })));
  return JSON.parse(TEMPLATE);
};

const PHASE: Record<string, GameState['phase']> = {
  ACTION_RESOLUTION: 'actionResolution', FELLOWSHIP: 'fellowship', HUNT_ALLOCATION: 'huntAllocation',
  ACTION_ROLL: 'actionRoll', RECOVER: 'recover', VICTORY_CHECK: 'victoryCheck',
};
const deckOfCard = (id: string): Deck => (EVENT_BY_ID[id]?.deck === 'Character' ? 'character' : 'strategy');
const UPGRADES_AND_MINIONS = ['aragorn', 'gandalf-white', 'witch-king', 'saruman', 'mouth-of-sauron'];

export function viewToState(view: View, opts: { planRoll?: number } = {}): GameState {
  const s = template();
  const me: Side = N.sideOf(view.viewer);
  const opp: Side = me === 'fp' ? 'shadow' : 'fp';
  s.turn = view.turn;
  s.phase = PHASE[view.phase] ?? 'actionResolution';
  s.currentPlayer = N.sideOf(view.to_act ?? view.active_side ?? view.viewer);
  delete (s as any).pendingChoice;
  delete (s as any).pendingCombat;
  delete (s as any).winner;
  s.log = [];
  if (opts.planRoll !== undefined) s.shadowPlanRoll = opts.planRoll;

  // --- the board ---------------------------------------------------------------------
  for (const id of REGION_IDS) {
    const r = s.regions[id as RegionId];
    r.units = {}; r.leaders = 0; r.nazgul = 0; r.characters = []; r.control = null; r.besieged = false;
    delete r.siegeBox;
  }
  s.characters.inPlay = {};
  for (const [pk, pr] of Object.entries(view.regions ?? {}) as [string, any][]) {
    const id = N.region(pk);
    const r = s.regions[id];
    if (!r) throw new Error(`unknown region ${pk}`);
    r.control = pr.control ? N.sideOf(pr.control) : null;
    const besiegedSide: Side | null = pr.siege ? N.sideOf(pr.siege) : null;
    type Force = { units: Partial<Record<Nation, { regular: number; elite: number }>>; leaders: number; nazgul: number; characters: string[] };
    const box: Force | null = besiegedSide ? (r.siegeBox = { units: {}, leaders: 0, nazgul: 0, characters: [] }) : null;
    r.besieged = !!besiegedSide;
    for (const u of pr.units ?? []) {
      const nat: Nation = N.nation(u.nation);
      const uSide: Side = ['isengard', 'sauron', 'southrons'].includes(nat) ? 'shadow' : 'fp';
      const into: Force = box && uSide === besiegedSide ? box : r;
      if (u.unit === 'leader') into.leaders += u.n;
      else if (u.unit === 'nazgul') into.nazgul += u.n;
      else {
        const cur = into.units[nat] ?? { regular: 0, elite: 0 };
        cur[u.unit as 'regular' | 'elite'] += u.n;
        into.units[nat] = cur;
      }
    }
    for (const pc of pr.characters ?? []) {
      const c = N.character(pc);
      if (c === 'ring-bearers') continue;
      const cSide: Side = MINIONS[c] ? 'shadow' : 'fp';
      (box && cSide === besiegedSide ? box : r).characters.push(c);
    }
  }

  // --- characters and the Fellowship -------------------------------------------------------
  const elim: string[] = [], entered: string[] = [];
  for (const [pk, pc] of Object.entries(view.characters ?? {}) as [string, any][]) {
    const c = N.character(pk);
    if (c === 'ring-bearers') continue;
    if (pc.where === 'region') {
      s.characters.inPlay[c] = N.region(pc.region);
      const r = s.regions[N.region(pc.region)];
      if (r && !r.characters.includes(c) && !r.siegeBox?.characters.includes(c)) r.characters.push(c);
    }
    if (pc.where === 'eliminated') elim.push(c);
    if (UPGRADES_AND_MINIONS.includes(c) && pc.where !== 'not_in_play') entered.push(c);
  }
  s.characters.eliminated = elim;
  s.characters.entered = entered;
  const f = view.fellowship;
  s.fellowship.location = N.region(f.region);
  s.fellowship.progress = f.progress;
  s.fellowship.corruption = f.corruption;
  s.fellowship.hidden = f.hidden;
  s.fellowship.mordor = f.mordor ?? null;
  s.fellowship.guide = N.character(f.guide);
  s.fellowship.companions = (f.companions ?? []).map(N.character);

  // --- politics, reinforcements, VP, rings ---------------------------------------------------
  for (const [pn, p] of Object.entries(view.politics ?? {}) as [string, any][]) s.nations[N.nation(pn)] = { step: p.step, active: p.active };
  for (const [pn, rf] of Object.entries(view.reinforcements ?? {}) as [string, any][]) {
    const n = N.nation(pn);
    s.reinforcements[n] = n === 'sauron'
      ? { regular: rf.regular, elite: rf.elite, leader: rf.leader ?? 0, nazgul: rf.nazgul ?? 0 }
      : { regular: rf.regular, elite: rf.elite, leader: rf.leader ?? 0 };
  }
  s.victoryPoints = { fp: view.victory_points?.FREE_PEOPLES ?? 0, shadow: view.victory_points?.SHADOW ?? 0 };
  const rf = view.elven_rings?.FREE_PEOPLES ?? 0, rs = view.elven_rings?.SHADOW ?? 0;
  s.elvenRings = [0, 1, 2].map((i) => (i < rf ? 'fp' : i < rf + rs ? 'shadow' : 'used'));
  s.flags.fpUsedElvenRingThisTurn = !!view.elven_ring_used?.FREE_PEOPLES;
  s.flags.shadowUsedElvenRingThisTurn = !!view.elven_ring_used?.SHADOW;

  // --- dice and the Hunt -----------------------------------------------------------------------
  for (const side of ['fp', 'shadow'] as Side[]) {
    s.dice[side] = []; s.usedDice[side] = [];
    for (const d of view.dice?.[N.pSide(side)] ?? []) {
      if (!d.face) continue;
      const fc: DieFace = N.face(d.face);
      if (d.status === 'available') s.dice[side].push(fc);
      else if (d.status === 'used') s.usedDice[side].push(fc);
    }
  }
  const h = view.hunt ?? {};
  s.hunt.box = h.box?.SHADOW ?? 0;
  s.hunt.fpDiceInBox = h.box?.FREE_PEOPLES ?? 0;
  s.hunt.pool = []; s.hunt.drawn = []; s.hunt.specialsInPool = []; s.hunt.specialsInPlay = []; s.hunt.specialsDrawn = [];
  for (const k of h.pool ?? []) (N.isSpecialTile(k) ? s.hunt.specialsInPool.push(N.specialTile(k)) : s.hunt.pool.push(N.standardTile(k)));
  for (const k of h.drawn ?? []) (N.isSpecialTile(k) ? s.hunt.specialsDrawn.push(N.specialTile(k)) : s.hunt.drawn.push(N.standardTile(k)));
  for (const k of h.ready ?? []) if (N.isSpecialTile(k)) s.hunt.specialsInPlay.push(N.specialTile(k));
  s.flags.huntMin1ThisTurn = !!h.shadow_must_hunt;

  // --- cards -----------------------------------------------------------------------------------
  const c = view.cards ?? {};
  const mine = s.cards[me], theirs = s.cards[opp];
  mine.hand = (c.hand ?? []).map(N.card);
  mine.discardFaceDown = (c.discarded_face_down ?? []).map(N.card);
  for (const [side, pile] of [[me, mine], [opp, theirs]] as const) {
    const ps = N.pSide(side);
    const disc: string[] = (c.discards?.[ps] ?? []).map(N.card);
    pile.discard = { character: disc.filter((x) => deckOfCard(x) === 'character'), strategy: disc.filter((x) => deckOfCard(x) === 'strategy') };
    pile.table = (c.on_table?.[ps] ?? []).map(N.card);
  }
  // our own draw piles: every card of ours not in hand, discards or on the table (order unknown)
  const seen = new Set([...mine.hand, ...(mine.discardFaceDown ?? []), ...mine.discard.character, ...mine.discard.strategy, ...mine.table]);
  for (const deck of ['character', 'strategy'] as Deck[]) {
    const want = c.decks?.[N.pSide(me)]?.[deck];
    const left = deckOf(me, deck).filter((id) => !seen.has(id));
    mine.draw[deck] = want === undefined ? left : left.slice(0, want);
  }
  // the opponent's hidden cards: markers, as our redacted view shows them
  const byDeck = c.opponent_hand_by_deck ?? {};
  theirs.hand = [
    ...Array.from({ length: byDeck.character ?? 0 }, () => 'hidden-character'),
    ...Array.from({ length: byDeck.strategy ?? 0 }, () => 'hidden-strategy'),
  ];
  theirs.discardFaceDown = Array.from({ length: c.opponent_discarded_face_down ?? 0 }, () => 'hidden-strategy');
  for (const deck of ['character', 'strategy'] as Deck[]) {
    theirs.draw[deck] = Array.from({ length: c.decks?.[N.pSide(opp)]?.[deck] ?? 0 }, () => `hidden-${deck}`);
  }
  return s;
}
