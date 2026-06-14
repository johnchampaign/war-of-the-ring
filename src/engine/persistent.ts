// Persistent "while in play" Event-card effects (rules-spec §4). These cards are
// played onto the owner's table (cards[side].table) via EventHandler.onTable and
// keep modifying the rules until removed. Each query below reads the table at the
// relevant decision seam; the handlers in handlers/index.ts only apply the card's
// immediate part and let it persist. Pure: imports types only (no cycles).
import type { GameState, RegionId } from './types';

const onTable = (s: GameState, side: 'fp' | 'shadow', id: string): boolean =>
  s.cards[side].table.includes(id);

/** fp-str-01 "The Last Battle": Action dice used to move the Fellowship are not
 *  added to the Hunt Box (so they don't raise later Hunt rolls). */
export const fellowshipDieSkipsHuntBox = (s: GameState): boolean => onTable(s, 'fp', 'fp-str-01');

const POWER_TOO_GREAT: RegionId[] = ['lorien', 'rivendell', 'grey-havens']; // fp-str-02
const TOM_BOMBADIL: RegionId[] = ['old-forest', 'the-shire', 'buckland'];    // fp-str-03

/** fp-str-02 "A Power too Great" / fp-str-03 "The Power of Tom Bombadil": the
 *  Shadow player cannot move an Army into, or attack, the listed regions. */
export function shadowBarredFromRegion(s: GameState, region: RegionId): boolean {
  if (onTable(s, 'fp', 'fp-str-02') && POWER_TOO_GREAT.includes(region)) return true;
  if (onTable(s, 'fp', 'fp-str-03') && TOM_BOMBADIL.includes(region)) return true;
  return false;
}

/** sh-str-05 "Threats and Promises": the Free Peoples player cannot advance a
 *  passive Nation on the Political Track using a Muster Action die. */
export const threatsAndPromisesActive = (s: GameState): boolean => onTable(s, 'shadow', 'sh-str-05');

/** sh-str-03 "Denethor's Folly": the Free Peoples player cannot use Combat cards
 *  for battles fought in Minas Tirith. */
export const fpCombatCardsBarredAt = (s: GameState, region: RegionId): boolean =>
  onTable(s, 'shadow', 'sh-str-03') && region === 'minas-tirith';

/** sh-char-21 "The Palantír of Orthanc": after the Shadow plays an Event card,
 *  immediately draw another card from either Shadow deck. */
export const palantirActive = (s: GameState): boolean => onTable(s, 'shadow', 'sh-char-21');

/** sh-char-15 "Worn with Sorrow and Toil": when a Companion in the Fellowship is
 *  taken as a casualty, the Shadow also discards an FP Character Event card. */
export const wornWithSorrowActive = (s: GameState): boolean => onTable(s, 'shadow', 'sh-char-15');

/** sh-char-22 "Wormtongue": Rohan cannot be activated except by an appropriate
 *  Companion, the Fellowship being declared in Edoras/Helm's Deep, or an attack on
 *  Edoras/Helm's Deep. Given an activation trigger, may it activate Rohan? */
export function wormtongueAllowsActivation(
  s: GameState, n: string, opts: { region?: RegionId; viaCompanion?: boolean },
): boolean {
  if (n !== 'rohan' || !onTable(s, 'shadow', 'sh-char-22')) return true;
  return !!opts.viaCompanion || opts.region === 'edoras' || opts.region === 'helms-deep';
}
