// The viewer's event-card hand, shown as a horizontal strip. If card art has been
// downloaded (artCache), each card renders as its real image; otherwise a compact
// text card (name + initiative) stands in — fully legible without any art. Hidden
// opponent cards never reach here (redact.ts replaces them with 'hidden').
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCardArt } from './artCache';
import type { GameState, Side } from '../engine/types';
import type { WotrAction } from '../adapter/wotrAction';
import eventCards from '../../assets/event-cards.json';
import { CardTypeBadge } from './cardTypeBadge';
import { FACE } from './DiceTray';
import { cardSideLine } from './names';

const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));
/** A touch screen (phone, tablet): there is no hover to read a card, and a tap is easy
 *  to make by accident — so a tap on a playable card opens it large with a "Play" button
 *  instead of playing it (player report oupr2melse2cu5pm). A mouse still plays on click. */
const touchScreen = (): boolean => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches; } catch { return false; }
};

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
  const [zoom, setZoom] = useState<string | null>(null);
  const [zoomPlay, setZoomPlay] = useState<(() => void) | null>(null);
  const touch = touchScreen();
  if (hand.length === 0) return null;
  // A compact card row (in-play cards, divider, then the hand), with the hint on its
  // own line underneath so it doesn't steal horizontal space.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#14110b' }}>
      {/* The cards get the full width. The "Hand (N)" label used to sit to their left
          and eat horizontal space the cards wanted; it has moved into the line
          underneath (player report 572i6e714m1d2j3t). */}
      <ScrollRow>
        {hand.map((id, i) => {
          const act = playable?.get(id) ?? null;
          const playNow = act && onPlay && !busy ? () => onPlay(act) : null;
          return <HandCard key={i} id={id} onZoom={() => { if (!id.startsWith('hidden')) { setZoomPlay(null); setZoom(id); } }} onHover={onHoverCard}
            play={playNow && touch ? () => { setZoomPlay(() => playNow); setZoom(id); } : playNow} />;
        })}
      </ScrollRow>
      {/* The "Hand (N) · hover to preview · click to enlarge" line under the cards is
          gone — space the cards want more (player report 0e4z5e1m4z4p3t32). */}
      {zoom && <CardZoom id={zoom} onClose={() => { setZoom(null); setZoomPlay(null); }}
        onPlay={zoomPlay ? () => { const p = zoomPlay; setZoom(null); setZoomPlay(null); p(); } : undefined} />}
    </div>
  );
}

/** A row of cards that scrolls sideways WITHOUT a scrollbar (player report
 *  6c2d1z2v2r2q175y: "there is a scrollbar on the hand"). A scrollbar that came and
 *  went also moved everything below it (6p3u624f0c6e0s2w); with none there is nothing
 *  to come and go. The mouse wheel scrolls it sideways, and a fade with a chevron marks
 *  each edge that has more cards beyond it. */
function ScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const update = () => {
    const el = ref.current; if (!el) return;
    const l = el.scrollLeft > 2, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
  };
  useLayoutEffect(update);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY; e.preventDefault(); update();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro?.disconnect(); el.removeEventListener('wheel', onWheel); };
  }, []);
  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} onScroll={update} style={handWrap}>{children}</div>
      {edge.l && <div style={{ ...fade, left: 0, justifyContent: 'flex-start', background: 'linear-gradient(to right, #14110b 30%, #14110b00)' }}>‹</div>}
      {edge.r && <div style={{ ...fade, right: 0, justifyContent: 'flex-end', background: 'linear-gradient(to left, #14110b 30%, #14110b00)' }}>›</div>}
    </div>
  );
}

/** The opponent's hand as card BACKS, in the order they hold them — which deck each
 *  came from is open information at the table, and so is how long a card has been
 *  held (player reports 0e4z5e1m4z4p3t32, 5e1p004j3c2w1j4s). Sits above the actions,
 *  with their dice, mirroring your own hand and dice below. */
