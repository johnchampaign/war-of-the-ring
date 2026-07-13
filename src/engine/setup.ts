// Initial game state. createGame(seed) builds a rules-correct turn-1 starting
// position from the static catalogs (assets/*.json via data.ts). Pure: all
// randomness via the framework Rng, serialized into state.rngState.
import { Rng } from 'digital-boardgame-framework';
import type {
  GameState, RegionState, Nation, NationState, Reinforcements, Side, CardPiles,
} from './types';
import { FP_NATIONS, SHADOW_NATIONS } from './types';
import {
  REGIONS, REGION_IDS, NATIONS_DEF, STARTING_COMPANIONS, STANDARD_TILE_LIST, deckOf,
} from './data';

const ALL_NATIONS: Nation[] = [...FP_NATIONS, ...SHADOW_NATIONS];

export interface SetupOptions {
  seed: number;
}

export function createGame({ seed }: SetupOptions): GameState {
  const rng = new Rng(seed);

  // --- Regions: place starting units/leaders/nazgûl from map.json setup -----
  const regions: Record<string, RegionState> = {};
  for (const id of REGION_IDS) {
    const def = REGIONS[id]!;
    const s = def.setup;
    const region: RegionState = {
      units: {},
      leaders: 0,
      nazgul: 0,
      characters: [],
      control: null,        // null = original owner (def.nation's side)
      besieged: false,
    };
    if (s && def.nation) {
      const reg = s.regular ?? 0, el = s.elite ?? 0;
      if (reg || el) region.units[def.nation] = { regular: reg, elite: el };
      region.leaders = s.leader ?? 0;
      region.nazgul = s.nazgul ?? 0;
    }
    regions[id] = region;
  }

  // --- Nations: political position + reinforcement pools -------------------
  const nations = {} as Record<Nation, NationState>;
  const reinforcements = {} as Record<Nation, Reinforcements>;
  for (const n of ALL_NATIONS) {
    const def = NATIONS_DEF[n]!;
    // Political track has 3 boxes above "At War"; startBox 1 (top) = 3 steps to
    // At War, box 3 = 1 step. (Exact track still flagged TODO in map.json _meta.)
    nations[n] = { step: 4 - def.political.startBox, active: def.political.active };
    reinforcements[n] = {
      regular: def.reinforcements.regular,
      elite: def.reinforcements.elite,
      leader: def.reinforcements.leader ?? 0,
      ...(def.reinforcements.nazgul != null ? { nazgul: def.reinforcements.nazgul } : {}),
    };
  }

  // --- Event decks: shuffle each deck per side -----------------------------
  const makePiles = (side: Side): CardPiles => ({
    draw: {
      character: rng.shuffle(deckOf(side, 'character')),
      strategy: rng.shuffle(deckOf(side, 'strategy')),
    },
    hand: [],
    discard: { character: [], strategy: [] },
    table: [],
  });
  const cards: Record<Side, CardPiles> = { fp: makePiles('fp'), shadow: makePiles('shadow') };

  // --- Hunt Pool: 16 standard tiles (indices into STANDARD_TILE_LIST) -------
  const pool = STANDARD_TILE_LIST.map((_, i) => i);

  const state: GameState = {
    schemaVersion: 1,
    rngState: rng.serialize(),
    turn: 1,
    phase: 'recover',
    currentPlayer: 'fp',
    dice: { fp: [], shadow: [] },
    usedDice: { fp: [], shadow: [] },
    hunt: { box: 0, fpDiceInBox: 0, pool, drawn: [], specialsInPlay: [], specialsInPool: [], specialsDrawn: [] },
    elvenRings: ['fp', 'fp', 'fp'],
    fellowship: {
      location: 'rivendell',
      progress: 0,
      hidden: true,
      corruption: 0,
      companions: [...STARTING_COMPANIONS],
      guide: 'gandalf-grey',
      mordor: null,
    },
    characters: { inPlay: {}, eliminated: [], entered: [] },
    regions,
    nations,
    reinforcements,
    cards,
    victoryPoints: { fp: 0, shadow: 0 },
    flags: {
      fellowshipDeclaredOrMovedThisTurn: false,
      fpUsedElvenRingThisTurn: false,
      shadowUsedElvenRingThisTurn: false,
      huntMin1ThisTurn: false,
    },
    pendingChoice: null,
    pendingCombat: null,
    winner: null,
    winReason: null,
    log: [{ seq: 1, turn: 1, side: null, kind: 'setup', msg: 'Game created.' }],
    notices: [],
  };
  return state;
}

/** Base Action dice counts (before character bonuses): FP 4, Shadow 7. */
export const BASE_DICE: Record<Side, number> = { fp: 4, shadow: 7 };
