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
  /** RAW siege model: when besieged, the DEFENDERS withdraw into the Stronghold's
   *  siege box (here) and the BESIEGER occupies the region's open field (`units`).
   *  Absent when not under siege. The garrison still controls the Settlement. */
  siegeBox?: { units: Partial<Record<Nation, ArmyUnits>>; leaders: number; nazgul: number; characters: CharacterId[] };
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
  /** The most recent Hunt roll (set just before drawing), stamped onto each draw. */
  lastRoll?: HuntRoll;
  /** Remaining standard Hunt Pool tiles (drawable); each entry is a tile index
   *  into the standard tile multiset. */
  pool: number[];
  /** Standard tiles already drawn this cycle (reshuffled when pool empties). */
  drawn: number[];
  /** Special tile ids currently in play (entered via events), awaiting Mordor. */
  specialsInPlay: string[];
  /** Special tile ids added to the active pool (after entering Mordor). */
  specialsInPool: string[];
  /** Special tiles drawn this cycle (reshuffled with the pool when it empties). */
  specialsDrawn: string[];
  /** Recent Hunt-tile draws (newest last, capped), for the UI's informational popup.
   *  `seq` increments per draw so the UI can show every not-yet-seen tile (even 0/
   *  blank ones). Public info — drawn tiles are open in WotR. */
  draws?: { seq: number; value: number | string; damage: number; reveal: boolean; stop?: boolean; onMordor: boolean;
    /** A Hunt that rolled but scored no successes — recorded so the popup still shows
     *  the roll (dice + box bonus) on a miss, not just on a hit. No tile is drawn. */
    miss?: boolean;
    /** The Hunt roll that produced this draw, for the informational popup (public). */
    roll?: HuntRoll }[];
}

/** A resolved Hunt roll: how many dice, the box bonus, the actual die faces, and
 *  the resulting successes. `mordor` rolls draw automatically (no dice). Public. */
export interface HuntRoll {
  level: number;
  bonus: number;
  dice: number[];
  rerolls: number[];
  successes: number;
  mordor: boolean;
}

// --- Event / Combat cards ------------------------------------------------
export type Deck = 'character' | 'strategy';

