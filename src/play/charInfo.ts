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
