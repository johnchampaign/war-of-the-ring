// Registered Event-card handlers — a representative subset of mechanically simple
// cards (heal/Corruption, political, recruit, dice). Each cites its card id from
// assets/event-cards.json. Cards not registered here stay unimplemented (not
// offered) until added. Effects modify the standard rules per the card text.
import type { GameState, Side, Nation } from '../types';
import { FP_NATIONS, SHADOW_NATIONS } from '../types';
import { withRng } from '../rng';
import { register, type EventTarget } from './registry';
import { recruit, settlementController, armySide, unitCount, STACKING_LIMIT, captureIfEnemySettlement, freeForMovement } from '../armies';
import { applyCasualties, startBattle } from '../combat';
import { extraHunt } from '../hunt';
import { activateNation, advancePolitical, isAtWar } from '../politics';
import { REGIONS } from '../data';
import { log } from '../log';

const COMPANION_SET = new Set(['gandalf-grey', 'strider', 'boromir', 'legolas', 'gimli', 'meriadoc', 'peregrin', 'aragorn', 'gandalf-white']);
/** Roll min(5, count) dice; count hits on `target`+. */
const rollDice = (state: GameState, count: number, target: number): number =>
  withRng(state, (rng) => { let h = 0; for (let i = 0; i < Math.min(5, count); i++) if (rng.rollDie(6) >= target) h++; return h; });
/** [FP-army region, Shadow-Nazgûl region] pairs that are the same or adjacent. */
function fpArmyNearNazgul(state: GameState): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const fp of Object.keys(state.regions)) {
    if (armySide(state, fp) !== 'fp') continue;
    for (const sh of [fp, ...REGIONS[fp]!.adjacency]) {
      if (state.regions[sh] && state.regions[sh]!.nazgul > 0 && armySide(state, sh) === 'shadow') out.push([fp, sh]);
    }
  }
  return out;
}
function eliminateNazgul(state: GameState, region: string, n: number): void {
  const r = state.regions[region]!; const k = Math.min(n, r.nazgul);
  r.nazgul -= k; state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) + k;
}
const allAtWar = (state: GameState, nations: Nation[]): boolean => nations.every((n) => state.nations[n].step === 0);
const isFpNation = (n: string): boolean => (FP_NATIONS as string[]).includes(n);
/** The region holding character `id` (separated/in play), or null. */
function charRegion(state: GameState, id: string): string | null {
  for (const r of Object.keys(state.regions)) if (state.regions[r]!.characters.includes(id)) return r;
  return null;
}
/** Draw one card from a deck into `side`'s hand (hand max 6). */
function drawCard(state: GameState, side: Side, deck: 'character' | 'strategy'): void {
  const p = state.cards[side]; const top = p.draw[deck].shift();
  if (top) p.hand.push(top);
  while (p.hand.length > 6) p.discard.strategy.push(p.hand.shift()!);
}
/** Region-step distance (BFS), or Infinity. */
function regionDist(from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set([from]); let layer = [from], d = 0;
  while (layer.length) { d++; const next: string[] = [];
    for (const r of layer) for (const a of REGIONS[r]?.adjacency ?? []) { if (a === to) return d; if (!seen.has(a)) { seen.add(a); next.push(a); } }
    layer = next; }
  return Infinity;
}
/** Move a whole Army (units + Leaders + Nazgûl + characters) from→to, capturing
 *  for `side` (default Shadow). */
function moveAllUnits(state: GameState, from: string, to: string, side: Side = 'shadow'): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  for (const n of Object.keys(src.units) as Nation[]) {
    const u = src.units[n]!; const d = dst.units[n] ?? { regular: 0, elite: 0 };
    d.regular += u.regular; d.elite += u.elite; dst.units[n] = d;
  }
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...src.characters);
  src.units = {}; src.leaders = 0; src.nazgul = 0; src.characters = [];
  captureIfEnemySettlement(state, to, side);
}
/** Force-place units into a region (a card that recruits in a NAMED region,
 *  bypassing the settlement/control checks recruit() applies). Capped by
 *  reinforcements + the stacking limit. */
function placeUnits(state: GameState, nation: Nation, region: string, regular: number, elite: number): void {
  const pool = state.reinforcements[nation], r = state.regions[region]!;
  const room = STACKING_LIMIT - unitCount(state, region);
  const reg = Math.max(0, Math.min(regular, pool.regular, room));
  const el = Math.max(0, Math.min(elite, pool.elite, room - reg));
  if (reg + el === 0) return;
  pool.regular -= reg; pool.elite -= el;
  const u = r.units[nation] ?? { regular: 0, elite: 0 };
  u.regular += reg; u.elite += el; r.units[nation] = u;
}

