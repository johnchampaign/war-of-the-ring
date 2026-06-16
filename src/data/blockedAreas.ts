// Off-map "special areas" on the board image we don't use (tracks, boxes,
// scoring strips). Authored in the #blocked dev tab and stored in
// assets/blocked-areas.json, in the SAME pixel space as region-geometry.json.
// The play board masks these out so they read as inert; nothing here is game
// state — it's static board metadata, like the region geometry.
import raw from '../../assets/blocked-areas.json';

export interface BlockedArea {
  label: string;
  polygon: [number, number][];
}

const data = raw as unknown as { areas: BlockedArea[] };

const allAreas: BlockedArea[] = Array.isArray(data.areas) ? data.areas : [];

// One special entry (label "Board Crop") is NOT a mask — its bounding box is the
// board's default view, cropping the dead side margins. Everything else masks out.
const CROP_LABEL = 'board crop';
const isCrop = (a: BlockedArea) => a.label.trim().toLowerCase() === CROP_LABEL;

/** Authored blocked-out areas (excludes the Board Crop entry). May be empty. */
export const blockedAreas: BlockedArea[] = allAreas.filter((a) => !isCrop(a));

export interface Rect { x: number; y: number; w: number; h: number }

/** The board's content rectangle (bounding box of the "Board Crop" polygon), or
 *  null if none authored — callers then fall back to the full image. */
export const boardCrop: Rect | null = (() => {
  const crop = allAreas.find(isCrop);
  if (!crop || crop.polygon.length < 2) return null;
  const xs = crop.polygon.map((p) => p[0]);
  const ys = crop.polygon.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
})();

/** SVG path for a blocked-area ring. */
export const blockedAreaPath = (poly: [number, number][]): string =>
  poly.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z';
