# Polygon-aware token layout

## The problem (cross-project: Rebellion & Axis & Allies)

A recurring UX bug in prior ports: tokens/units in a region are positioned from a
**single hard-coded anchor point** per region. When several pieces stack, or the
anchor sits near a border, the layout drifts and **misleads players about which
region a piece is actually in** — a unit reads as being in the neighbouring
region, an army's count is ambiguous, etc. Every fix was per-region hand-tuning.

## The fix: use the actual region polygon

`assets/region-geometry.json` (built by `scripts/extract-geometry.mjs`) gives, per
region, in normalised `0..1` board space:

- `polygon` — the region outline (array of `[x,y]`).
- `bbox`, `area`, `centroid`.
- `anchor` — the **pole of inaccessibility**: the centre of the largest circle
  that fits inside the polygon. Unlike the centroid, this is always well inside
  the region even for concave shapes (Gorgoroth, the long Mordor/Rohan regions),
  so it never lands on or past a border.
- `anchorRadius` — that circle's radius = how much room there is before a piece
  spills over a border. This is the key number: it lets the UI **size and pack**
  a stack to fit the region instead of guessing.

## Layout algorithm (UI, Phase 3)

Given a region's pieces (army units, leaders, characters, control marker, siege
box overflow):

1. **Anchor** the stack at `anchor`.
2. **Scale** piece size so the cluster's footprint ≤ `anchorRadius` (clamp to a
   min legible size; if it can't fit, switch to a compact "count badge" rendering
   rather than overflowing).
3. **Pack** multiple pieces around the anchor (concentric rings / small grid),
   each placement tested with point-in-polygon against `polygon` so nothing is
   ever drawn outside the region. Pieces that don't fit collapse into a count.
4. **Separate concerns** within a region if needed (e.g. army vs. control marker
   vs. characters) by sub-anchoring at offsets from `anchor`, still polygon-clipped.

This makes "which region is this piece in?" unambiguous by construction, and
removes per-region hand-tuning.

## Calibration & trust

The polygons are a **first-pass bootstrap** from SirMartin/WarOfRingMap, in *that*
project's reference-image space. Before pixel use they must be **affine-recalibrated**
to whatever board image the UI renders (the same hi-res board the client fetches).
The planned **calibration dev-tab** (also used to confirm adjacency) overlays the
polygons on the live board image for click-adjust; corrections are baked back into
`region-geometry.json`. Until then the relative geometry is correct and the layout
logic above can be developed against it.

## Status

- `region-geometry.json`: 105/105 regions, polygon + anchor + radius. ✅
- Affine recalibration to the UI board image + per-region click-fix: **calibration
  dev-tab, Phase 3.**
- The packing algorithm itself: **Phase 3 UI.**
