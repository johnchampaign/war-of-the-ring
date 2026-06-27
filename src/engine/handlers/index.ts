// Registered Event-card handlers — a representative subset of mechanically simple
// cards (heal/Corruption, political, recruit, dice). Each cites its card id from
// assets/event-cards.json. Cards not registered here stay unimplemented (not
// offered) until added. Effects modify the standard rules per the card text.
import type { GameState, Side, Nation, RegionId } from '../types';
import { FP_NATIONS, SHADOW_NATIONS } from '../types';
import { withRng } from '../rng';
import { register, type EventTarget, type EventHandler } from './registry';
import { recruit, settlementController, armySide, unitCount, STACKING_LIMIT, captureIfEnemySettlement, freeForMovement, canMoveArmy, forceUnitCount } from '../armies';
import { applyCasualties, startBattle } from '../combat';
import { shadowBarredFromRegion } from '../persistent';
import { extraHunt, drawHuntTileNumber, challengeOfTheKing } from '../hunt';
import { activateNation, advancePolitical, isAtWar } from '../politics';
import { REGIONS, levelOf, characterSide } from '../data';
import { moveFellowship, beginSeparation, placeSeparatedGroup, separationRange, separationDestinations } from '../fellowship';
import { moveCharacter, characterDestinations } from '../charMove';
import { log, notify } from '../log';

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
// The five Sauron Strongholds (for Nazgûl relocation effects).
const SAURON_STRONGHOLDS = Object.keys(REGIONS).filter((id) => REGIONS[id]!.nation === 'sauron' && REGIONS[id]!.settlement === 'Stronghold');
const MINIONS = ['witch-king', 'saruman', 'mouth-of-sauron'];
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
  // Over-limit is resolved by the player's discard choice (engine enforceHandLimit).
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
  // Only this side's Characters move with its Army; an enemy Character sharing the
  // region stays behind.
  const movingChars = src.characters.filter((c) => characterSide(c) === side);
  dst.leaders += src.leaders; dst.nazgul += src.nazgul; dst.characters.push(...movingChars);
  src.units = {}; src.leaders = 0; src.nazgul = 0;
  src.characters = src.characters.filter((c) => characterSide(c) !== side);
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

// Force-place units + a Leader into a NAMED region for an event recruit (bypasses the
// At-War gate; capped by reinforcements + stacking). Leaders only go where the units do.
function placeForce(state: GameState, nation: Nation, region: string, opts: { regular?: number; elite?: number; leader?: number }): void {
  placeUnits(state, nation, region, opts.regular ?? 0, opts.elite ?? 0);
  const lead = opts.leader ?? 0;
  if (lead > 0) {
    const pool = state.reinforcements[nation] as { leader?: number };
    const k = Math.min(lead, pool.leader ?? 0);
    if (k > 0) { state.regions[region]!.leaders += k; pool.leader = (pool.leader ?? 0) - k; }
  }
}
/** A region an event may recruit into: not controlled or occupied by the enemy. */
const recruitable = (state: GameState, side: Side, region: string): boolean => {
  const enemy: Side = side === 'fp' ? 'shadow' : 'fp';
  return settlementController(state, region) !== enemy && armySide(state, region) !== enemy;
};

type RecruitSlot = { nation: Nation; region: string };
/** Build a handler for a card that recruits one or more units "(Regular or Elite)"
 *  in NAMED regions, PROMPTING the player to choose Regular vs Elite for each unit
 *  (rulebook: the choice is the player's). `apply` runs the immediate part (before the
 *  choices); `leaders` are auto-placed (no R/E choice); `then` runs after all units
 *  (card draws etc.). Un-recruitable slots (no reinforcements / no room / enemy-held)
 *  are skipped. */
function recruitChoiceCard(side: Side, slots: RecruitSlot[], opts: {
  apply?: (s: GameState) => void;
  leaders?: RecruitSlot[];
  then?: (s: GameState) => void;
  canPlay?: (s: GameState) => boolean;
} = {}): EventHandler {
  const slotOptions = (state: GameState, i: number): EventTarget[] => {
    const sl = slots[i]!;
    if (!recruitable(state, side, sl.region)) return [];
    const pool = state.reinforcements[sl.nation];
    const room = STACKING_LIMIT - unitCount(state, sl.region);
    const o: EventTarget[] = [];
    if (room > 0 && pool.regular > 0) o.push({ nation: sl.nation, region: sl.region, figure: 'regular', slot: i });
    if (room > 0 && pool.elite > 0) o.push({ nation: sl.nation, region: sl.region, figure: 'elite', slot: i });
    return o;
  };
  return {
    canPlay: opts.canPlay ?? ((state) => slots.some((_, i) => slotOptions(state, i).length > 0)),
    apply: opts.apply,
    repeat: slots.length,
    targets(state, _side, applied = []) {
      const done = new Set(applied.map((t) => t.slot));
      for (let i = 0; i < slots.length; i++) {
        if (done.has(i)) continue;
        const o = slotOptions(state, i);
        if (o.length) return o; // first not-yet-chosen, still-recruitable slot
      }
      return [];
    },
    applyTarget(state, _side, t) {
      placeUnits(state, t.nation!, t.region!, t.figure === 'elite' ? 0 : 1, t.figure === 'elite' ? 1 : 0);
    },
    finalize(state) {
      for (const l of opts.leaders ?? []) placeForce(state, l.nation, l.region, { leader: 1 });
      opts.then?.(state);
    },
  };
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
    const need = guideIsStrider ? 3 : 5;
    const dice = withRng(state, (rng) => [rng.rollDie(6), rng.rollDie(6), rng.rollDie(6)]);
    const healed = dice.filter((d) => d >= need).length;
    heal(state, healed);
    // Surface the roll (the report: "Athelas should show the rolls in a popup").
    notify(state, `Athelas — rolled [${dice.join(', ')}], healing on ${need}+${guideIsStrider ? ' (Strider guides)' : ''}: healed ${healed} Corruption (now ${state.fellowship.corruption}/12).`);
    log(state, null, 'event', `Athelas heals ${healed} [${dice.join(',')}]`);
  },
});
// There Is Another Way: heal 1; then, if Gollum is the Guide, the Fellowship MAY
// also hide (if revealed) or move (if hidden, following normal movement rules — the
// move triggers a Hunt, run via `finalize` so its follow-up choice survives), or
// decline. A real player choice (RAW).
register('fp-char-10', {
  apply: (state) => { heal(state, 1); },
  targets: (state) => {
    if (!isGollumGuide(state)) return [];
    return state.fellowship.hidden ? [{ mode: 'move' }, { mode: 'none' }] : [{ mode: 'hide' }, { mode: 'none' }];
  },
  applyTarget: (state, _side, t) => {
    if (t.mode === 'hide') { state.fellowship.hidden = true; log(state, null, 'fellowship', 'There Is Another Way: Fellowship hidden (Gollum)'); }
    // 'move' is deferred to finalize (it raises a Hunt choice); 'none' does nothing.
  },
  finalize: (state, _side, applied) => { if (applied.some((t) => t.mode === 'move')) moveFellowship(state); },
});
register('fp-char-12', { apply(state) { heal(state, isGollumGuide(state) ? 2 : 1); } }); // Bilbo's Song

// --- Free Peoples: political ---------------------------------------------
register('fp-str-08', { // Wisdom of Elrond: activate + advance an FP Nation OF YOUR CHOICE
  canPlay: (state) => FP_NATIONS.some((n) => state.nations[n].step > 0),
  // The player chooses which Free Peoples Nation (one that can still advance).
  targets: (state) => FP_NATIONS.filter((n) => state.nations[n].step > 0).map((n) => ({ nation: n })),
  applyTarget(state, _side, t) {
    const n = t.nation!;
    activateNation(state, n); advancePolitical(state, n, 1);
    log(state, null, 'event', `Wisdom of Elrond — ${n.charAt(0).toUpperCase() + n.slice(1)} activated and advanced one step`);
  },
});