const heal = (state: GameState, n: number): void => {
  state.fellowship.corruption = Math.max(0, state.fellowship.corruption - n);
};
const corrupt = (state: GameState, n: number): void => {
  state.fellowship.corruption = Math.min(12, state.fellowship.corruption + n);
};
const isGollumGuide = (state: GameState): boolean => state.fellowship.guide === 'gollum';

/** Recruit via an Event card (may ignore At War): place into the first friendly,
 *  free, unfull Settlement of `nation`. Returns whether anything was placed. */
function eventRecruit(state: GameState, side: Side, nation: Nation, regular: number, elite: number): boolean {
  for (const id of Object.keys(state.regions)) {
    const def = REGIONS[id]!;
    if (def.nation !== nation || !def.settlement) continue;
    if (settlementController(state, id) !== side) continue;
    if (armySide(state, id) === (side === 'fp' ? 'shadow' : 'fp')) continue;
    if (unitCount(state, id) + regular + elite > STACKING_LIMIT) continue;
    if (recruit(state, nation, id, regular, elite, { ignoreAtWar: true })) return true;
  }
  return false;
}
const canEventRecruit = (state: GameState, nation: Nation, n = 1): boolean =>
  state.reinforcements[nation].regular + state.reinforcements[nation].elite >= n
  && Object.keys(state.regions).some((id) => {
    const def = REGIONS[id]!;
    return def.nation === nation && def.settlement
      && settlementController(state, id) === (FP_NATIONS.includes(nation) ? 'fp' : 'shadow')
      && unitCount(state, id) < STACKING_LIMIT;
  });

// --- Free Peoples: heal / Corruption -------------------------------------
register('fp-char-09', { // Athelas
  apply(state) {
    const guideIsStrider = state.fellowship.guide === 'strider';
    const healed = withRng(state, (rng) => {
      let h = 0; for (let i = 0; i < 3; i++) { const d = rng.rollDie(6); if (d >= (guideIsStrider ? 3 : 5)) h++; } return h;
    });
    heal(state, healed); log(state, null, 'event', `Athelas heals ${healed}`);
  },
});
register('fp-char-10', { apply(state) { heal(state, 1); } }); // There Is Another Way
register('fp-char-12', { apply(state) { heal(state, isGollumGuide(state) ? 2 : 1); } }); // Bilbo's Song

// --- Free Peoples: political ---------------------------------------------
register('fp-str-08', { // Wisdom of Elrond: activate + advance an FP nation
  canPlay: (state) => FP_NATIONS.some((n) => state.nations[n].step > 0),
  apply(state) {
    const n = FP_NATIONS.find((x) => state.nations[x].step > 0) ?? 'gondor';
    activateNation(state, n); advancePolitical(state, n, 1);
  },
});

// --- Free Peoples: recruit (Event recruit, may ignore At War) -------------
const fpRecruits: Array<[string, Nation]> = [
  ['fp-str-13', 'elves'],   // Círdan's Ships
  ['fp-str-14', 'gondor'],  // Guards of the Citadel
  ['fp-str-15', 'elves'],   // Celeborn's Galadhrim
  ['fp-str-16', 'rohan'],   // Riders of Théoden
  ['fp-str-17', 'north'],   // Grimbeorn the Old
  ['fp-str-18', 'gondor'],  // Imrahil of Dol Amroth
  ['fp-str-22', 'dwarves'], // Dáin Ironfoot's Guard
  ['fp-str-23', 'rohan'],   // Éomer, Son of Éomund
  ['fp-str-24', 'elves'],   // Thranduil's Archers
  ['fp-str-19', 'north'],   // King Brand's Men
];

// "Book of Mazarbul" — rouse the Dwarves directly to At War.
register('fp-str-04', {
  canPlay: (state) => !isAtWar(state, 'dwarves'),
  apply(state) { activateNation(state, 'dwarves'); advancePolitical(state, 'dwarves', 99); },
});
// "Fear! Fire! Foes!" — rouse the North directly to At War.
register('fp-str-07', {
  canPlay: (state) => !isAtWar(state, 'north'),
  apply(state) { activateNation(state, 'north'); advancePolitical(state, 'north', 99); },
});
for (const [id, nation] of fpRecruits) {
  register(id, {
    canPlay: (state) => canEventRecruit(state, nation),
    apply(state, side) { eventRecruit(state, side, nation, 1, 0); },
  });
}

