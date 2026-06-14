// Typed loaders for the static game catalogs (assets/*.json). Static board/card
// data — never goes into GameState/snapshots. The engine reads these to build the
// initial state and to resolve ids during play.
import mapRaw from '../../assets/map.json';
import charsRaw from '../../assets/characters.json';
import huntRaw from '../../assets/hunt-tiles.json';
import eventsRaw from '../../assets/event-cards.json';
import type { Nation, Side, Deck } from './types';

// --- Map / regions / nations --------------------------------------------
export interface RegionDef {
  name: string;
  nation: Nation | null;
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
export function deckOf(side: Side, deck: Deck): string[] {
  const s = side === 'fp' ? 'FreePeoples' : 'Shadow';
  const d = deck === 'character' ? 'Character' : 'Strategy';
  return EVENT_CARDS.filter((c) => c.side === s && c.deck === d).map((c) => c.id);
}
