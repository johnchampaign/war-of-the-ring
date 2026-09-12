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
// Not a Nation, but the same job: a lowercase 'shadow' in a log line is the SIDE.
const SIDE_WORD: Record<string, string> = { shadow: 'Shadow' };

export const regionName = (id: string): string => REGION_NAME.get(id) ?? id;

/** The `side` printed in the card data is an id-ish token ('FreePeoples'). Card views
 *  showed it raw and upper-cased — "FREEPEOPLES · INIT 4" (player report
 *  6z0g5z6r476e3j20). */
export const cardSideName = (side?: string): string => (side === 'Shadow' ? 'Shadow' : side === 'FreePeoples' ? 'Free Peoples' : (side ?? ''));
/** "Free Peoples · Initiative 4" — the one line every card view shows under the name. */
export const cardSideLine = (side?: string, initiative?: number): string =>
  `${cardSideName(side)} · Initiative ${initiative ?? '–'}`;
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
// "Recruited 0R/1E north in carrock" is spreadsheet notation, and it sits right next
// to the spelled-out "Recruited a north Leader in carrock" from the very same card
// (player report 6851284o1n1n151j). Spell the force out instead, keeping the Nation
// in front of the unit type the way the Leader line already does. Done on the DISPLAY
// side so every recruit log line — engine muster, Event card, Faramir — reads the
// same, past games included.
const RECRUIT = /\b(\d+)R\/(\d+)E(?:\/(\d+)L)?( \+ Leader)?\s+([a-z][a-z-]*)\b/g;
const an = (name: string): string => (/^[AEIOU]/.test(name) ? 'an' : 'a');
const unitPhrase = (n: number, nation: string, type: string): string =>
  (n === 1 ? `${an(nation)} ${nation} ${type}` : `${n} ${nation} ${type}s`);
function recruitPhrase(regular: number, elite: number, leaders: number, nationId: string): string {
  const nation = NATION_NAME[nationId] ?? nationId;
  const parts: string[] = [];
  if (regular > 0) parts.push(unitPhrase(regular, nation, 'Regular'));
  if (elite > 0) parts.push(unitPhrase(elite, nation, 'Elite'));
  if (leaders > 0) parts.push(unitPhrase(leaders, nation, 'Leader'));
  if (!parts.length) return `nothing for ${nation}`;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// A side's id is not a word a player should ever read. Engine log lines name the side
// now, but every game already logged says "fp captured Minas Morgul" / "fp plays combat
// card …" (player reports 252i1t0s6j6b6o5y, 0l314z0n0j2n3b5q), and the log is replayed
// from saved state — so the display side fixes those up too.
const SIDE_ID = /\bfp\b/g;

export function prettify(msg: string): string {
  if (!msg) return msg;
  msg = msg.replace(SIDE_ID, 'Free Peoples');
  // Before the id pass, while the Nation is still a bare lowercase id.
  let out = msg.replace(RECRUIT, (_m, r: string, e: string, l: string | undefined, plusLeader: string | undefined, nation: string) =>
    recruitPhrase(Number(r), Number(e), Number(l ?? 0) + (plusLeader ? 1 : 0), nation));
  out = out.replace(KEBAB, (t) => lookup(t) ?? t);
  out = out.replace(WORD, (t) => (NATION_NAME[t] ?? SIDE_WORD[t] ?? (charDef(t) ? charName(t) : null) ?? (REGION_NAME.has(t) ? REGION_NAME.get(t)! : null)) ?? t);
  return out;
}