// --- Free Peoples: recruit (Event recruit, may ignore At War) -------------
// Fixed-region FP recruit cards (place in a named region, with Leaders / draws).
// Each "(Regular or Elite)" card prompts the player to choose the figure per unit.
register('fp-str-14', recruitChoiceCard('fp', [{ nation: 'gondor', region: 'minas-tirith' }], { leaders: [{ nation: 'gondor', region: 'minas-tirith' }] })); // Guards of the Citadel
register('fp-str-15', recruitChoiceCard('fp', [{ nation: 'elves', region: 'lorien' }], { then: (s) => drawCard(s, 'fp', 'strategy') })); // Celeborn's Galadhrim
register('fp-str-17', recruitChoiceCard('fp', [{ nation: 'north', region: 'carrock' }], { leaders: [{ nation: 'north', region: 'carrock' }] })); // Grimbeorn the Old
register('fp-str-18', recruitChoiceCard('fp', [{ nation: 'gondor', region: 'dol-amroth' }], { leaders: [{ nation: 'gondor', region: 'dol-amroth' }] })); // Imrahil of Dol Amroth
register('fp-str-19', { canPlay: (s) => recruitable(s, 'fp', 'dale'), apply: (s) => { placeForce(s, 'north', 'dale', { regular: 2 }); drawCard(s, 'fp', 'strategy'); } }); // King Brand's Men (2 Regulars — no choice)
register('fp-str-22', recruitChoiceCard('fp', [{ nation: 'dwarves', region: 'erebor' }], { leaders: [{ nation: 'dwarves', region: 'erebor' }] })); // Dáin Ironfoot's Guard
register('fp-str-24', recruitChoiceCard('fp', [{ nation: 'elves', region: 'woodland-realm' }], { then: (s) => drawCard(s, 'fp', 'strategy') })); // Thranduil's Archers

// (Interactive FP recruit cards — Círdan / Riders / Éomer — are registered below with
// region-accurate targets.)
const fpRecruits: Array<[string, Nation]> = [];

// "Book of Mazarbul" — move any/all separated Companions; if one is then in Erebor or
// Ered Luin, rouse the Dwarves to War.
register('fp-str-04', moveCompanionsCard(['erebor', 'ered-luin'], 'dwarves'));
// "Fear! Fire! Foes!" — move any/all separated Companions; if one is then in The Shire
// or Bree, rouse the North to War.
register('fp-str-07', moveCompanionsCard(['the-shire', 'bree'], 'north'));
for (const [id, nation] of fpRecruits) {
  register(id, {
    canPlay: (state) => canEventRecruit(state, nation),
    apply(state, side) { eventRecruit(state, side, nation, 1, 0); },
  });
}

