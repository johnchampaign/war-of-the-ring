// Typed loaders for the static game catalogs (assets/*.json). Static board/card
// data — never goes into GameState/snapshots. The engine reads these to build the
// initial state and to resolve ids during play.
import mapRaw from '../../assets/map.json';
import charsRaw from '../../assets/characters.json';
import huntRaw from '../../assets/hunt-tiles.json';
import eventsRaw from '../../assets/event-cards.json';
import type { Nation, Side, Deck, DieFace } from './types';

// --- Map / regions / nations --------------------------------------------
export interface RegionDef {
  name: string;
  nation: Nation | null;
  /** Whose figures the `setup` block places, when the region belongs to no Nation.
   *  Osgiliath is the only case: a ruined Gondor city that sits OUTSIDE Gondor's
   *  border, yet starts the game garrisoned by 2 Gondor Regulars. Defaults to
   *  `nation` everywhere else. */
  setupNation?: Nation;
  settlement: 'Town' | 'City' | 'Stronghold' | 'Fortification' | null;
  vp: number;
  setup: { regular?: number; elite?: number; leader?: number; nazgul?: number } | null;
  adjacency: string[];
}
export interface NationDef {
  side: 'FreePeoples' | 'Shadow';
  reinforcements: { regular: number; elite: number; leader?: number; nazgul?: number };
  political: { active: boolean; startBox: number };
}

const mapData = mapRaw as unknown as {
  regions: Record<string, RegionDef>;
  nations: Record<Nation, NationDef>;
};

export const REGIONS: Record<string, RegionDef> = mapData.regions;
export const NATIONS_DEF: Record<Nation, NationDef> = mapData.nations;
export const REGION_IDS: string[] = Object.keys(REGIONS);

export const sideOfNation = (n: Nation): Side =>
  NATIONS_DEF[n].side === 'Shadow' ? 'shadow' : 'fp';

// --- Characters ----------------------------------------------------------
export interface CharacterDef {
  name: string;
  level: number | 'inf';
  leadership: number;
  nation: string | null; // 'any' | nation id | null
  dieBonus: number;
  startsInFellowship?: boolean;
  guide?: string | null;
  abilities?: { name: string; text: string }[];
}
const charsData = charsRaw as unknown as {
  companions: Record<string, CharacterDef>;
  upgrades: Record<string, CharacterDef>;
  gollum: CharacterDef;
  minions: Record<string, CharacterDef>;
};
export const COMPANIONS = charsData.companions;
export const UPGRADES = charsData.upgrades;
export const GOLLUM = charsData.gollum;
export const MINIONS = charsData.minions;
/** All starting Companions (in the Fellowship at setup). */
export const STARTING_COMPANIONS: string[] = Object.entries(COMPANIONS)
  .filter(([, c]) => c.startsInFellowship)
  .map(([id]) => id);

export function characterDef(id: string): CharacterDef | undefined {
  return COMPANIONS[id] ?? UPGRADES[id] ?? MINIONS[id] ?? (id === 'gollum' ? GOLLUM : undefined);
}
/** Which side a Character figure belongs to: Minions (Witch-king, Mouth of Sauron,
 *  Saruman) are Shadow; Companions, their upgrades, and Gollum are Free Peoples.
 *  Used so an Army move only carries its OWN side's Characters out of a region that
 *  also holds enemy figures (e.g. a stranded Companion sharing a region with a
 *  Shadow Army). */
export function characterSide(id: string): Side {
  return MINIONS[id] ? 'shadow' : 'fp';
}
/** Numeric level for movement/hunt math ('inf' Nazgûl => a large number). */
export function levelOf(id: string): number {
  const d = characterDef(id);
  if (!d) return 0;
  return d.level === 'inf' ? 99 : d.level;
}