// --- Shadow: Corruption --------------------------------------------------
register('sh-char-08', { // Candles of Corpses: +1 corruption per die 4+ (6 if Gollum guides)
  apply(state) {
    const t = isGollumGuide(state) ? 6 : 4;
    const c = withRng(state, (rng) => { let n = 0; for (let i = 0; i < 3; i++) if (rng.rollDie(6) >= t) n++; return n; });
    corrupt(state, c); log(state, null, 'event', `Candles of Corpses +${c} corruption`);
  },
});
register('sh-char-12', { // Morgul Wound: +2 if corruption ≤3 else +1; requires revealed
  canPlay: (state) => !state.fellowship.hidden,
  apply(state) { corrupt(state, state.fellowship.corruption <= 3 ? 2 : 1); },
});

// --- Shadow: dice --------------------------------------------------------
register('sh-char-18', { // The Lidless Eye: up to 3 unused Shadow dice → Eyes in the Hunt Box
  canPlay: (state) => state.dice.shadow.some((f) => f !== 'eye'),
  apply(state) {
    let moved = 0;
    for (let i = state.dice.shadow.length - 1; i >= 0 && moved < 3; i--) {
      if (state.dice.shadow[i] !== 'eye') { state.dice.shadow.splice(i, 1); state.hunt.box += 1; moved++; }
    }
    log(state, null, 'event', `The Lidless Eye: +${moved} Eyes to the Hunt Box`);
  },
});

// --- Shadow: recruit -----------------------------------------------------
const shRecruits: Array<[string, Nation]> = [
  ['sh-str-11', 'isengard'],   // Rage of the Dunlendings
  ['sh-str-13', 'isengard'],   // Half-orcs and Goblin-men
  ['sh-str-14', 'sauron'],     // Olog-hai
  ['sh-str-16', 'isengard'],   // A New Power is Rising
  ['sh-str-19', 'sauron'],     // Shadows on the Misty Mountains
  ['sh-str-20', 'sauron'],     // Orcs Multiplying Again
  ['sh-str-22', 'sauron'],     // Monsters Roused
  ['sh-str-17', 'southrons'],  // Many Kings to the Service of Mordor
];
for (const [id, nation] of shRecruits) {
  register(id, {
    canPlay: (state) => canEventRecruit(state, nation),
    apply(state, side) { eventRecruit(state, side, nation, 1, 0); },
  });
}

// --- Interactive movement cards (the player picks a target after playing) -----
// Cruel Weather: the Shadow moves the Fellowship to an adjacent region.
register('sh-char-10', {
  canPlay: (state) => state.fellowship.progress >= 1 && (REGIONS[state.fellowship.location]?.adjacency.length ?? 0) > 0,
  targets: (state) => (REGIONS[state.fellowship.location]?.adjacency ?? []).map((region) => ({ region })),
  applyTarget(state, _side, t) { state.fellowship.location = t.region!; log(state, null, 'event', `Cruel Weather moves the Fellowship to ${t.region}`); },
});
// Corsairs of Umbar: move the Umbar Army to a Gondor coastal region (coastal set
// approximated; merges, checking the stacking limit).
const GONDOR_COASTAL = ['anfalas', 'dol-amroth', 'pelargir', 'lossarnach', 'osgiliath'];
register('sh-str-10', {
  canPlay: (state) => isAtWar(state, 'southrons') && armySide(state, 'umbar') === 'shadow',
  targets: (state) => GONDOR_COASTAL
    .filter((to) => unitCount(state, 'umbar') + unitCount(state, to) <= STACKING_LIMIT)
    .map((to) => ({ from: 'umbar', to })),
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, t.to!); log(state, null, 'event', `Corsairs of Umbar: Umbar → ${t.to}`); },
});
// Shadows Gather: move one Shadow Army ≤3 regions, ending where another Shadow
// Army stands (not besieged). (Path-free-traversal nuance simplified to distance.)
function shadowsGatherMoves(state: GameState): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const shadowRegions = Object.keys(state.regions).filter((id) => armySide(state, id) === 'shadow');
  for (const from of shadowRegions) {
    for (const to of shadowRegions) {
      if (out.length >= 12) return out;
      if (from === to || state.regions[to]!.besieged) continue;
      if (regionDist(from, to) <= 3 && unitCount(state, from) + unitCount(state, to) <= STACKING_LIMIT) out.push({ from, to });
    }
  }
  return out;
}
register('sh-str-07', {
  canPlay: (state) => shadowsGatherMoves(state).length > 0,
  targets: shadowsGatherMoves,
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, t.to!); log(state, null, 'event', `Shadows Gather: ${t.from} → ${t.to}`); },
});
// The Shadow Lengthens: move TWO (different) Shadow Armies up to two regions each,
// every move ending where another Shadow Army stands (not besieged). `applied`
// excludes a just-moved army (now sitting at a prior move's destination).
function shadowLengthensMoves(state: GameState, applied: EventTarget[] = []): EventTarget[] {
  const movedTo = new Set(applied.map((a) => a.to));
  const out: EventTarget[] = [];
  const shadowRegions = Object.keys(state.regions).filter((id) => armySide(state, id) === 'shadow');
  for (const from of shadowRegions) {
    if (movedTo.has(from)) continue;
    for (const to of shadowRegions) {
      if (out.length >= 12) return out;
      if (from === to || state.regions[to]!.besieged) continue;
      if (regionDist(from, to) <= 2 && unitCount(state, from) + unitCount(state, to) <= STACKING_LIMIT) out.push({ from, to });
    }
  }
  return out;
}
register('sh-str-08', {
  repeat: 2,
  canPlay: (state) => shadowLengthensMoves(state).length > 0,
  targets: (state, _side, applied) => shadowLengthensMoves(state, applied),
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, t.to!); log(state, null, 'event', `The Shadow Lengthens: ${t.from} → ${t.to}`); },
});
// The Shadow is Moving (all Shadow Nations At War): move up to four DIFFERENT Shadow
// Armies one region each (to an adjacent region free for movement, merges allowed).
function shadowMovingMoves(state: GameState, applied: EventTarget[] = []): EventTarget[] {
  const movedTo = new Set(applied.map((a) => a.to));
  const out: EventTarget[] = [];
  for (const from of Object.keys(state.regions)) {
    if (armySide(state, from) !== 'shadow' || movedTo.has(from)) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (out.length >= 16) return out;
      if (freeForMovement(state, to, 'shadow') && unitCount(state, from) + unitCount(state, to) <= STACKING_LIMIT) out.push({ from, to });
    }
  }
  return out;
}
register('sh-str-09', {
  repeat: 4,
  canPlay: (state) => allAtWar(state, SHADOW_NATIONS) && shadowMovingMoves(state).length > 0,
  targets: (state, _side, applied) => shadowMovingMoves(state, applied),
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, t.to!); log(state, null, 'event', `The Shadow is Moving: ${t.from} → ${t.to}`); },
});