// --- Shadow: Corruption --------------------------------------------------
register('sh-char-08', { // Candles of Corpses: +1 corruption per die 4+ (6 if Gollum guides)
  // Precondition (shared with Orc Patrol / Isildur's Bane / Foul Thing, sh-char-05/06/07):
  // "Play if the Fellowship is not in a region containing a Free Peoples Settlement."
  canPlay: (state) => { const loc = state.fellowship.location; return !(REGIONS[loc]!.settlement && settlementController(state, loc) === 'fp'); },
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
// The Lidless Eye: change UP TO 3 unused Shadow dice into Eyes (Shadow chooses how
// many — each step converts one; stop early with "done").
register('sh-char-18', {
  canPlay: (state) => state.dice.shadow.some((f) => f !== 'eye'),
  repeat: 3,
  targets: (state, _side, applied = []) => (applied.length < 3 && state.dice.shadow.some((f) => f !== 'eye')) ? [{ eye: true }] : [],
  applyTarget(state) {
    for (let i = state.dice.shadow.length - 1; i >= 0; i--) {
      if (state.dice.shadow[i] !== 'eye') { state.dice.shadow.splice(i, 1); state.hunt.box += 1; log(state, null, 'event', 'The Lidless Eye: +1 Eye to the Hunt Box'); break; }
    }
  },
});

// --- Shadow: recruit -----------------------------------------------------
// Fixed-region Shadow recruit cards (named regions / counts).
// A New Power is Rising: 2 Isengard Regulars in each Dunland (no choice) + 2 in Orthanc (R or E each).
register('sh-str-16', recruitChoiceCard('shadow', [{ nation: 'isengard', region: 'orthanc' }, { nation: 'isengard', region: 'orthanc' }], {
  canPlay: (s) => recruitable(s, 'shadow', 'orthanc') || recruitable(s, 'shadow', 'north-dunland') || recruitable(s, 'shadow', 'south-dunland'),
  apply: (s) => { placeForce(s, 'isengard', 'north-dunland', { regular: 2 }); placeForce(s, 'isengard', 'south-dunland', { regular: 2 }); },
}));
register('sh-str-20', { // Orcs Multiplying Again: 3 Sauron Regulars in Dol Guldur + 3 in Mount Gundabad
  canPlay: (s) => recruitable(s, 'shadow', 'dol-guldur') || recruitable(s, 'shadow', 'mount-gundabad'),
  apply: (s) => { placeForce(s, 'sauron', 'dol-guldur', { regular: 3 }); placeForce(s, 'sauron', 'mount-gundabad', { regular: 3 }); },
});
register('sh-str-22', { // Monsters Roused: 1 Sauron Regular each in Angmar/Ettenmoors/Weather Hills + 1 Elite in Trollshaws
  canPlay: (s) => ['angmar', 'ettenmoors', 'weather-hills', 'trollshaws'].some((r) => recruitable(s, 'shadow', r)),
  apply: (s) => { for (const r of ['angmar', 'ettenmoors', 'weather-hills']) placeForce(s, 'sauron', r, { regular: 1 }); placeForce(s, 'sauron', 'trollshaws', { elite: 1 }); },
});

// (Interactive Shadow recruit cards are registered below with region-accurate targets.)
const shRecruits: Array<[string, Nation]> = [];
for (const [id, nation] of shRecruits) {
  register(id, {
    canPlay: (state) => canEventRecruit(state, nation),
    apply(state, side) { eventRecruit(state, side, nation, 1, 0); },
  });
}

// --- Interactive recruit cards: the player picks the legal region(s) -----------
const COASTAL = ['ered-luin', 'north-ered-luin', 'south-ered-luin', 'forlindon', 'harlindon', 'grey-havens', 'tower-hills', 'andrast', 'anfalas', 'dol-amroth', 'lossarnach', 'pelargir'];
const regionsWithShadowArmy = (s: GameState): EventTarget[] =>
  Object.keys(s.regions).filter((id) => armySide(s, id) === 'shadow' && unitCount(s, id) > 0 && recruitable(s, 'shadow', id)).map((region) => ({ region }));
const ROHAN_REGIONS = Object.keys(REGIONS).filter((id) => REGIONS[id]!.nation === 'rohan');

/** A "recruit N <Nation> unit(s) (Regular OR Elite) [+ Leader] in one of these
 *  regions" card: the player picks the region AND each figure's type. Covers
 *  "Regular or Elite" cards we were silently resolving to Regular (Riders of
 *  Théoden, Éomer, Half-orcs, Olog-hai) and the 2-unit Círdan's Ships. For N>1 the
 *  region is locked after the first pick (all units land together). The Leader
 *  (count-1 cards) is added with the first unit. */
function placeChoiceCard(nation: Nation, regions: (s: GameState) => string[], opts: { leader?: boolean; count?: number } = {}): EventHandler {
  const count = opts.count ?? 1;
  const pool = (s: GameState) => s.reinforcements[nation] as { regular: number; elite: number };
  return {
    canPlay: (s) => regions(s).length > 0 && (pool(s).regular > 0 || pool(s).elite > 0),
    repeat: count,
    noDone: count > 1, // "recruit two" is mandatory (up to what's available)
    targets: (s, _side, applied = []) => {
      const locked = applied.find((a) => a.region)?.region; // all units of this card go to one region
      const out: EventTarget[] = [];
      for (const region of (locked ? [locked] : regions(s))) {
        if (pool(s).regular > 0) out.push({ region, figure: 'regular', nation });
        if (pool(s).elite > 0) out.push({ region, figure: 'elite', nation });
      }
      return out;
    },
    applyTarget: (s, _side, t) => {
      if (!t.region || !t.figure) return;
      placeForce(s, nation, t.region, { regular: t.figure === 'regular' ? 1 : 0, elite: t.figure === 'elite' ? 1 : 0, leader: opts.leader ? 1 : 0 });
    },
  };
}
const ridersRegions = (s: GameState): string[] => {
  const set = new Set<string>();
  if (recruitable(s, 'fp', 'edoras')) set.add('edoras');
  for (const r of ROHAN_REGIONS) if (s.regions[r]!.characters.some((c) => COMPANION_SET.has(c)) && recruitable(s, 'fp', r)) set.add(r);
  return [...set];
};

// Círdan's Ships: TWO Elven units (each Regular OR Elite) in a coastal FP-Army region.
register('fp-str-13', placeChoiceCard('elves', (s) => COASTAL.filter((r) => armySide(s, r) === 'fp'), { count: 2 }));
// Riders of Théoden / Éomer: 1 Rohan unit (Regular OR Elite) + a Rohan Leader.
register('fp-str-16', placeChoiceCard('rohan', ridersRegions, { leader: true }));
register('fp-str-23', placeChoiceCard('rohan', (s) => ROHAN_REGIONS.filter((r) => REGIONS[r]!.settlement && recruitable(s, 'fp', r)), { leader: true }));
// Half-orcs and Goblin-men / Olog-hai: 1 Isengard / Sauron unit (Regular OR Elite)
// in a region with a Shadow Army.
const shadowArmyRegionIds = (s: GameState): string[] => regionsWithShadowArmy(s).map((t) => t.region!);
register('sh-str-13', placeChoiceCard('isengard', shadowArmyRegionIds));
register('sh-str-14', placeChoiceCard('sauron', shadowArmyRegionIds));
// Rage of the Dunlendings: recruit 2 Isengard Regulars in a free region adjacent to a
// Dunland, then OPTIONALLY move up to 4 Isengard units there from N/S Dunland (RAW).
const RAGE_SOURCES = ['north-dunland', 'south-dunland'];
const rageHasIsengard = (s: GameState, d: string): boolean => ((s.regions[d]?.units.isengard?.regular ?? 0) + (s.regions[d]?.units.isengard?.elite ?? 0)) > 0;
register('sh-str-11', {
  canPlay: (s) => s.reinforcements.isengard.regular > 0 && rageTargets(s).length > 0,
  repeat: 5, // 1 recruit + up to 4 consolidation moves
  targets: (s, _side, applied = []) => {
    if (applied.length === 0) return rageTargets(s); // choose the recruit region
    const region = applied[0]!.region!;
    if (applied.length - 1 >= 4 || unitCount(s, region) >= STACKING_LIMIT) return []; // moved the max / no room
    return RAGE_SOURCES.filter((d) => d !== region && rageHasIsengard(s, d)).map((from) => ({ from, region, mode: 'move' as const }));
  },
  applyTarget: (s, _side, t) => {
    if (!t.from) { placeForce(s, 'isengard', t.region!, { regular: 2 }); return; }
    // Move one Isengard unit (Regular first) from the Dunland source into the recruit region.
    const src = s.regions[t.from]!.units.isengard; const dst = s.regions[t.region!]!;
    if (!src || unitCount(s, t.region!) >= STACKING_LIMIT) return;
    const du = dst.units.isengard ?? { regular: 0, elite: 0 };
    if (src.regular > 0) { src.regular -= 1; du.regular += 1; }
    else if (src.elite > 0) { src.elite -= 1; du.elite += 1; }
    dst.units.isengard = du;
  },
});
register('sh-str-19', { // Shadows on the Misty Mountains: 2 Sauron + 1 Nazgûl in Mount Gram or Moria
  canPlay: (s) => ['mount-gram', 'moria'].some((r) => recruitable(s, 'shadow', r)) && (s.reinforcements.sauron.regular > 0 || (s.reinforcements.sauron.nazgul ?? 0) > 0),
  targets: (s) => ['mount-gram', 'moria'].filter((r) => recruitable(s, 'shadow', r)).map((region) => ({ region })),
  applyTarget: (s, _side, t) => {
    placeForce(s, 'sauron', t.region!, { regular: 2 });
    const k = Math.min(1, s.reinforcements.sauron.nazgul ?? 0);
    if (k > 0) { s.regions[t.region!]!.nazgul += k; s.reinforcements.sauron.nazgul = (s.reinforcements.sauron.nazgul ?? 0) - k; }
  },
});
register('sh-str-17', { // Many Kings: 2 S&E Regulars in each of three different S&E Settlements
  repeat: 3,
  canPlay: (s) => s.reinforcements.southrons.regular > 0 && seSettlements(s).length > 0,
  targets: (s, _side, applied = []) => { const used = new Set(applied.map((a) => a.region)); return seSettlements(s).filter((r) => !used.has(r)).map((region) => ({ region })); },
  applyTarget: (s, _side, t) => placeForce(s, 'southrons', t.region!, { regular: 2 }),
});
function rageTargets(s: GameState): EventTarget[] {
  const adj = new Set([...REGIONS['north-dunland']!.adjacency, ...REGIONS['south-dunland']!.adjacency]);
  return [...adj].filter((r) => recruitable(s, 'shadow', r)).map((region) => ({ region }));
}
function seSettlements(s: GameState): string[] {
  return Object.keys(REGIONS).filter((id) => REGIONS[id]!.nation === 'southrons' && REGIONS[id]!.settlement && recruitable(s, 'shadow', id));
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
      if (out.length >= 120) return out; // high cap: list ALL legal card-moves (never hide a legal move)
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
      if (out.length >= 120) return out; // high cap: list ALL legal card-moves (never hide a legal move)
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
      if (out.length >= 120) return out; // high cap: list ALL legal card-moves (never hide a legal move)
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
/** Move the Shadow army (units + Nazgûl + Minions) out of `from` into `to`,
 *  leaving any Free Peoples figures behind (Dead Men retreat). */
function retreatShadowStack(state: GameState, from: RegionId, to: RegionId): void {
  const src = state.regions[from]!, dst = state.regions[to]!;
  for (const n of SHADOW_NATIONS) {
    const u = src.units[n]; if (!u || (u.regular + u.elite) === 0) continue;
    const d = dst.units[n] ?? { regular: 0, elite: 0 }; d.regular += u.regular; d.elite += u.elite; dst.units[n] = d; delete src.units[n];
  }
  dst.nazgul += src.nazgul; src.nazgul = 0;
  const minions = src.characters.filter((c) => !COMPANION_SET.has(c));
  src.characters = src.characters.filter((c) => COMPANION_SET.has(c));
  dst.characters.push(...minions);
  for (const c of minions) if (state.characters.inPlay[c]) state.characters.inPlay[c] = to;
}
/** Destroy the Shadow army at `region` — units recycle to reinforcements, Nazgûl
 *  return to the Sauron pool, Minions are eliminated (Dead Men's "if it cannot
 *  retreat, it is destroyed, along with any Nazgûl and Minions"). */
function destroyShadowStack(state: GameState, region: RegionId): void {
  const r = state.regions[region]!;
  for (const n of SHADOW_NATIONS) {
    const u = r.units[n]; if (!u) continue;
    state.reinforcements[n].regular += u.regular; state.reinforcements[n].elite += u.elite; delete r.units[n];
  }
  if (r.nazgul > 0) { state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) + r.nazgul; r.nazgul = 0; }
  for (const c of r.characters.filter((c) => !COMPANION_SET.has(c))) { state.characters.eliminated.push(c); delete state.characters.inPlay[c]; }
  r.characters = r.characters.filter((c) => COMPANION_SET.has(c));
}
register('fp-char-22', {
  canPlay: (state) => aragornRohanRegion(state) !== null,
  targets: () => ['erech', 'lamedon', 'pelargir'].map((region) => ({ region })),
  applyTarget(state, _side, t) {
    const from = aragornRohanRegion(state); if (!from || !t.region) return;
    const region = t.region, src = state.regions[from]!, dst = state.regions[region]!;
    // 1. Move Strider/Aragorn + any Companions in the same region.
    const moving = src.characters.filter((c) => COMPANION_SET.has(c));
    src.characters = src.characters.filter((c) => !COMPANION_SET.has(c));
    dst.characters.push(...moving);
    for (const c of moving) if (state.characters.inPlay[c]) state.characters.inPlay[c] = region;
    log(state, null, 'event', `Dead Men of Dunharrow: ${from} → ${region}`);
    // 2. A Shadow Army there takes a die's worth of hits, then must retreat —
    //    destroyed (with its Nazgûl/Minions) if it cannot.
    if (armySide(state, region) === 'shadow') {
      const hits = withRng(state, (rng) => rng.rollDie(6));
      applyCasualties(state, region, 'shadow', hits, 'regularsFirst');
      log(state, null, 'event', `Dead Men: the Shadow Army at ${region} takes ${hits} hit${hits === 1 ? '' : 's'}`);
      const dest = REGIONS[region]!.adjacency.find((a) => freeForMovement(state, a, 'shadow'));
      if (unitCount(state, region) > 0 && dest) { retreatShadowStack(state, region, dest); log(state, null, 'event', `Dead Men: the Shadow Army retreats ${region} → ${dest}`); }
      else { destroyShadowStack(state, region); log(state, null, 'event', `Dead Men: the Shadow Army at ${region} is destroyed`); }
    }
    // 3. Recruit up to three Gondor Regular units there, taking control if necessary.
    captureIfEnemySettlement(state, region, 'fp');
    const n = Math.min(3, state.reinforcements.gondor.regular, Math.max(0, STACKING_LIMIT - unitCount(state, region)));
    if (n > 0) {
      const u = dst.units.gondor ?? { regular: 0, elite: 0 }; u.regular += n; dst.units.gondor = u;
      state.reinforcements.gondor.regular -= n;
      log(state, null, 'event', `Dead Men: recruit ${n} Gondor Regular${n === 1 ? '' : 's'} in ${region}`);
    }
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
      if (out.length >= 120) return out; // high cap: list ALL legal card-moves (never hide a legal move)
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
// Pits of Mordor: 2 Sauron Regulars in each of three DIFFERENT Sauron Strongholds —
// the player CHOOSES which three (there are 6), rather than the first three found.
const pitsStrongholds = (state: GameState): string[] => Object.keys(state.regions).filter((id) => {
  const def = REGIONS[id]!;
  return def.nation === 'sauron' && def.settlement === 'Stronghold' && settlementController(state, id) === 'shadow' && unitCount(state, id) < STACKING_LIMIT;
});
register('sh-str-24', {
  repeat: 3,
  canPlay: (state) => isAtWar(state, 'sauron') && (state.reinforcements.sauron as { regular: number }).regular > 0 && pitsStrongholds(state).length > 0,
  targets: (state, _side, applied = []) => { const used = new Set(applied.map((a) => a.region)); return pitsStrongholds(state).filter((r) => !used.has(r)).map((region) => ({ region })); },
  applyTarget: (state, _side, t) => { recruit(state, 'sauron', t.region!, 2, 0, { ignoreAtWar: true }); },
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
// House of the Stewards: recruit a Gondor unit (R or E) with Boromir + draw 2 Strategy.
register('fp-char-23', {
  canPlay: (state) => charRegion(state, 'boromir') !== null && state.reinforcements.gondor.regular + state.reinforcements.gondor.elite > 0,
  targets(state) {
    const r = charRegion(state, 'boromir'); if (!r) return [];
    const pool = state.reinforcements.gondor; const room = STACKING_LIMIT - unitCount(state, r);
    const o: EventTarget[] = [];
    if (room > 0 && pool.regular > 0) o.push({ nation: 'gondor', region: r, figure: 'regular', slot: 0 });
    if (room > 0 && pool.elite > 0) o.push({ nation: 'gondor', region: r, figure: 'elite', slot: 0 });
    return o;
  },
  applyTarget(state, _s, t) { placeUnits(state, 'gondor', t.region!, t.figure === 'elite' ? 0 : 1, t.figure === 'elite' ? 1 : 0); },
  finalize(state) { drawCard(state, 'fp', 'strategy'); drawCard(state, 'fp', 'strategy'); },
});
// Kindred of Glorfindel: recruit an Elven unit (R or E) in Rivendell + draw 1 Strategy.
register('fp-str-21', recruitChoiceCard('fp', [{ nation: 'elves', region: 'rivendell' }], { then: (s) => drawCard(s, 'fp', 'strategy') }));
// Swords in Eriador: a North unit (R or E) in the Shire + a Dwarven unit (R or E) in Ered Luin, then draw.
register('fp-str-20', recruitChoiceCard('fp', [{ nation: 'north', region: 'the-shire' }, { nation: 'dwarves', region: 'ered-luin' }], { then: (s) => drawCard(s, 'fp', 'strategy') }));
// The Grey Company: in Strider's Army, upgrade one Regular to an Elite.
// The Grey Company: in Strider/Aragorn's Army, upgrade one Regular to an Elite of the
// SAME Nation — the player CHOOSES which Nation (his Army can hold several).
const greyCompanyRegion = (state: GameState): string | null => charRegion(state, 'strider') ?? charRegion(state, 'aragorn');
const greyCompanyNations = (state: GameState, r: string): Nation[] =>
  (Object.entries(state.regions[r]!.units) as [string, { regular: number; elite: number }][])
    .filter(([n, u]) => isFpNation(n) && u.regular > 0 && state.reinforcements[n as Nation].elite > 0)
    .map(([n]) => n as Nation);
register('fp-char-24', {
  canPlay: (state) => { const r = greyCompanyRegion(state); return !!r && greyCompanyNations(state, r).length > 0; },
  targets: (state) => { const r = greyCompanyRegion(state); return r ? greyCompanyNations(state, r).map((nation) => ({ nation, region: r, figure: 'elite' as const })) : []; },
  applyTarget(state, _side, t) {
    const u = state.regions[t.region!]!.units[t.nation!]!;
    u.regular--; u.elite++;
    state.reinforcements[t.nation!].regular++; state.reinforcements[t.nation!].elite--;
  },
  finalize(state) { drawCard(state, 'fp', 'strategy'); drawCard(state, 'fp', 'strategy'); }, // "Then, draw two Strategy Event cards."
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
      // Snapshot Nazgûl + Minions before combat resolution: applyCasualties clears
      // them when the Army is destroyed, but the card wants them eliminated with it.
      const naz0 = state.regions['orthanc']!.nazgul;
      const minionsHere = state.regions['orthanc']!.characters.filter((c) => MINIONS.includes(c));
      const hits = rollDice(state, 3, 4);
      if (hits > 0) applyCasualties(state, 'orthanc', 'shadow', hits, 'regularsFirst');
      let extra = '';
      if (unitCount(state, 'orthanc') === 0) {
        state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) + naz0; // recycle
        for (const m of minionsHere) { if (!state.characters.eliminated.includes(m)) state.characters.eliminated.push(m); extra += `, eliminated ${m}`; }
      }
      log(state, null, 'event', `The Ents Awake: ${hits} hit(s) on Orthanc${extra}`);
      // If Gandalf the White is in Fangorn or a Rohan region, the FP may play one more
      // Character Event card without an Action die (consumed in the next playEvent).
      const gw = charRegion(state, 'gandalf-white');
      if (gw && (gw === 'fangorn' || REGIONS[gw]!.nation === 'rohan')) {
        state.flags.fpFreeCharEventThisTurn = true;
        log(state, null, 'event', 'The Ents Awake: Free Peoples may play a Character Event without a die');
      }
    },
  });
}
// Faramir's Rangers: hit a Shadow Army in Osgiliath / N. or S. Ithilien.
// Faramir's Rangers: CHOOSE a Shadow Army in Osgiliath/N./S. Ithilien, roll 3 dice
// (hit on 5+); then, if an FP Army is in Osgiliath, recruit one Gondor unit (R or E).
register('fp-str-06', {
  canPlay: (state) => ['osgiliath', 'south-ithilien', 'north-ithilien'].some((r) => armySide(state, r) === 'shadow'),
  repeat: 2, // the attack target, then the optional Gondor recruit
  targets(state, _side, applied = []) {
    if (applied.length === 0) {
      return ['osgiliath', 'south-ithilien', 'north-ithilien'].filter((r) => armySide(state, r) === 'shadow').map((region) => ({ region }));
    }
    // After the strike: the Osgiliath recruit (R or E), if you hold Osgiliath.
    if (armySide(state, 'osgiliath') === 'fp') {
      const pool = state.reinforcements.gondor, room = STACKING_LIMIT - unitCount(state, 'osgiliath');
      const o: EventTarget[] = [];
      if (room > 0 && pool.regular > 0) o.push({ nation: 'gondor', region: 'osgiliath', figure: 'regular', slot: 1 });
      if (room > 0 && pool.elite > 0) o.push({ nation: 'gondor', region: 'osgiliath', figure: 'elite', slot: 1 });
      return o;
    }
    return [];
  },
  applyTarget(state, _side, t) {
    if (t.figure) { placeUnits(state, 'gondor', t.region!, t.figure === 'elite' ? 0 : 1, t.figure === 'elite' ? 1 : 0); return; }
    const hits = rollDice(state, 3, 5);
    if (hits > 0) applyCasualties(state, t.region!, 'shadow', hits, 'regularsFirst');
    log(state, null, 'event', `Faramir's Rangers: ${hits} hit(s) on ${t.region}`);
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
    // Surviving Nazgûl must move to any one unconquered Sauron Stronghold (card text).
    const survivors = state.regions[sh]!.nazgul;
    const dest = SAURON_STRONGHOLDS.find((r) => r !== sh && settlementController(state, r) === 'shadow');
    if (survivors > 0 && dest) { state.regions[dest]!.nazgul += survivors; state.regions[sh]!.nazgul = 0; }
    log(state, null, 'event', `The Eagles are Coming!: eliminated ${kills} Nazgûl at ${sh}${survivors > 0 && dest ? `; ${survivors} fled to ${dest}` : ''}`);
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
    log(state, null, 'event', `Stormcrow: ${n} set back one step on the Political Track`);
    // The FREE PEOPLES player chooses which unit of that Nation to eliminate.
    const hasUnit = Object.values(state.regions).some((r) => { const u = r.units[n]; return !!u && (u.regular > 0 || u.elite > 0); });
    if (hasUnit) state.pendingChoice = { owner: 'fp', kind: 'stormcrowLoss', data: { nation: n } };
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
register('sh-char-22', { onTable: true, canPlay: (state) => inPlay(state, 'saruman'), apply() { /* Wormtongue — play if Saruman is in play; see politics.ts (activateNation) */ } });
register('sh-char-16', { onTable: true, apply() { /* Flocks of Crebain — +1 Hunt dice, see hunt.ts resolveHunt */ } });
register('sh-char-17', { onTable: true, apply() { /* Balrog of Moria — extra Hunt tile on a Moria declaration, see wotrAdapter declareFellowship */ } });

// --- Card-granted Army actions with a Nazgûl. A "Shadow Army containing a Nazgûl"
//     is a region with Shadow units and ≥1 Nazgûl. The card grants a real prompt to
//     move and/or attack with such an Army (move = whole stack; attack = startBattle).
const nazgulArmies = (state: GameState): string[] =>
  Object.keys(state.regions).filter((id) => armySide(state, id) === 'shadow' && state.regions[id]!.nazgul > 0 && unitCount(state, id) > 0);
/** Legal move/attack EventTargets for Nazgûl-led Armies. `allowAttack` gates the
 *  attack option (Ringwraiths: only as the sole action); `exclude` skips Armies that
 *  have already moved this card. */
function nazgulArmyActions(state: GameState, allowAttack: boolean, exclude: Set<string> = new Set()): EventTarget[] {
  const out: EventTarget[] = [];
  for (const from of nazgulArmies(state)) {
    if (exclude.has(from)) continue;
    for (const to of REGIONS[from]!.adjacency) {
      if (canMoveArmy(state, from, to, 'shadow')) out.push({ from, to, mode: 'move' });
      else if (allowAttack && armySide(state, to) === 'fp' && !shadowBarredFromRegion(state, to)) out.push({ from, to, mode: 'attack' });
    }
    // ASSAULT: this Nazgûl-led Army occupies a besieged Stronghold's open field and
    // may storm the boxed garrison (attack from===to), same gate as a normal attack.
    const box = state.regions[from]!.siegeBox;
    if (allowAttack && box && forceUnitCount(box) > 0 && !shadowBarredFromRegion(state, from)) out.push({ from, to: from, mode: 'attack' });
  }
  return out;
}
function applyNazgulArmyAction(state: GameState, t: EventTarget): void {
  if (t.mode === 'attack') { startBattle(state, 'shadow', t.from!, t.to!); log(state, null, 'event', `Nazgûl-led attack ${t.from} → ${t.to}`); }
  else { moveAllUnits(state, t.from!, t.to!); log(state, null, 'event', `Nazgûl-led Army moves ${t.from} → ${t.to}`); }
}

register('sh-char-23', { // The Ringwraiths Are Abroad
  // RAW: "Move any or all of the Nazgûl" (each FLIES anywhere) — THEN you may move two
  // Armies each containing a Nazgûl, or attack with one. Was missing the fly-move part
  // (player report: couldn't fly a Nazgûl to the Fords of Isen).
  repeat: 24,
  optionalFromStart: true, // "any or ALL" + the army clause is optional
  canPlay: (state) => Object.values(state.regions).some((r) => r.nazgul > 0) || nazgulArmyActions(state, true).length > 0,
  targets(state, _side, applied = []) {
    const last = applied[applied.length - 1];
    // Destination step of a Nazgûl figure-move (fly anywhere it can land).
    if (last && last.companion === 'nazgul' && last.from && !last.region) {
      return characterDestinations(state, 'shadow', 'nazgul', last.from).map((region) => ({ companion: 'nazgul', from: last.from, region }));
    }
    const armyActs = applied.filter((a) => a.mode === 'move' || a.mode === 'attack');
    if (armyActs.some((a) => a.mode === 'attack') || armyActs.length >= 2) return []; // army clause spent (1 attack, or 2 moves)
    const out: EventTarget[] = [];
    if (armyActs.length === 0) {
      // Phase 1 still open: pick a Nazgûl group to fly (exclude groups already moved this card).
      const blocked = new Set([...applied.filter((a) => a.companion === 'nazgul').flatMap((a) => [a.from, a.region])].filter(Boolean) as string[]);
      for (const from of Object.keys(state.regions)) if (state.regions[from]!.nazgul > 0 && !blocked.has(from)) out.push({ companion: 'nazgul', from });
    }
    // Phase 2: move a Nazgûl-led Army (≤2, different armies) or attack with one (first action only).
    const movedFrom = new Set(armyActs.map((a) => a.from!));
    out.push(...nazgulArmyActions(state, armyActs.length === 0, movedFrom));
    return out;
  },
  applyTarget(state, _side, t) {
    if (t.companion === 'nazgul') { if (t.region && t.from) moveCharacter(state, 'shadow', 'nazgul', t.from, t.region); return; }
    applyNazgulArmyAction(state, t);
  },
});

/** Move / attack / ASSAULT EventTargets for the single Army containing the Witch-king. */
function wkArmyActions(state: GameState, wk: RegionId): EventTarget[] {
  const out: EventTarget[] = [];
  if (armySide(state, wk) !== 'shadow') return out; // WK must be with a Shadow Army
  for (const to of REGIONS[wk]!.adjacency) {
    if (canMoveArmy(state, wk, to, 'shadow')) out.push({ from: wk, to, mode: 'move' });
    else if (armySide(state, to) === 'fp' && !shadowBarredFromRegion(state, to)) out.push({ from: wk, to, mode: 'attack' });
  }
  const box = state.regions[wk]!.siegeBox; // assault a Stronghold the WK's Army is besieging
  if (box && forceUnitCount(box) > 0 && !shadowBarredFromRegion(state, wk)) out.push({ from: wk, to: wk, mode: 'attack' });
  return out;
}

register('sh-char-24', { // The Black Captain Commands
  // RAW: EITHER recruit two Nazgûl in the Witch-king's region OR move any/all of the
  // Nazgûl (each flies). THEN move OR attack with the Army containing the Witch-king
  // (one action — includes ASSAULTING a Stronghold that Army is besieging). Was:
  // auto-recruited and offered only adjacent moves/attacks — no fly, no assault.
  repeat: 24,
  optionalFromStart: true, // the recruit/fly clause and the army clause are both optional
  canPlay: (state) => inPlay(state, 'witch-king'),
  targets(state, _side, applied = []) {
    const wk = charRegion(state, 'witch-king');
    const last = applied[applied.length - 1];
    // Destination step of a Nazgûl figure-fly.
    if (last && last.companion === 'nazgul' && last.from && !last.region) {
      return characterDestinations(state, 'shadow', 'nazgul', last.from).map((region) => ({ companion: 'nazgul', from: last.from, region }));
    }
    const recruited = applied.some((a) => a.mode === 'recruit');
    const flies = applied.filter((a) => a.companion === 'nazgul');
    const armyActs = applied.filter((a) => a.mode === 'move' || a.mode === 'attack');
    const out: EventTarget[] = [];
    // Phase 1 — recruit XOR fly — only before any army action and before recruiting.
    if (armyActs.length === 0 && !recruited) {
      if (flies.length === 0 && wk && (state.reinforcements.sauron.nazgul ?? 0) > 0) out.push({ mode: 'recruit', region: wk });
      const blocked = new Set(flies.flatMap((a) => [a.from, a.region]).filter(Boolean) as string[]);
      for (const id of Object.keys(state.regions)) if (state.regions[id]!.nazgul > 0 && !blocked.has(id)) out.push({ companion: 'nazgul', from: id });
    }
    // Phase 2 — ONE move/attack with the Army containing the Witch-king.
    if (armyActs.length === 0 && wk) out.push(...wkArmyActions(state, wk));
    return out;
  },
  applyTarget(state, _side, t) {
    if (t.mode === 'recruit' && t.region) {
      const k = Math.min(2, state.reinforcements.sauron.nazgul ?? 0);
      if (k > 0) { state.regions[t.region]!.nazgul += k; state.reinforcements.sauron.nazgul = (state.reinforcements.sauron.nazgul ?? 0) - k; log(state, null, 'event', `The Black Captain Commands: ${k} Nazgûl muster at ${t.region}`); }
      return;
    }
    if (t.companion === 'nazgul') { if (t.region && t.from) moveCharacter(state, 'shadow', 'nazgul', t.from, t.region); return; }
    applyNazgulArmyAction(state, t);
  },
});
// The Breaking of the Fellowship — the FREE PEOPLES player chooses which N Companions
// to separate (to the Fellowship's region). Forbidden on the Mordor Track.
register('sh-char-14', {
  canPlay: (state) => state.fellowship.mordor === null && !state.fellowship.hidden && state.fellowship.companions.some((c) => COMPANION_SET.has(c)),
  apply(state) {
    const n = drawHuntTileNumber(state);
    if (n === null) { log(state, null, 'event', 'The Breaking of the Fellowship: tile had no effect'); return; }
    if (isGollumGuide(state)) { corrupt(state, 1); log(state, null, 'event', 'The Breaking of the Fellowship: Gollum guides — +1 Corruption'); return; }
    const avail = state.fellowship.companions.filter((c) => COMPANION_SET.has(c)).length;
    const k = Math.min(n, avail);
    if (k > 0) state.pendingChoice = { owner: 'fp', kind: 'breakingSep', data: { left: k } };
  },
});

// --- Grond / The Fighting Uruk-hai: a 3-round siege assault on a besieged FP
//     Stronghold (siege mechanic in combat.ts). The besieging army must be adjacent
//     to the besieged Stronghold and contain the required figure/unit. -----------
// Strongholds the Shadow is currently BESIEGING (siege model: the besieger occupies
// the Stronghold region, the FP garrison sits in its siegeBox), filtered by a
// per-region predicate (an Isengard unit, the Witch-king, …). The assault is an
// attack from===to, since the besieger is in-region — NOT adjacent (that was the
// pre-siege-rewrite model, which left Grond / Fighting Uruk-hai unplayable).
function siegeAssaultTargets(state: GameState, qualifies: (from: string) => boolean): EventTarget[] {
  const out: EventTarget[] = [];
  for (const id of Object.keys(state.regions)) {
    const def = REGIONS[id]!;
    const r = state.regions[id]!;
    if (def.settlement !== 'Stronghold' || !r.besieged) continue;
    if (settlementController(state, id) !== 'fp') continue; // garrison (in the box) still holds it
    if (armySide(state, id) === 'shadow' && qualifies(id)) out.push({ from: id, to: id });
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

// --- Companion-separation event cards: separate one Companion (with bonus
//     movement) plus a secondary effect. Interactive — the player picks which.
//     (The cards' alternative "or move an already-separated Companion" is folded
//     into the existing Character-die moveCharacter action.) ---------------------
const fellowCompanions = (state: GameState): EventTarget[] =>
  state.fellowship.companions.filter((c) => COMPANION_SET.has(c)).map((companion) => ({ companion }));
const canSeparate = (state: GameState): boolean =>
  state.fellowship.mordor === null && state.fellowship.companions.some((c) => COMPANION_SET.has(c));

/** A card that may MOVE any or all already-separated Companions, then (if a Companion
 *  ends in a `trigger` region) rouses `nation` to war. Interactive: repeatedly pick a
 *  Companion (button) then its destination (board-click), or stop. The rouse is
 *  checked both before (already-positioned) and after the moves (idempotent via the
 *  not-At-War guard). */
function moveCompanionsCard(trigger: RegionId[], nation: Nation): EventHandler {
  const seps = (state: GameState): [string, RegionId][] => Object.entries(state.characters.inPlay).filter(([c]) => COMPANION_SET.has(c)) as [string, RegionId][];
  const canMove = (state: GameState, c: string, from: RegionId): boolean => characterDestinations(state, 'fp', c, from).length > 0;
  const checkRouse = (state: GameState): void => {
    if (isAtWar(state, nation)) return;
    if (trigger.some((r) => (state.regions[r]?.characters ?? []).some((c) => COMPANION_SET.has(c)))) {
      activateNation(state, nation, { viaCompanion: true }); advancePolitical(state, nation, 99);
      const nm = nation.charAt(0).toUpperCase() + nation.slice(1);
      log(state, null, 'event', `A Companion rouses the ${nm} to War`);
      notify(state, `A Companion in ${trigger.map((r) => REGIONS[r]?.name ?? r).join(' / ')} rouses the ${nm} to war!`);
    }
  };
  return {
    canPlay: (state) => seps(state).some(([c, from]) => canMove(state, c, from)) || (!isAtWar(state, nation) && trigger.some((r) => (state.regions[r]?.characters ?? []).some((c) => COMPANION_SET.has(c)))),
    apply: (state) => checkRouse(state),     // rouse from an already-positioned Companion
    repeat: 12,
    optionalFromStart: true,                  // "any or ALL" — moving zero is allowed
    targets(state, _side, applied = []) {
      const last = applied[applied.length - 1];
      if (last && last.companion && !last.region) {
        // destination step for the just-picked Companion
        const from = state.characters.inPlay[last.companion];
        return from ? characterDestinations(state, 'fp', last.companion, from).map((region) => ({ companion: last.companion, region })) : [];
      }
      // pick step: separated Companions that haven't completed a move and can still move
      const done = new Set(applied.filter((t) => t.region).map((t) => t.companion));
      return seps(state).filter(([c, from]) => !done.has(c) && canMove(state, c, from)).map(([c]) => ({ companion: c }));
    },
    applyTarget(state, _side, t) {
      if (t.region) moveCharacter(state, 'fp', t.companion!, state.characters.inPlay[t.companion!]!, t.region);
      // pick step (no region): records the Companion; no mutation
    },
    finalize: (state) => checkRouse(state),  // rouse from a Companion moved into the trigger region
  };
}

/** A card that may MOVE any or all Nazgûl groups (each region's Nazgûl fly together),
 *  then runs `after` (reveal / Hunt if a Nazgûl ends with the Fellowship). Interactive:
 *  pick a Nazgûl group (button), board-click its destination, repeat, or stop. A group
 *  moves at most once (its source and destination are blocked from re-selection). */
function moveNazgulCard(after: (state: GameState) => void): EventHandler {
  const sourceRegions = (state: GameState, blocked: Set<string>): RegionId[] =>
    Object.keys(state.regions).filter((r) => state.regions[r]!.nazgul > 0 && !blocked.has(r));
  return {
    canPlay: (state) => Object.values(state.regions).some((r) => r.nazgul > 0),
    repeat: 12,
    optionalFromStart: true,                   // "any or ALL" — moving zero is allowed
    targets(state, _side, applied = []) {
      const last = applied[applied.length - 1];
      if (last && last.from && !last.region) {
        // destination step for the Nazgûl group at last.from
        return characterDestinations(state, 'shadow', 'nazgul', last.from).map((region) => ({ companion: 'nazgul', from: last.from, region }));
      }
      // pick step: Nazgûl groups whose source/destination hasn't been used this card
      const blocked = new Set<string>([...applied.map((t) => t.from), ...applied.filter((t) => t.region).map((t) => t.region)].filter(Boolean) as string[]);
      return sourceRegions(state, blocked).map((from) => ({ companion: 'nazgul', from }));
    },
    applyTarget(state, _side, t) {
      if (t.region && t.from) moveCharacter(state, 'shadow', 'nazgul', t.from, t.region);
      // pick step (no region): records the source group; no mutation
    },
    // The effect runs ONCE, after all moves (a Nazgûl already on the Fellowship still
    // triggers it via the "move none" path → finalize). NOT in apply (extraHunt etc.
    // are not idempotent).
    finalize: after,
  };
}

/** A card that separates ONE Companion: step 1 pick the Companion, step 2 pick where
 *  it goes (the player's CHOICE, within Progress + Level + the card's bonus). `after`
 *  runs the card's post-placement effect (heal, extra rouse). */
function separateViaCard(opts: { extraMove?: number; levelOverride?: number; after?: (state: GameState, companions: string[], dest: RegionId) => void } = {}): EventHandler {
  // RAW: these cards separate "one Companion OR one group of Companions". The player
  // picks one or more Companions (each a companion-only target → a panel button), then
  // a destination (a companion+region target → a board click) that places the whole
  // group together. Nothing mutates until the destination is chosen (no stranded
  // separated-but-unplaced Companions); placement happens in finalize from `applied`.
  const chosenOf = (applied: EventTarget[]) => [...new Set(applied.filter((a) => a.companion).map((a) => a.companion!))];
  return {
    canPlay: canSeparate,
    repeat: 24,   // pick any number of Companions, then a destination
    noDone: true, // can't stop without placing — the destination ends it
    targets(state, _side, applied = []) {
      if (applied.some((a) => a.region)) return []; // destination chosen → done
      const chosen = chosenOf(applied);
      const inGroup = new Set(chosen);
      // Add more Companions to the travelling group (panel buttons).
      const out: EventTarget[] = fellowCompanions(state).filter((t) => !inGroup.has(t.companion!));
      // Once ≥1 is chosen, offer destinations (range = Progress + the highest Level in
      // the group + the card's bonus). Tagged with chosen[0] so it's a board-click target.
      if (chosen.length > 0) {
        const range = Math.max(...chosen.map((c) => separationRange(state, c, opts)));
        for (const region of separationDestinations(state, state.fellowship.location, range)) out.push({ companion: chosen[0], region });
      }
      return out;
    },
    applyTarget() { /* no mutation per step; the group is placed in finalize from `applied` */ },
    finalize(state, _side, applied) {
      const region = applied.find((a) => a.region)?.region;
      const companions = chosenOf(applied);
      if (!region || companions.length === 0) return; // fizzle (no destination reachable)
      for (const c of companions) beginSeparation(state, c);
      placeSeparatedGroup(state, companions, region);
      opts.after?.(state, companions, region);
    },
  };
}
// I Will Go Alone — separate a Companion (you choose where; +1 region), then heal 1.
register('fp-char-11', separateViaCard({ extraMove: 1, after: (s) => heal(s, 1) }));
// Gwaihir the Windlord — separate a Companion as if Level 4 (you choose where).
register('fp-char-15', separateViaCard({ levelOverride: 4 }));
// We Prove the Swifter — separate a Companion +2 regions (you choose where).
register('fp-char-16', separateViaCard({ extraMove: 2 }));
// There and Back Again — separate a Companion (+1, you choose where); if Gimli/Legolas
// is then in Dale/Erebor/Woodland Realm, rouse the Dwarves, Elves & North.
register('fp-char-17', separateViaCard({
  extraMove: 1,
  after: (state) => {
    const trig = ['dale', 'erebor', 'woodland-realm'];
    if (['gimli', 'legolas'].some((c) => trig.includes(charRegion(state, c) ?? ''))) {
      activateNation(state, 'dwarves', { viaCompanion: true }); activateNation(state, 'north', { viaCompanion: true });
      advancePolitical(state, 'dwarves', 1); advancePolitical(state, 'elves', 1); advancePolitical(state, 'north', 1);
      log(state, null, 'event', 'There and Back Again rouses the Dwarves/Elves/North');
      notify(state, 'There and Back Again rouses the Dwarves, Elves and North to war!');
    }
  },
}));

// --- Nazgûl converge on the Fellowship. "Move any or all of the Nazgûl" is
//     auto-resolved to the decisive move — one Nazgûl flown to the Fellowship's
//     region — since that is the play that arms the card's secondary effect. ------
const anyNazgul = (state: GameState): string | null => {
  for (const id of Object.keys(state.regions)) if (state.regions[id]!.nazgul > 0) return id;
  return null;
};
function nazgulCanReachFellowship(state: GameState): boolean {
  const dest = state.fellowship.location;
  const def = REGIONS[dest]!;
  // Nazgûl can't enter an FP-controlled Stronghold unless it's besieged.
  if (def.settlement === 'Stronghold' && settlementController(state, dest) === 'fp' && !state.regions[dest]!.besieged) return false;
  return state.fellowship.mordor === null && anyNazgul(state) !== null;
}
// Nazgûl Search — move any/all Nazgûl; if one is then with the Fellowship, reveal it.
register('sh-char-09', {
  ...moveNazgulCard((state) => {
    const loc = state.fellowship.location;
    if (state.fellowship.hidden && (state.regions[loc]!.nazgul > 0 || state.regions[loc]!.characters.includes('witch-king'))) {
      state.fellowship.hidden = false;
      log(state, null, 'event', 'Nazgûl Search reveals the Fellowship');
    }
  }),
  canPlay: (state) => state.fellowship.progress >= 1 && state.fellowship.hidden && nazgulCanReachFellowship(state),
});
// The Nazgûl Strike! — move any/all Nazgûl; if one is then with the Fellowship, roll
// for the Hunt. (The "discard an FP table card instead" option remains simplified to
// the Hunt roll — rules-spec D13.)
register('sh-char-08b', {
  ...moveNazgulCard((state) => {
    const loc = state.fellowship.location;
    if (state.regions[loc]!.nazgul > 0 || state.regions[loc]!.characters.includes('witch-king')) {
      log(state, null, 'event', 'The Nazgûl Strike! — Hunt roll');
      extraHunt(state);
    }
  }),
  canPlay: (state) => state.fellowship.progress >= 1 && nazgulCanReachFellowship(state),
});

// Return to Valinor: each non-besieged Elven Stronghold with Elven units takes a
// Hunt-style roll (1 die per unit, max 5; hit on 6). (The data precond reads "you
// control an Elven Stronghold"; the effect targets the Elves' own Strongholds, so
// playability follows the effect — at least one such Stronghold has Elven units.)
function elvenStrongholds(state: GameState): string[] {
  return Object.keys(state.regions).filter((id) => REGIONS[id]!.nation === 'elves' && REGIONS[id]!.settlement === 'Stronghold'
    && !state.regions[id]!.besieged && (state.regions[id]!.units.elves?.regular ?? 0) + (state.regions[id]!.units.elves?.elite ?? 0) > 0);
}
register('sh-str-01', {
  canPlay: (state) => elvenStrongholds(state).length > 0,
  apply(state) {
    for (const id of elvenStrongholds(state)) {
      const u = state.regions[id]!.units.elves!;
      const hits = rollDice(state, u.regular + u.elite, 6);
      if (hits > 0) applyCasualties(state, id, 'fp', hits, 'regularsFirst');
      log(state, null, 'event', `Return to Valinor: ${hits} Elven units sail from ${id}`);
    }
  },
});

// Lure of the Ring: a random Companion; the FP chooses Corruption=Level or to
// eliminate him (Gollum-as-Guide → +1 Corruption instead, no choice).
register('sh-char-13', {
  canPlay: (state) => !state.fellowship.hidden && state.fellowship.companions.some((c) => COMPANION_SET.has(c)),
  apply(state) {
    if (isGollumGuide(state)) { corrupt(state, 1); log(state, null, 'event', 'Lure of the Ring: Gollum guides — +1 Corruption'); return; }
    const pool = state.fellowship.companions.filter((c) => COMPANION_SET.has(c));
    const companion = withRng(state, (rng) => rng.pick(pool));
    state.pendingChoice = { owner: 'fp', kind: 'lureChoice', data: { companion, level: levelOf(companion) } };
    log(state, null, 'event', `Lure of the Ring tempts ${companion}`);
  },
});

// Challenge of the King: with Strider/Aragorn in a Gondor/Rohan Army, draw 3 Hunt
// tiles — all 3 Eyes eliminates him; otherwise the drawn Eye tiles leave the game.
function striderAragornArmy(state: GameState): { id: string; char: string } | null {
  for (const char of ['aragorn', 'strider']) {
    const id = charRegion(state, char);
    if (id && (REGIONS[id]!.nation === 'gondor' || REGIONS[id]!.nation === 'rohan') && armySide(state, id) === 'fp') return { id, char };
  }
  return null;
}
register('fp-char-14', {
  canPlay: (state) => striderAragornArmy(state) !== null,
  apply(state) {
    const who = striderAragornArmy(state);
    if (challengeOfTheKing(state)) {
      if (who) {
        const r = state.regions[who.id]!;
        r.characters = r.characters.filter((c) => c !== who.char);
        delete state.characters.inPlay[who.char];
        if (!state.characters.eliminated.includes(who.char)) state.characters.eliminated.push(who.char);
        log(state, null, 'event', `Challenge of the King: all Eyes — ${who.char} is lost`);
      }
    } else log(state, null, 'event', 'Challenge of the King: Eye tiles removed from the Hunt Pool');
  },
});

// Hordes From the East: recruit five S&E Regulars in a free S&E region adjacent to
// the eastern map edge (derived from region geometry: Far Harad / Khand / South Rhûn).
const EAST_EDGE_SE = ['far-harad', 'khand', 'south-rhun'];
register('sh-str-21', {
  canPlay: (state) => isAtWar(state, 'southrons') && state.reinforcements.southrons.regular > 0
    && EAST_EDGE_SE.some((id) => armySide(state, id) !== 'fp'),
  targets: (state) => EAST_EDGE_SE.filter((id) => armySide(state, id) !== 'fp').map((region) => ({ region })),
  applyTarget(state, _side, t) { placeUnits(state, 'southrons', t.region!, 5, 0); log(state, null, 'event', `Hordes From the East muster in ${t.region}`); },
});

// Help Unlooked For: an FP Army relieves a besieged Stronghold — a relief attack
// INTO the Stronghold the Shadow is besieging (siege model: the besieger occupies
// the Stronghold region; the FP garrison sits in its siegeBox). The Shadow rolls one
// die less per FP unit in the box (min 1). (Pre-siege-rewrite this looked for the
// besieger ADJACENT to the Stronghold and counted the region's units as the garrison.)
function besiegedFpStronghold(state: GameState, id: string): boolean {
  return REGIONS[id]!.settlement === 'Stronghold' && state.regions[id]!.besieged
    && settlementController(state, id) === 'fp' && armySide(state, id) === 'shadow';
}
function helpUnlookedForTargets(state: GameState): EventTarget[] {
  const out: EventTarget[] = [];
  for (const sh of Object.keys(state.regions)) {
    if (!besiegedFpStronghold(state, sh)) continue;
    for (const from of REGIONS[sh]!.adjacency) if (armySide(state, from) === 'fp') out.push({ from, to: sh, mode: 'attack' });
  }
  return out;
}
register('fp-str-10', {
  canPlay: (state) => helpUnlookedForTargets(state).length > 0,
  targets: helpUnlookedForTargets,
  applyTarget(state, _side, t) {
    const box = state.regions[t.to!]!.siegeBox; // the boxed FP garrison
    const garrison = box ? forceUnitCount(box) : 0;
    startBattle(state, 'fp', t.from!, t.to!, { defenderDicePenalty: garrison });
    log(state, null, 'event', `Help Unlooked For: relief attack ${t.from} → ${t.to} (Shadow −${garrison} dice)`);
  },
});

// The Spirit of Mordor: choose a Shadow Army of ≥2 Nations, roll 5 dice, hit on 5+.
function multiNationShadowArmies(state: GameState): EventTarget[] {
  const out: EventTarget[] = [];
  for (const id of Object.keys(state.regions)) {
    if (armySide(state, id) !== 'shadow') continue;
    const nations = (Object.keys(state.regions[id]!.units) as Nation[]).filter((n) => { const u = state.regions[id]!.units[n]!; return u.regular > 0 || u.elite > 0; });
    if (nations.length >= 2) out.push({ region: id });
  }
  return out;
}
register('fp-str-05', {
  canPlay: (state) => multiNationShadowArmies(state).length > 0,
  targets: multiNationShadowArmies,
  applyTarget(state, _side, t) {
    const hits = rollDice(state, 5, 5);
    if (hits > 0) applyCasualties(state, t.region!, 'shadow', hits, 'regularsFirst');
    log(state, null, 'event', `The Spirit of Mordor scores ${hits} at ${t.region}`);
  },
});

// --- The Red Arrow: advance Rohan + recruit a Rohan unit (R or E) & Leader in Edoras ----
register('fp-str-09', recruitChoiceCard('fp', [{ nation: 'rohan', region: 'edoras' }], {
  canPlay: (state) => state.nations.gondor.active,
  apply: (state) => advancePolitical(state, 'rohan', 1),
  leaders: [{ nation: 'rohan', region: 'edoras' }],
}));

// --- Hill-Trolls: replace up to two Sauron Regulars on the board with Elites ---
register('sh-str-15', {
  canPlay: (state) => isAtWar(state, 'sauron') && state.reinforcements.sauron.elite > 0
    && Object.values(state.regions).some((r) => (r.units.sauron?.regular ?? 0) > 0),
  // "Replace up to two Sauron Regulars with Elites" — the player chooses WHICH
  // Regulars (board-click a region with one), not an arbitrary first-found pair.
  repeat: 2, optionalFromStart: true,
  targets(state) {
    if (state.reinforcements.sauron.elite <= 0) return [];
    return Object.keys(state.regions)
      .filter((id) => (state.regions[id]!.units.sauron?.regular ?? 0) > 0)
      .map((region) => ({ region, figure: 'elite' as const }));
  },
  applyTarget(state, _side, t) {
    if (!t.region) return;
    const u = state.regions[t.region]!.units.sauron;
    if (!u || u.regular <= 0 || state.reinforcements.sauron.elite <= 0) return;
    u.regular--; u.elite++; state.reinforcements.sauron.regular++; state.reinforcements.sauron.elite--;
    log(state, null, 'event', `Hill-Trolls: upgraded a Sauron Regular to Elite in ${t.region}`);
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
