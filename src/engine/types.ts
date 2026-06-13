// War of the Ring — engine state types. PURE data: plain JSON-able values only,
// no DOM, no framework imports (the adapter is the only file that imports the
// framework). All randomness flows through the framework Rng (serialized into
// `rngState`); all turn-boundary serialization through the codec. See
// docs/rules-spec.md for the rules these model.

export type Side = 'fp' | 'shadow';

// Nation ids (match assets/map.json / characters.json).
export type Nation =
  | 'dwarves' | 'elves' | 'gondor' | 'north' | 'rohan' // Free Peoples
  | 'sauron' | 'isengard' | 'southrons';               // Shadow

export const FP_NATIONS: Nation[] = ['dwarves', 'elves', 'gondor', 'north', 'rohan'];
export const SHADOW_NATIONS: Nation[] = ['sauron', 'isengard', 'southrons'];

export type RegionId = string;     // assets/map.json region ids
export type CharacterId = string;  // assets/characters.json ids

// --- Action dice ---------------------------------------------------------
// Faces differ by side; we model the resolved face after a roll.
export type DieFace =
  | 'character' | 'army' | 'muster' | 'event' | 'armyMuster'
  | 'will'   // Free Peoples special (Will of the West)
  | 'eye';   // Shadow special (Eye of Sauron)

// --- Per-region runtime state -------------------------------------------
export interface ArmyUnits {
  regular: number;
  elite: number;
}

export interface RegionState {
  /** Army units present, keyed by owning nation. */
  units: Partial<Record<Nation, ArmyUnits>>;
  /** Free Peoples Leader figures (gray) — nation-agnostic. */
  leaders: number;
  /** Shadow Nazgûl figures (excludes the Witch-king, who is a character). */
  nazgul: number;
  /** Character ids physically in this region (separated Companions, Minions,
   *  the Witch-king). The Fellowship's Companions are NOT here. */
  characters: CharacterId[];
  /** Settlement control: the side controlling this region's Settlement, or null
   *  for the original owner (the region's nation side). */
  control: Side | null;
  /** True when a Stronghold here is under siege (defenders in the siege box). */
  besieged: boolean;
}

// --- Nation political state ---------------------------------------------
export interface NationState {
  /** Steps from "At War" (0 = At War). */
  step: number;
  /** Active (can reach At War) vs passive (must be activated first). */
  active: boolean;
}

export interface Reinforcements {
  regular: number;
  elite: number;
  leader: number;
  nazgul?: number; // sauron only
}

// --- Fellowship & Hunt ---------------------------------------------------
export interface FellowshipState {
  /** Last-known region (the Ring-bearers figure location). */
  location: RegionId;
  /** Fellowship Progress counter, 0..n on the Fellowship Track. */
  progress: number;
  /** Hidden vs Revealed. */
  hidden: boolean;
  /** Corruption 0..12 (12 => Shadow wins). */
  corruption: number;
  /** Companions currently IN the Fellowship (ids). */
  companions: CharacterId[];
  /** Current Guide character id. */
  guide: CharacterId;
  /** Mordor Track step 0..5 once on the track, else null. */
  mordor: number | null;
}

export interface HuntState {
  /** Shadow dice currently in the Hunt Box (allocated + Eyes). */
  box: number;
  /** Free Peoples dice in the Hunt Box this turn (each adds +1 to Hunt rolls). */
  fpDiceInBox: number;
  /** Remaining standard Hunt Pool tiles (drawable); each entry is a tile index
   *  into the standard tile multiset. */
  pool: number[];
  /** Standard tiles already drawn this cycle (reshuffled when pool empties). */
  drawn: number[];
  /** Special tile ids currently in play (entered via events), awaiting Mordor. */
  specialsInPlay: string[];
  /** Special tile ids added to the active pool (after entering Mordor). */
  specialsInPool: string[];
}

// --- Event / Combat cards ------------------------------------------------
export type Deck = 'character' | 'strategy';

export interface CardPiles {
  // draw piles, hands, discards per deck, per side. Card ids from event-cards.json.
  draw: Record<Deck, string[]>;
  hand: string[];
  discard: Record<Deck, string[]>;
  /** "Play on the table" cards in effect, by id. */
  table: string[];
}

// --- Characters in play --------------------------------------------------
export interface CharactersState {
  /** Companions/minions separated/in play and their region (not in Fellowship). */
  inPlay: Record<CharacterId, RegionId>;
  /** Companion ids permanently eliminated. */
  eliminated: CharacterId[];
  /** Upgrades / minions that have entered (aragorn, gandalf-white, witch-king,
   *  saruman, mouth-of-sauron, gollum). */
  entered: CharacterId[];
}

// --- Phases --------------------------------------------------------------
export type Phase =
  | 'setup'
  | 'recover'        // 1: recover dice + draw events
  | 'fellowship'     // 2
  | 'huntAllocation' // 3
  | 'actionRoll'     // 4
  | 'actionResolution' // 5
  | 'victoryCheck'   // 6
  | 'gameOver';

// A pending choice the engine is waiting on (the ChoiceRequest protocol).
export interface PendingChoice {
  /** Who must decide. */
  owner: Side;
  /** What kind of choice (handler-specific). */
  kind: string;
  /** Opaque payload for the handler resolving it. */
  data?: unknown;
}

// --- The whole game state ------------------------------------------------
export interface GameState {
  schemaVersion: 1;
  /** Serialized framework Rng state. */
  rngState: number;
  turn: number;
  phase: Phase;
  /** Whose action it is during Action Resolution (alternates). */
  currentPlayer: Side;
  /** Action dice pools: rolled faces still available to spend. */
  dice: Record<Side, DieFace[]>;
  /** Dice already used this turn (set aside; recovered in phase 1). */
  usedDice: Record<Side, DieFace[]>;
  hunt: HuntState;
  /** Elven Rings: 'fp' = available to FP, 'shadow' = flipped to Shadow, 'used' = spent. */
  elvenRings: Array<'fp' | 'shadow' | 'used'>;
  fellowship: FellowshipState;
  characters: CharactersState;
  regions: Record<RegionId, RegionState>;
  nations: Record<Nation, NationState>;
  reinforcements: Record<Nation, Reinforcements>;
  cards: Record<Side, CardPiles>;
  victoryPoints: Record<Side, number>;
  /** Per-turn flags (e.g. fellowship moved count) reset in phase 1. */
  flags: {
    fellowshipDeclaredOrMovedThisTurn: boolean;
    fpUsedElvenRingThisTurn: boolean;
    shadowUsedElvenRingThisTurn: boolean;
    /** Set in phase 1 from last turn's Fellowship moves: forces Shadow to place
     *  ≥1 Hunt die this turn (rules-spec §3 phase 3). */
    huntMin1ThisTurn: boolean;
  };
  pendingChoice: PendingChoice | null;
  /** Winner once decided. */
  winner: Side | null;
  winReason: string | null;
  /** Structured turn log (public + side-tagged entries). */
  log: LogEntry[];
}

export interface LogEntry {
  turn: number;
  /** null = public; otherwise only visible to this side in redacted views. */
  side: Side | null;
  kind: string;
  msg: string;
}
