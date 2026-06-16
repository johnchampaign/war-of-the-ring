// The Middle-earth board: the real map image (first-run download) behind the
// region polygons, with army badges laid out inside each region via the
// framework's layoutTokensInPolygon. WotR has no 2D unit art (the pieces are
// miniatures), so armies render as informative tokens — side colour, regular vs
// elite split, leader/Nazgûl pip. Without the downloaded map it falls back to
// nation-coloured polygons; fully playable either way.
import { memo, useMemo } from 'react';
import { layoutTokensInPolygon } from 'digital-boardgame-framework';
import { useBoardArt } from './artCache';
import { regionIds, regionPolygon, mapImage } from '../data/geometry';
import mapData from '../../assets/map.json';
import { FP_NATIONS } from '../engine/types';
import type { GameState, RegionId, Nation, Side } from '../engine/types';

const NATION_COLOR: Record<string, string> = {
  dwarves: '#7a5230', elves: '#5fbf6a', gondor: '#2f4f9e', north: '#7fb6e6',
  rohan: '#2e7d4f', isengard: '#c9b037', sauron: '#a83232', southrons: '#d98a3d',
};
const regions = (mapData as { regions: Record<string, { name?: string; nation: Nation | null; settlement: string | null; vp: number }> }).regions;
const rName = (id: RegionId): string => regions[id]?.name ?? id;
const FP_SET = new Set<string>(FP_NATIONS);

const polyPath = (poly: { x: number; y: number }[]) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

// One army badge per side present in a region, with the regular/elite split and
// the side's leader figures (FP grey Leaders / Shadow Nazgûl). WotR has no 2D
// unit art (the pieces are miniatures), so these are informative tokens: side
// colour, regulars vs elites (gold), and a leader/Nazgûl pip.
interface ArmyInfo { side: Side; reg: number; elite: number; leaders: number; nazgul: number }
function presentArmies(r: GameState['regions'][string]): ArmyInfo[] {
  let fpReg = 0, fpElite = 0, shReg = 0, shElite = 0;
  for (const [nation, u] of Object.entries(r.units)) {
    if (FP_SET.has(nation)) { fpReg += u!.regular; fpElite += u!.elite; }
    else { shReg += u!.regular; shElite += u!.elite; }
  }
  const out: ArmyInfo[] = [];
  if (fpReg + fpElite + r.leaders > 0) out.push({ side: 'fp', reg: fpReg, elite: fpElite, leaders: r.leaders, nazgul: 0 });
  if (shReg + shElite + r.nazgul > 0) out.push({ side: 'shadow', reg: shReg, elite: shElite, leaders: 0, nazgul: r.nazgul });
  return out;
}

export interface BoardHighlights {
  sources?: Set<RegionId>;       // regions you can act FROM (green)
  selected?: RegionId | null;    // the chosen source (bright)
  destinations?: Set<RegionId>;  // valid targets for the chosen source (yellow)
}

