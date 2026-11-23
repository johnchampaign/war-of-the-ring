#!/usr/bin/env vite-node
// probe-protocol-bot.mjs — the WotR Bot Protocol client (protocol/wotr-protocol-bot.mjs) without a referee:
//  - the protocol's vocabulary against this engine's ids: every card, region, Character and Hunt tile, both ways;
//  - a referee's view of a position (written here from a state of this engine) read back into the same board;
//  - the lock step: a referee's Army move (the die, the Army, the units) becomes this engine's one moveArmy;
//  - the AI's action as the referee's atomic steps: a split move answered step by step;
//  - a session: hello, new_game, decisions answered with one of the referee's options only.
import { loadEngine, N, stateFromView, collapse, Plan, Session } from '../protocol/wotr-protocol-bot.mjs';
import { createGame } from '../src/engine/setup.ts';
import { startGame, wotrAdapter } from '../src/adapter/wotrAdapter.ts';
import { REGIONS, REGION_IDS, EVENT_CARDS, STANDARD_TILE_LIST, SPECIAL_TILE_BY_CARD, sideOfNation } from '../src/engine/data.ts';
import { FP_NATIONS, SHADOW_NATIONS } from '../src/engine/types.ts';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

await loadEngine();

console.log('\n=== the vocabulary ===');
{
  const keys = [];
  for (const s of ['fp', 'sh']) for (const d of ['char', 'strat']) for (let i = 1; i <= 24; i++) keys.push(`${s}-${d}-${String(i).padStart(2, '0')}`);
  const ids = keys.map(N.card);
  check('96 protocol card keys name 96 different cards here', new Set(ids).size === 96 && ids.every((id) => EVENT_CARDS.some((c) => c.id === id)));
  check('…and back', keys.every((k) => N.pCard(N.card(k)) === k));
  check('every region of this map has a protocol key and back', REGION_IDS.every((r) => N.region(N.pRegion(r)) === r) && N.region('northern-rovanion') === 'northern-rhovanion');
  const std = Object.values(N.stdTile);
  check('16 standard Hunt tiles, each once', std.length === 16 && new Set(std).size === 16 && std.every((i) => i >= 0 && i < STANDARD_TILE_LIST.length));
  check('the Eye tiles are the Eyes', ['eye-1', 'eye-2', 'eye-3', 'eye-4'].every((k) => STANDARD_TILE_LIST[N.stdTile[k]].value === 'eye'));
  check('2r is a 2 with Reveal', STANDARD_TILE_LIST[N.stdTile['2r']].value === 2 && STANDARD_TILE_LIST[N.stdTile['2r']].reveal);
  check('the eight special tiles', Object.values(N.special).every((c) => SPECIAL_TILE_BY_CARD[c]));
  check('the Gandalfs and the faces', N.char('gandalf-the-white') === 'gandalf-white' && N.face('WILL_OF_THE_WEST') === 'will' && N.pFace('armyMuster') === 'ARMY_MUSTER');
}

