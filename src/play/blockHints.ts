// When the generic "why can't I do that?" map hints apply.
//
// `moveBlockReason` / `musterBlockReason` answer one specific question: "I tried to
// move or muster and nothing happened — why?" They are the right answer only while
// the player is actually doing a basic Move or Muster action during Action
// Resolution. Every other map click is a different question: placing the Ring-bearers
// on a reveal, choosing where a Companion separates to, an Event card picking its own
// targets. Answering those with a muster/move rule produces a sentence that is TRUE
// but is not why the click was refused — a revealed Fellowship clicked onto a besieged
// Minas Tirith was told "There is an enemy Army in Minas Tirith", when the real bar is
// that the Ring-bearers may not reveal into an unconquered Free Peoples City or
// Stronghold (player report 5f3q6k1f20650635).
//
// That report also settles HOW to fix it, and it is worth recording: Event cards can
// cascade into arbitrary map clicks, so writing a bespoke hint for each interaction is
// a slippery slope. Outside this window the click stays SILENT, which is what the
// placement flows already did and what the reporter asked for.
//
// Lives in its own module (rather than inline in PlayPage) so the rule is a named,
// testable thing — `scripts/probe-block-hint-window.mjs` pins it.
import type { GameState } from '../engine/types';

/** The subset of the view this decision reads. */
export type HintWindowView = Pick<GameState, 'phase' | 'pendingChoice'>;

/** Whether the generic Move/Muster refusal hints should be raised for a map click.
 *
 *  True only during Action Resolution with no other machine owning the board.
 *  `armyMove2` and `charMove2` ARE the basic move, continued on the same die, so they
 *  count; any other PendingChoice means something else is driving the map right now. */
export function basicMoveHintsApply(view: HintWindowView | null | undefined): boolean {
  if (!view || view.phase !== 'actionResolution') return false;
  const pc = view.pendingChoice;
  return !pc || pc.kind === 'armyMove2' || pc.kind === 'charMove2';
}