// Dead Men of Dunharrow: move Strider/Aragorn (+ Companions in the same region)
// from a Rohan region to Erech, Lamedon or Pelargir.
const ROHAN = ['eastemnet', 'edoras', 'folde', 'fords-of-isen', 'helms-deep', 'westemnet'];
function aragornRohanRegion(state: GameState): string | null {
  for (const id of ROHAN) if (state.regions[id]!.characters.some((c) => c === 'aragorn' || c === 'strider')) return id;
  return null;
}
register('fp-char-22', {
  canPlay: (state) => aragornRohanRegion(state) !== null,
  targets: () => ['erech', 'lamedon', 'pelargir'].map((region) => ({ region })),
  applyTarget(state, _side, t) {
    const from = aragornRohanRegion(state); if (!from) return;
    const moving = state.regions[from]!.characters.filter((c) => COMPANION_SET.has(c));
    state.regions[from]!.characters = state.regions[from]!.characters.filter((c) => !COMPANION_SET.has(c));
    state.regions[t.region!]!.characters.push(...moving);
    for (const c of moving) if (state.characters.inPlay[c]) state.characters.inPlay[c] = t.region!;
    log(state, null, 'event', `Dead Men of Dunharrow: ${from} → ${t.region}`);
  },
});
// Paths of the Woses: move an FP Army from a Rohan region directly to Minas Tirith.
register('fp-str-11', {
  canPlay: (state) => isAtWar(state, 'rohan') && ROHAN.some((r) => armySide(state, r) === 'fp'),
  targets: (state) => ROHAN.filter((r) => armySide(state, r) === 'fp').map((from) => ({ from, to: 'minas-tirith' })),
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, 'minas-tirith', 'fp'); log(state, null, 'event', `Paths of the Woses: ${t.from} → Minas Tirith`); },
});
// Through a Day and a Night: move an FP Army containing a Companion up to 2 regions.
function dayNightMoves(state: GameState): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (const from of Object.keys(state.regions)) {
    if (armySide(state, from) !== 'fp' || !state.regions[from]!.characters.some((c) => COMPANION_SET.has(c))) continue;
    for (const to of Object.keys(state.regions)) {
      if (out.length >= 12) return out;
      const d = regionDist(from, to);
      if (d >= 1 && d <= 2 && freeForMovement(state, to, 'fp') && unitCount(state, from) + unitCount(state, to) <= STACKING_LIMIT) out.push({ from, to });
    }
  }
  return out;
}
register('fp-str-12', {
  canPlay: (state) => dayNightMoves(state).length > 0,
  targets: dayNightMoves,
  applyTarget(state, _side, t) { moveAllUnits(state, t.from!, t.to!, 'fp'); log(state, null, 'event', `Through a Day and a Night: ${t.from} → ${t.to}`); },
});

