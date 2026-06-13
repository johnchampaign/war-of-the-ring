// Bringing Shadow Minions into play (rules-spec §5, character cards). A Muster die
// places the Witch-king / Saruman / the Mouth of Sauron when their card condition
// is met; each adds +1 Action die while in play (dice.poolSize reads
// characters.entered). The Witch-king also activates all Free Peoples Nations.
import type { GameState, Nation, RegionId } from './types';
import { FP_NATIONS } from './types';
import { REGIONS } from './data';
import { settlementController, armySide } from './armies';
import { activateNation, isAtWar } from './politics';
import { log } from './log';

export type Minion = 'witch-king' | 'saruman' | 'mouth-of-sauron';
export const MINION_IDS: Minion[] = ['witch-king', 'saruman', 'mouth-of-sauron'];

const allFpAtWar = (state: GameState): boolean => FP_NATIONS.every((n) => isAtWar(state, n));
const hasSauronUnit = (state: GameState, id: RegionId): boolean => {
  const u = state.regions[id]!.units.sauron;
  return !!u && (u.regular + u.elite) > 0;
};

/** Whether `minion` may be brought into play right now. */
export function canBringMinion(state: GameState, minion: Minion): boolean {
  if (state.characters.entered.includes(minion)) return false;
  switch (minion) {
    case 'witch-king':
      return isAtWar(state, 'sauron') && FP_NATIONS.some((n) => isAtWar(state, n)) && entryRegion(state, minion) !== null;
    case 'saruman':
      return isAtWar(state, 'isengard') && settlementController(state, 'orthanc') === 'shadow';
    case 'mouth-of-sauron':
      return (state.fellowship.mordor !== null || allFpAtWar(state)) && entryRegion(state, minion) !== null;
  }
}

/** A valid placement region for a minion, or null. */
export function entryRegion(state: GameState, minion: Minion): RegionId | null {
  if (minion === 'saruman') return settlementController(state, 'orthanc') === 'shadow' ? 'orthanc' : null;
  if (minion === 'witch-king') {
    for (const id of Object.keys(state.regions)) {
      if (armySide(state, id) === 'shadow' && hasSauronUnit(state, id)) return id;
    }
    return null;
  }
  // Mouth of Sauron: any unconquered Sauron Stronghold.
  for (const id of Object.keys(state.regions)) {
    const def = REGIONS[id]!;
    if (def.settlement === 'Stronghold' && def.nation === 'sauron' && settlementController(state, id) === 'shadow') return id;
  }
  return null;
}

/** Place a minion into play in `region` (must satisfy its condition). */
export function bringMinion(state: GameState, minion: Minion, region: RegionId): boolean {
  if (!canBringMinion(state, minion)) return false;
  if (region !== entryRegion(state, minion) && minion !== 'mouth-of-sauron' && minion !== 'witch-king') return false;
  state.characters.entered.push(minion);
  state.regions[region]!.characters.push(minion);
  if (minion === 'witch-king') for (const n of FP_NATIONS as Nation[]) activateNation(state, n);
  log(state, null, 'muster', `${minion} enters play at ${region}` + (minion === 'witch-king' ? ' (all FP Nations activated)' : ''));
  return true;
}
