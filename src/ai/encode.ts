// encode — a fixed-length board encoding for the learned value net (valueNet.ts).
//
// Every entry is a small non-negative integer (0..255), so a position is stored as a
// Uint8Array: ~1.3 KB, which keeps a self-play corpus of a million positions in memory.
// The net standardizes the inputs itself. Public information only: the Fellowship's
// `location` is the last-known region, hands and draw piles appear as sizes, and the
// Hunt pool as its (public) tile mix. So the encoding of a player's redacted view
// equals the encoding of the true state, apart from fields the view hides.
//
// Changing the layout invalidates stored data and trained nets: bump ENCODING_VERSION.
import type { GameState, Side, Nation, RegionId, DieFace } from '../engine/types';
import { REGION_IDS, NATIONS_DEF, MINIONS, STANDARD_TILE_LIST, levelOf } from '../engine/data';
import { MORDOR_ENTRANCES } from '../engine/fellowship';
import { dist } from './wotrAI';

export const ENCODING_VERSION = 1;

const NATIONS = Object.keys(NATIONS_DEF) as Nation[];
const FP_NATION = new Set(NATIONS.filter((n) => NATIONS_DEF[n].side === 'FreePeoples'));
const FACES: DieFace[] = ['character', 'army', 'muster', 'event', 'armyMuster', 'will', 'eye'];
const PHASES = ['fellowship', 'huntAllocation', 'actionRoll', 'actionResolution'];

/** Per-region channels, in order. */
export const REGION_CHANNELS = [
  'fpReg', 'fpElite', 'fpLeaders', 'fpChars', 'shReg', 'shElite', 'nazgul', 'shChars',
  'ctrlFp', 'ctrlSh', 'besieged', 'fellowshipHere',
];

const GLOBAL_NAMES: string[] = [
  'turn', ...PHASES.map((p) => `phase.${p}`), 'fpToMove',
  ...FACES.map((f) => `dice.fp.${f}`), ...FACES.map((f) => `dice.sh.${f}`), 'used.fp', 'used.sh',
  'hunt.box', 'hunt.fpDice', 'hunt.pool', 'hunt.poolSum', 'hunt.poolEyes', 'hunt.poolReveal',
  'rings.fp', 'rings.sh',
  'fs.progress', 'fs.hidden', 'fs.corruption', 'fs.mordorStep', 'fs.toGo', 'fs.companions', 'fs.compLevels',
  'chars.fpOut', 'chars.fpDead', 'chars.minions', 'chars.entered',
  ...NATIONS.flatMap((n) => [`nat.${n}.step`, `nat.${n}.active`]),
  ...NATIONS.flatMap((n) => [`rf.${n}.reg`, `rf.${n}.elite`, `rf.${n}.leader`]), 'rf.nazgul',
  'hand.fp', 'hand.sh', 'draw.fp.char', 'draw.fp.strat', 'draw.sh.char', 'draw.sh.strat', 'table.fp', 'table.sh',
  'vp.fp', 'vp.sh', 'huntMin1',
];

export const INPUT_NAMES: string[] = [
  ...REGION_IDS.flatMap((r) => REGION_CHANNELS.map((c) => `${r}.${c}`)),
  ...GLOBAL_NAMES,
];
export const INPUT_SIZE = INPUT_NAMES.length;

const clamp = (x: number): number => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Encode `state` into `out` (allocated if absent). */
export function encode(state: GameState, out: Uint8Array = new Uint8Array(INPUT_SIZE)): Uint8Array {
  let k = 0;
  const put = (x: number): void => { out[k++] = clamp(x); };
  const fs = state.fellowship;
  const fsAt = fs.mordor === null ? fs.location : null;
  for (const id of REGION_IDS) {
    const r = state.regions[id as RegionId];
    let fpR = 0, fpE = 0, shR = 0, shE = 0;
    for (const [n, u] of Object.entries(r.units) as [Nation, { regular: number; elite: number }][]) {
      if (!u) continue;
      if (FP_NATION.has(n)) { fpR += u.regular; fpE += u.elite; } else { shR += u.regular; shE += u.elite; }
    }
    let fpC = 0, shC = 0;
    for (const c of r.characters) if (MINIONS[c]) shC++; else fpC++;
    put(fpR); put(fpE); put(r.leaders); put(fpC); put(shR); put(shE); put(r.nazgul); put(shC);
    put(r.control === 'fp' ? 1 : 0); put(r.control === 'shadow' ? 1 : 0); put(r.besieged ? 1 : 0);
    put(fsAt === id ? 1 : 0);
  }
  // globals — must follow GLOBAL_NAMES exactly
  put(state.turn);
  for (const p of PHASES) put(state.phase === p ? 1 : 0);
  put(state.currentPlayer === 'fp' ? 1 : 0);
  for (const side of ['fp', 'shadow'] as Side[]) for (const f of FACES) put(state.dice[side].filter((d) => d === f).length);
  put(state.usedDice.fp.length); put(state.usedDice.shadow.length);
  let poolSum = 0, eyes = 0, reveal = 0;
  for (const i of state.hunt.pool) {
    const t = STANDARD_TILE_LIST[i];
    if (!t) continue;
    if (t.value === 'eye') eyes++; else if (typeof t.value === 'number') poolSum += t.value;
    if (t.reveal) reveal++;
  }
  put(state.hunt.box); put(state.hunt.fpDiceInBox); put(state.hunt.pool.length); put(poolSum); put(eyes); put(reveal);
  put(state.elvenRings.filter((x) => x === 'fp').length); put(state.elvenRings.filter((x) => x === 'shadow').length);
  const toGo = fs.mordor !== null ? 0 : Math.max(0, Math.min(...MORDOR_ENTRANCES.map((e) => dist(fs.location, e))) - fs.progress);
  let lv = 0;
  for (const c of fs.companions) lv += Math.min(4, levelOf(c));
  put(fs.progress); put(fs.hidden ? 1 : 0); put(fs.corruption); put(fs.mordor === null ? 0 : fs.mordor + 1);
  put(toGo); put(fs.companions.length); put(lv);
  const inPlay = Object.keys(state.characters.inPlay);
  put(inPlay.filter((c) => !MINIONS[c]).length); put(state.characters.eliminated.length);
  put(inPlay.filter((c) => MINIONS[c]).length); put(state.characters.entered.length);
  for (const n of NATIONS) { put(state.nations[n].step); put(state.nations[n].active ? 1 : 0); }
  let naz = 0;
  for (const n of NATIONS) {
    const rf = state.reinforcements[n];
    put(rf.regular); put(rf.elite); put(rf.leader);
    naz += rf.nazgul ?? 0;
  }
  put(naz);
  const cf = state.cards.fp, cs = state.cards.shadow;
  put(cf.hand.length); put(cs.hand.length);
  put(cf.draw.character.length); put(cf.draw.strategy.length); put(cs.draw.character.length); put(cs.draw.strategy.length);
  put(cf.table.length); put(cs.table.length);
  put(state.victoryPoints.fp ?? 0); put(state.victoryPoints.shadow ?? 0);
  put(state.flags.huntMin1ThisTurn ? 1 : 0);
  if (k !== INPUT_SIZE) throw new Error(`encode: wrote ${k} of ${INPUT_SIZE}`);
  return out;
}

