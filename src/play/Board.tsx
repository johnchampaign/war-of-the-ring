// The Middle-earth board, PLACEHOLDER mode: region polygons (filled by Nation
// colour) + tokens laid out inside each region via the framework's
// layoutTokensInPolygon (the polygon token-placement work). No publisher art —
// fully playable. The real board image is a first-run download, layered on later.
import { useMemo } from 'react';
import { layoutTokensInPolygon } from 'digital-boardgame-framework';
import { regionIds, regionPolygon, mapImage } from '../data/geometry';
import mapData from '../../assets/map.json';
import type { GameState, RegionId, Nation, Side } from '../engine/types';

const NATION_COLOR: Record<string, string> = {
  dwarves: '#7a5230', elves: '#5fbf6a', gondor: '#2f4f9e', north: '#7fb6e6',
  rohan: '#2e7d4f', isengard: '#c9b037', sauron: '#a83232', southrons: '#d98a3d',
};
const regions = (mapData as { regions: Record<string, { nation: Nation | null; settlement: string | null; vp: number }> }).regions;

const polyPath = (poly: { x: number; y: number }[]) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

function unitTotal(r: GameState['regions'][string]): { fp: number; shadow: number } {
  let fp = 0, shadow = 0;
  for (const [nation, u] of Object.entries(r.units)) {
    const n = u!.regular + u!.elite;
    if (['dwarves', 'elves', 'gondor', 'north', 'rohan'].includes(nation)) fp += n; else shadow += n;
  }
  return { fp, shadow };
}

export interface BoardHighlights {
  sources?: Set<RegionId>;       // regions you can act FROM (green)
  selected?: RegionId | null;    // the chosen source (bright)
  destinations?: Set<RegionId>;  // valid targets for the chosen source (yellow)
}

export function Board({ view, onPickRegion, highlights }: {
  view: GameState; onPickRegion?: (id: RegionId) => void; highlights?: BoardHighlights;
}) {
  const W = mapImage.width, H = mapImage.height;
  const hl = highlights ?? {};

  const regionEls = useMemo(() => regionIds.map((id) => {
    const poly = regionPolygon(id);
    if (!poly) return null;
    const def = regions[id];
    const fill = def?.nation ? NATION_COLOR[def.nation] ?? '#888' : '#cfcab8';
    const r = view.regions[id];
    const { fp, shadow } = r ? unitTotal(r) : { fp: 0, shadow: 0 };
    const total = fp + shadow;
    const side: Side | null = total ? (fp >= shadow ? 'fp' : 'shadow') : null;
    const layout = total ? layoutTokensInPolygon(poly, Math.min(total, 10), { tokenRadius: 11 }) : null;
    const control = r?.control;
    return { id, poly, fill, def, total, side, layout, control, r };
  }), [view]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x={0} y={0} width={W} height={H} fill="#9fb8cf" />
      {regionEls.map((e) => e && (
        <g key={e.id} onClick={() => onPickRegion?.(e.id)} style={{ cursor: onPickRegion ? 'pointer' : 'default' }}>
          <path d={polyPath(e.poly)} fill={e.fill}
            fillOpacity={hl.selected === e.id ? 0.75 : 0.5}
            stroke={hl.selected === e.id ? '#fff200' : hl.destinations?.has(e.id) ? '#ffd23f' : hl.sources?.has(e.id) ? '#5dff7a' : '#3a3a3a'}
            strokeWidth={hl.selected === e.id || hl.destinations?.has(e.id) ? 4 : hl.sources?.has(e.id) ? 3 : 1.2} />
          {/* settlement marker */}
          {e.def?.settlement && (
            <rect x={e.poly[0]!.x - 5} y={e.poly[0]!.y - 5} width={10} height={10}
              fill={e.control === 'shadow' ? '#a83232' : e.control === 'fp' ? '#2f4f9e' : '#fff'}
              stroke="#222" strokeWidth={1} transform={`rotate(45 ${e.poly[0]!.x} ${e.poly[0]!.y})`} />
          )}
          {/* tokens */}
          {e.layout && !e.layout.stacked && e.layout.points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={11 * e.layout!.scale}
              fill={e.side === 'shadow' ? '#c0392b' : '#2c5fb3'} stroke="#fff" strokeWidth={1} />
          ))}
          {e.layout?.stacked && (
            <>
              <circle cx={e.layout.anchor.x} cy={e.layout.anchor.y} r={14}
                fill={e.side === 'shadow' ? '#c0392b' : '#2c5fb3'} stroke="#fff" strokeWidth={1.5} />
              <text x={e.layout.anchor.x} y={e.layout.anchor.y + 5} fontSize={15} textAnchor="middle" fill="#fff" fontWeight="bold">{e.total}</text>
            </>
          )}
          {/* nazgûl / characters dots */}
          {e.r && (e.r.nazgul > 0 || e.r.characters.length > 0) && (
            <circle cx={(e.layout?.anchor.x ?? e.poly[0]!.x) + 16} cy={(e.layout?.anchor.y ?? e.poly[0]!.y) - 16} r={6} fill="#111" stroke="#fff" strokeWidth={1} />
          )}
        </g>
      ))}
      {/* Fellowship marker (last-known position) */}
      <FellowshipMarker view={view} />
    </svg>
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
