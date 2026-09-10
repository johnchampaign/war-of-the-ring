// Which legal actions belong in the right-hand action LIST, and which belong on the
// MAP. Pure, so it can be tested: `scripts/probe-panel-board-split.mjs` plays full
// games and asserts the one property that matters — every legal action is reachable
// from somewhere. Strip a kind from the list without giving it a board path and you
// have made a legal action unplayable, which is a far worse bug than the clutter the
// stripping was meant to cure.
import type { WotrAction } from '../adapter/wotrAction';
import type { GameState } from '../engine/types';
import { isDecisionAction, eventChoiceInModal, isCardRecruitTarget, isCardArmyMoveTarget } from './actionText';

/** Army moves and attacks: spatial, so they are map clicks, never buttons. */
export type SpatialAction = Extract<WotrAction, { kind: 'moveArmy' | 'attack' }>;
export const isSpatial = (a: WotrAction): a is SpatialAction => a.kind === 'moveArmy' || a.kind === 'attack';

/** For every action kind the list may hide, HOW it is offered instead — a map click,
 *  or a dedicated always-visible control.
 *
 *  This is the contract the probe enforces. An action is reachable on exactly one of
 *  three surfaces: this list, the decision modal (mid-combat / mid-Hunt prompts, see
 *  `isDecisionAction`), or a path named here. One that is on none of them cannot be
 *  taken at all. Keep the descriptions accurate — they are the only written record of
 *  why each button was allowed to disappear. */
export const BOARD_PATH: Record<string, string> = {
  moveArmy: 'click the green army, then a highlighted destination',
  attack: 'click the green army then the enemy region — or, for an assault/sortie (from === to), the besieged region itself and "⚔ Assault"',
  armyMove2: 'as moveArmy, for the optional second move with the same Army die',
  moveCharacter: 'click the figure’s region, choose the figure, then a highlighted destination',
  recruitUnit: 'click a highlighted Settlement, then the bundle in the muster menu',
  bringMinion: 'click a highlighted region, then the Minion in the muster menu',
  declareFellowship: 'click a highlighted region to declare the Fellowship there',
  revealMove: 'click a highlighted region to place the revealed Ring-bearers',
  separateMove: 'click a highlighted region to place the separated Companion(s)',
  eventTarget: 'card-driven: recruits via the muster menu of the highlighted Settlement, army moves via click-army-then-destination, companion placements via the highlighted region; the decision modal for simple picks; the rest (done / assault / deck picks) stay buttons',
  useElvenRing: 'the Elven Rings pill in the status bar',
  playEvent: 'the Ents Awake prompt owns the one free Character-card play',
};

/** Whether the right-hand action list shows `a`.
 *
 *  `legal` is the whole legal-action set (some decisions are only "simple" — and so
 *  belong in the modal — relative to what else is on offer); `view` supplies the
 *  pending choice. */
export function panelShowsAction(a: WotrAction, legal: WotrAction[], view: GameState): boolean {
  return !isSpatial(a)
    // Siege ASSAULTS were buttons as well as a board click, on the theory that an attack
    // with no separate destination needed one. Once the board grew its "⚔ Assault the
    // besieged Stronghold" option the button was a duplicate, and the reporter asked for
    // it to go "for consistency with regular attacks" — every other attack is a map
    // click (report 6y3j4u31164n1c5r). Click the besieged region itself.
    && !isDecisionAction(a) && a.kind !== 'moveCharacter'
    // separateMove PLACEMENT (has a target) is a board click; the "also separate X"
    // group-add option (companion, no target) is a list button.
    && !(a.kind === 'separateMove' && !!a.target)
    // Fellowship-figure placement (declare / revealed-move) is done by clicking the
    // board (banner + highlighted regions), NOT a button — and revealMove has no
    // readable label, so it would otherwise show as raw JSON in the list.
    && a.kind !== 'revealMove' && a.kind !== 'declareFellowship'
    // The second army move (armyMove2 with from/to) is a board click now; keep only the
    // "no second move" (done) option as a button.
    && !(a.kind === 'armyMove2' && !!a.from)
    && !(a.kind === 'eventTarget' && !!a.region && !!a.companion) // card-separation destinations go on the board
    // Card RECRUITS and card ARMY MOVES are board flows too — the same muster menu and
    // move picker a Muster / Army die uses (player report 2s3p6y0x000k6b70: "Event card
    // recruitment should use that interface ... likewise all movement affected by cards").
    && !isCardRecruitTarget(a) && !isCardArmyMoveTarget(a)
    // Simple event-card picks show in the decision modal (player report: they went
    // unnoticed as buttons) — keep them out of the list to avoid duplicates.
    && !(a.kind === 'eventTarget' && eventChoiceInModal(legal))
    // Mustering is board-driven (player report: the per-Settlement recruit buttons were
    // tedious to page through): click a highlighted Settlement instead.
    && a.kind !== 'recruitUnit'
    && !(a.kind === 'playEvent' && view.pendingChoice?.kind === 'freeCharEvent') // the Ents Awake prompt owns these
    // Elven Ring uses are not Actions (they cost no die and precede the action); they
    // sit behind the status bar's Elven Rings pill (player report 5f1r022l2q5t0p0b).
    && a.kind !== 'useElvenRing'
    // Minion entries go the same way as mustering, for the same two reasons: the
    // board-click muster menu already offers them, and the Witch-king's entry list is
    // EVERY region holding a Shadow Army — which buried the rest of the list under
    // "Bring the Witch-king into play in …" buttons (report 2j4j710i000x3k0b). NB
    // `bringUpgrade` (crowning Aragorn / Gandalf the White) carries no region and has no
    // board path at all, so it stays a button.
    && a.kind !== 'bringMinion';
}
