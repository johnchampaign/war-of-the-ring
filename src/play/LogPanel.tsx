// Always-visible game log: the public turn log (moves, merges, over-stack
// removals, musters, combat, hunt) so a unit's fate is always traceable in the
// moment — e.g. "did my regular move, merge, or die?". Built from the redacted
// view.log (public entries + the viewer's own side-tagged ones), NEWEST FIRST
// (player report: "I almost always want to look at something recent").
// No hidden info: it shows exactly what the seat may see. Lines only this seat can see
// (its own side-tagged ones) carry a 🔒 so they don't read as public.
import { useState } from 'react';
import type { GameState } from '../engine/types';
import type { LogTime } from '../online/gameClient';
import { FACE } from './DiceTray';
import { prettify } from './names';
import eventCards from '../../assets/event-cards.json';

const CARD_NAME = new Map<string, string>((eventCards as { cards: { id: string; name: string }[] }).cards.map((c) => [c.id, c.name]));

/** A card-play line with only the card's NAME marked as hoverable — the rest of the
 *  line is ordinary text (player report 0g2h4249521o684f). A line that doesn't spell
 *  the name out keeps the whole line as the hover target, so it stays reachable. */
function CardLine({ text, card, onHoverCard }: { text: string; card: string; onHoverCard: (id: string | null) => void }) {
  const name = CARD_NAME.get(card);
  const at = name ? text.indexOf(name) : -1;
  const hover = (label: string) => (
    <span style={{ color: '#cfe0ff', textDecoration: 'underline dotted', textUnderlineOffset: 2, cursor: 'help' }}
      title="Hover to read this card"
      onMouseEnter={() => onHoverCard(card)} onMouseLeave={() => onHoverCard(null)}>{label}</span>
  );
  if (at < 0) return hover(text);
  return <span style={{ color: '#ddd' }}>{text.slice(0, at)}{hover(name!)}{text.slice(at + name!.length)}</span>;
}

const KIND_COLOR: Record<string, string> = {
  combat: '#e6857f', army: '#d8cfa8', muster: '#9cc77a', hunt: '#e6a3d0',
  fellowship: '#e6b85a', event: '#9fb6e6', politics: '#cbb', roll: '#8aa', victory: '#ffd23f', pass: '#889',
};

// "14:32" today, "Aug 14" earlier — the log column is narrow; the full instant
// lives in the hover title.
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The whole log as plain text, oldest first — what this seat can see, nothing more. */
export function logAsText(view: GameState): string {
  return (view.log ?? []).map((e) => {
    const who = e.actor === 'fp' ? 'FP ' : e.actor === 'shadow' ? 'SH ' : '';
    return `T${e.turn} ${who}${e.kind}: ${prettify(e.msg, e.actor)}`;
  }).join('\n');
}

/** "Copy log" for the full-log window (player report 3e6x0e1a3c643e4p). */
export function CopyLogButton({ view, style }: { view: GameState; style?: React.CSSProperties }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = () => {
    const done = (ok: boolean) => { setState(ok ? 'copied' : 'failed'); setTimeout(() => setState('idle'), 1800); };
    try { navigator.clipboard.writeText(logAsText(view)).then(() => done(true), () => done(false)); } catch { done(false); }
  };
  // A fixed line height: the ✓ glyph is taller than the letters and used to nudge the
  // button (and the layout around it) when the label changed (player report 4a5q2k245o3z6s3m).
  return <button onClick={copy} style={{ lineHeight: '16px', ...style }} title="Copy the whole game log to the clipboard">
    {state === 'copied' ? 'Copied ✓' : state === 'failed' ? 'Copy failed' : 'Copy log'}
  </button>;
}

