// Always-visible game log: the public turn log (moves, merges, over-stack
// removals, musters, combat, hunt) so a unit's fate is always traceable in the
// moment — e.g. "did my regular move, merge, or die?". Built from the redacted
// view.log (public entries + the viewer's own side-tagged ones), NEWEST FIRST
// (player report: "I almost always want to look at something recent").
// No hidden info: it shows exactly what the seat may see.
import type { GameState } from '../engine/types';
import { FACE } from './DiceTray';

const KIND_COLOR: Record<string, string> = {
  combat: '#e6857f', army: '#d8cfa8', muster: '#9cc77a', hunt: '#e6a3d0',
  fellowship: '#e6b85a', event: '#9fb6e6', politics: '#cbb', roll: '#8aa', victory: '#ffd23f', pass: '#889',
};

export function LogPanel({ view, onHoverCard }: { view: GameState; onHoverCard?: (id: string | null) => void }) {
  const log = view.log ?? [];
  const newestFirst = [...log].reverse(); // newest at the top — no auto-scroll needed
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid #2a2418' }}>
      <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 2px', flexShrink: 0 }}>
        Game log <span style={{ textTransform: 'none', letterSpacing: 0 }}>(newest first)</span>
      </div>
      <div style={{ overflowY: 'auto', padding: '0 8px 6px', fontFamily: 'system-ui' }}>
        {newestFirst.length === 0
          ? <div style={{ fontSize: 12, color: '#776' }}>No events yet.</div>
          : newestFirst.map((e, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.35, padding: '1px 0', display: 'flex', gap: 6 }}>
              <span style={{ flexShrink: 0, color: '#665', width: 22, textAlign: 'right' }}>T{e.turn}</span>
              <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: KIND_COLOR[e.kind] ?? '#998', width: 52 }}>{e.kind}</span>
              {e.die && <span title="action die spent" style={{ flexShrink: 0, background: (FACE[e.die] ?? { bg: '#555' }).bg, color: '#fff', borderRadius: 3, padding: '0 4px', fontSize: 8, fontWeight: 700, alignSelf: 'center' }}>{(FACE[e.die] ?? { label: e.die }).label}</span>}
              {/* A card-play entry: hover to read the card's text (report: "tell me what the AI's card does"). */}
              {e.card && onHoverCard
                ? <span style={{ color: '#cfe0ff', textDecoration: 'underline dotted', textUnderlineOffset: 2, cursor: 'help' }}
                    title="Hover to read this card"
                    onMouseEnter={() => onHoverCard(e.card!)} onMouseLeave={() => onHoverCard(null)}>{e.msg}</span>
                : <span style={{ color: '#ddd' }}>{e.msg}</span>}
            </div>
          ))}
      </div>
    </div>
  );
}
