// Human-readable names for the ids that leak into user-facing text.
//
// The engine logs and labels with ids (`minas-tirith`, `gandalf-grey`, `sh-char-03`,
// `north`, `actionResolution`) because the engine is pure data; players should
// never read them (player report 3z1w2w120v0r4h5v: "kebab case in the log and
// modals ... 'sh-char-03' ... the Phase chip says actionResolution"). Rather than
// chase every log() call, the DISPLAY side prettifies: any whole token that is a
// known region, character, card or nation id becomes its name.
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';
import { charName, charDef } from './charInfo';

const REGION_NAME = new Map<string, string>(Object.entries((mapData as { regions: Record<string, { name?: string }> }).regions).map(([id, r]) => [id, r.name ?? id]));
const CARD_NAME = new Map<string, string>((eventCards as { cards: { id: string; name: string }[] }).cards.map((c) => [c.id, c.name]));
const NATION_NAME: Record<string, string> = { dwarves: 'Dwarves', elves: 'Elves', gondor: 'Gondor', north: 'North', rohan: 'Rohan', sauron: 'Sauron', isengard: 'Isengard', southrons: 'Southrons' };

export const regionName = (id: string): string => REGION_NAME.get(id) ?? id;
export const cardName = (id: string): string => CARD_NAME.get(id) ?? id;

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup', recover: 'Recover Dice & Draw Cards', fellowship: 'Fellowship', huntAllocation: 'Hunt Allocation',
  actionRoll: 'Action Roll', actionResolution: 'Action Resolution', victoryCheck: 'Victory Check', gameOver: 'Game Over',
};
export const phaseLabel = (p: string): string => PHASE_LABEL[p] ?? p.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** Full die-face names with the right article ("an Army die", "a Character die"). */
const FACE_NAME: Record<string, string> = { character: 'Character', army: 'Army', muster: 'Muster', armyMuster: 'Army/Muster', event: 'Event', will: 'Will of the West', eye: 'Eye' };
export const faceName = (f: string): string => FACE_NAME[f] ?? f;
export const aFace = (f: string): string => { const n = faceName(f); return `${/^[AEIOU]/.test(n) ? 'an' : 'a'} ${n}`; };

// Whole-token replacement. Kebab tokens (two or more parts) are unambiguous ids;
// single lowercase words are replaced only when they are a nation, a character
// whose id is a plain word (boromir, legolas, gimli, strider, saruman, gollum...)
// or a one-word region (orthanc, moria, eastemnet, dale).
const KEBAB = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;
const WORD = /\b[a-z]{4,}\b/g;
const lookup = (id: string): string | null => {
  if (REGION_NAME.has(id)) return REGION_NAME.get(id)!;
  if (CARD_NAME.has(id)) return CARD_NAME.get(id)!;
  if (charDef(id)) return charName(id);
  if (NATION_NAME[id]) return NATION_NAME[id]!;
  return null;
};
export function prettify(msg: string): string {
  if (!msg) return msg;
  let out = msg.replace(KEBAB, (t) => lookup(t) ?? t);
  out = out.replace(WORD, (t) => (NATION_NAME[t] ?? (charDef(t) ? charName(t) : null) ?? (REGION_NAME.has(t) ? REGION_NAME.get(t)! : null)) ?? t);
  return out;
}
