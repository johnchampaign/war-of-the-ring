// Character display helpers: map internal ids (e.g. "gandalf-grey") to the proper
// card name ("Gandalf the Grey") and expose the full card def for the hover preview.
import characters from '../../assets/characters.json';

interface CharDef {
  name: string; title?: string; level: number | string; leadership?: number; nation?: string | null;
  guide?: string; becomesGuide?: string; abilities?: { name: string; text: string }[];
}
const c = characters as any;
const ALL: Record<string, CharDef> = { ...c.companions, ...c.upgrades, ...c.minions, gollum: c.gollum };

const MINION_KEYS = new Set(Object.keys(c.minions ?? {}));
/** Whether a character id is a Shadow Minion (Witch-king / Saruman / Mouth of Sauron).
 *  Minions are not Companions — they don't "separate" or activate a Nation on arrival. */
export const isMinion = (id: string): boolean => MINION_KEYS.has(id);

/** Proper card name for a character id; falls back to the id if unknown. */
export const charName = (id: string): string => ALL[id]?.name ?? id;
/** Full character card def (for the hover preview), or undefined. */
export const charDef = (id: string): CharDef | undefined => ALL[id];

/** Every character's own mark. First initials alone were not enough — Gandalf and
 *  Gimli were both a bare "G" and so indistinguishable on the map (player report
 *  134422574z465h4b). Each figure now carries a mark unique to it: two letters where
 *  an initial collides, and the Witch-king keeps the Eye he already had. Letters
 *  rather than pictographs throughout, because emoji render at wildly different sizes
 *  and weights across platforms and these discs are ~16px across — the one Eye is
 *  established and legible, a whole alphabet of them would not be. The Gandalfs and
 *  the Aragorn line are told apart by INK as well as letters: the White is white, the
 *  Grey is grey, the crowned Aragorn gold against Strider's plain steel. */
const CHAR_MARK: Record<string, { label: string; ink?: string }> = {
  'gandalf-grey': { label: 'Gg', ink: '#c9c9c9' },
  'gandalf-white': { label: 'Gw', ink: '#ffffff' },
  gimli: { label: 'Gi' },
  legolas: { label: 'Le' },
  boromir: { label: 'Bo' },
  strider: { label: 'St', ink: '#cfd6e0' },
  aragorn: { label: 'Ar', ink: '#ffd86a' },
  meriadoc: { label: 'Me' },
  peregrin: { label: 'Pe' },
  gollum: { label: 'Go', ink: '#b6e3a8' },
  saruman: { label: 'Sa' },
  'mouth-of-sauron': { label: 'Mo' },
  'witch-king': { label: '👁' },
  nazgul: { label: 'N' },
};
/** The map mark for a character, if it has a deliberate one. */
export const charMark = (id: string): { label: string; ink?: string } | undefined => CHAR_MARK[id];
/** Every mark, for the probe that keeps them unique. */
export const ALL_CHAR_MARKS = CHAR_MARK;