// --- Recruit / muster cards in named or chosen regions -----------------------
// Pits of Mordor: recruit 2 Sauron Regulars in each of three Sauron Strongholds.
register('sh-str-24', {
  canPlay: (state) => isAtWar(state, 'sauron'),
  apply(state) {
    let done = 0;
    for (const id of Object.keys(state.regions)) {
      if (done >= 3) break;
      const def = REGIONS[id]!;
      if (def.nation === 'sauron' && def.settlement === 'Stronghold' && settlementController(state, id) === 'shadow'
        && unitCount(state, id) < STACKING_LIMIT && recruit(state, 'sauron', id, 2, 0, { ignoreAtWar: true })) done++;
    }
  },
});
// Musterings of Long-planned War: 5 Southrons in Gorgoroth + 5 Sauron in Nurn.
register('sh-str-23', {
  canPlay: (state) => allAtWar(state, SHADOW_NATIONS),
  apply(state) {
    placeUnits(state, 'southrons', 'gorgoroth', 5, 0);
    placeUnits(state, 'sauron', 'nurn', 5, 0);
  },
});
// Return of the Witch-king: move the Witch-king to Angmar + recruit there.
register('sh-str-12', {
  canPlay: (state) => state.characters.entered.includes('witch-king'),
  apply(state) {
    for (const id of Object.keys(state.regions)) {
      const i = state.regions[id]!.characters.indexOf('witch-king');
      if (i >= 0) { state.regions[id]!.characters.splice(i, 1); break; }
    }
    state.regions['angmar']!.characters.push('witch-king');
    placeUnits(state, 'sauron', 'angmar', 2, 1);
    log(state, null, 'event', 'Return of the Witch-king: to Angmar + muster');
  },
});

// --- Recruit + draw / upgrade cards ------------------------------------------
// House of the Stewards: recruit a Gondor unit with Boromir + draw 2 Strategy.
register('fp-char-23', {
  canPlay: (state) => charRegion(state, 'boromir') !== null,
  apply(state) {
    const r = charRegion(state, 'boromir'); if (!r) return;
    placeUnits(state, 'gondor', r, 1, 0);
    drawCard(state, 'fp', 'strategy'); drawCard(state, 'fp', 'strategy');
  },
});
// Kindred of Glorfindel: recruit an Elven unit in Rivendell + draw 1 Strategy.
register('fp-str-21', {
  canPlay: (state) => settlementController(state, 'rivendell') === 'fp'
    && state.reinforcements.elves.regular + state.reinforcements.elves.elite > 0,
  apply(state) {
    if (!recruit(state, 'elves', 'rivendell', 1, 0, { ignoreAtWar: true })) placeUnits(state, 'elves', 'rivendell', 1, 0);
    drawCard(state, 'fp', 'strategy');
  },
});
// Swords in Eriador: recruit a North unit in the Shire + a Dwarven unit in Ered Luin.
register('fp-str-20', {
  canPlay: (state) => state.reinforcements.north.regular + state.reinforcements.north.elite > 0
    || state.reinforcements.dwarves.regular + state.reinforcements.dwarves.elite > 0,
  apply(state) {
    recruit(state, 'north', 'the-shire', 1, 0, { ignoreAtWar: true });
    recruit(state, 'dwarves', 'ered-luin', 1, 0, { ignoreAtWar: true });
  },
});
// The Grey Company: in Strider's Army, upgrade one Regular to an Elite.
register('fp-char-24', {
  canPlay: (state) => {
    const r = charRegion(state, 'strider'); if (!r) return false;
    return Object.entries(state.regions[r]!.units).some(([n, u]) => isFpNation(n) && u!.regular > 0 && state.reinforcements[n as Nation].elite > 0);
  },
  apply(state) {
    const r = charRegion(state, 'strider'); if (!r) return;
    for (const [n, u] of Object.entries(state.regions[r]!.units)) {
      if (isFpNation(n) && u!.regular > 0 && state.reinforcements[n as Nation].elite > 0) {
        u!.regular--; u!.elite++; state.reinforcements[n as Nation].regular++; state.reinforcements[n as Nation].elite--; break;
      }
    }
  },
});

