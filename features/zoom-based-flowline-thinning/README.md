# zoom-based-flowline-thinning

## Goal
`GET /api/world?bbox=` currently returns every published Flowline overlapping the bbox, which is too slow and heavy when zoomed out. The number of Flowlines must decrease with lower zoom, and the World map must show a scale bar.

## Scope
In: zoom-aware server-side Flowline thinning, truncation hint in the UI, MapLibre metric scale bar.
Out: vector tiles, geometry simplification (possible follow-up). "Explore this Area" keeps full detail.

## Decisions
- Thinning is server-side and driven by the viewport width derived from `bbox` (no `zoom` parameter). Up to 100 km wide, 100% of Flowlines are shown (bounded only by the `WORLD_FLOWLINE_LIMIT` safety cap, default 2000). Wider viewports show a share of `100 km / width` (cap scaled accordingly), dropping short Flowlines first (minimum length `(width/100 km − 1) km`, max 6 km), ranked by `flow_score` desc, then length desc, then id.
- Policy is a pure module `src/flowlinePolicy.ts`.
- Response adds `fartlekTruncated`; `truncated` keeps its collectible meaning.
- Selected and quest Flowlines are still merged into the map so they never vanish.
- Scale bar: MapLibre `ScaleControl`, metric, bottom-left, themed.

## Implementation plan
1. Zoom policy module (zoom → `{ minLengthMeters, limit }`) with unit tests.
2. `FartlekRepository.listWithinBounds(bounds, { minLengthMeters, limit })`: add `length_meters >=` filter, ordering and `LIMIT n+1` to detect truncation; return `{ fartleks, truncated }`; add an index on `(status, length_meters)` only if needed.
3. `/api/world`: parse `zoom`, apply policy, return `fartlekTruncated`; update `worldViewport.test.ts`. `loadArea` for exploration uses a zoom-agnostic generous call.
4. Client: `loadViewport(bounds, zoom)`, pass zoom from `moveend`, show "Zoom in to see all Flowlines" when truncated; update tests.
5. Add `ScaleControl` and styling; check no overlap with other controls.
6. Update docs (env var), run tests and typecheck.

## Acceptance criteria
- Zoomed-out requests return substantially fewer Flowlines than zoomed-in ones, never exceeding the tier cap.
- Zooming in reveals more/shorter Flowlines; truncation hint shows when capped.
- Selected/quest Flowlines remain visible.
- Scale bar is visible and updates with zoom.
- Explore-this-area behavior is unchanged.

## Validation
Unit tests for policy, repository and API; client tests for zoom param and scale control; `npm test` and typecheck; manual zoom check with real data.
