// Always-visible game log: the public turn log (moves, merges, over-stack
// removals, musters, combat, hunt) so a unit's fate is always traceable in the
// moment — e.g. "did my regular move, merge, or die?". Built from the redacted
// view.log (public entries + the viewer's own side-tagged ones), newest at the
// bottom, auto-scrolled. No hidden info: it shows exactly what the seat may see.
import { useEffect, useRef } from 'react';
import type { GameState } from '../engine/types';

const KIND_COLOR: Record<string, string> = {
  combat: '#e6857f', army: '#d8cfa8', muster: '#9cc77a', hunt: '#e6a3d0',
  fellowship: '#e6b85a', event: '#9fb6e6', politics: '#cbb', roll: '#8aa', victory: '#ffd23f',
};

export function LogPanel({ view }: { view: GameState }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const log = view.log ?? [];
  // Keep the newest entry in view as the log grows.
  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [log.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid #2a2418' }}>
      <div style={{ fontSize: 10, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 8px 2px', flexShrink: 0 }}>
        Game log
      </div>
      <div ref={bodyRef} style={{ overflowY: 'auto', padding: '0 8px 6px', fontFamily: 'system-ui' }}>
        {log.length === 0
          ? <div style={{ fontSize: 12, color: '#776' }}>No events yet.</div>
          : log.map((e, i) => (
            <div key={i} style={{ fontSize: 12, lineHeight: 1.35, padding: '1px 0', display: 'flex', gap: 6 }}>
              <span style={{ flexShrink: 0, color: '#665', width: 22, textAlign: 'right' }}>T{e.turn}</span>
              <span style={{ flexShrink: 0, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: KIND_COLOR[e.kind] ?? '#998', width: 52 }}>{e.kind}</span>
              <span style={{ color: '#ddd' }}>{e.msg}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