// --- Hunt tiles ----------------------------------------------------------
export interface HuntTileDef {
  value: number | 'eye' | 'die';
  reveal: boolean;
  stop?: boolean;
  count: number;
  introducedBy?: string;
  card?: string;
}
const huntData = huntRaw as unknown as {
  standard: HuntTileDef[];
  specialFellowship: HuntTileDef[];
  specialShadow: HuntTileDef[];
};
export const HUNT_STANDARD = huntData.standard;
export const HUNT_SPECIAL_FELLOWSHIP = huntData.specialFellowship;
export const HUNT_SPECIAL_SHADOW = huntData.specialShadow;
/** Expand the standard tile multiset into a flat list of tile defs (one per
 *  physical tile) — the Hunt Pool is indices into this list. */
export const STANDARD_TILE_LIST: HuntTileDef[] = HUNT_STANDARD.flatMap((t) =>
  Array.from({ length: t.count }, () => t));

/** Special Hunt tiles keyed by the Event card that brings them into play. They
 *  join the Hunt Pool only once the Fellowship is on the Mordor Track. */
export const SPECIAL_TILE_BY_CARD: Record<string, HuntTileDef> = Object.fromEntries(
  [...HUNT_SPECIAL_FELLOWSHIP, ...HUNT_SPECIAL_SHADOW]
    .filter((t) => t.introducedBy)
    .map((t) => [t.introducedBy!, t]),
);

// --- Event cards ---------------------------------------------------------
export interface EventCardDef {
  id: string;
  name: string;
  side: 'FreePeoples' | 'Shadow';
  deck: 'Character' | 'Strategy';
  // Card initiative (bottom-left number; lower resolves first on a timing tie).
  // Usually a single number; a few cards (e.g. sh-str-07/08) print a RANGE like
  // "3-5", kept verbatim as a string. null only if genuinely unread.
  initiative: number | string | null;
  // The die face printed in the card's upper corner — the non-Event die that can play
  // it (rulebook p.21-22: a Character die plays a Character Event card, an Army die an
  // Army Event card, a Muster die a Muster Event card). An Event/Palantír die plays any
  // card regardless. Set for all 96 base cards by scripts/merge-play-via.mjs; null only
  // if a future card were added without the icon read.
  playableVia: 'character' | 'army' | 'muster' | null;
  precondition: string | null;
  eventText: string;
  discardCondition?: string;
  combat: { title: string; precondition: string | null; text: string } | null;
}
const eventsData = eventsRaw as unknown as { cards: EventCardDef[] };
export const EVENT_CARDS: EventCardDef[] = eventsData.cards;
export const EVENT_BY_ID: Record<string, EventCardDef> = Object.fromEntries(
  EVENT_CARDS.map((c) => [c.id, c]),
);
/** The Action-die faces that can play `cardId` (rulebook p.21-22), most-specific
 *  first so the scarce Event/Palantír die is spent last: the card's own printed icon
 *  (Character / Army / Muster), then the Army/Muster face when the icon is Army or
 *  Muster, then Event, then Will of the West (Free Peoples only — it may become any
 *  other result). Cards whose icon is unknown fall back to the old deck-wide
 *  approximation. Does NOT include the Mouth of Sauron's once-a-turn Muster→Army
 *  substitution; that lives in the adapter with the rest of his ability. */
export function playFacesFor(cardId: string): DieFace[] {
  const via = EVENT_BY_ID[cardId]?.playableVia
    ?? (EVENT_BY_ID[cardId]?.deck === 'Character' ? 'character' : null);
  if (via === 'character') return ['character', 'event', 'will'];
  if (via === 'army') return ['army', 'armyMuster', 'event', 'will'];
  if (via === 'muster') return ['muster', 'armyMuster', 'event', 'will'];
  return ['army', 'armyMuster', 'muster', 'event', 'will']; // unknown icon: any Strategy die
}

export function deckOf(side: Side, deck: Deck): string[] {
  const s = side === 'fp' ? 'FreePeoples' : 'Shadow';
  const d = deck === 'character' ? 'Character' : 'Strategy';
  return EVENT_CARDS.filter((c) => c.side === s && c.deck === d).map((c) => c.id);
}
