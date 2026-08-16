// Always-visible game log: the public turn log (moves, merges, over-stack
// removals, musters, combat, hunt) so a unit's fate is always traceable in the
// moment — e.g. "did my regular move, merge, or die?". Built from the redacted
// view.log (public entries + the viewer's own side-tagged ones), NEWEST FIRST
// (player report: "I almost always want to look at something recent").
// No hidden info: it shows exactly what the seat may see.
import type { GameState } from '../engine/types';
import type { LogTime } from '../online/gameClient';
import { FACE } from './DiceTray';

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

export function LogPanel({ view, times, onHoverCard }: {
  view: GameState;
  /** Move-receipt times, ascending by seq (feature F). An entry's time is the
   *  FIRST stamp with seq >= entry.seq — the move whose submission produced it.
   *  Absent (older client / endpoint down) -> the log renders undated, as before. */
  times?: LogTime[];
  onHoverCard?: (id: string | null) => void;
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
  const newestFirst = [...log].reverse(); // newest at the top — no auto-scroll needed
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid #2a2418' }}>
      <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 2px', flexShrink: 0 }}>
        Game log <span style={{ textTransform: 'none', letterSpacing: 0 }}>(newest first)</span>
      </div>
      <div style={{ overflowY: 'auto', padding: '0 8px 6px', fontFamily: 'system-ui' }}>
        {newestFirst.length === 0
          ? <div style={{ fontSize: 12, color: '#776' }}>No events yet.</div>
          : newestFirst.map((e, i) => {
            const at = stamps ? stamps[log.length - 1 - i] : null;
            return (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.35, padding: '1px 0', display: 'flex', gap: 6 }}>
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
              {e.die && <span title="action die spent" style={{ flexShrink: 0, background: (FACE[e.die] ?? { bg: '#555' }).bg, color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 8, fontWeight: 700, alignSelf: 'center' }}>{(FACE[e.die] ?? { label: e.die }).label}</span>}
              {/* A card-play entry: hover to read the card's text (report: "tell me what the AI's card does"). */}
              {e.card && onHoverCard
                ? <span style={{ color: '#cfe0ff', textDecoration: 'underline dotted', textUnderlineOffset: 2, cursor: 'help' }}
                    title="Hover to read this card"
                    onMouseEnter={() => onHoverCard(e.card!)} onMouseLeave={() => onHoverCard(null)}>{e.msg}</span>
                : <span style={{ color: '#ddd' }}>{e.msg}</span>}
            </div>
            );
          })}
      </div>
    </div>
  );
}
