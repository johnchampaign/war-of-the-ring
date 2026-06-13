// Thin adapter between WotR's on-disk region-geometry.json (polygons as [x,y]
// pairs, the framework's documented JSON format) and the framework geo API
// (Polygon = Point[] of {x,y}). The framework owns the math; this just reshapes
// the data. Board geometry is STATIC — never put it in game state / snapshots.
import type { Polygon } from 'digital-boardgame-framework';
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
  return t ? t.polygon.map(([x, y]) => ({ x, y })) : null;
}

/** All region polygons, keyed by id, as framework Polygons. */
export function allRegionPolygons(): Record<string, Polygon> {
  const out: Record<string, Polygon> = {};
  for (const id of regionIds) out[id] = regionPolygon(id)!;
  return out;
}
