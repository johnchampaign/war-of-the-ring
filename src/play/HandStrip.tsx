// The viewer's event-card hand, shown as a horizontal strip. If card art has been
// downloaded (artCache), each card renders as its real image; otherwise a compact
// text card (name + initiative) stands in — fully legible without any art. Hidden
// opponent cards never reach here (redact.ts replaces them with 'hidden').
import { useState } from 'react';
import { useCardArt } from './artCache';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import eventCards from '../../assets/event-cards.json';
import { CardTypeBadge } from './cardTypeBadge';
import { cardSideLine } from './names';

const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));

export function HandStrip({ view, you, onHoverCard, playable, onPlay, busy }: {
  view: GameState; you: Side; onHoverCard?: (id: string | null) => void;
  /** The legal "play this card" action per card id, when it can be played right now.
   *  Playing a card IS clicking it in your hand — the way every card game works, and
   *  it gives the action list back a lot of room (player report 4b4f6o3p5v066c5o). */
  playable?: Map<string, WotrAction>; onPlay?: (a: WotrAction) => void; busy?: boolean;
}) {
  const hand = view.cards?.[you]?.hand ?? [];
  // "Play on the table" cards are face-up / public for both sides (Mithril Coat,
  // Wizard's Staff, persistent effects, special-tile cards, …).
  const tabled = [...(view.cards?.fp?.table ?? []), ...(view.cards?.shadow?.table ?? [])];
  const [zoom, setZoom] = useState<string | null>(null);
  if (hand.length === 0 && tabled.length === 0) return null;
  // A compact card row (in-play cards, divider, then the hand), with the hint on its
  // own line underneath so it doesn't steal horizontal space.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#14110b' }}>
      {/* Hand on top, played ("in play") cards underneath. */}
      <div style={wrap}>
        <span style={label}>Hand ({hand.length}):</span>
        {hand.map((id, i) => {
          const act = playable?.get(id) ?? null;
          return <HandCard key={i} id={id} onZoom={() => !id.startsWith('hidden') && setZoom(id)} onHover={onHoverCard}
            play={act && onPlay && !busy ? () => onPlay(act) : null} />;
        })}
      </div>
      {tabled.length > 0 && (
        <div style={wrap}>
          <span style={label}>In play:</span>
          {tabled.map((id, i) => <HandCard key={`t${i}`} id={id} onZoom={() => setZoom(id)} onHover={onHoverCard} />)}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#776', padding: '2px 8px 4px', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {playable && playable.size > 0
          ? <>hover to preview · <b style={{ color: '#9f9' }}>click a lit card to play it</b> · 🔍 to enlarge</>
          : <>hover to preview · click to enlarge</>}
      </div>
      {zoom && <CardZoom id={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** The magnifier corner button: on a PLAYABLE card the plain click plays it, so
 *  enlarging needs its own target. On an unplayable card the whole card still
 *  enlarges, exactly as before. */
function ZoomDot({ onZoom }: { onZoom: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onZoom(); }} title="Enlarge this card"
      style={{ position: 'absolute', bottom: 1, right: 1, width: 17, height: 17, lineHeight: '15px', textAlign: 'center', padding: 0, fontSize: 10,
        borderRadius: 4, cursor: 'zoom-in', background: 'rgba(12,10,7,0.82)', color: '#e9e1cc', border: '1px solid #6a5a3a' }}>🔍</button>
  );
}

function HandCard({ id, onZoom, onHover, play }: { id: string; onZoom: () => void; onHover?: (id: string | null) => void; play?: (() => void) | null }) {
  const art = useCardArt(id.startsWith('hidden') ? null : id);
  const def = CARD.get(id);
  const hov = { onMouseEnter: () => onHover?.(id), onMouseLeave: () => onHover?.(null) };
  // A playable card is lit and plays on click; everything else keeps click-to-enlarge.
  const lit: React.CSSProperties = play
    ? { outline: '2px solid #6ea84f', outlineOffset: 1, borderRadius: 5, boxShadow: '0 0 8px rgba(110,168,79,0.55)' }
    : {};
  const tip = play ? `${def?.name ?? id} — click to PLAY` : `${def?.name ?? id} — click to enlarge`;
  if (art) return (
    // Art card with a small play-type badge overlaid top-left, so the die-type is
    // readable at a glance even on the image (Ira #3).
    <div style={{ position: 'relative', flexShrink: 0, ...lit }} {...hov}>
      <img src={art} alt={def?.name ?? id} title={tip} style={{ ...img, cursor: play ? 'pointer' : 'zoom-in' }} onClick={play ?? onZoom} />
      {play && <ZoomDot onZoom={onZoom} />}
      {!id.startsWith('hidden') && def && <CardTypeBadge deck={def.deck} via={def.playableVia} small style={{ position: 'absolute', top: 2, left: 2, boxShadow: '0 1px 3px #000' }} />}
    </div>
  );
  // Text-card placeholder.
  const side = def?.side === 'Shadow' ? '#5a2222' : '#1f3a5a';
  return (
    <div style={{ ...textCard, background: side, cursor: play ? 'pointer' : 'zoom-in', position: 'relative', ...lit }} onClick={play ?? onZoom} title={play ? tip : (def?.eventText ?? '')} {...hov}>
      {play && <ZoomDot onZoom={onZoom} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
        <CardTypeBadge deck={def?.deck} via={def?.playableVia} small />
        <span style={{ fontSize: 9, color: '#ccb' }}>Ini {def?.initiative ?? '–'}</span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.15 }}>{def?.name ?? id}</div>
    </div>
  );
}

// Click-to-enlarge: full card art (or full text) over a dimmed backdrop. Exported so
// the opponent's-turn recap can pop the same enlarged view from a logged card play.
export function CardZoom({ id, onClose }: { id: string; onClose: () => void }) {
  const art = useCardArt(id);
  const def = CARD.get(id);
  return (
    <div style={zoomBackdrop} onClick={onClose}>
      {art ? (
        <img src={art} alt={def?.name ?? id} style={{ maxHeight: '88vh', maxWidth: '88vw', borderRadius: 8, boxShadow: '0 8px 40px #000' }} />
      ) : (
        <div style={zoomText} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <CardTypeBadge deck={def?.deck} via={def?.playableVia} />
            <span style={{ fontSize: 11, color: '#ccb' }}>{cardSideLine(def?.side, def?.initiative)}</span>
          </div>
          <h3 style={{ margin: '4px 0' }}>{def?.name ?? id}</h3>
          {/* Preconditions (the "Play if…" requirement) so the card's legality is readable
              even without the art — amber italic, distinct from the effect text. */}
          {def?.precondition && <p style={{ fontSize: 12, ...zoomReq }}>{def.precondition}</p>}
          {def?.eventText && <p style={{ fontSize: 13 }}><b>Event:</b> {def.eventText}</p>}
          {def?.combat?.title && <p style={{ fontSize: 13 }}><b>Combat — {def.combat.title}:</b>{' '}
            {def.combat.precondition && <span style={zoomReq}>[{def.combat.precondition}] </span>}{def.combat.text}</p>}
        </div>
      )}
    </div>
  );
}

const wrap: React.CSSProperties = { display: 'flex', gap: 6, overflowX: 'auto', padding: '5px 8px', background: '#14110b', borderTop: '1px solid #2a2418', alignItems: 'center' };
const label: React.CSSProperties = { fontSize: 11, color: '#998', alignSelf: 'center', marginRight: 2, whiteSpace: 'nowrap', flexShrink: 0 };
// A hand card is clicked to PLAY it, so nothing on it should offer a text cursor or
// swallow the click — the type badge over its corner did both (player report
// 12295h3l3m5w3y3t).
const img: React.CSSProperties = { height: 76, width: 'auto', borderRadius: 4, flexShrink: 0, boxShadow: '0 1px 4px #000', cursor: 'pointer', userSelect: 'none' };
const zoomBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.8)', display: 'grid', placeItems: 'center', zIndex: 60, cursor: 'zoom-out' };
const zoomText: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 10, maxWidth: 440, cursor: 'default' };
const zoomReq: React.CSSProperties = { color: '#d8b48c', fontStyle: 'italic' };
const textCard: React.CSSProperties = { width: 58, height: 76, flexShrink: 0, borderRadius: 4, padding: 4, userSelect: 'none', color: '#f0e9d8', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid #443', fontSize: 9 };
