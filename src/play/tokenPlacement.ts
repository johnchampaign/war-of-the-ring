// Where the Fellowship marker goes inside its region.
//
// Every other token in a region (army badges, a lone Nazgûl, the settlement diamond,
// a boxed garrison, Character discs) is laid out around the region's anchor. The
// Fellowship marker used to sit ON that anchor and is drawn over everything, so it hid
// whatever stood there — a lone Nazgûl in Trollshaws vanished under it (player report
// 43732p5u0j71692t). The marker now takes the nearest spot around the anchor that is
// clear of the region's other tokens and still inside the region. An empty region
// keeps the marker on the anchor, exactly where it always was.
//
// Pure geometry, no React: Board.tsx and scripts/probe-fellowship-marker-clear.mjs
// both call it, so the probe checks the placement the board really draws.
import { signedDistanceToPolygon, type Point, type Polygon } from 'digital-boardgame-framework';

/** A token's footprint, as a circle enclosing everything it draws. */
export interface Circle { x: number; y: number; r: number }

/** The Fellowship marker disc's radius (Board.tsx FellowshipMarker). */
export const MARKER_R = 13;
/** Breathing room kept between the marker and any other token. */
const GAP = 3;

/** The circles already drawn in a region, mirroring Board.tsx's placement of each
 *  token relative to the region anchor. Keep in step with Board.tsx. */
export function regionOccupants(o: {
  anchor: Point;
  /** Army badge centres, one per nation present (already clamped by the board). */
  armyPoints: Point[];
  /** Per badge: true when it is a lone Nazgûl / Leader token rather than a full pill. */
  armySolo: boolean[];
  /** The layout scale the badges are drawn at. */
  scale: number;
  /** A Settlement diamond is drawn (a Town, City or Stronghold; not a Fortification). */
  settlement: boolean;
  boxedCount: number;
  charCount: number;
  boxedCharCount: number;
}): Circle[] {
  const { anchor: a } = o;
  const s = Math.min(1, Math.max(0.6, o.scale));
  const out: Circle[] = [];
  o.armyPoints.forEach((p, i) => {
    // A full pill is 34×20 with a Leader/Nazgûl pip at its top-right corner; a solo
    // token is one small disc.
    out.push({ x: p.x, y: p.y, r: (o.armySolo[i] ? 9.5 : 25) * s });
  });
  if (o.settlement) out.push({ x: a.x - 16, y: a.y - 14, r: 12 });
  for (let i = 0; i < o.boxedCount; i++) out.push({ x: a.x - 16 + (i - (o.boxedCount - 1) / 2) * 16, y: a.y + 2, r: 14 });
  for (let i = 0; i < o.charCount; i++) out.push({ x: a.x + (i - (o.charCount - 1) / 2) * 15, y: a.y - 18, r: 8.5 });
  for (let i = 0; i < o.boxedCharCount; i++) out.push({ x: a.x + (i - (o.boxedCharCount - 1) / 2) * 15, y: a.y + 20, r: 11 });
  return out;
}

/** How far a marker centred at `p` stays clear of every occupant (negative = overlap). */
export function markerClearance(p: Point, occupied: Circle[]): number {
  let min = Infinity;
  for (const c of occupied) min = Math.min(min, Math.hypot(p.x - c.x, p.y - c.y) - c.r - MARKER_R);
  return min;
}

/** The marker's centre: the anchor when nothing is in the way, otherwise the nearest
 *  spot on rings around the anchor that clears every occupant. Preference order:
 *    1. clear of every token AND well inside the region (at most ~40% of the disc
 *       hangs over a neighbour);
 *    2. clear of every token with its centre still inside the region — in a thin
 *       region (Goblin's Gate, Western Mirkwood) a marker overlapping an edge beats one
 *       covering a token, and a click on it still goes to its own region;
 *    3. the best compromise, if a tiny crowded region allows neither.
 *  Deterministic. */
export function fellowshipMarkerPoint(poly: Polygon, anchor: Point, occupied: Circle[]): Point {
  if (markerClearance(anchor, occupied) >= GAP) return anchor;
  const minInside = MARKER_R * 0.6;
  const candidates: Point[] = [];
  for (const d of [24, 30, 36, 44, 54, 66, 80]) {
    for (let k = 0; k < 16; k++) {
      // Start to the right and sweep round, so the marker prefers sitting beside the
      // badges rather than above them (where Character discs live).
      const t = (k / 16) * Math.PI * 2;
      candidates.push({ x: anchor.x + d * Math.cos(t), y: anchor.y + d * Math.sin(t) });
    }
  }
  const scored = candidates.map((p) => ({ p, clear: markerClearance(p, occupied) - GAP, inside: signedDistanceToPolygon(p, poly) }));
  const wellInside = scored.find((c) => c.clear >= 0 && c.inside >= minInside);
  if (wellInside) return wellInside.p;
  const centreInside = scored.find((c) => c.clear >= 0 && c.inside > 0);
  if (centreInside) return centreInside.p;
  let best = scored[0]!;
  for (const c of scored) if (Math.min(c.clear, c.inside) > Math.min(best.clear, best.inside)) best = c;
  return best.p;
}
