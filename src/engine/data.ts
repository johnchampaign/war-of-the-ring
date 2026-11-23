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

/** Display names for the eight Nations. The engine's ids are not words a player should
 *  read, and one of them is not even a name: the Nation is "Southrons & Easterlings",
 *  never "Southrons" (player report 1s2u180x0p6e5i0f). Engine-authored sentences (block
 *  hints, refusals) reach the player verbatim, so they name Nations through this. */
const NATION_NAME: Record<string, string> = {
  dwarves: 'Dwarves', elves: 'Elves', gondor: 'Gondor', north: 'North', rohan: 'Rohan',
  sauron: 'Sauron', isengard: 'Isengard', southrons: 'Southrons & Easterlings',
};
export const nationName = (n: string): string => NATION_NAME[n] ?? n;
// The Elves, the Dwarves and the Southrons & Easterlings are peoples, so they take a
// plural verb and, in board hints, the article the hints use for the Sides too: "The
// Elves are not At War — their units…", never "Elves is … its units" (player reports
// 674z4l1n0w1v1l24, 0w154y2h1j4c0b2w). The game log keeps the bare names.
const PLURAL_NATIONS = new Set(['dwarves', 'elves', 'southrons']);
/** Whether these Nations, as one subject, take a plural verb. */
export const nationsArePlural = (ns: readonly string[]): boolean =>
  ns.length !== 1 || PLURAL_NATIONS.has(ns[0]!);
/** A Nation mid-sentence, with its article: "the Elves", "Gondor". */
export const theNation = (n: string): string => (PLURAL_NATIONS.has(n) ? 'the ' : '') + nationName(n);
/** Nations mid-sentence: "the Elves", "Rohan and the Dwarves". */
export function nationList(ns: string | readonly string[]): string {
  const list = (typeof ns === 'string' ? [ns] : ns).map(theNation);
  return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
/** Nations as a sentence's subject: "The Elves", "Rohan and the Dwarves". */
export function nationSubject(ns: string | readonly string[]): string {
  const joined = nationList(ns);
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

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

/**
 * Switches for following another rules engine's game (set only by protocol/wotr-protocol-bot.mjs while it follows a
 * referee's game; all off otherwise, so this engine plays as ever for itself):
 * - askEveryCombatCard: every Combat card question is asked, also of a side with no card to play ("no card" its only
 *   option: the WotR Bot Protocol's hidden passes, so that no question skipped tells about a hand).
 * - ownSideLeadership: only a side's own Characters lend an Army Leadership (a Companion left in a region with a
 *   Shadow Army, a Hobbit or Gandalf of no Nation, adds none to the Shadow's re-roll).
 * - scoutsIntoSiege: no longer used: this engine now offers Scouts' "or withdraw into a siege" itself.
 * - sarumanRecruitIn: the Isengard Settlements the Voice of Saruman recruits in, in that order (the followed game's,
 *   when the Regulars run short or a Settlement is full), or null (all of them, as ever).
 * - nazgulStrikeAsPrinted: The Nazgûl Strike!'s "you may either discard … or roll for the Hunt" is asked also with no card to
 *   discard, and may be declined (nazgulStrike with `decline`); its Hunt is a Hunt roll, as if the Fellowship moved.
 * - rageStacksAfter: Rage of the Dunlendings moves its up to four units whatever the stacking limit, the excess removed
 *   after the card (as the followed game does).
 * - everyNazgul: the "move any or all of the Nazgûl" cards have room for every Nazgûl moved one by one (this engine
 *   stops at six moves).
 * - forfeitedLeadership: Mighty Attack's forfeit, the Leadership of the Companion the followed game's player chose
 *   ("forfeit the Leadership of one Companion"; this engine forfeits 1), or null.
 * - countedRecruits: Many Kings / Pits of Mordor place a target's `count` of Regulars (the followed game's player
 *   chose how many when they run short; this engine places two where it can).
 * - musterOverLimit: a Muster die may recruit into a region at the stacking limit, the excess removed after the
 *   action (as the followed game does; this engine refuses the recruit).
 * - selfHitsAll: a Combat card's hits on its own units (Relentless Assault, Onslaught) may take every unit of the Army
 *   (the followed game allows it; this engine keeps one).
 * - dreadfulFrom: Dreadful Spells is cast by the Army its target names (`from`), as the followed game's player chose
 *   (this engine picks the one with the most Nazgûl).
 * - hitsBeforeReroll: Mighty Attack / Andúril turn their miss into a hit before the Leader re-roll (the card's "before
 *   rolling the dice for your Leader re-roll"; this engine turns a miss left after the re-roll).
 * - fpCasualtyOffset: per Nation, the Free Peoples Regulars this engine would count as casualties that the followed
 *   game does not (Elites reduced take their Regular from the casualties first), or null.
 * - reduceAlways: an Elite may be "reduced" for one hit even with no Regular to replace it (it is eliminated), also with
 *   two or more hits to take (this engine then offers only its removal for two).
 * - noEffectChoices: a card's choice that changes nothing is offered too (Wisdom of Elrond's Nation At War already),
 *   as the followed game offers every option.
 * - printedCardRolls: Combat cards' rolls as their texts say: We Come to Kill's attack hits on 5+ (not at the round's
 *   odds), Mûmakil's "more total hits" counts the pre-Combat attacks' hits.
 * - revealStrongholds: the Shadow Strongholds the followed game's reveal path passed (one Hunt tile each), or null
 *   (this engine's own least-harm route; set only while applying that reveal).
 * - playAsPlayed: an Event card the followed game played is played here too, whatever this engine's own conditions
 *   for playing it (set only while applying that play).
 */
export const followOptions: {
  askEveryCombatCard: boolean; ownSideLeadership: boolean; scoutsIntoSiege: boolean; sarumanRecruitIn: string[] | null;
  nazgulStrikeAsPrinted: boolean; rageStacksAfter: boolean; everyNazgul: boolean; forfeitedLeadership: { side: string; n: number } | null; countedRecruits: boolean; musterOverLimit: boolean; selfHitsAll: boolean; dreadfulFrom: boolean; hitsBeforeReroll: boolean; fpCasualtyOffset: Record<string, number> | null; revealStrongholds: number | null; reduceAlways: boolean; noEffectChoices: boolean; printedCardRolls: boolean; playAsPlayed: boolean;
} = { askEveryCombatCard: false, ownSideLeadership: false, scoutsIntoSiege: false, sarumanRecruitIn: null, nazgulStrikeAsPrinted: false, rageStacksAfter: false, everyNazgul: false, forfeitedLeadership: null, countedRecruits: false, musterOverLimit: false, selfHitsAll: false, dreadfulFrom: false, hitsBeforeReroll: false, fpCasualtyOffset: null, revealStrongholds: null, reduceAlways: false, noEffectChoices: false, printedCardRolls: false, playAsPlayed: false };

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
