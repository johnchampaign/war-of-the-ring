// Top status bar: turn / phase / seat, victory points, the Ring track, dice.
import type { GameState } from '../engine/types';

export function StatusBar({ view, you }: { view: GameState; you: string | null }) {
  const fs = view.fellowship;
  const diceStr = (s: 'fp' | 'shadow') => view.dice[s].join(' ') || '—';
  return (
    <div style={bar}>
      <span style={pill}>Turn {view.turn}</span>
      <span style={pill}>Phase: {view.phase}</span>
      <span style={pill}>You: {you === 'fp' ? 'Free Peoples' : you === 'shadow' ? 'Shadow' : '—'}</span>
      <span style={{ ...pill, background: '#2f4f9e' }}>FP VP {view.victoryPoints.fp}</span>
      <span style={{ ...pill, background: '#a83232' }}>Shadow VP {view.victoryPoints.shadow}</span>
      <span style={{ ...pill, background: '#6b2d2d' }}>Corruption {fs.corruption}/12</span>
      <span style={pill}>Fellowship: {fs.mordor !== null ? `Mordor ${fs.mordor}/5` : `progress ${fs.progress}`} · {fs.hidden ? 'hidden' : 'REVEALED'}</span>
      <span style={pill}>Guide: {fs.guide} · {fs.companions.length} companions</span>
      <span style={pill}>Hunt box {view.hunt.box}</span>
      <span style={{ ...pill, background: '#1e3a6e' }}>FP dice: {diceStr('fp')}</span>
      <span style={{ ...pill, background: '#6e1e1e' }}>Shadow dice: {diceStr('shadow')}</span>
    </div>
  );
}

const bar: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#15110b', color: '#eee', fontFamily: 'system-ui', fontSize: 12, alignItems: 'center' };
const pill: React.CSSProperties = { background: '#33302a', padding: '3px 8px', borderRadius: 10, whiteSpace: 'nowrap' };
