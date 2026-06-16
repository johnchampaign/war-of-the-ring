// Informational popup shown when a Hunt tile is drawn, summarizing the outcome
// (damage, reveal, Mordor). Dismissable. The engine records the latest draw in
// hunt.lastDraw with an incrementing `seq`; this tracks the last seq it has shown so
// each new draw pops once. (Hunt-damage *choices* are handled by the DecisionModal;
// this only surfaces when no such decision is pending.)
import { useState } from 'react';
import type { GameState } from '../engine/types';

export function HuntPopup({ view }: { view: GameState }) {
  const draw = view.hunt.lastDraw;
  const [seen, setSeen] = useState(0);
  // Don't stack on top of a live decision (the DecisionModal shows tile details there).
  if (!draw || draw.seq <= seen || view.pendingChoice) return null;

  const outcome = typeof draw.value === 'number'
    ? `${draw.value} Hunt damage`
    : draw.value === 'eye' ? `an Eye — ${draw.damage} damage (from the Shadow's Hunt dice)`
      : draw.value === 'die' ? `a die — rolled ${draw.damage} damage`
        : `${draw.value} (${draw.damage} damage)`; // special tile id
  const heal = typeof draw.value === 'number' && draw.value < 0;

  return (
    <div style={backdrop} onClick={() => setSeen(draw.seq)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1 }}>⊙ The Hunt for the Ring</div>
        <p style={{ fontSize: 15, margin: '10px 0' }}>
          {heal ? <>The Fellowship recovers <b>{-(draw.value as number)} Corruption</b>.</> : <>The Hunt drew <b>{outcome}</b>.</>}
          {draw.reveal && <> The Fellowship is now <b style={{ color: '#e6857f' }}>Revealed</b>.</>}
          {draw.onMordor && <> <span style={{ color: '#b9b29c' }}>(on the Mordor track)</span></>}
        </p>
        <button style={btn} onClick={() => setSeen(draw.seq)}>OK</button>
      </div>
    </div>
  );
}

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 55 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '18px 22px', borderRadius: 12, border: '1px solid #5a4a2a', maxWidth: 420, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const btn: React.CSSProperties = { padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
