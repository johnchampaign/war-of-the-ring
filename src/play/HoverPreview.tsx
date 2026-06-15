// Hover inspector shown in the right column under the action panel. Mousing over a
// board region shows a zoomed crop of the map there (plus the region's name and
// contents); mousing over a hand card shows the card enlarged. Read-only — it never
// submits actions, just magnifies whatever the cursor is over.
import { useCardArt, useBoardArt } from './artCache';
import { regionPolygon, mapImage } from '../data/geometry';
import mapData from '../../assets/map.json';
import eventCards from '../../assets/event-cards.json';
import { FP_NATIONS } from '../engine/types';
import type { GameState, Nation } from '../engine/types';
import { charName, charDef } from './charInfo';

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

export function HoverPreview({ hover, view }: { hover: Hover; view: GameState }) {
  return (
    <div style={panel}>
      {hover?.kind === 'region' ? <RegionPreview id={hover.id} view={view} />
        : hover?.kind === 'card' ? <CardPreview id={hover.id} />
          : hover?.kind === 'character' ? <CharacterPreview id={hover.id} />
            : <div style={hint}>Hover the board, a card, or the Guide to inspect it here.</div>}
    </div>
  );
}

function RegionPreview({ id, view }: { id: string; view: GameState }) {
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

  // Per-side unit summary.
  let fpReg = 0, fpElite = 0, shReg = 0, shElite = 0;
  for (const [n, u] of Object.entries(r?.units ?? {})) {
    if (FP_SET.has(n)) { fpReg += u!.regular; fpElite += u!.elite; } else { shReg += u!.regular; shElite += u!.elite; }
  }
  const control = r?.control ? (r.control === 'fp' ? 'Free Peoples' : 'Shadow') : (def?.nation ? (FP_SET.has(def.nation) ? 'Free Peoples' : 'Shadow') : null);

  return (
    <div>
      <svg viewBox={vb} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, background: '#9fb8cf' }}>
        {boardArt
          ? <image href={boardArt} x={0} y={0} width={mapImage.width} height={mapImage.height} preserveAspectRatio="none" />
          : <path d={polyPath(poly)} fill={fill} fillOpacity={0.5} />}
        <path d={polyPath(poly)} fill="none" stroke="#fff200" strokeWidth={Math.max(w, h) * 0.02} />
      </svg>
      <div style={info}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{def?.name ?? id}</div>
        <div style={{ color: '#b9b29c', fontSize: 12 }}>
          {def?.settlement ?? 'open region'}{def?.vp ? ` · ${def.vp} VP` : ''}{control ? ` · ${control}` : ''}{r?.besieged ? ' · besieged' : ''}
        </div>
        {(fpReg + fpElite + (r?.leaders ?? 0)) > 0 && <div style={{ color: '#7fb6e6', fontSize: 12 }}>FP: {fpReg}R / {fpElite}E{r?.leaders ? ` · ${r.leaders} Leader${r.leaders > 1 ? 's' : ''}` : ''}</div>}
        {(shReg + shElite + (r?.nazgul ?? 0)) > 0 && <div style={{ color: '#e6857f', fontSize: 12 }}>Shadow: {shReg}R / {shElite}E{r?.nazgul ? ` · ${r.nazgul} Nazgûl` : ''}</div>}
        {(r?.characters?.length ?? 0) > 0 && <div style={{ color: '#d9c98a', fontSize: 12 }}>Characters: {r!.characters.map(charName).join(', ')}</div>}
      </div>
    </div>
  );
}

function CardPreview({ id }: { id: string }) {
  const art = useCardArt(id === 'hidden' ? null : id);
  const def = CARD.get(id);
  if (id === 'hidden') return <div style={hint}>Hidden card.</div>;
  if (art) return <img src={art} alt={def?.name ?? id} style={{ width: '100%', borderRadius: 8, display: 'block' }} />;
  return (
    <div style={info}>
      <div style={{ fontSize: 11, color: '#ccb', textTransform: 'uppercase' }}>{def?.side} · {def?.deck} · init {def?.initiative ?? '–'}</div>
      <h3 style={{ margin: '4px 0' }}>{def?.name ?? id}</h3>
      {def?.eventText && <p style={{ fontSize: 13, margin: '4px 0' }}><b>Event:</b> {def.eventText}</p>}
      {def?.combat?.title && <p style={{ fontSize: 13, margin: '4px 0' }}><b>Combat — {def.combat.title}:</b> {def.combat.text}</p>}
    </div>
  );
}

function CharacterPreview({ id }: { id: string }) {
  const d = charDef(id);
  if (!d) return <div style={hint}>{charName(id)}</div>;
  return (
    <div style={info}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{d.name}</div>
      {d.title && <div style={{ color: '#b9b29c', fontSize: 12, fontStyle: 'italic' }}>{d.title}</div>}
      <div style={{ color: '#d9c98a', fontSize: 12 }}>Level {d.level === 'inf' ? '∞' : d.level}{d.leadership ? ` · Leadership ${d.leadership}` : ''}</div>
      {d.guide && <p style={{ fontSize: 12, margin: '4px 0' }}><b>Guide:</b> {d.guide}</p>}
      {d.becomesGuide && <p style={{ fontSize: 12, margin: '4px 0' }}><b>Becomes Guide:</b> {d.becomesGuide}</p>}
      {d.abilities?.map((a, i) => <p key={i} style={{ fontSize: 12, margin: '4px 0' }}><b>{a.name}:</b> {a.text}</p>)}
    </div>
  );
}

const panel: React.CSSProperties = { borderTop: '1px solid #2a2418', padding: 8, fontFamily: 'system-ui', color: '#e9e1cc', overflow: 'auto' };
const hint: React.CSSProperties = { color: '#776', fontSize: 12, fontStyle: 'italic', padding: '12px 4px' };
const info: React.CSSProperties = { padding: '6px 2px', display: 'flex', flexDirection: 'column', gap: 2 };
