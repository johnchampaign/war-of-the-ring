// Structured append-only log — framework log-format v2 (GameLogEntry). Every
// entry flows through this choke point: appendGameLog stamps a monotonic `seq`
// (stable across capping) and we cap the in-state log at LOG_CAP entries.
// side=null => public. side set => private to that side (secret:true), matching
// the historical WotR semantic; adapter/redact.ts filters on `secret`.
import { appendGameLog } from 'digital-boardgame-framework';
import type { GameState, Side } from './types';

const LOG_CAP = 500;

/** A side's name as the subject of a log line — "Free Peoples", "Shadow". */
export const sideName = (s: Side): string => (s === 'fp' ? 'Free Peoples' : 'Shadow');
/** The log speaks in the present tense with its subject named ("Shadow moves…",
 *  "Free Peoples capture…"; player reports 536w3k2o504c6s6i, 4w1r36061y2k1v5s).
 *  "Free Peoples" takes the plural verb, as the rest of the log already does
 *  ("Free Peoples play", "Free Peoples draw"); "Shadow" the singular. */
export function sideDoes(s: Side, verb: string): string {
  if (s === 'fp') return `Free Peoples ${verb}`;
  return `Shadow ${/(s|sh|ch|x)$/.test(verb) ? `${verb}es` : `${verb}s`}`;
}

/** "A", "A and B", "A, B and C" — the figures a log line names as its subject. */
export function andList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Every Corruption change is logged in one voice: "The Ring-bearers suffer N
 *  Corruption" / "The Ring-bearers shed N Corruption", with the running total
 *  (player report 5540322n1d113g2o — "shed" rather than the rulebook's "heal",
 *  which doesn't fit "Corruption" grammatically). Applies the clamped change, logs
 *  only an actual change, and returns it. `why` is an optional trailing clause. */
export function sufferCorruption(state: GameState, n: number, why = ''): number {
  const before = state.fellowship.corruption;
  state.fellowship.corruption = Math.min(12, before + Math.max(0, n));
  const d = state.fellowship.corruption - before;
  if (d > 0) log(state, null, 'hunt', `The Ring-bearers suffer ${d} Corruption${why ? ` ${why}` : ''} (Total: ${state.fellowship.corruption})`);
  return d;
}
export function shedCorruption(state: GameState, n: number, why = ''): number {
  const before = state.fellowship.corruption;
  state.fellowship.corruption = Math.max(0, before - Math.max(0, n));
  const d = before - state.fellowship.corruption;
  if (d > 0) log(state, null, 'hunt', `The Ring-bearers shed ${d} Corruption${why ? ` ${why}` : ''} (Total: ${state.fellowship.corruption})`);
  return d;
}

export function log(state: GameState, side: Side | null, kind: string, msg: string, payload?: unknown): void {
  appendGameLog(state.log, {
    turn: state.turn,
    phase: state.phase,
    side,
    kind,
    msg,
    ...(payload !== undefined ? { payload } : {}),
    ...(side != null ? { secret: true as const } : {}),
  }, LOG_CAP);
}

/** A card entering a hand, logged publicly — WHICH deck and WHY, never the card's
 *  identity (that stays secret). Drawing used to be silent, so a hand that grew
 *  mid-turn was unexplainable from the log: a player audited the Free Peoples' opening
 *  hand, found it playing more cards than it had drawn, and neither he nor we could
 *  reconstruct where they came from (report 1y0753: it was King Brand's Men, whose own
 *  text draws a card). Every draw now says so. */
export function logCardDraw(state: GameState, side: Side, deck: 'character' | 'strategy', drew: boolean, reason?: string): void {
  const d = deck === 'character' ? 'Character' : 'Strategy';
  log(state, null, 'event', drew
    ? `${sideDoes(side, 'draw')} a ${d} Event card${reason ? ` (${reason})` : ''}`
    : `${sideName(side)} cannot draw — the ${d} deck is empty`);
}

/** Record a transient informational notice for the UI to pop once (public).
 *  `title` is the heading the popup wears. It used to be hardcoded "A Nation is
 *  Roused", so Athelas's healing roll and the Challenge of the King both announced
 *  themselves as a nation going to war (player report 1q205c2371642z0l). */
export function notify(state: GameState, msg: string, title?: string): void {
  if (!state.notices) state.notices = [];
  const seq = (state.notices[state.notices.length - 1]?.seq ?? 0) + 1;
  state.notices.push({ seq, msg, ...(title ? { title } : {}) });
}
