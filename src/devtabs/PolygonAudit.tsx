// DEV-ONLY audit overlay (framework geo proof, WotR is the first consumer).
// Draws every region polygon (semi-transparent) + its pole-of-inaccessibility
// anchor + a sample token cluster from the framework's layoutTokensInPolygon,
// OVER the real reference map image. Misaligned / inverted / merged polygons and
// any token bleed are obvious by eye. Keep as a dev route; never ship.
//
// All geometry math comes from digital-boardgame-framework (>= 0.9.0). This file
// only renders.
import { useMemo, useState } from 'react';
import {
  layoutTokensInPolygon,
  poleOfInaccessibilityWithClearance,
  signedDistanceToPolygon,
  area,
  type Polygon,
} from 'digital-boardgame-framework';
import { mapImage, regionIds, regionPolygon } from '../data/geometry';
import mapData from '../../assets/map.json';

interface RegionInfo {
  nation: string | null;
  settlement: string | null;
  setup: { regular?: number; elite?: number; leader?: number; nazgul?: number } | null;
}
const regions = (mapData as { regions: Record<string, RegionInfo> }).regions;

// Sample token count for a region: its starting on-board pieces, or a default.
function setupCount(id: string): number {
  const s = regions[id]?.setup;
  if (!s) return 0;
  return (s.regular ?? 0) + (s.elite ?? 0) + (s.leader ?? 0) + (s.nazgul ?? 0);
}

const polyToPath = (poly: Polygon) =>
  poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

export function PolygonAudit() {
  const [tokenRadius, setTokenRadius] = useState(14);
  const [forceCount, setForceCount] = useState(0); // 0 = use each region's setup count
  const [showMap, setShowMap] = useState(true);
  const [showClusters, setShowClusters] = useState(true);

  const W = mapImage.width;
  const H = mapImage.height;

  const computed = useMemo(() => {
    return regionIds.map((id) => {
      const poly = regionPolygon(id)!;
      // One call for anchor + clearance (v0.9.1); reuse the anchor in layout.
      const { point: anchor, clearance } = poleOfInaccessibilityWithClearance(poly);
      const count = forceCount > 0 ? forceCount : setupCount(id);
      const layout = count > 0
        ? layoutTokensInPolygon(poly, count, { tokenRadius, anchor })
        : null;
      return { id, poly, anchor, clearance, count, layout, a: area(poly) };
    });
  }, [tokenRadius, forceCount]);

  // Cross-check the framework's containment promise: every token centre should be
  // inside its own polygon (clearance >= 0). Counted here so a regression is loud.
  let bleed = 0;
  for (const c of computed) {
    if (!c.layout || c.layout.stacked) continue;
    for (const p of c.layout.points) {
      if (signedDistanceToPolygon(p, c.poly) < 0) bleed++;
    }
  }
  const stackedCount = computed.filter((c) => c.layout?.stacked).length;

  const btn = (on: boolean): React.CSSProperties => ({
    padding: '4px 10px', marginRight: 8, cursor: 'pointer',
    background: on ? '#2b6cb0' : '#444', color: '#fff', border: 'none', borderRadius: 4,
  });

  return (
    <div style={{ fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh', padding: 12 }}>
      <h2 style={{ margin: '4px 0' }}>WotR — Polygon / token-layout audit (framework geo {`v0.9`})</h2>
      <div style={{ marginBottom: 8, fontSize: 14 }}>
        <button style={btn(showMap)} onClick={() => setShowMap((v) => !v)}>map bg</button>
        <button style={btn(showClusters)} onClick={() => setShowClusters((v) => !v)}>token clusters</button>
        <label style={{ marginLeft: 12 }}>tokenRadius {tokenRadius}px
          <input type="range" min={4} max={40} value={tokenRadius}
            onChange={(e) => setTokenRadius(+e.target.value)} style={{ verticalAlign: 'middle' }} />
        </label>
        <label style={{ marginLeft: 12 }}>force count {forceCount || 'setup'}
          <input type="range" min={0} max={12} value={forceCount}
            onChange={(e) => setForceCount(+e.target.value)} style={{ verticalAlign: 'middle' }} />
        </label>
        <span style={{ marginLeft: 16 }}>
          regions: {computed.length} · stacked piles: {stackedCount} ·{' '}
          <b style={{ color: bleed ? '#f56' : '#5d5' }}>token bleed: {bleed}</b>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width={1320} height={1320 * H / W} style={{ display: 'block', border: '1px solid #333', background: '#000', maxWidth: '100%' }}>
        {showMap && <image href={`/dev-assets/${mapImage.src}`} x={0} y={0} width={W} height={H} />}
        {computed.map((c) => (
          <g key={c.id}>
            <path d={polyToPath(c.poly)} fill="rgba(80,160,255,0.18)" stroke="rgba(120,200,255,0.9)" strokeWidth={1.5} />
            <circle cx={c.anchor.x} cy={c.anchor.y} r={3} fill="#ffd23f" />
            {showClusters && c.layout && !c.layout.stacked && c.layout.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={tokenRadius * c.layout!.scale}
                fill="rgba(255,90,90,0.5)" stroke="#fff" strokeWidth={0.7} />
            ))}
            {showClusters && c.layout?.stacked && (
              <>
                <circle cx={c.anchor.x} cy={c.anchor.y} r={tokenRadius}
                  fill="rgba(255,160,40,0.7)" stroke="#fff" strokeWidth={1} />
                <text x={c.anchor.x} y={c.anchor.y + 4} fontSize={12} textAnchor="middle" fill="#000">{c.count}</text>
              </>
            )}
          </g>
        ))}
      </svg>
      <p style={{ fontSize: 12, color: '#999' }}>
        Yellow dot = pole of inaccessibility (framework anchor). Red discs = token
        cluster (layoutTokensInPolygon). Orange disc + number = stacked-pile fallback
        for regions too small to hold the cluster. Polygons are in the reference
        image's pixel space; if the shipped board image differs they need affine
        recalibration. "token bleed" must stay 0.
      </p>
    </div>
  );
}