// The referee's view of `s` for `viewer` (protocol §7), as a referee would write it.
function viewOf(s, viewer) {
  const P = (x) => N.pSide(x);
  const other = viewer === 'fp' ? 'shadow' : 'fp';
  const regions = {};
  for (const id of REGION_IDS) {
    const r = s.regions[id];
    const units = [];
    const chars = [];
    for (const f of [r, r.siegeBox].filter(Boolean)) {
      for (const [n, u] of Object.entries(f.units)) {
        if (u.regular) units.push({ nation: N.pNation(n), unit: 'regular', n: u.regular });
        if (u.elite) units.push({ nation: N.pNation(n), unit: 'elite', n: u.elite });
      }
      const fpNation = Object.keys(f.units).find((n) => sideOfNation(n) === 'fp') ?? REGIONS[id].nation ?? 'gondor';
      if (f.leaders) units.push({ nation: N.pNation(fpNation), unit: 'leader', n: f.leaders });
      if (f.nazgul) units.push({ nation: 'SAURON', unit: 'nazgul', n: f.nazgul });
      chars.push(...f.characters.map(N.pChar));
    }
    const def = REGIONS[id];
    const owner = def.nation ? sideOfNation(def.nation) : null;
    const control = def.settlement ? (r.control ?? owner) : null;
    if (units.length || chars.length || control) regions[N.pRegion(id)] = { control: control ? P(control) : null, units, characters: chars, siege: false };
  }
  const nations = {}, reinforcements = {};
  for (const n of [...FP_NATIONS, ...SHADOW_NATIONS]) {
    nations[N.pNation(n)] = { step: s.nations[n].step, active: s.nations[n].active };
    const r = s.reinforcements[n];
    reinforcements[N.pNation(n)] = { regular: r.regular, elite: r.elite, leader: r.leader ?? 0, nazgul: r.nazgul ?? 0 };
  }
  const characters = {};
  for (const c of [...s.fellowship.companions]) characters[N.pChar(c)] = { where: 'fellowship' };
  for (const [c, region] of Object.entries(s.characters.inPlay)) characters[N.pChar(c)] = { where: 'region', region: N.pRegion(region) };
  const cards = s.cards;
  return {
    viewer: P(viewer), turn: s.turn, phase: { fellowship: 'FELLOWSHIP', huntAllocation: 'HUNT_ALLOCATION', actionResolution: 'ACTION_RESOLUTION' }[s.phase] ?? 'ACTION_RESOLUTION',
    to_act: P(wotrAdapter.currentActor(s) ?? 'fp'), active_side: P(s.currentPlayer), regions, politics: nations, reinforcements,
    fellowship: { region: N.pRegion(s.fellowship.location), progress: s.fellowship.progress, corruption: s.fellowship.corruption, hidden: s.fellowship.hidden, mordor: s.fellowship.mordor, guide: N.pChar(s.fellowship.guide), companions: s.fellowship.companions.map(N.pChar) },
    characters,
    dice: Object.fromEntries(['fp', 'shadow'].map((x) => [P(x), [...s.dice[x].map((f, i) => ({ die: i, face: N.pFace(f), status: 'available', used: false }))]])),
    hunt: { box: { FREE_PEOPLES: s.hunt.fpDiceInBox, SHADOW: s.hunt.box }, pool: s.hunt.pool.map((i) => N.stdTileBack[i]), reserve: [], ready: [], drawn: [], removed: [], shadow_must_hunt: false },
    cards: {
      hand: cards[viewer].hand.map(N.pCard), discarded_face_down: [], opponent_hand: cards[other].hand.length,
      opponent_hand_by_deck: { character: cards[other].hand.filter((c) => N.deck(c) === 'character').length, strategy: cards[other].hand.filter((c) => N.deck(c) === 'strategy').length },
      opponent_discarded_face_down: 0,
      decks: { [P(viewer)]: { character: cards[viewer].draw.character.length, strategy: cards[viewer].draw.strategy.length }, [P(other)]: { character: cards[other].draw.character.length, strategy: cards[other].draw.strategy.length } },
      discards: { FREE_PEOPLES: [], SHADOW: [] }, on_table: { FREE_PEOPLES: [], SHADOW: [] },
    },
    victory_points: { FREE_PEOPLES: 0, SHADOW: 0 }, elven_rings: { FREE_PEOPLES: 3, SHADOW: 0 }, elven_ring_used: { FREE_PEOPLES: false, SHADOW: false },
    battle: null, result: null,
  };
}

console.log('\n=== the view read back ===');
const start = startGame(createGame({ seed: 7 }));
{
  const back = stateFromView(viewOf(start, 'fp'));
  const board = (s) => JSON.stringify(REGION_IDS.map((id) => {
    const r = s.regions[id];
    return [id, Object.entries(r.units).filter(([, u]) => u.regular || u.elite).sort(), r.leaders, r.nazgul, [...r.characters].sort(), r.control];
  }));
  check('the figures, region by region', board(back) === board(start));
  check('politics and reinforcements', JSON.stringify(back.nations) === JSON.stringify(start.nations) && JSON.stringify(back.reinforcements) === JSON.stringify(start.reinforcements));
  const fs = (s) => JSON.stringify(['location', 'progress', 'hidden', 'corruption', 'companions', 'guide', 'mordor'].map((k) => s.fellowship[k]));
  check('the Fellowship', fs(back) === fs(start), fs(back));
  check('the own hand, and the opponent\'s as stand-ins of the right decks', JSON.stringify(back.cards.fp.hand) === JSON.stringify(start.cards.fp.hand)
    && back.cards.shadow.hand.length === start.cards.shadow.hand.length);
  check('this engine asks the same question there', JSON.stringify(wotrAdapter.legalActions(back, 'fp')) === JSON.stringify(wotrAdapter.legalActions(start, 'fp')));
}

console.log('\n=== the lock step: the referee\'s steps as one action here ===');
{
  // The Shadow moves part of its Army out of Dol Guldur: the die, the Army and its destination, two counts.
  const st = (kind, opt, events = []) => ({ side: 'shadow', kind, opt, events, inCard: false, inBattle: false });
  const steps = [
    st('ACTION', { kind: 'use_die', die: 2, face: 'ARMY', action: 'move_armies' }),
    st('ARMY_MOVE', { kind: 'army_move', from: 'dol-guldur', to: 'north-anduin-vale', all: false }),
    st('ARMY_SELECTION', { kind: 'count', count: 3, nation: 'SAURON', unit: 'regular' }),
    st('ARMY_SELECTION', { kind: 'count', count: 1, nation: 'SAURON', unit: 'elite' }, [
      { kind: 'army_moved', side: 'SHADOW', from: 'dol-guldur', to: 'north-anduin-vale', pieces: [{ nation: 'SAURON', unit: 'regular', count: 3 }, { nation: 'SAURON', unit: 'elite', count: 1 }] },
    ]),
  ];
  const his = { actor: 'shadow', kind: null, phase: 'actionResolution', legal: [] };
  const wait = collapse(steps.slice(0, 3), his, start, { side: 'shadow', kind: 'ARMY_SELECTION' });
  check('while units are still being chosen: wait', wait.more === true, JSON.stringify(wait));
  const r = collapse(steps, his, start, { side: 'fp', kind: 'ACTION' });
  const a = r.acts?.[0]?.action;
  check('then one moveArmy with the units that went', r.n === 4 && a?.kind === 'moveArmy' && a.from === 'dol-guldur' && a.to === 'north-anduin-vale'
    && a.move?.units?.sauron?.regular === 3 && a.move?.units?.sauron?.elite === 1 && a.die === 'army', JSON.stringify(r));
}

