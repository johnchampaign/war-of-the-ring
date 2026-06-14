// Registered Event-card handlers — a representative subset of mechanically simple
// cards (heal/Corruption, political, recruit, dice). Each cites its card id from
// assets/event-cards.json. Cards not registered here stay unimplemented (not
// offered) until added. Effects modify the standard rules per the card text.
import type { GameState, Side, Nation } from '../types';
import { FP_NATIONS } from '../types';
import { withRng } from '../rng';
import { register } from './registry';
import { recruit, settlementController, armySide, unitCount, STACKING_LIMIT } from '../armies';
import { applyCasualties } from '../combat';
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
