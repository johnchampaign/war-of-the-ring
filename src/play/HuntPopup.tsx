// Informational popup listing every Hunt tile drawn since it was last dismissed —
// including 0/blank tiles — so the player always sees what came out of the cup
// (a single hunt can draw several: reveal/declare through Shadow Strongholds).
// The engine records draws in hunt.draws (each with an incrementing seq); this
// tracks the highest seq shown so each new tile pops exactly once. Hunt-damage
// CHOICES are handled by the DecisionModal; this waits until no choice is pending.
import { useState } from 'react';
import type { GameState } from '../engine/types';

type Draw = NonNullable<GameState['hunt']['draws']>[number];

function describe(d: Draw): string {
  const base = typeof d.value === 'number'
    ? (d.value < 0 ? `heal ${-d.value} Corruption` : d.value === 0 ? '0 — a blank (no damage)' : `${d.value} Hunt damage`)
    : d.value === 'eye' ? `an Eye — ${d.damage} damage` : d.value === 'die' ? `a die — rolled ${d.damage} damage` : `${d.value} (${d.damage} damage)`;
  return base + (d.reveal ? ' · Reveal' : '') + (d.onMordor ? ' · Mordor' : '');
}

export function HuntPopup({ view }: { view: GameState }) {
  const draws = view.hunt.draws ?? [];
  const [seen, setSeen] = useState(0);
  const fresh = draws.filter((d) => d.seq > seen);
  if (fresh.length === 0 || view.pendingChoice) return null;
  const maxSeq = Math.max(...fresh.map((d) => d.seq));
  const dismiss = () => setSeen(maxSeq);

  return (
    <div style={backdrop} onClick={dismiss}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>
          ⊙ The Hunt for the Ring — {fresh.length === 1 ? 'tile drawn' : `${fresh.length} tiles drawn`}
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, textAlign: 'left' }}>
          {fresh.map((d) => (
            <li key={d.seq} style={{ fontSize: 14, padding: '3px 0', borderBottom: '1px solid #2a2418' }}>• {describe(d)}</li>
          ))}
        </ul>
        <button style={btn} onClick={dismiss}>OK</button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 55 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 280, maxWidth: 440, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
