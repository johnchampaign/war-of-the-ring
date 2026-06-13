// The viewer's event-card hand, shown as a horizontal strip. If card art has been
// downloaded (artCache), each card renders as its real image; otherwise a compact
// text card (name + initiative) stands in — fully legible without any art. Hidden
// opponent cards never reach here (redact.ts replaces them with 'hidden').
import { useCardArt } from './artCache';
import type { GameState, Side } from '../engine/types';
import eventCards from '../../assets/event-cards.json';

const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));

export function HandStrip({ view, you }: { view: GameState; you: Side }) {
  const hand = view.cards?.[you]?.hand ?? [];
  if (hand.length === 0) return null;
  return (
    <div style={wrap}>
      <span style={{ fontSize: 11, color: '#998', alignSelf: 'center', marginRight: 4 }}>Hand ({hand.length}):</span>
      {hand.map((id, i) => <HandCard key={i} id={id} />)}
    </div>
  );
}

function HandCard({ id }: { id: string }) {
  const art = useCardArt(id === 'hidden' ? null : id);
  const def = CARD.get(id);
  if (art) return <img src={art} alt={def?.name ?? id} title={def?.name ?? id} style={img} />;
  // Text-card placeholder.
  const side = def?.side === 'Shadow' ? '#5a2222' : '#1f3a5a';
  return (
    <div style={{ ...textCard, background: side }} title={def?.eventText ?? ''}>
      <div style={{ fontSize: 9, color: '#ccb', textTransform: 'uppercase' }}>{def?.deck ?? '?'} · {def?.initiative ?? '–'}</div>
      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.15 }}>{def?.name ?? id}</div>
    </div>
  );
}

const wrap: React.CSSProperties = { display: 'flex', gap: 6, overflowX: 'auto', padding: '6px 8px', background: '#14110b', borderTop: '1px solid #2a2418' };
const img: React.CSSProperties = { height: 96, width: 'auto', borderRadius: 4, flexShrink: 0, boxShadow: '0 1px 4px #000' };
const textCard: React.CSSProperties = { width: 70, height: 96, flexShrink: 0, borderRadius: 4, padding: 5, color: '#f0e9d8', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid #443' };
