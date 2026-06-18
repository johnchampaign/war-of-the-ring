// The Middle-earth board: the real map image (first-run download) behind the
// region polygons, with army badges laid out inside each region via the
// framework's layoutTokensInPolygon. WotR has no 2D unit art (the pieces are
// miniatures), so armies render as informative tokens — side colour, regular vs
// elite split, leader/Nazgûl pip. Without the downloaded map it falls back to
// nation-coloured polygons; fully playable either way.
import { memo, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { layoutTokensInPolygon } from 'digital-boardgame-framework';
import { useBoardArt } from './artCache';
import { regionIds, regionPolygon, mapImage } from '../data/geometry';
import { blockedAreas, blockedAreaPath } from '../data/blockedAreas';

// Compute, once the board image is available, a per-mask fill that BLENDS with the
// surrounding board instead of a harsh black box (Ira #7). For each blocked area we
// sample the image just OUTSIDE its outline (vertices + edge midpoints, nudged
// outward from the centroid) and average those pixels — so the unused printed strip
// is painted over with the colour of the board around it. Blob-sourced images are
// same-origin, so the canvas isn't tainted and getImageData works.
const MASK_FALLBACK = 'rgba(8,6,3,0.82)';
function useMaskBlendColors(boardArt: string | null): string[] | null {
  const [colors, setColors] = useState<string[] | null>(null);
  useEffect(() => {
    if (!boardArt || blockedAreas.length === 0) { setColors(null); return; }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        // Polygon coords are in mapImage space; scale to the image's natural pixels.
        const sx = img.naturalWidth / mapImage.width, sy = img.naturalHeight / mapImage.height;
        const sampleAt = (x: number, y: number): [number, number, number] | null => {
          const px = Math.round(x * sx), py = Math.round(y * sy);
          if (px < 0 || py < 0 || px >= cv.width || py >= cv.height) return null;
          const d = ctx.getImageData(px, py, 1, 1).data;
          return d[3] === 0 ? null : [d[0]!, d[1]!, d[2]!];
        };
        const out = blockedAreas.map((a) => {
          const pts = a.polygon;
          const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
          const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          const M = 14; // px to nudge the sample point outward, past the outline
          const probes: Array<[number, number]> = [];
          for (let i = 0; i < pts.length; i++) {
            const v = pts[i]!, n = pts[(i + 1) % pts.length]!;
            probes.push(v, [(v[0] + n[0]) / 2, (v[1] + n[1]) / 2]); // vertex + edge midpoint
          }
          const samples = probes
            .map(([x, y]) => { const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1; return sampleAt(x + (dx / len) * M, y + (dy / len) * M); })
            .filter((s): s is [number, number, number] => s !== null);
          if (!samples.length) return MASK_FALLBACK;
          const a0 = samples.reduce((m, s) => [m[0] + s[0], m[1] + s[1], m[2] + s[2]], [0, 0, 0]);
          return `rgb(${Math.round(a0[0] / samples.length)},${Math.round(a0[1] / samples.length)},${Math.round(a0[2] / samples.length)})`;
        });
        if (!cancelled) setColors(out);
      } catch { /* tainted / OOM — keep the default masks */ }
    };
    img.src = boardArt;
    return () => { cancelled = true; };
  }, [boardArt]);
  return colors;
}

// Board crop rectangle (map-image pixel space) — see the note at its use site for
// why this is hardcoded rather than read from blocked-areas.json.
const BOARD_CROP = { x: 240, y: 2, w: 1511, h: 1318 };
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

