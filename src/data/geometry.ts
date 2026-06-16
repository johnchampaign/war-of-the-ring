// Thin adapter between WotR's on-disk region-geometry.json (polygons as [x,y]
// pairs, the framework's documented JSON format) and the framework geo API
// (Polygon = Point[] of {x,y}). The framework owns the math; this just reshapes
// the data. Board geometry is STATIC — never put it in game state / snapshots.
import { toPolygon, type Polygon } from 'digital-boardgame-framework';
import raw from '../../assets/region-geometry.json';

export interface MapImage {
  src: string;
  width: number;
  height: number;
}

interface GeometryFile {
  image: MapImage;
  territories: Record<string, { polygon: [number, number][] }>;
}

const data = raw as unknown as GeometryFile;

/** The reference image the polygons are in the pixel space of. */
export const mapImage: MapImage = data.image;

/** Region ids that have polygon geometry. */
export const regionIds: string[] = Object.keys(data.territories);

/** Convert a region's on-disk [x,y][] ring into a framework Polygon ({x,y}[]). */
export function regionPolygon(id: string): Polygon | null {
  const t = data.territories[id];
  return t ? toPolygon(t.polygon) : null;
}

/** All region polygons, keyed by id, as framework Polygons. */
export function allRegionPolygons(): Record<string, Polygon> {
  const out: Record<string, Polygon> = {};
  for (const id of regionIds) out[id] = regionPolygon(id)!;
  return out;
}

/** Tight bounding box of every playable region polygon, in the map image's pixel
 *  space — the board's natural crop. Derived from the SAME geometry the board
 *  renders from (region-geometry.json), so it can't go stale independently of the
 *  board: if the regions draw, this is correct. The dead margins (army boxes,
 *  tracks, title banner) hold no region polygons, so they fall outside this box.
 *  A small margin keeps edge regions off the very edge. */
export const playableBounds: { x: number; y: number; w: number; h: number } = (() => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of regionIds) {
    for (const [x, y] of data.territories[id]!.polygon) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: mapImage.width, h: mapImage.height };
  const m = Math.round(Math.min(mapImage.width, mapImage.height) * 0.012); // ~1.2% margin
  const x = Math.max(0, minX - m), y = Math.max(0, minY - m);
  const x2 = Math.min(mapImage.width, maxX + m), y2 = Math.min(mapImage.height, maxY + m);
  return { x, y, w: x2 - x, h: y2 - y };
})();
