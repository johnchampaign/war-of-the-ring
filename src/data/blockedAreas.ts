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

/** All authored blocked areas (may be empty). */
export const blockedAreas: BlockedArea[] = Array.isArray(data.areas) ? data.areas : [];

/** SVG path for a blocked-area ring. */
export const blockedAreaPath = (poly: [number, number][]): string =>
  poly.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ') + ' Z';
