// Informational popup for the Hunt for the Ring. Shows the full picture, not just
// the result: how many dice were in the Hunt Box, the actual die faces rolled (and
// any re-rolls), how many successes, and every tile drawn (including 0/blank).
// The engine records draws in hunt.draws (each with an incrementing seq and the
// roll that produced it); this tracks the highest seq shown so each new hunt pops
// exactly once. Hunt-damage CHOICES are handled by the DecisionModal; this waits
// until no choice is pending.
import { useState } from 'react';
import type { GameState, HuntRoll } from '../engine/types';

type Draw = NonNullable<GameState['hunt']['draws']>[number];

function describe(d: Draw): string {
  const base = typeof d.value === 'number'
    ? (d.value < 0 ? `heal ${-d.value} Corruption` : d.value === 0 ? '0 — a blank (no damage)' : `${d.value} Hunt damage`)
    : d.value === 'eye' ? `an Eye — ${d.damage} damage` : d.value === 'die' ? `a die — rolled ${d.damage} damage` : `${d.value} (${d.damage} damage)`;
  return base + (d.reveal ? ' · Reveal' : '') + (d.onMordor ? ' · Mordor' : '');
}

// A die face as a small pip box; a hit (≥6 after the box bonus, never a 1) is gold.
function Die({ n, bonus, faded }: { n: number; bonus: number; faded?: boolean }) {
  const hit = n !== 1 && n + bonus >= 6;
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center', width: 22, height: 22, margin: '0 2px',
      borderRadius: 4, fontSize: 13, fontWeight: 700,
      background: hit ? '#caa84b' : '#2a2418', color: hit ? '#1a1408' : '#b9b09a',
      border: `1px solid ${hit ? '#e6c869' : '#4a4332'}`, opacity: faded ? 0.6 : 1,
    }}>{n}</span>
  );
}

function RollLine({ roll }: { roll: HuntRoll }) {
  if (roll.mordor) {
    return <div style={lineStyle}>Mordor Track — tile drawn automatically ({roll.level} Hunt die{roll.level === 1 ? '' : 'ce'} of pressure)</div>;
  }
  return (
    <div style={lineStyle}>
      <div>{roll.level} Hunt die{roll.level === 1 ? '' : 'ce'}{roll.bonus ? ` · +${roll.bonus} box bonus` : ''}</div>
      <div style={{ margin: '4px 0' }}>
        {roll.dice.map((n, i) => <Die key={i} n={n} bonus={roll.bonus} />)}
        {roll.rerolls.length > 0 && <span style={{ color: '#888', margin: '0 4px' }}>re-roll</span>}
        {roll.rerolls.map((n, i) => <Die key={`r${i}`} n={n} bonus={roll.bonus} faded />)}
      </div>
      <div style={{ color: roll.successes ? '#9cc77a' : '#c98', fontWeight: 600 }}>
        {roll.successes} success{roll.successes === 1 ? '' : 'es'}
      </div>
    </div>
  );
}

export function HuntPopup({ view }: { view: GameState }) {
  const draws = view.hunt.draws ?? [];
  const [seen, setSeen] = useState(0);
  const fresh = draws.filter((d) => d.seq > seen);
  if (fresh.length === 0 || view.pendingChoice) return null;
  const maxSeq = Math.max(...fresh.map((d) => d.seq));
  const dismiss = () => setSeen(maxSeq);
  const roll = fresh.find((d) => d.roll)?.roll;

  return (
    <div style={backdrop} onClick={dismiss}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 8 }}>
          ⊙ The Hunt for the Ring
        </div>
        {roll && <RollLine roll={roll} />}
        <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, margin: '8px 0 2px' }}>
          {fresh.length === 1 ? 'Tile drawn' : `${fresh.length} tiles drawn`}
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

const lineStyle: React.CSSProperties = { fontSize: 13, color: '#ddd', background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: '8px 10px' };
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 55 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 300, maxWidth: 440, boxShadow: '0 8px 40px #000', textAlign: 'center' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14 };