// --- Action-die manipulation --------------------------------------------------
// Mirror of Galadriel: turn an unused FP Character die into a Will of the West.
register('fp-char-13', {
  canPlay: (state) => state.dice.fp.includes('character'),
  apply(state) {
    const i = state.dice.fp.indexOf('character');
    if (i >= 0) state.dice.fp[i] = 'will';
    if (state.fellowship.location === 'lorien' && settlementController(state, 'lorien') !== 'shadow') heal(state, 1);
  },
});
// The Day Without Dawn: discard all unused FP Will-of-the-West dice.
register('sh-str-04', {
  canPlay: (state) => allAtWar(state, SHADOW_NATIONS) && state.dice.fp.includes('will'),
  apply(state) {
    const kept = state.dice.fp.filter((f) => f !== 'will');
    const removed = state.dice.fp.length - kept.length;
    state.dice.fp = kept;
    log(state, null, 'event', `The Day Without Dawn: discarded ${removed} FP Will die/dice`);
  },
});

// --- Direct-damage event cards (roll dice -> hits on an Army) ----------------
// The Ents Awake (Treebeard/Huorns/Entmoot): hit the Shadow Army in Orthanc.
for (const id of ['fp-char-19', 'fp-char-20', 'fp-char-21']) {
  register(id, {
    canPlay: (state) => state.characters.entered.includes('gandalf-white')
      && state.regions['fangorn']!.characters.some((c) => COMPANION_SET.has(c))
      && armySide(state, 'orthanc') === 'shadow',
    apply(state) {
      const hits = rollDice(state, 3, 4);
      if (hits > 0) applyCasualties(state, 'orthanc', 'shadow', hits, 'regularsFirst');
      log(state, null, 'event', `The Ents Awake: ${hits} hit(s) on Orthanc`);
    },
  });
}
// Faramir's Rangers: hit a Shadow Army in Osgiliath / N. or S. Ithilien.
register('fp-str-06', {
  canPlay: (state) => ['osgiliath', 'south-ithilien', 'north-ithilien'].some((r) => armySide(state, r) === 'shadow'),
  apply(state) {
    const r = ['osgiliath', 'south-ithilien', 'north-ithilien'].find((x) => armySide(state, x) === 'shadow')!;
    const hits = rollDice(state, 3, 5);
    if (hits > 0) applyCasualties(state, r, 'shadow', hits, 'regularsFirst');
    log(state, null, 'event', `Faramir's Rangers: ${hits} hit(s) on ${r}`);
  },
});
// The Eagles are Coming!: eliminate Nazgûl near an FP Army containing a Companion.
register('fp-char-18', {
  canPlay: (state) => fpArmyNearNazgul(state).some(([fp]) => state.regions[fp]!.characters.some((c) => COMPANION_SET.has(c))),
  apply(state) {
    const pair = fpArmyNearNazgul(state).find(([fp]) => state.regions[fp]!.characters.some((c) => COMPANION_SET.has(c)));
    if (!pair) return;
    const sh = pair[1];
    const kills = rollDice(state, state.regions[sh]!.nazgul, 5);
    eliminateNazgul(state, sh, kills);
    log(state, null, 'event', `The Eagles are Coming!: eliminated ${kills} Nazgûl at ${sh}`);
  },
});
// Dreadful Spells (Shadow): hit an FP Army adjacent to/with a Nazgûl force.
register('sh-char-19', {
  canPlay: (state) => fpArmyNearNazgul(state).length > 0,
  apply(state) {
    const [fp, sh] = fpArmyNearNazgul(state)[0]!;
    const hits = rollDice(state, state.regions[sh]!.nazgul, 5);
    if (hits > 0) applyCasualties(state, fp, 'fp', hits, 'regularsFirst');
    log(state, null, 'event', `Dreadful Spells: ${hits} hit(s) on ${fp}`);
  },
});

// --- Shadow: extra Hunt cards (draw a tile; skip Eye / FP-special) -----------
const fellowshipInFpSettlement = (state: GameState): boolean => {
  const loc = state.fellowship.location;
  return !!REGIONS[loc]!.settlement && settlementController(state, loc) === 'fp';
};
for (const id of ['sh-char-05', 'sh-char-06', 'sh-char-07']) { // Orc Patrol / Isildur's Bane / Foul Thing
  register(id, {
    canPlay: (state) => !fellowshipInFpSettlement(state),
    apply(state) { extraHunt(state); },
  });
}

