// Top status bar: turn / phase / seat, victory points, the Ring track, dice.
import { useState } from 'react';
import type { GameState } from '../engine/types';
import { charName, charDef } from './charInfo';

// A browsable roster of everyone currently in the Fellowship (Ira #4): click the
// companion pill to open it; hover a name to show that character's card in the
// inspector. The Guide is marked. Gollum (when Guide) is included even if not in the
// companions array.
function FellowshipRoster({ guide, companions, onHoverChar }: { guide: string; companions: string[]; onHoverChar?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ids = companions.includes(guide) ? companions : [guide, ...companions];
  return (
    <span style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ ...pill, border: 'none', cursor: 'pointer', font: 'inherit', color: '#e9e1cc' }}
        title="Browse the Fellowship — hover a name to see the card">
        {companions.length} companion{companions.length === 1 ? '' : 's'} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div style={roster} onMouseLeave={() => onHoverChar?.(null)}>
          {ids.length === 0 && <div style={{ color: '#998', fontSize: 12 }}>No companions remain.</div>}
          {ids.map((id) => {
            const d = charDef(id);
            const isGuide = id === guide;
            return (
              <div key={id} onMouseEnter={() => onHoverChar?.(id)}
                style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 6px', borderRadius: 5, cursor: 'help', background: isGuide ? '#2c2616' : 'transparent' }}>
                <span style={{ fontWeight: 600, color: isGuide ? '#ffd86a' : '#e9e1cc' }}>{isGuide ? '★ ' : ''}{charName(id)}</span>
                {d && <span style={{ color: '#b9b29c', fontSize: 11 }}>Lvl {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Lead ${d.leadership}` : ''}</span>}
              </div>
            );
          })}
          <div style={{ color: '#776', fontSize: 10, marginTop: 4, borderTop: '1px solid #2a2418', paddingTop: 4 }}>★ = Guide · hover a name for its card</div>
        </div>
      )}
    </span>
  );
}

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
        style={{ textDecoration: 'underline dotted', cursor: 'help' }}>{charName(fs.guide)}</span></span>
      <FellowshipRoster guide={fs.guide} companions={fs.companions} onHoverChar={onHoverChar} />
      <span style={pill}>Hunt box {view.hunt.box}</span>
      <span style={pill} title="Event cards in hand. The opponent's individual cards are hidden, but the count is open information.">
        🂠 FP {view.cards?.fp?.hand?.length ?? 0} · Shadow {view.cards?.shadow?.hand?.length ?? 0}
      </span>
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
const roster: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 70, background: '#1c1710', border: '1px solid #5a4a2a', borderRadius: 8, padding: 6, minWidth: 200, boxShadow: '0 8px 30px #000', whiteSpace: 'nowrap' };