export function LogPanel({ view, times, onHoverCard, recentTurns }: {
  view: GameState;
  /** Move-receipt times, ascending by seq (feature F). An entry's time is the
   *  FIRST stamp with seq >= entry.seq — the move whose submission produced it.
   *  Absent (older client / endpoint down) -> the log renders undated, as before. */
  times?: LogTime[];
  onHoverCard?: (id: string | null) => void;
  /** Show only this many most recent turns (the always-visible side log — player
   *  report f9lbogv5wwdn2x5k: the whole game there is clutter; the Log button in the
   *  status bar still opens all of it). Absent = the whole log. */
  recentTurns?: number;
}) {
  const log = view.log ?? [];
  // Two-pointer walk (both lists ascend in seq): stamp[i] = display time of log[i].
  let stamps: (string | null)[] | null = null;
  if (times && times.length) {
    let ti = 0;
    stamps = log.map((e) => {
      while (ti < times.length && times[ti]!.seq < e.seq) ti++;
      return ti < times.length ? times[ti]!.at : null; // newer than the last stamp = still in flight
    });
  }
  const fromTurn = recentTurns ? view.turn - recentTurns + 1 : -Infinity;
  const hidden = log.filter((e) => e.turn < fromTurn).length;
  // newest at the top — no auto-scroll needed. Older turns are dropped from the END,
  // so the index arithmetic for the stamps below stays log.length - 1 - i.
  const newestFirst = [...log].reverse().slice(0, log.length - hidden);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid #2a2418' }}>
      <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 2px', flexShrink: 0 }}>
        Game log <span style={{ textTransform: 'none', letterSpacing: 0 }}>({recentTurns ? 'recent turns, ' : ''}newest first)</span>
      </div>
      <div style={{ overflowY: 'auto', padding: '0 8px 6px', fontFamily: 'system-ui' }}>
        {newestFirst.length === 0
          ? <div style={{ fontSize: 12, color: '#776' }}>No events yet.</div>
          : newestFirst.map((e, i) => {
            const at = stamps ? stamps[log.length - 1 - i] : null;
            return (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.35, padding: '1px 0', display: 'flex', flexWrap: 'wrap', columnGap: 6 }}>
              {/* When this happened (feature F, player-clock/server-clock via the
                  transport — the engine has no clock). Only rendered when stamps
                  exist, so older games keep their exact old layout. */}
              {stamps && (
                <span title={at ? new Date(at).toLocaleString() : 'awaiting timestamp'}
                  style={{ flexShrink: 0, color: '#554', width: 38, fontSize: 10, textAlign: 'right', alignSelf: 'center' }}>
                  {at ? shortTime(at) : ''}
                </span>
              )}
              <span style={{ flexShrink: 0, color: '#665', width: 22, textAlign: 'right' }}>T{e.turn}</span>
              {/* Who acted (player report: the kind tags alone don't say whose action it was).
                  Engine/phase entries (rolls, combat rounds) have no actor — blank keeps columns aligned. */}
              <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, width: 18, color: e.actor === 'fp' ? '#7fa8e6' : e.actor === 'shadow' ? '#e6857f' : '#554' }}>
                {e.actor === 'fp' ? 'FP' : e.actor === 'shadow' ? 'SH' : ''}
              </span>
              <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: KIND_COLOR[e.kind] ?? '#998', width: 52 }}>{e.kind}</span>
              {/* A PRIVATE line — "You discard Shadows Gather face down" — reaches only its
                  own side; the opponent's log carries a nameless public twin instead. Unmarked,
                  it read as if the card were discarded face up for everyone to see (player
                  report 5vo9kqqrl81uv3n6). */}
              {e.secret && (
                <span title={`Private — only the ${e.side === 'fp' ? 'Free Peoples' : e.side === 'shadow' ? 'Shadow' : 'acting'} player sees this line`}
                  aria-label="private line" style={{ flexShrink: 0, fontSize: 10, alignSelf: 'center', cursor: 'help' }}>🔒</span>
              )}
              {e.die && <span title="action die spent" style={{ flexShrink: 0, background: (FACE[e.die] ?? { bg: '#555' }).bg, color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 8, fontWeight: 700, alignSelf: 'center' }}>{(FACE[e.die] ?? { label: e.die }).label}</span>}
              {/* A card-play entry: hover to read the card's text (report: "tell me what the AI's card does"). */}
              {/* The text takes the rest of the row, or — when the log is too narrow
                  for that (the inspector area on a 1440px screen left it ~50px, one
                  word a line) — drops to its own full-width line under the tags. */}
              <span style={{ flex: '1 1 140px', minWidth: 0 }}>
                {e.card && onHoverCard
                  ? <CardLine text={prettify(e.msg, e.actor)} card={e.card} onHoverCard={onHoverCard} />
                  : <span style={{ color: '#ddd' }}>{prettify(e.msg, e.actor)}</span>}
              </span>
            </div>
            );
          })}
        {hidden > 0 && (
          <div style={{ fontSize: 11, color: '#776', fontStyle: 'italic', paddingTop: 4 }}>
            Earlier turns: open Log in the status bar.
          </div>
        )}
      </div>
    </div>
  );
}
