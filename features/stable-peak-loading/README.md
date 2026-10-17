# Stable peak loading

## Goal
Stop World map icons (peaks and other collectibles) from jumping when the map is panned. Load collectibles for a
wide area ahead of time, cache them on the client, and avoid reloading on every move.

## Problem
`GET /api/world?bbox=` returns only the `WORLD_VIEWPORT_LIMIT` (300) collectibles nearest the bbox center, and the
client (`loadViewport` in `public/components/world-page.js`) replaces its whole set after every `moveend`. Panning
changes which 300 are "nearest", so icons pop in, out and move.

## Scope
- In: `/api/world` collectible loading, client-side area cache, bounds helpers, docs.
- Out: the exploration ("Explore this Area") endpoint and its `WORLD_VIEWPORT_LIMIT` usage; Fartlek policy.

## Decisions
- Approach: area cache. The client fetches an area at least 200 km wide and high around the view, renders from the
  cache, and refetches only when the viewport leaves the cached area.
- New server config `WORLD_AREA_LIMIT` (default 3000) caps collectibles per `/api/world` request; `WORLD_VIEWPORT_LIMIT`
  stays for exploration.
- The loaded area is twice the viewport (at least 200 km) so zoomed-out maps can still pan. On reload, new results are merged by id with already-loaded items near the new area, so capped reloads never drop or swap visible icons; items far outside are pruned.

## Implementation plan
1. `src/config.ts`: add `worldAreaLimit` (`WORLD_AREA_LIMIT`, default 3000); use it for collectibles in `/api/world`.
2. `public/components/shared/map/staza-map-utils.js`: add pure `expandBounds(bounds, minKm = 200)` (latitude-aware
   longitude degrees, clamped) and `boundsContain(outer, inner)`.
3. `public/components/world-page.js` `loadViewport`: keep `loadedArea` and cached snapshot; skip fetching when the
   viewport is inside `loadedArea` and the last result was not truncated; otherwise fetch the expanded bbox, merge by
   id, prune far items, keep `requestToken` race protection, selection clearing and filters. When truncated, results stay
   nearest-to-center and refetch happens when the view leaves the inner region of the last fetch.
4. Verify `staza-collectible-layers.js` uses stable feature ids and no clustering/collision causes jumps.
5. Update `features/milestone-15-staza-world-v1/README.md` limit docs and mention `WORLD_AREA_LIMIT`.

## Acceptance criteria
- Panning within the loaded area causes no network request and no icon changes.
- Icons already visible do not disappear or move when panning to adjacent areas.
- At least a 200 km wide area is loaded ahead of the visible map.
- Exploration behavior is unchanged.

## Validation
- Unit tests for `expandBounds` and the "inside loaded area, no refetch" decision.
- `npm test` and a manual pan check in the World page.
