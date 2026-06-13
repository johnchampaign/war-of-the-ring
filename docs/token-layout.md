# Polygon-aware token layout

## The problem (cross-project: Rebellion & Axis & Allies)

A recurring UX bug in prior ports: tokens/units in a region are positioned from a
**single hard-coded anchor point** per region. When several pieces stack, or the
anchor sits near a border, the layout drifts and **misleads players about which
region a piece is actually in** — a unit reads as being in the neighbouring
region, an army's count is ambiguous, etc. Every fix was per-region hand-tuning.

## The fix: shared framework geometry (digital-boardgame-framework ≥ 0.9.0)

The geometry math now lives in the **framework** (`src/core/geo`, exported from
the package root) — `poleOfInaccessibility`, `layoutTokensInPolygon`,
`pointInPolygon`, `signedDistanceToPolygon`, `boundingBox`, `centroid`, `area`.
WotR was the first consumer; we deleted our hand-rolled copies and migrated
(see `framework-geo-feedback.md`).

`assets/region-geometry.json` (built by `scripts/extract-geometry.mjs`) holds the
**data only**, in the framework's normalized format:

- `image: { src, width, height }` — the reference board image the polygons are in
  the **pixel space** of (SirMartin `map_en.jpg`, 1920×1324).
- `territories: { <regionId>: { polygon: [[x,y], …] } }` — each region's outline as
  pixel-coordinate `[x,y]` pairs.

The anchor and clearance are **computed at runtime** by the framework, not stored
(single source of truth). `src/data/geometry.ts` is the thin adapter that turns
the on-disk `[x,y]` pairs into the framework's `Polygon` (`{x,y}[]`).

## Layout (rendering, Phase 3)

The framework's `layoutTokensInPolygon(polygon, count, { tokenRadius })` does the
work: anchors the cluster at the pole of inaccessibility, shrinks it to fit, and
returns `stacked: true` (single anchored pile + count badge) when even the shrunk
cluster won't fit. The renderer just draws at the returned `points`. No bespoke
packing, no per-region hand-tuning. "Which region is this piece in?" is
unambiguous by construction.

Verified: across all 105 regions (setup counts and a 12-token stress) **0 token
bleed**, **0 anchors outside their polygon**; the stacked fallback triggers only
on the smallest regions under load.

## Audit overlay (verification)

`src/devtabs/PolygonAudit.tsx` (dev-only, currently the app's entry until the
real UI lands) draws every polygon + its framework-computed anchor + a sample
`layoutTokensInPolygon` cluster **over the real reference map image**
(`public/dev-assets/wotr-map.jpg`, fetched locally, gitignored). It counts token
bleed live (must stay 0). This is the key eyeball check for misaligned / inverted
/ merged polygons. Run `npm run dev` and open it.

## Calibration & trust

The polygons are a **first-pass bootstrap** from SirMartin/WarOfRingMap, in *that*
image's pixel space. If the shipped UI renders a *different* board image, they
need an **affine recalibration** to it; the planned **calibration dev-tab** (also
used to confirm adjacency) overlays the polygons for click-adjust and bakes
corrections back into `region-geometry.json`. Until then the geometry is correct
relative to the reference image and the layout logic works against it.

## Status

- `region-geometry.json`: 105/105 regions, framework normalized format
  (polygons in reference-image pixels). ✅
- Token layout via framework `layoutTokensInPolygon`; audit overlay confirms
  0 bleed. ✅
- Affine recalibration to the shipped board image + per-region click-fix:
  **calibration dev-tab, Phase 3.**
