// Informational popup for transient game notices (e.g. a Companion rousing a Nation
// to war). The engine records notices in state.notices, each with an incrementing
// seq; this tracks the highest seq shown so each notice pops exactly once. Waits
// until no decision is pending so it never sits over a choice modal.
import { useState } from 'react';
import type { GameState } from '../engine/types';

export function NoticePopup({ view }: { view: GameState }) {
  const notices = view.notices ?? [];
  const [seen, setSeen] = useState(0);
  const fresh = notices.filter((n) => n.seq > seen);
  if (fresh.length === 0 || view.pendingChoice || view.pendingCombat) return null;
  const maxSeq = Math.max(...fresh.map((n) => n.seq));
  const dismiss = () => setSeen(maxSeq);

  return (
    <div style={backdrop} onClick={dismiss}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>
          ⚑ A Nation is Roused
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, textAlign: 'left' }}>
          {fresh.map((n) => (
            <li key={n.seq} style={{ fontSize: 14, padding: '4px 0', lineHeight: 1.4 }}>{n.msg}</li>
          ))}
        </ul>
        <button style={btn} onClick={dismiss}>OK</button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 55 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 300, maxWidth: 440, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
