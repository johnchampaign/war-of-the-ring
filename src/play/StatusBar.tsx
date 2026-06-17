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
      <span style={pill} title="The three Elven Rings. Held by the Free Peoples; when the FP use one it flips to the Shadow (who may then use it once), after which it is spent.">
        Elven Rings:{' '}
        {view.elvenRings.map((r, i) => (
          <span key={i} style={{ fontSize: 14, margin: '0 1px', color: r === 'fp' ? '#7fd0ff' : r === 'shadow' ? '#e6857f' : '#6a6458' }}
            title={r === 'fp' ? 'Free Peoples' : r === 'shadow' ? 'flipped to Shadow' : 'used (spent)'}>
            {r === 'used' ? '◇' : '◈'}
          </span>
        ))}
        <span style={{ color: '#998', marginLeft: 4 }}>
          ({view.elvenRings.filter((r) => r === 'fp').length} FP · {view.elvenRings.filter((r) => r === 'shadow').length} SH · {view.elvenRings.filter((r) => r === 'used').length} used)
        </span>
      </span>
      {/* Dice are shown in the DiceTray (right column) — not duplicated here. */}
    </div>
  );
}

const bar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#15110b', color: '#eee', fontFamily: 'system-ui', fontSize: 12, alignItems: 'center' };
const pill: React.CSSProperties = { background: '#33302a', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' };