// One army badge per NATION present in a region (so North / Elves / Dwarves etc.
// are distinguishable at a glance — the badge is tinted with the Nation's colour),
// with the regular/elite split and a leader/Nazgûl pip. WotR has no 2D unit art
// (the pieces are miniatures), so these are informative tokens.
interface ArmyInfo { side: Side; nation: Nation | null; reg: number; elite: number; leaders: number; nazgul: number }
function presentArmies(r: GameState['regions'][string]): ArmyInfo[] {
  const out: ArmyInfo[] = [];
  for (const [nation, u] of Object.entries(r.units)) {
    if (u!.regular + u!.elite === 0) continue;
    out.push({ side: FP_SET.has(nation) ? 'fp' : 'shadow', nation: nation as Nation, reg: u!.regular, elite: u!.elite, leaders: 0, nazgul: 0 });
  }
  // Region-level Leaders (FP) / Nazgûl (Shadow) attach to that side's first badge,
  // or get their own badge if that side has no units in the region.
  if (r.leaders > 0) { const fp = out.find((a) => a.side === 'fp'); if (fp) fp.leaders = r.leaders; else out.push({ side: 'fp', nation: null, reg: 0, elite: 0, leaders: r.leaders, nazgul: 0 }); }
  if (r.nazgul > 0) { const sh = out.find((a) => a.side === 'shadow'); if (sh) sh.nazgul = r.nazgul; else out.push({ side: 'shadow', nation: null, reg: 0, elite: 0, leaders: 0, nazgul: r.nazgul }); }
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
  const art = useBoardArt(); // map_en.jpg (1920x1324), aligns 1:1 with the polygons
  // Let the player switch to the clean polygon map even when the art is downloaded.
  const [polyOnly, setPolyOnly] = useState(false);
  const boardArt = polyOnly ? null : art;
  // Per-mask fill sampled from the board so the unused printed strips blend in (#7).
  const maskColors = useMaskBlendColors(boardArt);

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

  // --- Zoom / pan (the whole map is detailed; let the player get close to read it).
  // The playable-area crop, in the map image's pixel space, HARDCODED here on
  // purpose: the same rectangle lived in blocked-areas.json, but that data file was
  // repeatedly served to the browser stale (while the JS bundle updated), silently
  // reverting the crop to the full board. Baking it into the bundle guarantees it
  // applies. Coordinates are the authored Board Crop (x 240–1751, y 2–1320).
  const CROP = BOARD_CROP;
  const ASPECT = CROP.h / CROP.w;
  // `null` = show the current crop (default). Only an explicit pan/zoom stores an
  // override. Deriving the default from CROP (instead of seeding state once) means
  // a code change to the crop applies immediately — even over hot-reload, which
  // preserves state and would otherwise keep a stale full-image view.
  const [override, setOverride] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const vb = override ?? CROP;
  const setVb = (next: { x: number; y: number; w: number; h: number } | ((cur: { x: number; y: number; w: number; h: number }) => { x: number; y: number; w: number; h: number })) =>
    setOverride((cur) => (typeof next === 'function' ? next(cur ?? CROP) : next));
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; w: number; h: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const clampVb = (v: { x: number; y: number; w: number; h: number }) => {
    const w = Math.min(CROP.w, Math.max(CROP.w / 8, v.w)), h = w * ASPECT;
    return { w, h, x: Math.min(Math.max(v.x, CROP.x - w * 0.15), CROP.x + CROP.w - w * 0.85), y: Math.min(Math.max(v.y, CROP.y - h * 0.15), CROP.y + CROP.h - h * 0.85) };
  };
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setVb((cur) => {
      const w = Math.min(CROP.w, Math.max(CROP.w / 8, cur.w * factor)), h = w * ASPECT;
      return clampVb({ x: cur.x + px * cur.w - px * w, y: cur.y + py * cur.h - py * h, w, h });
    });
  }, [ASPECT, CROP.w, CROP.x, CROP.h, CROP.y]);
  const onWheel = useCallback((e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.deltaY < 0 ? 0.85 : 1 / 0.85);
  }, [zoomAt]);
  const onPointerDown = (e: React.PointerEvent) => { if (e.button === 0) drag.current = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y, w: vb.w, h: vb.h, moved: false }; };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const r = svgRef.current!.getBoundingClientRect();
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) setVb(clampVb({ x: d.vx - (e.clientX - d.x) / r.width * d.w, y: d.vy - (e.clientY - d.y) / r.height * d.h, w: d.w, h: d.h }));
  };
  const onPointerUp = () => { if (drag.current?.moved) suppressClick.current = true; drag.current = null; };
  const pickRegion = (id: RegionId) => { if (suppressClick.current) { suppressClick.current = false; return; } onPickRegion?.(id); };

  const resetView = () => setOverride(null);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
    {/* Snap back to the default cropped view (also recovers from zoom/pan). */}
    <div style={{ position: 'absolute', top: 6, left: 6, zIndex: 5, display: 'flex', gap: 6 }}>
      <button onClick={resetView} title="Reset view to the board crop"
        style={{ padding: '3px 8px', fontSize: 12, background: 'rgba(28,23,16,0.85)', color: '#e9e1cc', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>
        ⟲ Reset view
      </button>
      {art && (
        <button onClick={() => setPolyOnly((v) => !v)} title="Switch between the board image and the clean polygon map"
          style={{ padding: '3px 8px', fontSize: 12, background: 'rgba(28,23,16,0.85)', color: '#e9e1cc', border: '1px solid #5a4a2a', borderRadius: 6, cursor: 'pointer' }}>
          Map: {polyOnly ? 'Polygon' : 'Image'}
        </button>
      )}
    </div>
    <svg ref={svgRef} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
      style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: onPickRegion ? 'grab' : 'default' }}>
      <rect x={0} y={0} width={W} height={H} fill="#9fb8cf" />
      {/* Real board image (first-run download) sits behind the polygons, aligned
          1:1 to their pixel space. When present, region fills go near-transparent
          so the map shows through; strokes/highlights stay for click targeting. */}
      {boardArt && <image href={boardArt} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
      {regionEls.map((e) => e && (
        <g key={e.id} onClick={() => pickRegion(e.id)}
          onMouseEnter={() => onHoverRegion?.(e.id)} onMouseLeave={() => onHoverRegion?.(null)}
          style={{ cursor: onPickRegion ? 'pointer' : 'default' }}>
          <title>{rName(e.id)}{e.def?.settlement ? ` — ${e.def.settlement}${e.def.vp > 0 ? ` (${e.def.vp} VP)` : ''}` : ''}{e.r?.besieged ? ' — UNDER SIEGE' : ''}</title>
          {/* Over the board image the polygons are invisible at rest — used only for
              hover/click hit-testing (pointerEvents:'all' keeps the transparent fill
              clickable). Only the functional move-highlights (selected / destination /
              source) paint a stroke. Without the image the polygons ARE the map, so
              they keep their nation fill + a faint outline. */}
          <path d={polyPath(e.poly)} fill={e.fill} style={{ pointerEvents: 'all' }}
            fillOpacity={boardArt ? (hl.selected === e.id ? 0.3 : hl.destinations?.has(e.id) || hl.sources?.has(e.id) ? 0.18 : 0) : (hl.selected === e.id ? 0.75 : 0.5)}
            stroke={hl.selected === e.id ? '#fff200' : hl.destinations?.has(e.id) ? '#ffd23f' : hl.sources?.has(e.id) ? '#5dff7a' : (boardArt ? 'none' : '#3a3a3a')}
            strokeWidth={hl.selected === e.id || hl.destinations?.has(e.id) ? 4 : hl.sources?.has(e.id) ? 3 : 1.2} />
          {/* settlement marker — control-coloured diamond, the VP value, and a red
              dashed ring while the Stronghold is under siege (defenders in the box). */}
          {e.def?.settlement && (() => {
            const mx = e.poly[0]!.x, my = e.poly[0]!.y;
            return (
              <g style={{ pointerEvents: 'none' }}>
                {e.r?.besieged && <circle cx={mx} cy={my} r={11} fill="none" stroke="#ff5252" strokeWidth={2} strokeDasharray="3 2" />}
                <rect x={mx - 5} y={my - 5} width={10} height={10}
                  fill={e.control === 'shadow' ? '#a83232' : e.control === 'fp' ? '#2f4f9e' : '#fff'}
                  stroke="#222" strokeWidth={1} transform={`rotate(45 ${mx} ${my})`} />
                {e.def.vp > 0 && <text x={mx + 10} y={my - 5} fontSize={11} fontWeight="bold" fill="#ffe08a" stroke="#000" strokeWidth={0.7} paintOrder="stroke" textAnchor="middle">{e.def.vp}</text>}
              </g>
            );
          })()}
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
      {/* Unused "special areas" printed on the board IMAGE, painted over with a colour
          sampled from the surrounding board so they blend in rather than reading as
          black holes (#7). Only over the image — the polygon map has no such art. */}
      {boardArt && blockedAreas.map((a, i) => (
        <path key={`blocked-${i}`} d={blockedAreaPath(a.polygon)} fill={maskColors?.[i] ?? MASK_FALLBACK}
          stroke="none" style={{ pointerEvents: 'none' }} />
      ))}
      {/* Fellowship marker (last-known position) */}
      <FellowshipMarker view={view} />
    </svg>
    </div>
  );
});

// An army marker: a two-tone pill — side colour for Regulars, gold for Elites —
// plus a corner pip counting Leaders (FP) / Nazgûl (Shadow). Sized to stay legible
// at fit-to-width zoom without overwhelming the small regions.
function ArmyBadge({ x, y, scale, army }: { x: number; y: number; scale: number; army: ArmyInfo }) {
  const { side, nation, reg, elite, leaders, nazgul } = army;
  // Tint the badge by the Nation so factions are distinguishable; fall back to a
  // generic side colour for a leaders-only badge (no units → no nation).
  const col = (nation && NATION_COLOR[nation]) || (side === 'shadow' ? '#b8332b' : '#2c5fb3');
  const nationName = nation ? nation.charAt(0).toUpperCase() + nation.slice(1) : (side === 'shadow' ? 'Shadow' : 'Free Peoples');
  const s = Math.min(1, Math.max(0.6, scale));
  const W = 34, H = 20;
  const both = reg > 0 && elite > 0;
  const special = leaders + nazgul;
  const label = `${nationName}: ${reg} Regular${reg === 1 ? '' : 's'}, ${elite} Elite${elite === 1 ? '' : 's'}` +
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