export interface CardPiles {
  // draw piles, hands, discards per deck, per side. Card ids from event-cards.json.
  draw: Record<Deck, string[]>;
  hand: string[];
  discard: Record<Deck, string[]>;
  /** Hand-limit discards — face DOWN per RAW p.20: identity hidden from the
   *  opponent (redact maps to type-only placeholders), deck type public. */
  discardFaceDown?: string[];
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

// An interactive battle in progress (rules-spec §7). The combat sub-machine
// pauses with a PendingChoice for casualty selection, the cease decision, and the
// retreat decision; `step` is where to resume.
export type CombatStep =
  | 'attackerCard' | 'defenderCard'
  | 'beginRound' | 'attackerCasualties' | 'defenderCasualties'
  | 'continueDecision' | 'retreatDecision'
  | 'siegeWithdraw' | 'siegeAdvance';

export interface PendingCombat {
  attacker: Side;
  defender: Side;
  from: RegionId;
  to: RegionId;
  round: number;
  fortified: boolean;
  step: CombatStep;
  /** Combat cards chosen at battle start (applied in round 0), or null. */
  attackerCard: string | null;
  defenderCard: string | null;
  /** Hits scored this round (attacker's hits land on the defender, vice versa). */
  atkHits: number;
  defHits: number;
  /** The dice faces rolled THIS round (for the battle popup; target = to-hit). */
  atkRoll?: { dice: number[]; rerolls: number[]; target: number };
  defRoll?: { dice: number[]; rerolls: number[]; target: number };
  /** Unit counts at battle start, to report each side's losses when it ends. */
  atkUnits0?: number;
  defUnits0?: number;
  /** RAW siege assault: the besieger occupies the region (`from`===`to`) and the
   *  DEFENDER's figures are in `to.siegeBox`. Set to the defender's side so combat
   *  reads/writes the boxed defender from the siege box instead of the region. */
  boxed?: Side;
  /** Set while a pre-combat retreat (Scouts) is paused for the owner to CHOOSE the
   *  destination — the region the retreating Army is leaving. */
  preCombatRetreatFrom?: RegionId;
  /** True for a siege assault (attacking a besieged Stronghold): round-capped, the
   *  attacker hits on 6 every round, and the defender cannot retreat. */
  siege?: boolean;
  /** Rounds remaining in this siege assault (1 normally; 3 via Grond / Uruk-hai). */
  siegeRoundsLeft?: number;
  /** Grond / The Fighting Uruk-hai: the FP may not play a Combat card in the first
   *  siege round unless a Companion is in the besieged Stronghold. */
  fpCardLock?: boolean;
  /** Help Unlooked For: the defender rolls this many fewer Combat dice (min 1 die). */
  defDicePenalty?: number;
  /** The White Rider battle-start choice: asked once; true if the FP forfeited
   *  Gandalf the White's Leadership to negate all Nazgûl Leadership this battle. */
  whiteRiderAsked?: boolean;
  whiteRiderForfeit?: boolean;
  /** Witch-king "Sorcerer": a Shadow Combat card was played in round 1 with the WK in
   *  the battle — pending the Shadow's optional matching-deck Event draw. */
  sorcererDeck?: 'character' | 'strategy';
  sorcererAsked?: boolean;
  /** Attack split (rulebook p.28): figures of the attacking Army left OUT of the
   *  battle (the rearguard). Held aside from `from` for the battle's duration and
   *  restored into `from` when it ends; they take no part and can't advance. */
  rearguard?: { units: Partial<Record<Nation, { regular: number; elite: number }>>; leaders: number; nazgul: number; characters: string[] };
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
    /** Mouth of Sauron "Messenger": a Muster die already used as an Army die this turn. */
    mouthMusterUsedThisTurn?: boolean;
    /** The Ents Awake: FP may play one Character Event card without an Action die. */
    fpFreeCharEventThisTurn?: boolean;
  };
  pendingChoice: PendingChoice | null;
  /** An interactive battle in progress, or null. */
  pendingCombat: PendingCombat | null;
  /** Winner once decided. */
  winner: Side | null;
  winReason: string | null;
  /** Structured turn log (public + side-tagged entries). */
  log: LogEntry[];
  /** Transient informational notices for the UI to pop once (e.g. a Companion
   *  rousing a Nation). Public; each has an incrementing seq so a client shows it
   *  exactly once. */
  notices?: { seq: number; msg: string }[];
  /** The most recent finished battle, for the battle-outcome popup (public). seq
   *  marks a new battle so the popup shows each once. */
  lastBattle?: {
    seq: number; from: RegionId; to: RegionId; attacker: Side; rounds: number;
    atkLosses: number; defLosses: number; captured: boolean; siege: boolean; outcome: string;
    atkRoll?: { dice: number[]; rerolls: number[]; target: number };
    defRoll?: { dice: number[]; rerolls: number[]; target: number };
  };
}

export interface LogEntry {
  turn: number;
  /** null = public; otherwise only visible to this side in redacted views. */
  side: Side | null;
  kind: string;
  msg: string;
  /** The action die spent on this action, when one was (set by the adapter dispatch
   *  for the UI; absent for free/phase log entries). */
  die?: DieFace;
  /** The event/combat card this entry refers to (id), so the UI can show its text on
   *  hover — e.g. "Shadow plays Return to Valinor". Public info (card plays are open). */
  card?: string;
  /** The player whose action produced this entry (set by the adapter dispatch).
   *  PUBLIC — who acted is open tabletop information; distinct from `side`, which
   *  controls redaction visibility. Absent for phase/engine-driven entries (rolls,
   *  phase transitions). Player report: "show which player is acting in the log". */
  actor?: Side;
}
