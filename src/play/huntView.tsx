// Shared Hunt rendering — the dice rolled (with hit highlighting), the box bonus,
// re-rolls, successes, and a one-line tile description. Used by BOTH the HuntPopup
// (after the fact) and the DecisionModal's HuntDetail (while you're deciding how to
// absorb the damage), so the decision shows the SAME full context the popup does.
import type { GameState, HuntRoll } from '../engine/types';

export type Draw = NonNullable<GameState['hunt']['draws']>[number];

/** Plain-language one-liner for a drawn tile. */
export function describeDraw(d: Draw): string {
  const base = typeof d.value === 'number'
    ? (d.value < 0 ? `heal ${-d.value} Corruption` : d.value === 0 ? '0 — a blank (no damage)' : `${d.value} Hunt damage`)
    : d.value === 'eye' ? `an Eye — ${d.damage} damage` : d.value === 'die' ? `a die — rolled ${d.damage} damage` : `${d.value} (${d.damage} damage)`;
  return base + (d.reveal ? ' · Reveal' : '') + (d.onMordor ? ' · Mordor' : '');
}

// A die face as a small pip box; a hit (≥6 after the box bonus, never a 1) is gold.
export function Die({ n, bonus, faded }: { n: number; bonus: number; faded?: boolean }) {
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

/** The Hunt roll: dice count + box bonus, the faces (hits gold), re-rolls, successes. */
export function RollLine({ roll }: { roll: HuntRoll }) {
  if (roll.mordor) {
    return <div style={huntLineStyle}>Mordor Track — tile drawn automatically ({roll.level} Hunt die{roll.level === 1 ? '' : 'ce'} of pressure)</div>;
  }
  return (
    <div style={huntLineStyle}>
      <div>{roll.level} Hunt die{roll.level === 1 ? '' : 'ce'}{roll.bonus ? ` · +${roll.bonus} box bonus` : ''} <span style={{ color: '#887' }}>(hits on 6+)</span></div>
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

/** The Corruption track as a number with a delta, e.g. "Corruption 5 → 8 / 12".
 *  `add` (optional) shows where it lands if this damage is absorbed as Corruption. */
export function CorruptionLine({ current, add }: { current: number; add?: number }) {
  const after = add != null ? Math.min(12, current + add) : null;
  const danger = (after ?? current) >= 10;
  return (
    <div style={{ fontSize: 13, margin: '6px 0 2px', color: danger ? '#e88' : '#cbbf9a' }}>
      Corruption <b>{current}</b>{after != null && after !== current ? <> → <b>{after}</b></> : null} / 12
      {danger && <span style={{ color: '#e88', fontWeight: 700 }}> — Shadow wins at 12!</span>}
    </div>
  );
}

export const huntLineStyle: React.CSSProperties = { fontSize: 13, color: '#ddd', background: '#15110b', border: '1px solid #2a2418', borderRadius: 8, padding: '8px 10px' };