// --- Stormcrow: set back an FP Nation (with the Fellowship/a Companion) + a loss
register('sh-str-06', {
  canPlay: (state) => stormcrowNation(state) !== null,
  apply(state) {
    const n = stormcrowNation(state); if (!n) return;
    state.nations[n].step = Math.min(3, state.nations[n].step + 1); // move back one step
    // FP loses one Army unit of that Nation (Regular preferred).
    for (const id of Object.keys(state.regions)) {
      const u = state.regions[id]!.units[n];
      if (u && u.regular > 0) { u.regular--; break; }
      if (u && u.elite > 0) { u.elite--; break; }
    }
    log(state, null, 'event', `Stormcrow: ${n} set back + a unit lost`);
  },
});
/** An FP Nation, not yet At War, whose region holds the Fellowship or a Companion. */
function stormcrowNation(state: GameState): Nation | null {
  const inRegion = (id: string): Nation | null => {
    const def = REGIONS[id]!; const n = def.nation as Nation | null;
    return n && isFpNation(n) && state.nations[n].step > 0 ? n : null;
  };
  const fellow = inRegion(state.fellowship.location);
  if (fellow) return fellow;
  for (const id of Object.keys(state.regions)) {
    if (state.regions[id]!.characters.some((c) => COMPANION_SET.has(c))) { const n = inRegion(id); if (n) return n; }
  }
  return null;
}

// --- Special Hunt tiles: the card brings a tile "into play"; it joins the Hunt
//     Pool only once the Fellowship is on the Mordor Track (rules-spec §11). ---
for (const id of ['fp-char-01', 'fp-char-02', 'fp-char-03', 'fp-char-04', 'sh-char-01', 'sh-char-02', 'sh-char-03', 'sh-char-04']) {
  register(id, {
    apply(state) {
      const h = state.hunt;
      if (h.specialsInPlay.includes(id) || h.specialsInPool.includes(id) || (h.specialsDrawn ?? []).includes(id)) return;
      (state.fellowship.mordor !== null ? h.specialsInPool : h.specialsInPlay).push(id);
      log(state, null, 'event', `special Hunt tile ${id} now in play`);
    },
  });
}

// --- On-table hunt-defense cards: discard during the Hunt to reduce damage by 1
//     (the discard-for-reduction itself is the reduceCard huntDamage option). ---
register('fp-char-06', { // Axe and Bow — Gimli or Legolas in the Fellowship
  onTable: true,
  canPlay: (state) => state.fellowship.companions.includes('gimli') || state.fellowship.companions.includes('legolas'),
  apply() { /* persists on the table */ },
});
register('fp-char-07', { // Horn of Gondor — Boromir in the Fellowship
  onTable: true,
  canPlay: (state) => state.fellowship.companions.includes('boromir'),
  apply() { /* persists on the table */ },
});
register('fp-char-05', { // Mithril Coat and Sting — discard to redraw a Hunt tile
  onTable: true,
  apply() { /* persists on the table */ },
});
register('fp-char-08', { // Wizard's Staff — Gandalf the Grey in the Fellowship
  onTable: true,
  canPlay: (state) => state.fellowship.companions.includes('gandalf-grey'),
  apply() { /* persists on the table */ },
});

// --- Persistent "while in play" cards: played to the table; their ongoing rule
//     change is enforced at the relevant seam via src/engine/persistent.ts. The
//     handler applies only the immediate part and lets the card persist. ---------
register('fp-str-01', { onTable: true, apply() { /* The Last Battle — see hunt.ts (fpDiceInBox) */ } });
register('fp-str-02', { // A Power too Great — advance Elves; bar Shadow from Lórien/Rivendell/Grey Havens
  onTable: true,
  apply(state) { advancePolitical(state, 'elves', 1); log(state, null, 'event', 'A Power too Great: Elves advance; Shadow barred from Lórien/Rivendell/Grey Havens'); },
});
register('fp-str-03', { // The Power of Tom Bombadil — advance North; bar Shadow from Old Forest/Shire/Buckland
  onTable: true,
  apply(state) { advancePolitical(state, 'north', 1); log(state, null, 'event', 'The Power of Tom Bombadil: North advances; Shadow barred from the Old Forest/Shire/Buckland'); },
});
register('sh-str-05', { onTable: true, apply() { /* Threats and Promises — see politics.ts (advanceableNations) */ } });
register('sh-char-21', { onTable: true, apply() { /* The Palantír of Orthanc — bonus draw, see wotrAdapter playEvent */ } });
register('sh-char-15', { onTable: true, apply() { /* Worn with Sorrow and Toil — see hunt.ts (companion casualty) */ } });
register('sh-char-22', { onTable: true, apply() { /* Wormtongue — see politics.ts (activateNation) */ } });

