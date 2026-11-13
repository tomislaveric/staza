# Shared Staza Map Foundation

Milestone 15.3. Unify the World map and the Ride/Activity Detail replay onto a single,
presentation-only **Shared Staza Map Foundation** so both screens are two views of the same
Staza world, and a future map-styling change is made once and affects both.

## Goal

- Extract World's MapLibre map internals into a reusable, framework-free shared foundation.
- Re-point World at it with no behavior change.
- Rebuild the Ride Detail replay natively on the shared foundation (same OpenFreeMap/Liberty
  basemap, Staza dark theme transform, and native collectible layers), retiring the current
  2D `<canvas>` replay renderer.
- Keep the existing replay engine (timing, event semantics, playback duration, historical
  snapshots) as the untouched source of truth.

## Background / current state

- **World** = MapLibre GL JS + OpenFreeMap/Liberty basemap + Staza dark theme transform +
  native collectible circle layers + quest route layers (`public/components/world/`).
- **Ride Detail replay** = a hand-rolled 2D `<canvas>` renderer (`public/replay.js`) that
  manually projects lat/lng to pixels and animates the rider, route reveal, and collection
  feedback via `requestAnimationFrame`. It uses no MapLibre, no basemap, no shared theme, and
  no shared collectible vocabulary.

The two maps are different rendering technologies, not a look-alike duplicate.

## Scope

In scope:

- Shared MapLibre map foundation module set under `public/components/shared/map/`.
- World re-pointed at the shared foundation (behavior unchanged).
- Ride Detail replay rebuilt natively on MapLibre with shared basemap/theme/collectibles.
- Activity-specific replay layers: full route (subdued), progressive traveled segment,
  moving position point, collection-event transitions.

Out of scope:

- Light mode (theme stays a single source of truth for future theming).
- New quest/World features, fog of war, regions, clustering, sprite system.
- New replay behavior, route generation, Strava/Garmin, new persistence models.
- The Collected-tab SVG timeline (left as-is).

## Decisions

- Shared modules live in a new `public/components/shared/map/` directory (neutral naming;
  kebab-case files, factory functions, no framework).
- Replay is **rebuilt natively** on MapLibre — not a 1:1 canvas port. Existing replay
  semantics, timing, event timing, playback duration/speed, and persisted snapshots are
  preserved unchanged.
- The Collected-tab horizontal SVG timeline is **left as-is** this milestone.
- One canonical Staza map theme (`staza-map-theme.js`) remains the single source of truth for
  both screens.
  - **Later change:** the theme moved to the server (`src/basemapTheme.ts`), which serves
    it as `/api/world/basemap/style.json`. The web and native apps now load the same themed
    style; `staza-map-theme.js` and `staza-map-style.js` were removed.
- Presentation-only feature properties `activityCollected` / `activityPending` are added for
  activity collection transitions; they must not mutate domain state or the global
  visited/unvisited meaning.

## Implementation plan

### Shared foundation (`public/components/shared/map/`)

- `staza-map-theme.js` — canonical theme + `STAZA_DARK_PALETTE` (moved from `world/`).
- `staza-map-style.js` — `loadStazaStyle(styleUrl, fetch)`.
- `staza-collectible-features.js` — `collectibleFeature`, `collectiblesToFeatureCollection`,
  `EMPTY_FEATURE_COLLECTION`; extended with optional `activityCollected` / `activityPending`.
- `staza-collectible-layers.js` — collectible source + circle/glow/selected layers, layer-ID
  constants, `ensureCollectibleLayers`, `setCollectibleData`, `bindCollectibleInteractions`,
  plus a restrained `activityCollected` visual branch.
- `staza-route-layers.js` — shared Staza route line factory (glow/casing/line) parameterized
  by `sourceId` + accent, so quest route and activity route share styling yet stay distinct.
- `staza-map-utils.js` — `readBounds`, `boundsToParameter`, `routeToGeoJson`, bounds/fit and
  empty-geometry helpers, and `LAYER_ORDER` constants.
- `staza-map.js` — `createStazaMap(container, { styleUrl, attribution, controls })`: MapLibre
  init, themed style load, common controls (zoom + attribution), load-readiness promise, and
  generic source/layer/fit/fly/destroy helpers. No gameplay/replay logic.

### Layer-order model

Enforced via a single insert helper against `LAYER_ORDER`:

```
BASEMAP
 → ROUTE_BACKGROUND (full activity route, subdued)   [activity only]
 → ROUTE_PROGRESS  (traveled segment / quest route)
 → COLLECTIBLES
 → SELECTION/EMPHASIS
 → TRANSIENT_POSITION (replay rider point)           [activity only]
```

### World

- Reduce `world/world-map.js` to a thin World adapter over the shared foundation.
- Update `world-page.js` imports; collapse `world/collectible-*.js` and
  `world/staza-map-theme.js` into re-exports of the shared modules (or delete + update
  imports). No behavior change.

### Ride Detail replay

- Keep `replay.js` engine functions (`replayDurationSeconds`, `interpolatePosition`,
  `markerState`, `replayScore`, `feedDisplayData`, `nextCollectibleData`, `replayCompletion`,
  `nearMissDisplayData`, `replayMarkers`, `collectiblePresentation`, `rarityPresentation`).
- Remove canvas presentation (`project`, `routeBounds`, `drawMarker`, canvas draw loop).
- New `shared/map`-based activity replay map (adapter, e.g. `activity-map.js`):
  - Full-route background LineString (set once).
  - Progressive traveled LineString updated per frame via `source.setData` (route points with
    `timestampMs ≤ t` plus interpolated head).
  - Moving position point layer updated per frame with `interpolatePosition(route, t)`.
  - Collection transitions derived per frame from `markerState(id, events, t)` into
    `activityPending` / `activityCollected` props; restrained halo on `collecting`.
  - Camera fits route + collectibles on load; no aggressive follow; rider never hidden behind
    overlays.
- `components/replay-tab.js` swaps the `<canvas>` for a map container `<div>` + play button
  and mounts the MapLibre replay; `mountReplay` keeps its clock/scheduler but updates MapLibre
  sources instead of drawing to canvas.
- `components/activity-detail-page.js` provides basemap config (reuse `/api/world/basemap`).

## Historical-data constraints

- Ride Detail keeps using the persisted `activity.replay` snapshot; do not substitute live
  World catalog state.
- Collection transitions are driven only by historical event timestamps (`markerState`).
- `activityCollected` / `activityPending` are presentation-only and must not change domain
  state.

## Acceptance criteria

- World map, collectibles, and quest interactions are visually and behaviorally unchanged.
- Activity Detail renders the identical Staza basemap and collectible visual language.
- Activity route renders and the map fits the route on load.
- Replay plays with a geographically anchored moving position, a progressive route reveal,
  and collection transitions driven by historical event timing.
- Collected items remain geographically aligned; near misses remain intact.
- Zoom/pan/resize are stable with no marker drift and zero console errors.
- No second/duplicate map implementation remains in Ride Detail.
- One canonical Staza theme drives both screens.

## Validation

- Unit (`npm test`, vitest): shared map (theme/style moved verbatim, layer order, activity
  route factory, feature normalization incl. `activityCollected`/`activityPending`, bounds/
  empty-geometry util), World behavior unchanged, replay engine unchanged, new replay map
  (progressive route, position point, collection transition from `markerState`, fit-on-load,
  no canvas element, shared style used). Avoid brittle pixel-perfect assertions.
- Manual/Playwright: World unchanged; Activity Detail same basemap + route + fit + replay +
  aligned collected items + near misses; zoom/pan/resize stable; cross-screen basemap and
  collectible vocabulary identical.
