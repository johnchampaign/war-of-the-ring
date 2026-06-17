// Top status bar: turn / phase / seat, victory points, the Ring track, dice.
import type { GameState } from '../engine/types';
import { charName } from './charInfo';

export function StatusBar({ view, you, onHoverChar }: { view: GameState; you: string | null; onHoverChar?: (id: string | null) => void }) {
  const fs = view.fellowship;
  return (
    <div style={bar}>
      <span style={pill}>Turn {view.turn}</span>
      <span style={pill}>Phase: {view.phase}</span>
      <span style={pill}>You: {you === 'fp' ? 'Free Peoples' : you === 'shadow' ? 'Shadow' : '—'}</span>
      <span style={{ ...pill, background: '#2f4f9e' }}>FP VP {view.victoryPoints.fp}</span>
      <span style={{ ...pill, background: '#a83232' }}>Shadow VP {view.victoryPoints.shadow}</span>
      <span style={{ ...pill, background: '#6b2d2d' }}>Corruption {fs.corruption}/12</span>
      <span style={pill}>Fellowship: {fs.mordor !== null ? `Mordor ${fs.mordor}/5` : `progress ${fs.progress}`}</span>
      <span style={fs.hidden ? { ...pill, background: '#274027', color: '#bfe6bf' } : { ...pill, background: '#a83232', color: '#fff', fontWeight: 700 }}
        title={fs.hidden ? 'The Fellowship is hidden — you may move it.' : 'The Fellowship is REVEALED — it cannot move until you hide it again (a Character die).'}>
        {fs.hidden ? '🙈 Hidden' : '🔴 REVEALED'}
      </span>
      <span style={pill}>Guide: <span
        onMouseEnter={() => onHoverChar?.(fs.guide)} onMouseLeave={() => onHoverChar?.(null)}
        style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{charName(fs.guide)}</span> · {fs.companions.length} companions</span>
      <span style={pill}>Hunt box {view.hunt.box}</span>
      {/* Dice are shown in the DiceTray (right column) — not duplicated here. */}
    </div>
  );
}

const bar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#15110b', color: '#eee', fontFamily: 'system-ui', fontSize: 12, alignItems: 'center' };
const pill: React.CSSProperties = { background: '#33302a', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' };