export const Board = memo(function Board({ view, onPickRegion, onHoverRegion, highlights }: {
  view: GameState; onPickRegion?: (id: RegionId) => void; onHoverRegion?: (id: RegionId | null) => void; highlights?: BoardHighlights;
}) {
  const W = mapImage.width, H = mapImage.height;
  const hl = highlights ?? {};
  const boardArt = useBoardArt(); // map_en.jpg (1920x1324), aligns 1:1 with the polygons

  const regionEls = useMemo(() => regionIds.map((id) => {
    const poly = regionPolygon(id);
    if (!poly) return null;
    const def = regions[id];
    const fill = def?.nation ? NATION_COLOR[def.nation] ?? '#888' : '#cfcab8';
    const r = view.regions[id];
    const armies = r ? presentArmies(r) : [];
    const layout = armies.length ? layoutTokensInPolygon(poly, armies.length, { tokenRadius: 22 }) : null;
    const control = r?.control;
    return { id, poly, fill, def, armies, layout, control, r };
  }), [view]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="#9fb8cf" />
      {/* Real board image (first-run download) sits behind the polygons, aligned
          1:1 to their pixel space. When present, region fills go near-transparent
          so the map shows through; strokes/highlights stay for click targeting. */}
      {boardArt && <image href={boardArt} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
      {regionEls.map((e) => e && (
        <g key={e.id} onClick={() => onPickRegion?.(e.id)}
          onMouseEnter={() => onHoverRegion?.(e.id)} onMouseLeave={() => onHoverRegion?.(null)}
          style={{ cursor: onPickRegion ? 'pointer' : 'default' }}>
          <title>{rName(e.id)}{e.def?.settlement ? ` — ${e.def.settlement}` : ''}</title>
          <path d={polyPath(e.poly)} fill={e.fill}
            fillOpacity={boardArt ? (hl.selected === e.id ? 0.3 : hl.destinations?.has(e.id) || hl.sources?.has(e.id) ? 0.18 : 0) : (hl.selected === e.id ? 0.75 : 0.5)}
            stroke={hl.selected === e.id ? '#fff200' : hl.destinations?.has(e.id) ? '#ffd23f' : hl.sources?.has(e.id) ? '#5dff7a' : '#3a3a3a'}
            strokeWidth={hl.selected === e.id || hl.destinations?.has(e.id) ? 4 : hl.sources?.has(e.id) ? 3 : 1.2} />
          {/* settlement marker */}
          {e.def?.settlement && (
            <rect x={e.poly[0]!.x - 5} y={e.poly[0]!.y - 5} width={10} height={10}
              fill={e.control === 'shadow' ? '#a83232' : e.control === 'fp' ? '#2f4f9e' : '#fff'}
              stroke="#222" strokeWidth={1} transform={`rotate(45 ${e.poly[0]!.x} ${e.poly[0]!.y})`} />
          )}
          {/* army badges (one per side present) */}
          {e.armies.map((a, i) => {
            const pt = e.layout && !e.layout.stacked && e.layout.points[i]
              ? e.layout.points[i]
              : { x: (e.layout?.anchor.x ?? e.poly[0]!.x), y: (e.layout?.anchor.y ?? e.poly[0]!.y) + i * 22 };
            return <ArmyBadge key={a.side} x={pt.x} y={pt.y} scale={e.layout?.scale ?? 1} army={a} />;
          })}
          {/* separated companions / minions / Witch-king present in the region */}
          {e.r && e.r.characters.length > 0 && (
            <circle cx={(e.layout?.anchor.x ?? e.poly[0]!.x) - 16} cy={(e.layout?.anchor.y ?? e.poly[0]!.y) - 16} r={6} fill="#2a1d3a" stroke="#fff" strokeWidth={1} />
          )}
        </g>
      ))}
      {/* Fellowship marker (last-known position) */}
      <FellowshipMarker view={view} />
    </svg>
  );
});

// An army marker: a two-tone pill — side colour for Regulars, gold for Elites —
// plus a corner pip counting Leaders (FP) / Nazgûl (Shadow). Sized to stay legible
// at fit-to-width zoom without overwhelming the small regions.
function ArmyBadge({ x, y, scale, army }: { x: number; y: number; scale: number; army: ArmyInfo }) {
  const { side, reg, elite, leaders, nazgul } = army;
  const col = side === 'shadow' ? '#b8332b' : '#2c5fb3';
  const s = Math.min(1, Math.max(0.6, scale));
  const W = 34, H = 20;
  const both = reg > 0 && elite > 0;
  const special = leaders + nazgul;
  const label = `${side === 'shadow' ? 'Shadow' : 'Free Peoples'}: ${reg} Regular${reg === 1 ? '' : 's'}, ${elite} Elite${elite === 1 ? '' : 's'}` +
    (leaders ? `, ${leaders} Leader${leaders === 1 ? '' : 's'}` : '') + (nazgul ? `, ${nazgul} Nazgûl` : '');
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <title>{label}</title>
      <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={5} fill={elite > 0 && reg === 0 ? '#e8c14a' : col} stroke="#fff" strokeWidth={1.2} />
      {both && <rect x={0} y={-H / 2} width={W / 2} height={H} rx={5} fill="#e8c14a" stroke="#fff" strokeWidth={1.2} />}
      {reg > 0 && <text x={both ? -W / 4 : 0} y={4.5} fontSize={13} fontWeight="bold" fill="#fff" textAnchor="middle">{reg}</text>}
      {elite > 0 && <text x={both ? W / 4 : 0} y={4.5} fontSize={13} fontWeight="bold" fill="#3a2a00" textAnchor="middle">{elite}</text>}
      {special > 0 && (
        <g>
          <circle cx={W / 2 - 1} cy={-H / 2 + 1} r={6.5} fill={nazgul > 0 ? '#141414' : '#f4e7c0'} stroke="#fff" strokeWidth={1} />
          <text x={W / 2 - 1} y={-H / 2 + 4} fontSize={9} fontWeight="bold" fill={nazgul > 0 ? '#fff' : '#222'} textAnchor="middle">{special}</text>
        </g>
      )}
    </g>
  );
}

function FellowshipMarker({ view }: { view: GameState }) {
  const poly = regionPolygon(view.fellowship.location);
  if (!poly) return null;
  const anchor = layoutTokensInPolygon(poly, 1, { tokenRadius: 9 }).anchor;
  const x = anchor.x - 12, y = anchor.y - 12;
  return (
    <g>
      <circle cx={anchor.x} cy={anchor.y} r={13} fill="#f2e6c2" stroke="#7a5a1e" strokeWidth={2} />
      <text x={anchor.x} y={anchor.y + 5} fontSize={15} textAnchor="middle">💍</text>
      {!view.fellowship.hidden && <circle cx={x + 24} cy={y} r={6} fill="#c0392b" stroke="#fff" strokeWidth={1} />}
    </g>
  );
}