export function OpponentHand({ view, you }: { view: GameState; you: Side }) {
  const opp: Side = you === 'fp' ? 'shadow' : 'fp';
  const hand = view.cards?.[opp]?.hand ?? [];
  const deckOf = (id: string): string => id === 'hidden-character' ? 'Character' : id === 'hidden-strategy' ? 'Strategy' : CARD.get(id)?.deck ?? 'Strategy';
  const sideBg = opp === 'shadow' ? '#4a1c1c' : '#1b3350';
  const counts = hand.reduce((m, id) => { const d = deckOf(id); m[d] = (m[d] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const label = `${opp === 'fp' ? 'Free Peoples' : 'Shadow'} hand: ${hand.length} card${hand.length === 1 ? '' : 's'}${hand.length ? ` (${counts.Character ?? 0} Character, ${counts.Strategy ?? 0} Strategy)` : ''}`;
  // Full-size beside Politics; half-height when the side column is too narrow for the
  // two to sit side by side and everything stacks (a 1440px screen), where every
  // pixel up here is one the action list loses.
  const ref = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current, row = el?.parentElement?.parentElement;
    if (!el || !row || typeof ResizeObserver === 'undefined') return;
    const measure = () => setStacked(el.parentElement!.offsetWidth >= row.clientWidth - 2);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(row);
    return () => ro.disconnect();
  }, []);
  const h = stacked ? 52 : 104;
  return (
    <div ref={ref} style={{ ...handWrap, borderTop: 'none', minHeight: h + 10 }} title={label} data-testid="opponent-hand">
      {hand.length === 0 && <span style={{ fontSize: 11, color: '#776', fontStyle: 'italic' }}>{label}</span>}
      {hand.map((id, i) => {
        const deck = deckOf(id);
        return (
          <div key={i} style={{ ...textCard, height: h, width: Math.round(h * 76 / 104), padding: 2, background: `repeating-linear-gradient(45deg, ${sideBg}, ${sideBg} 6px, #00000033 6px, #00000033 12px)`, justifyContent: 'center', alignItems: 'center', gap: 6, cursor: 'default', border: '2px solid #c9a24a88' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: deck === 'Character' ? FACE.character.bg : FACE.armyMuster.bg, borderRadius: 4, padding: '1px 4px', boxShadow: '0 1px 3px #000' }}>{stacked ? (deck === 'Character' ? 'Char' : 'Strat') : deck}</span>
          </div>
        );
      })}
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

/** The cards face-up ON THE TABLE, both sides' — public information, and nothing you
 *  can play, so they sit with the board state rather than crowding the cards that are
 *  yours (player report 572i6e714m1d2j3t). */
export function TabledStrip({ view, onHoverCard }: { view: GameState; onHoverCard?: (id: string | null) => void }) {
  const tabled = [...(view.cards?.fp?.table ?? []), ...(view.cards?.shadow?.table ?? [])];
  const [zoom, setZoom] = useState<string | null>(null);
  if (tabled.length === 0) return null;
  return (
    <div style={{ background: '#14110b' }}>
      <div style={wrap}>
        <span style={label}>In play:</span>
        {tabled.map((id, i) => <HandCard key={`t${i}`} id={id} onZoom={() => setZoom(id)} onHover={onHoverCard} />)}
      </div>
      {zoom && <CardZoom id={zoom} onClose={() => setZoom(null)} />}
    </div>
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
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.2 }}>{def?.name ?? id}</div>
    </div>
  );
}

// Click-to-enlarge: full card art (or full text) over a dimmed backdrop. Exported so
// the opponent's-turn recap can pop the same enlarged view from a logged card play.
export function CardZoom({ id, onClose, onPlay }: { id: string; onClose: () => void;
  /** Touch screens: play the card from its enlarged view (see touchScreen). */
  onPlay?: () => void }) {
  const art = useCardArt(id);
  const def = CARD.get(id);
  return (
    <div style={{ ...zoomBackdrop, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }} onClick={onClose}>
      {onPlay && (
        <div style={{ display: 'flex', gap: 8 }} onClick={(e) => e.stopPropagation()}>
          <button onClick={onPlay} data-testid="zoom-play"
            style={{ padding: '10px 22px', fontSize: 16, fontWeight: 700, borderRadius: 8, background: '#4a5a3a', color: '#f0e9d8', border: '1px solid #6a7', cursor: 'pointer' }}>Play this card</button>
          <button onClick={onClose} style={{ padding: '10px 18px', fontSize: 16, borderRadius: 8, background: '#3a3326', color: '#f0e9d8', border: '1px solid #554', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {art ? (
        <img src={art} alt={def?.name ?? id} style={{ maxHeight: onPlay ? '78vh' : '88vh', maxWidth: '88vw', borderRadius: 8, boxShadow: '0 8px 40px #000' }} />
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
// No scrollbar at all on the card rows (see ScrollRow): one that came and went with the
// hand's size moved everything below it (player reports 6p3u624f0c6e0s2w,
// 6c2d1z2v2r2q175y).
const handWrap: React.CSSProperties = { ...wrap, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' };
const fade: React.CSSProperties = { position: 'absolute', top: 0, bottom: 0, width: 30, pointerEvents: 'none', display: 'flex', alignItems: 'center', padding: '0 3px', color: '#e6c06a', fontSize: 22, fontWeight: 700, textShadow: '0 0 4px #000' };
const label: React.CSSProperties = { fontSize: 11, color: '#998', alignSelf: 'center', marginRight: 2, whiteSpace: 'nowrap', flexShrink: 0 };
// A hand card is clicked to PLAY it, so nothing on it should offer a text cursor or
// swallow the click — the type badge over its corner did both (player report
// 12295h3l3m5w3y3t).
const img: React.CSSProperties = { height: 104, width: 'auto', borderRadius: 4, flexShrink: 0, boxShadow: '0 1px 4px #000', cursor: 'pointer', userSelect: 'none' };
// Above the status bar's drop-downs (70) and the Report button (71) — an enlarged card
// opened from a drop-down sat under it (player report 5657121k373p5j0w).
const zoomBackdrop: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(8,6,3,0.8)', display: 'grid', placeItems: 'center', zIndex: 78, cursor: 'zoom-out' };
const zoomText: React.CSSProperties = { background: '#211c14', color: '#eee', fontFamily: 'system-ui', padding: 20, borderRadius: 10, maxWidth: 'min(440px, 92vw)', cursor: 'default' };
const zoomReq: React.CSSProperties = { color: '#d8b48c', fontStyle: 'italic' };
const textCard: React.CSSProperties = { width: 76, height: 104, flexShrink: 0, borderRadius: 4, padding: 4, userSelect: 'none', color: '#f0e9d8', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: '1px solid #443', fontSize: 9 };
