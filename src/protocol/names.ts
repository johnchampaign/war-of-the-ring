// names — WotR Bot Protocol vocabulary (behindmedia/wotr-protocol, vocabulary-0.1) <-> our ids.
//
// The protocol's keys are ours almost everywhere; the exceptions are listed here.
import type { Side, Nation, DieFace, RegionId } from '../engine/types';
import { STANDARD_TILE_LIST } from '../engine/data';

export type PSide = 'FREE_PEOPLES' | 'SHADOW';
export const sideOf = (p: PSide): Side => (p === 'SHADOW' ? 'shadow' : 'fp');
export const pSide = (s: Side): PSide => (s === 'shadow' ? 'SHADOW' : 'FREE_PEOPLES');

const REGION_P2O: Record<string, string> = { 'northern-rovanion': 'northern-rhovanion', 'southern-rovanion': 'southern-rhovanion' };
const REGION_O2P: Record<string, string> = Object.fromEntries(Object.entries(REGION_P2O).map(([p, o]) => [o, p]));
export const region = (p: string): RegionId => (REGION_P2O[p] ?? p) as RegionId;
export const pRegion = (o: string): string => REGION_O2P[o] ?? o;

const CHAR_P2O: Record<string, string> = { 'gandalf-the-grey': 'gandalf-grey', 'gandalf-the-white': 'gandalf-white' };
const CHAR_O2P: Record<string, string> = Object.fromEntries(Object.entries(CHAR_P2O).map(([p, o]) => [o, p]));
export const character = (p: string): string => CHAR_P2O[p] ?? p;
export const pCharacter = (o: string): string => CHAR_O2P[o] ?? o;

/** Cards: the protocol says `-strat-`, we say `-str-`. */
export const card = (p: string): string => p.replace('-strat-', '-str-');
export const pCard = (o: string): string => o.replace('-str-', '-strat-');

const NATION_P2O: Record<string, Nation> = {
  DWARVES: 'dwarves', ELVES: 'elves', GONDOR: 'gondor', NORTH: 'north', ROHAN: 'rohan',
  ISENGARD: 'isengard', SAURON: 'sauron', SOUTHRONS_EASTERLINGS: 'southrons',
} as Record<string, Nation>;
const NATION_O2P: Record<string, string> = Object.fromEntries(Object.entries(NATION_P2O).map(([p, o]) => [o, p]));
export const nation = (p: string): Nation => { const n = NATION_P2O[p]; if (!n) throw new Error(`unknown nation ${p}`); return n; };
export const pNation = (o: string): string => NATION_O2P[o] ?? o;

const FACE_P2O: Record<string, DieFace> = {
  CHARACTER: 'character', ARMY: 'army', MUSTER: 'muster', ARMY_MUSTER: 'armyMuster', EVENT: 'event',
  WILL_OF_THE_WEST: 'will', EYE: 'eye',
};
const FACE_O2P: Record<string, string> = Object.fromEntries(Object.entries(FACE_P2O).map(([p, o]) => [o, p]));
export const face = (p: string): DieFace => { const f = FACE_P2O[p]; if (!f) throw new Error(`unknown die face ${p}`); return f; };
export const pFace = (o: string): string => FACE_O2P[o] ?? o;

/** Special Hunt tiles: we key them by the Event card that brings them in. */
const SPECIAL_P2O: Record<string, string> = {
  'elven-cloaks': 'fp-char-01', 'elven-rope': 'fp-char-02', 'phial-of-galadriel': 'fp-char-03', 'smeagol-helps-nice-master': 'fp-char-04',
  'shelobs-lair': 'sh-char-01', 'the-ring-is-mine': 'sh-char-02', 'on-on-they-went': 'sh-char-03', 'give-it-to-uss': 'sh-char-04',
};
export const isSpecialTile = (p: string): boolean => p in SPECIAL_P2O;
export const specialTile = (p: string): string => SPECIAL_P2O[p]!;

/** Standard Hunt tiles: protocol key -> an index into STANDARD_TILE_LIST. `eye-N`, `X-N`
 *  (no reveal), `Xr` / `Xr-N` (reveal). Each key gets its own index. */
const STD_INDEX: Record<string, number> = (() => {
  const keys = ['eye-1', 'eye-2', 'eye-3', 'eye-4', '3-1', '3-2', '3-3', '2-1', '2-2', '1-1', '1-2', '2r', '1r-1', '1r-2', '0r-1', '0r-2'];
  const taken = new Set<number>();
  const out: Record<string, number> = {};
  for (const k of keys) {
    const eye = k.startsWith('eye');
    const m = /^(\d)(r?)/.exec(k);
    const value = eye ? 'eye' : Number(m![1]);
    const reveal = !eye && m![2] === 'r';
    const i = STANDARD_TILE_LIST.findIndex((t, j) => !taken.has(j) && t.value === value && (eye || !!t.reveal === reveal));
    if (i < 0) throw new Error(`no standard Hunt tile for ${k}`);
    taken.add(i);
    out[k] = i;
  }
  return out;
})();
export const standardTile = (p: string): number => { const i = STD_INDEX[p]; if (i === undefined) throw new Error(`unknown Hunt tile ${p}`); return i; };
