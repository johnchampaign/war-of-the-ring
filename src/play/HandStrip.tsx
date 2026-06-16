// The viewer's event-card hand, shown as a horizontal strip. If card art has been
// downloaded (artCache), each card renders as its real image; otherwise a compact
// text card (name + initiative) stands in — fully legible without any art. Hidden
// opponent cards never reach here (redact.ts replaces them with 'hidden').
import { useState } from 'react';
import { useCardArt } from './artCache';
import type { GameState, Side } from '../engine/types';
import eventCards from '../../assets/event-cards.json';

const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));

export function HandStrip({ view, you, onHoverCard }: { view: GameState; you: Side; onHoverCard?: (id: string | null) => void }) {
  const hand = view.cards?.[you]?.hand ?? [];
  // "Play on the table" cards are face-up / public for both sides (Mithril Coat,
  // Wizard's Staff, persistent effects, special-tile cards, …).
  const tabled = [...(view.cards?.fp?.table ?? []), ...(view.cards?.shadow?.table ?? [])];
  const [zoom, setZoom] = useState<string | null>(null);
  if (hand.length === 0 && tabled.length === 0) return null;
  // A single compact row: in-play (table) cards first, then a divider, then the hand.
  return (
    <div style={wrap}>
      {tabled.length > 0 && <>
        <span style={label}>In play:</span>
        {tabled.map((id, i) => <HandCard key={`t${i}`} id={id} onZoom={() => setZoom(id)} onHover={onHoverCard} />)}
        <span style={{ width: 1, alignSelf: 'stretch', background: '#3a342a', margin: '0 4px' }} />
      </>}
      <span style={label}>Hand ({hand.length}):</span>
      {hand.map((id, i) => <HandCard key={i} id={id} onZoom={() => id !== 'hidden' && setZoom(id)} onHover={onHoverCard} />)}
      <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 10, color: '#776', paddingRight: 4 }}>hover to preview · click to enlarge</span>
      {zoom && <CardZoom id={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

function HandCard({ id, onZoom, onHover }: { id: string; onZoom: () => void; onHover?: (id: string | null) => void }) {
  const art = useCardArt(id === 'hidden' ? null : id);
  const def = CARD.get(id);
  const hov = { onMouseEnter: () => onHover?.(id), onMouseLeave: () => onHover?.(null) };
  if (art) return <img src={art} alt={def?.name ?? id} title={`${def?.name ?? id} — click to enlarge`} style={img} onClick={onZoom} {...hov} />;
  // Text-card placeholder.
  const side = def?.side === 'Shadow' ? '#5a2222' : '#1f3a5a';
  return (
    <div style={{ ...textCard, background: side, cursor: 'pointer' }} onClick={onZoom} title={def?.eventText ?? ''} {...hov}>
      <div style={{ fontSize: 9, color: '#ccb', textTransform: 'uppercase' }}>{def?.deck ?? '?'} · {def?.initiative ?? '–'}</div>
      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.15 }}>{def?.name ?? id}</div>
    </div>
  );
}

// Click-to-enlarge: full card art (or full text) over a dimmed backdrop.
function CardZoom({ id, onClose }: { id: string; onClose: () => void }) {
  const art = useCardArt(id);
  const def = CARD.get(id);
  return (
    <div style={zoomBackdrop} onClick={onClose}>
      {art ? (
        <img src={art} alt={def?.name ?? id} style={{ maxHeight: '88vh', maxWidth: '88vw', borderRadius: 8, boxShadow: '0 8px 40px #000' }} />
      ) : (
        <div style={zoomText} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 11, color: '#ccb', textTransform: 'uppercase' }}>{def?.side} · {def?.deck} · init {def?.initiative}</div>
          <h3 style={{ margin: '4px 0' }}>{def?.name ?? id}</h3>
          {def?.eventText && <p style={{ fontSize: 13 }}><b>Event:</b> {def.eventText}</p>}
          {def?.combat?.title && <p style={{ fontSize: 13 }}><b>Combat — {def.combat.title}:</b> {def.combat.text}</p>}
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { display: 'flex', gap: 6, overflowX: 'auto', padding: '5px 8px', background: '#14110b', borderTop: '1px solid #2a2418', alignItems: 'center' };
const label: React.CSSProperties = { fontSize: 11, color: '#998', alignSelf: 'center', marginRight: 2, whiteSpace: 'nowrap', flexShrink: 0 };
const img: React.CSSProperties = { height: 76, width: 'auto', borderRadius: 4, flexShrink: 0, boxShadow: '0 1px 4px #000', cursor: 'pointer' };
const zoomBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.8)', display: 'grid', placeItems: 'center', zIndex: 60, cursor: 'zoom-out' };
const zoomText: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 10, maxWidth: 440, cursor: 'default' };
const textCard: React.CSSProperties = { width: 58, height: 76, flexShrink: 0, borderRadius: 4, padding: 4, color: '#f0e9d8', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid #443', fontSize: 9 };
