# Framework geo (v0.9.0) — feedback from the WotR migration

WotR is the first consumer of `digital-boardgame-framework`'s `src/core/geo`.
We migrated off our hand-rolled pole-of-inaccessibility + token-layout (commit
daaefdc) onto the shared module. It worked; below is what to fold into the
framework's `docs/framework-fit-notes.md`. **Don't edit the framework from the
WotR repo — this is the hand-off note.**

## What worked (keep)

- **Containment is rock-solid.** Across 210 layout runs (105 regions × {setup
  count, 12-token stress}), **0 tokens fell outside their polygon** and **0
  poles-of-inaccessibility landed outside their polygon** — including the
  concave Mordor-shaped regions (Gorgoroth, the long Anduin-vale strips) the
  design doc worried about. The centroid-betrays-you case is genuinely handled.
- **Stacked-pile fallback triggers sensibly.** On the 12-token stress it
  collapsed to a pile in exactly the 10 smallest regions; at real setup counts
  (≤8) nothing needed to stack at tokenRadius 14px. Good default behaviour.
- **Runs fine in Node** (the extraction script imports it) and in the browser
  bundle (Vite, 40 modules). No DOM assumptions leaked in.

## Gaps / sharp edges (ranked)

1. **`poleOfInaccessibility` discards the clearance radius it already computed.**
   It returns only `Point`, but polylabel's `best.d` *is* the radius of the
   largest inscribed circle at that point — exactly the number you want to
   **size a token stack** (how big before it bleeds). Today we re-derive it with
   a second `signedDistanceToPolygon(anchor, polygon)` call — redundant work the
   algorithm just threw away. Our hand-rolled version returned `{ point, radius }`.
   *Suggestion:* return `{ point, clearance }`, or add
   `poleOfInaccessibilityWithClearance`. The radius is the natural companion to
   the anchor and several renderers will want it.

2. **`precision` default `1.0` silently assumes pixel-space coordinates.** With
   normalized `0..1` polygons (a very natural format) `precision = 1.0` is larger
   than the whole shape, so the search barely subdivides and you get ~bbox-centre
   garbage with no error. The design doc *does* mandate pixel coords, and
   converting our data to the reference image's pixel space fixed it — but this
   is a footgun. *Suggestion:* one JSDoc line ("precision is in coordinate units;
   for normalized 0..1 coordinates pass ~1e-3"), or scale precision relative to
   the bbox internally.

3. **No way to reuse a precomputed anchor.** `layoutTokensInPolygon` calls
   `poleOfInaccessibility` on every invocation. Board geometry is static, so the
   anchor is constant per region — but a renderer that re-lays-out on every state
   change recomputes PIA for all 105 polygons each render. We memoize per region
   in `useMemo`, but the hot path would be cleaner if `LayoutOptions` accepted an
   optional `anchor?: Point` (skip PIA when supplied), or there were a
   `prepareRegion(polygon) → { anchor, layout(count, opts) }`. Perf/ergonomics,
   not correctness.

4. **`Polygon` is `Point[]` but every serialized source is `[x,y][]`.** Clip-path,
   GeoJSON-ish exports, our SirMartin source — all pairs. Every consumer writes
   the identical `pairs.map(([x,y]) => ({x,y}))` adapter (we did, in
   `src/data/geometry.ts`). The design doc's own normalized-format JSON example
   uses `[[x,y],...]` on disk while the TS type is `{x,y}[]` — the gap is real.
   *Suggestion:* ship a tiny `toPolygon(pairs: [number,number][]) → Polygon`
   helper (and maybe `fromPolygon`), and state explicitly in the format spec that
   on-disk = pairs, in-memory = points, consumer converts.

5. **Audit overlay is per-game but ~120 lines of boilerplate every game repeats.**
   The "draw polygons + anchor dot + sample cluster over the map image, count
   bleed" page is the non-negotiable verification tool (design doc says so) and
   will be near-identical for A&A and Rebellion. Not framework *math*, but a
   documented copy-paste recipe (or a headless `auditLayout(territories, opts) →
   { bleed, stacked, anchorsOutside }` checker that the page and CI both call)
   would save each game re-deriving it. We have a working React version in
   `src/devtabs/PolygonAudit.tsx` to lift from.

## Minor

- `centroid` is exported "for comparison / fallback only" — good, and the JSDoc
  warning is appropriately loud. We use it nowhere in production paths.
- Nice that everything is deterministic; our headless containment check is
  reproducible and CI-able.