// --- Grond / The Fighting Uruk-hai: a 3-round siege assault on a besieged FP
//     Stronghold (siege mechanic in combat.ts). The besieging army must be adjacent
//     to the besieged Stronghold and contain the required figure/unit. -----------
function siegeAssaultTargets(state: GameState, qualifies: (from: string) => boolean): EventTarget[] {
  const out: EventTarget[] = [];
  for (const to of Object.keys(state.regions)) {
    const def = REGIONS[to]!;
    if (def.settlement !== 'Stronghold' || !state.regions[to]!.besieged) continue;
    if (settlementController(state, to) !== 'fp') continue;
    for (const from of def.adjacency) if (armySide(state, from) === 'shadow' && qualifies(from)) out.push({ from, to });
  }
  return out;
}
const inPlay = (state: GameState, id: string) => state.characters.entered.includes(id) && !state.characters.eliminated.includes(id);
register('sh-char-20', { // Grond, Hammer of the Underworld — Witch-king with the besieging Army
  canPlay: (state) => siegeAssaultTargets(state, (from) => state.regions[from]!.characters.includes('witch-king')).length > 0,
  targets: (state) => siegeAssaultTargets(state, (from) => state.regions[from]!.characters.includes('witch-king')),
  applyTarget(state, _side, t) { startBattle(state, 'shadow', t.from!, t.to!, { siegeRounds: 3, fpCardLock: true }); log(state, null, 'event', `Grond assaults ${t.to} (3-round siege)`); },
});
const hasIsengardUnit = (state: GameState, from: string): boolean => {
  const u = state.regions[from]!.units.isengard;
  return !!u && (u.regular > 0 || u.elite > 0);
};
register('sh-str-02', { // The Fighting Uruk-hai — Saruman in play + an Isengard unit besieging
  canPlay: (state) => inPlay(state, 'saruman') && siegeAssaultTargets(state, (from) => hasIsengardUnit(state, from)).length > 0,
  targets: (state) => siegeAssaultTargets(state, (from) => hasIsengardUnit(state, from)),
  applyTarget(state, _side, t) { startBattle(state, 'shadow', t.from!, t.to!, { siegeRounds: 3, fpCardLock: true }); log(state, null, 'event', `The Fighting Uruk-hai assault ${t.to} (3-round siege)`); },
});
register('sh-str-03', { // Denethor's Folly — eliminate an FP Leader in Minas Tirith; bar FP Combat cards there
  onTable: true,
  apply(state) {
    const mt = state.regions['minas-tirith']!;
    if (mt.leaders > 0) { mt.leaders -= 1; log(state, null, 'event', "Denethor's Folly: an FP Leader in Minas Tirith is eliminated"); }
  },
});

// --- The Red Arrow: advance Rohan + recruit a Rohan unit & Leader in Edoras ----
register('fp-str-09', {
  canPlay: (state) => state.nations.gondor.active,
  apply(state) {
    advancePolitical(state, 'rohan', 1);
    recruit(state, 'rohan', 'edoras', 1, 0, { ignoreAtWar: true });
    if (state.reinforcements.rohan.leader > 0 && settlementController(state, 'edoras') === 'fp') {
      state.reinforcements.rohan.leader--; state.regions['edoras']!.leaders++;
    }
  },
});

// --- Hill-Trolls: replace up to two Sauron Regulars on the board with Elites ---
register('sh-str-15', {
  canPlay: (state) => isAtWar(state, 'sauron') && state.reinforcements.sauron.elite > 0
    && Object.values(state.regions).some((r) => (r.units.sauron?.regular ?? 0) > 0),
  apply(state) {
    let done = 0;
    for (const id of Object.keys(state.regions)) {
      const u = state.regions[id]!.units.sauron;
      while (done < 2 && u && u.regular > 0 && state.reinforcements.sauron.elite > 0) {
        u.regular--; u.elite++; state.reinforcements.sauron.regular++; state.reinforcements.sauron.elite--; done++;
      }
      if (done >= 2) break;
    }
    log(state, null, 'event', `Hill-Trolls: upgraded ${done} Sauron Regular(s) to Elite`);
  },
});

// --- The King is Revealed: recruit 5 Sauron Regulars + a Nazgûl in Minas Morgul -
register('sh-str-18', {
  canPlay: (state) => state.characters.entered.includes('aragorn'),
  apply(state) {
    const room = STACKING_LIMIT - unitCount(state, 'minas-morgul');
    const n = Math.max(0, Math.min(5, state.reinforcements.sauron.regular, room));
    if (n > 0) recruit(state, 'sauron', 'minas-morgul', n, 0, { ignoreAtWar: true });
    // Nazgûl don't count toward the Army stacking limit.
    if ((state.reinforcements.sauron.nazgul ?? 0) > 0) {
      state.reinforcements.sauron.nazgul!--; state.regions['minas-morgul']!.nazgul++;
    }
  },
});
