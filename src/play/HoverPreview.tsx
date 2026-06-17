// Hover inspector shown in the right column under the action panel. Mousing over a
// board region shows a zoomed crop of the map there (plus the region's name and
// contents); mousing over a hand card shows the card enlarged. Read-only — it never
// submits actions, just magnifies whatever the cursor is over.
import { useLayoutEffect, useRef, useState } from 'react';
import { useCardArt, useBoardArt } from './artCache';
import { regionPolygon, mapImage } from '../data/geometry';
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';
import { FP_NATIONS } from '../engine/types';
import type { GameState, Nation } from '../engine/types';
import { charName, charDef } from './charInfo';
import { CardTypeBadge } from './cardTypeBadge';

export type Hover = { kind: 'region'; id: string } | { kind: 'card'; id: string } | { kind: 'character'; id: string } | null;

const regions = (mapData as { regions: Record<string, { name?: string; nation: Nation | null; settlement: string | null; vp: number }> }).regions;
const CARD = new Map<string, any>((eventCards as { cards: any[] }).cards.map((c) => [c.id, c]));
const FP_SET = new Set<string>(FP_NATIONS);
const NATION_COLOR: Record<string, string> = {
  dwarves: '#7a5230', elves: '#5fbf6a', gondor: '#2f4f9e', north: '#7fb6e6',
  rohan: '#2e7d4f', isengard: '#c9b037', sauron: '#a83232', southrons: '#d98a3d',
};
const polyPath = (poly: { x: number; y: number }[]) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function HoverPreview({ hover, view, bottom }: { hover: Hover; view: GameState; bottom?: boolean }) {
  // Bottom bar: a wide horizontal inspector (thumbnail + readable text) that fills
  // the otherwise-empty space beside the hand.
  if (bottom) {
    return (
      <div style={bottomPanel}>
        {hover?.kind === 'region' ? <RegionPreview id={hover.id} view={view} bottom />
          : hover?.kind === 'card' ? <CardPreview id={hover.id} bottom />
            : hover?.kind === 'character' ? <CharacterPreview id={hover.id} bottom />
              : <div style={{ ...hint, alignSelf: 'center' }}>Hover a card, a region, the Guide, or an action to inspect it here. Click any card to enlarge it full-screen.</div>}
      </div>
    );
  }
  return (
    <div style={panel}>
      <FitBox dep={hover ? `${hover.kind}:${hover.id}` : 'none'}>
        {hover?.kind === 'region' ? <RegionPreview id={hover.id} view={view} />
          : hover?.kind === 'card' ? <CardPreview id={hover.id} />
            : hover?.kind === 'character' ? <CharacterPreview id={hover.id} />
              : <div style={hint}>Hover the board, a card, or the Guide to inspect it here.</div>}
      </FitBox>
    </div>
  );
}