console.log('\n=== the AI\'s action as the referee\'s steps ===');
{
  const plan = new Plan({ kind: 'moveArmy', from: 'dol-guldur', to: 'north-anduin-vale', move: { units: { sauron: { regular: 2 } } } }, 'army', 'shadow');
  const d = (kind, options, context = null) => ({ kind, side: 'SHADOW', options: options.map((o, i) => ({ o: i, ...o })), context });
  const o1 = plan.answer(d('ACTION', [{ kind: 'use_die', die: 0, face: 'CHARACTER', action: 'move_army_with_leader' }, { kind: 'use_die', die: 1, face: 'ARMY', action: 'move_armies' }, { kind: 'pass' }]));
  check('the Army die', o1?.o === 1, JSON.stringify(o1));
  const o2 = plan.answer(d('ARMY_MOVE', [{ kind: 'army_move', from: 'dol-guldur', to: 'north-anduin-vale', all: true }, { kind: 'army_move', from: 'dol-guldur', to: 'north-anduin-vale', all: false }, { kind: 'end' }]));
  check('the Army, split', o2?.o === 1, JSON.stringify(o2));
  const counts = (unit, max) => Array.from({ length: max + 1 }, (_, n) => ({ kind: 'count', count: n, nation: 'SAURON', unit }));
  const o3 = plan.answer(d('ARMY_SELECTION', counts('regular', 5), { from: 'dol-guldur', to: 'north-anduin-vale', nation: 'SAURON', unit: 'regular', available: 5 }));
  check('two Regulars go', o3?.count === 2, JSON.stringify(o3));
  const o4 = plan.answer(d('ARMY_SELECTION', counts('elite', 1), { from: 'dol-guldur', to: 'north-anduin-vale', nation: 'SAURON', unit: 'elite', available: 1 }));
  check('no Elite', o4?.count === 0, JSON.stringify(o4));
  check('the next Army move is not this action\'s', plan.answer(d('ARMY_MOVE', [{ kind: 'end' }])) === null);
}

console.log('\n=== a session ===');
{
  const sent = [];
  const session = new Session({ name: 'test', versionLabel: 'probe' }, (m) => sent.push(m));
  session.handle({ type: 'hello', id: 1, protocol: 'wotr-bot/0.1', referee: 'probe' });
  check('hello: asks for the events', sent[0]?.type === 'hello' && sent[0].events === true && sent[0].id === 1);
  session.handle({ type: 'new_game', id: 2, game: 'g-1', side: 'FREE_PEOPLES', seed_bot: 12345, clock: { kind: 'game', ms: 900000, increment_ms: 10000 } });
  check('new_game: ready', sent[1]?.type === 'ready' && sent[1].id === 2);
  for (const [i, c] of start.cards.fp.hand.entries()) session.handle({ type: 'event', game: 'g-1', seq: i + 1, event: { kind: 'random_card_draw', side: 'FREE_PEOPLES', deck: N.deck(c), card: N.pCard(c) } });
  // The Fellowship phase: the options a referee would list for this position.
  const view = viewOf(start, 'fp');
  const options = [{ o: 0, kind: 'declare', region: 'rivendell' }, { o: 1, kind: 'guide', character: 'strider' }, { o: 2, kind: 'done' }];
  session.handle({ type: 'decide', id: 3, game: 'g-1', decision: { kind: 'FELLOWSHIP_PHASE', side: 'FREE_PEOPLES', options, fingerprint: 'f' }, view, clock: { left_ms: 900000, opponent_ms: 900000, increment_ms: 10000 } });
  const c = sent[2];
  check('a decision: one of the options, its fingerprint echoed', c?.type === 'choice' && c.id === 3 && options.some((o) => o.o === c.o) && c.fingerprint === 'f', JSON.stringify(c));
  session.handle({ type: 'decide', id: 4, game: 'g-1', decision: { kind: 'CARD_CHOICE', side: 'FREE_PEOPLES', options: [{ o: 0, kind: 'card_choice', card: 'fp-char-01', answer: 'skip', skip: true }], fingerprint: 'g' }, view, clock: {} });
  check('a question this engine does not know: still one of the options', sent[3]?.o === 0);
  session.handle({ type: 'game_over', game: 'g-1', winner: 'FREE_PEOPLES', how: 'RING_DESTROYED', turn: 9 });
  check('game_over: the game is closed', session.game === null && session.played === 1);
}

if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall protocol-bot checks pass');
