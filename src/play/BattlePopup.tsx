// Battle-outcome popup (player report: "show the battle outcome — dice and
// effect"). Pops once when a battle finishes (seq-tracked, like the HuntPopup),
// showing the final round's dice for each side (hits in gold), each side's losses,
// and the result. Combat is public info, so it shows for both players.
import { useState } from 'react';
import type { GameState, Side } from '../engine/types';
import mapData from '../../assets/map.json';

const rName = (id: string): string => (mapData as any).regions[id]?.name ?? id;
const sideName = (s: Side) => (s === 'fp' ? 'Free Peoples' : 'Shadow');

// A combat die: a hit is a 6, or ≥ the to-hit target (never a 1).
function CDie({ n, target }: { n: number; target: number }) {
  const hit = n === 6 || (n !== 1 && n >= target);
  return (
    <span style={{
      display: 'inline-grid', placeItems: 'center', width: 22, height: 22, margin: '0 2px',
      borderRadius: 4, fontSize: 13, fontWeight: 700,
      background: hit ? '#caa84b' : '#2a2418', color: hit ? '#1a1408' : '#b9b09a',
      border: `1px solid ${hit ? '#e6c869' : '#4a4332'}`,
    }}>{n}</span>
  );
}

function RollRow({ label, roll, color }: { label: string; roll?: { dice: number[]; rerolls: number[]; target: number; rerollTarget?: number }; color: string }) {
  if (!roll || (roll.dice.length === 0 && roll.rerolls.length === 0)) return null;
  // A Combat card can bonus the Combat roll and the Leader re-roll separately, so
  // the re-roll may hit on a different number — label it when it differs.
  const rt = roll.rerollTarget ?? roll.target;
  return (
    <div style={{ margin: '3px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      <span style={{ width: 64, fontSize: 12, color }}>{label}</span>
      <span style={{ fontSize: 11, color: '#887', marginRight: 4 }}>(hits {roll.target}+)</span>
      {roll.dice.map((n, i) => <CDie key={i} n={n} target={roll.target} />)}
      {roll.rerolls.length > 0 && <span style={{ color: '#887', margin: '0 4px', fontSize: 11 }}>re-roll{rt !== roll.target ? ` (${rt}+)` : ''}</span>}
      {roll.rerolls.map((n, i) => <CDie key={`r${i}`} n={n} target={rt} />)}
    </div>
  );
}

export function BattlePopup({ view }: { view: GameState }) {
  const b = view.lastBattle;
  const [seen, setSeen] = useState(0);
  // Wait until the battle is fully resolved and no other prompt is up.
  if (!b || b.seq <= seen || view.pendingChoice || view.pendingCombat) return null;

  return (
    <div style={backdrop} onClick={() => setSeen(b.seq)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 13, color: '#e6b85a', fontVariant: 'small-caps', letterSpacing: 1, marginBottom: 6 }}>
          ⚔ {b.siege ? 'Siege' : 'Battle'} — {b.rounds} round{b.rounds === 1 ? '' : 's'}
        </div>
        <div style={{ fontSize: 14, marginBottom: 8 }}>
          <b style={{ color: b.attacker === 'fp' ? '#7fb6e6' : '#e6857f' }}>{sideName(b.attacker)}</b> attacked{' '}
          <b>{rName(b.to)}</b> <span style={{ color: '#998' }}>(from {rName(b.from)})</span>
        </div>
        <div style={{ background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 11, color: '#887', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Final round</div>
          <RollRow label="Attacker" roll={b.atkRoll} color="#e6857f" />
          <RollRow label="Defender" roll={b.defRoll} color="#7fb6e6" />
        </div>
        <div style={{ fontSize: 13, margin: '8px 0', color: '#cbbf9a' }}>
          Losses — Attacker: <b style={{ color: b.atkLosses ? '#e88' : '#9a9' }}>{b.atkLosses}</b> · Defender: <b style={{ color: b.defLosses ? '#e88' : '#9a9' }}>{b.defLosses}</b>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, padding: '6px 8px', borderRadius: 8, textAlign: 'center',
          background: b.captured ? '#5a1f1f' : '#1d3320', color: b.captured ? '#ffb3b3' : '#bfe6bf' }}>
          {b.outcome}
        </div>
        <button style={btn} onClick={() => setSeen(b.seq)}>OK</button>
      </div>
    </div>
  );
}

// Above the turn-summary (z 56) so the player's OWN battle result is acknowledged
// FIRST, before the opponent's "while you waited" recap is revealed underneath.
const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.6)', display: 'grid', placeItems: 'center', zIndex: 58 };
const card: React.CSSProperties = { background: '#1c1710', color: '#eee', fontFamily: 'system-ui', padding: '16px 22px', borderRadius: 12, border: '1px solid #5a4a2a', minWidth: 320, maxWidth: 460, boxShadow: '0 8px 40px #000' };
const btn: React.CSSProperties = { marginTop: 12, padding: '7px 22px', background: '#3a3326', color: '#f0e9d8', border: '1px solid #6a5', borderRadius: 6, cursor: 'pointer', fontSize: 14, display: 'block', marginLeft: 'auto', marginRight: 'auto' };