// Scales its content down (never up) so it always fits the panel's height — no
// scrollbars to chase (moving to a scrollbar would drop the hover and clear this).
function FitBox({ dep, children }: { dep: string; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current, content = contentRef.current;
    if (!box || !content) return;
    // scrollHeight is the natural (pre-transform) layout height, so the ratio is stable.
    const fit = () => {
      const avail = box.clientHeight, natural = content.scrollHeight;
      setScale(natural > 0 && avail > 0 ? Math.min(1, avail / natural) : 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [dep]);
  return (
    <div ref={boxRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <div ref={contentRef} style={{ transformOrigin: 'top left', transform: scale < 1 ? `scale(${scale})` : undefined, width: '100%' }}>
        {children}
      </div>
    </div>
  );
}

function RegionPreview({ id, view, bottom }: { id: string; view: GameState; bottom?: boolean }) {
  const boardArt = useBoardArt();
  const poly = regionPolygon(id);
  const def = regions[id];
  const r = view.regions[id];
  if (!poly) return <div style={hint}>{def?.name ?? id}</div>;
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY, pad = Math.max(w, h) * 0.25;
  const vb = `${minX - pad} ${minY - pad} ${w + 2 * pad} ${h + 2 * pad}`;
  const fill = def?.nation ? NATION_COLOR[def.nation] ?? '#888' : '#cfcab8';

  // Per-NATION unit breakdown, so North / Elves / Dwarves etc. are distinguishable.
  const nationLines = Object.entries(r?.units ?? {})
    .filter(([, u]) => u!.regular + u!.elite > 0)
    .map(([n, u]) => ({ nation: n as Nation, reg: u!.regular, elite: u!.elite }))
    .sort((a, b) => (FP_SET.has(a.nation) ? 0 : 1) - (FP_SET.has(b.nation) ? 0 : 1));
  const control = r?.control ? (r.control === 'fp' ? 'Free Peoples' : 'Shadow') : (def?.nation ? (FP_SET.has(def.nation) ? 'Free Peoples' : 'Shadow') : null);

  const crop = (
    <svg viewBox={vb} style={bottom
      ? { height: '100%', width: 'auto', maxWidth: '45%', display: 'block', borderRadius: 6, background: '#9fb8cf', flexShrink: 0 }
      : { width: '100%', height: 'auto', display: 'block', borderRadius: 6, background: '#9fb8cf' }}>
      {boardArt
        ? <image href={boardArt} x={0} y={0} width={mapImage.width} height={mapImage.height} preserveAspectRatio="none" />
        : <path d={polyPath(poly)} fill={fill} fillOpacity={0.5} />}
      <path d={polyPath(poly)} fill="none" stroke="#fff200" strokeWidth={Math.max(w, h) * 0.02} />
    </svg>
  );
  const facts = (
    <div style={{ ...info, ...(bottom ? { overflowY: 'auto', flex: 1, minWidth: 0 } : {}) }}>
      <div style={{ fontWeight: 700, fontSize: bottom ? 16 : 14 }}>{def?.name ?? id}</div>
      <div style={{ color: '#b9b29c', fontSize: 12 }}>
        {def?.settlement ?? 'open region'}{def?.vp ? ` · ${def.vp} VP` : ''}{control ? ` · ${control}` : ''}{r?.besieged ? ' · besieged' : ''}
      </div>
      {nationLines.map((nl) => (
        <div key={nl.nation} style={{ color: NATION_COLOR[nl.nation] ?? '#ccc', fontSize: 12, fontWeight: 600 }}>
          {cap(nl.nation)}: {nl.reg}R / {nl.elite}E
        </div>
      ))}
      {(r?.leaders ?? 0) > 0 && <div style={{ color: '#cfd8e6', fontSize: 12 }}>{r!.leaders} Free Peoples Leader{r!.leaders > 1 ? 's' : ''}</div>}
      {(r?.nazgul ?? 0) > 0 && <div style={{ color: '#e6857f', fontSize: 12 }}>{r!.nazgul} Nazgûl</div>}
      {(r?.characters?.length ?? 0) > 0 && <div style={{ color: '#d9c98a', fontSize: 12 }}>Characters: {r!.characters.map(charName).join(', ')}</div>}
    </div>
  );
  return bottom
    ? <div style={{ display: 'flex', gap: 12, height: '100%', padding: 8, boxSizing: 'border-box' }}>{crop}{facts}</div>
    : <div>{crop}{facts}</div>;
}

function CardPreview({ id, bottom }: { id: string; bottom?: boolean }) {
  const art = useCardArt(id === 'hidden' ? null : id);
  const def = CARD.get(id);
  if (id === 'hidden') return <div style={hint}>Hidden card.</div>;
  const text = (
    <div style={{ overflowY: 'auto', minWidth: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <CardTypeBadge deck={def?.deck} />
        <span style={{ fontSize: 11, color: '#ccb', textTransform: 'uppercase' }}>{def?.side} · init {def?.initiative ?? '–'}</span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, margin: '2px 0 6px' }}>{def?.name ?? id}</div>
      {def?.eventText && <p style={{ fontSize: 13, margin: '4px 0', lineHeight: 1.35 }}><b>Event:</b> {def.eventText}</p>}
      {def?.combat?.title && <p style={{ fontSize: 13, margin: '4px 0', lineHeight: 1.35 }}><b>Combat — {def.combat.title}:</b> {def.combat.text}</p>}
    </div>
  );
  if (bottom) {
    // Wide inspector: thumbnail (sized to the bar) + the full transcribed text, which
    // is legible even though the card image itself is small.
    return (
      <div style={{ display: 'flex', gap: 12, height: '100%', padding: 8, boxSizing: 'border-box' }}>
        {art && <img src={art} alt={def?.name ?? id} style={{ height: '100%', width: 'auto', borderRadius: 6, flexShrink: 0 }} />}
        {text}
      </div>
    );
  }
  if (art) return <img src={art} alt={def?.name ?? id} style={{ width: '100%', borderRadius: 8, display: 'block' }} />;
  return <div style={info}>{text}</div>;
}

function CharacterPreview({ id, bottom }: { id: string; bottom?: boolean }) {
  const d = charDef(id);
  const art = useCardArt(id);
  if (!d) return <div style={hint}>{charName(id)}</div>;
  const text = (
    <div style={{ ...info, ...(bottom ? { padding: 10, overflowY: 'auto', flex: 1, minWidth: 0, boxSizing: 'border-box' } : {}) }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{d.name}</div>
      {d.title && <div style={{ color: '#b9b29c', fontSize: 12, fontStyle: 'italic' }}>{d.title}</div>}
      <div style={{ color: '#d9c98a', fontSize: 12 }}>Level {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Leadership ${d.leadership}` : ''}</div>
      {d.guide && <p style={{ fontSize: 12, margin: '4px 0' }}><b>Guide:</b> {d.guide}</p>}
      {d.becomesGuide && <p style={{ fontSize: 12, margin: '4px 0' }}><b>Becomes Guide:</b> {d.becomesGuide}</p>}
      {d.abilities?.map((a, i) => <p key={i} style={{ fontSize: 12, margin: '4px 0' }}><b>{a.name}:</b> {a.text}</p>)}
    </div>
  );
  // Show the actual character card image when art has been downloaded; otherwise the
  // transcribed text alone (fully legible). In the wide bottom bar, art sits beside text.
  if (bottom) {
    return (
      <div style={{ display: 'flex', gap: 12, height: '100%', padding: 8, boxSizing: 'border-box' }}>
        {art && <img src={art} alt={d.name} style={{ height: '100%', width: 'auto', borderRadius: 6, flexShrink: 0 }} />}
        {text}
      </div>
    );
  }
  return art ? <img src={art} alt={d.name} style={{ width: '100%', borderRadius: 8, display: 'block' }} /> : text;
}

const panel: React.CSSProperties = { borderTop: '1px solid #2a2418', padding: 8, fontFamily: 'system-ui', color: '#e9e1cc', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const bottomPanel: React.CSSProperties = { height: '100%', fontFamily: 'system-ui', color: '#e9e1cc', display: 'flex', overflow: 'hidden', background: '#14110b' };
const hint: React.CSSProperties = { color: '#776', fontSize: 12, fontStyle: 'italic', padding: '12px 4px' };
const info: React.CSSProperties = { padding: '6px 2px', display: 'flex', flexDirection: 'column', gap: 2 };
