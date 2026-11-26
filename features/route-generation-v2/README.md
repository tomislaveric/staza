# route-generation-v2

> **Superseded in part by [route-planner-wizard](../route-planner-wizard/README.md):** intents
> (Glide, Chill, Explore) were removed. The generator now builds exactly one route with one fixed
> policy (`GENERATION_POLICY` in `src/routePlanning/generationPolicy.ts`, generator in
> `routeGenerator.ts`), and `intent`/`intents` in requests are ignored. The scoring components and
> the generation algorithm below still apply; the per-intent table describes the former design.

> Amends [explore-sessions-and-saved-explorations](../explore-sessions-and-saved-explorations/README.md)
> and [explore-reveal-and-manual-planner](../explore-reveal-and-manual-planner/README.md):
> Explore this area works at any zoom, and **Generate route** builds exactly one route for a
> chosen intent (Glide, Chill or Explore).

## Goal

Generate one good, editable route for what the player wants from the ride, not for how many
collectibles fit on it.

```text
World → move/zoom the map → (optional start; last Locate me wins)
→ Explore this area (always enabled)
→ choose intent: Glide | Chill (default) | Explore
→ Generate route (exactly one route) → editor → Save Exploration
```

After generation the player keeps the existing editor:

- add or remove Flowlines and Collectibles
- change the start
- choose an end point or a round trip
- set waypoints
- reorder stops
- reroute
- Save Exploration

## Starting point

- `POST /api/explorations/generate` builds candidates from three internal target strategies
  (`balanced`, `peak_focus`, `discovery`). They ask for 2–8 collectibles, scaled by distance.
- Route scoring weights `questProgress` highest, so the recommended route is the one with the
  most POIs. This causes zigzag routes between castles.
- When the area has collectibles, Flowlines are only analysed after routing. They never shape
  the route.
- Up to three proposals are returned. Web and iOS silently pick the recommended one and force a
  round trip.
- Explore is disabled when the viewport is wider than 50 km ("Zoom in to explore"). The server
  also rejects areas larger than 2° per side.

## Scope

In:

- Server intent model, scoring and a single-route generator.
- Explore available at any zoom level.
- Web and iOS clients.
- en/de strings.
- Docs and the e2e test.

Out:

- Android (it has no World map).
- Persisting the intent on saved Explorations.
- A length or time selector.
- Real stop data (traffic signals, junction types).
- Changes to Flowline extraction or the routing service.

## Decisions

- **Intents are Glide, Chill and Explore** in every language (API value `flow` for Glide; renamed
  from "Flow" so it never clashes with the Flowline Flow score and filter). No "Schnell fahren", "fast" or
  speed wording: Staza does not optimize speed.
  - **Glide:** prioritize Flowline quality, minimize interruptions, POIs secondary.
  - **Chill:** balanced route quality, lower complexity, moderate distance, POIs optional.
  - **Explore:** more WorldObjects and more variety, small detours allowed, but never at the
    cost of route quality.
- **Chill is preselected.**
- **Exactly one route.** No 3–5 proposals. For older iOS builds the response keeps
  `proposals: [one]` with `recommended: true`.
- **Start is required.** It is the last successful or saved Locate me position when that lies
  inside the explored area. Otherwise Generate opens the editor picking a start: Generate stays
  disabled until the player taps the map.
- **Length** stays derived from the area size and is then **capped per intent**: Chill is
  shortest, Flow and Explore are longer. There is no length UI.
- **Explore always works.** When the viewport is wider than 50 km or taller than 100 km, the
  server clamps the explored area to a frame of at most that size centered on the viewport center
  (antimeridian aware) and returns it as `area: { bbox, center, clamped }`. The session and
  Generate use that frame, and the client draws it on the map during the Explore session.
- **The intent is not persisted.** It lives only in the request and the Explore session.
- **Explore does not mean "as many castles as possible".** It uses a weighted mix:
  - route quality
  - fitting Flowlines
  - distance
  - a few good Points of Interest
  - no zigzag only for collectibles
- **Route quality is a hard floor.** A POI is kept only if the route with it stays above the
  intent's route-quality floor and within its per-POI detour budget, compared with the same route
  without it. Otherwise the route without the POI wins.
- **Interruptions are a geometry proxy:** sharp turns per km, number of stops, and Flowline
  fragmentation. No traffic-signal data exists yet.
- **Non-cycling sports** never follow Flowlines (existing rule). Intents still apply through
  route quality, interruptions, length and POIs.

## Intent policy

`src/routePlanning/intent.ts` defines `RouteIntent = "flow" | "chill" | "explore"`,
`DEFAULT_ROUTE_INTENT = "chill"` and `ROUTE_INTENT_POLICIES`. Every tunable is a named constant.

| | Flow | Chill | Explore |
|---|---|---|---|
| Flowlines | chain the best by flow score and road quality | at most one good Flowline | explore-score weighted |
| Interruptions | strongly minimized | moderate | moderate |
| Length cap | long | short to moderate | long |
| POI budget | at most 1, only if almost free | 0–2, optional | a few, scaled by length, diverse |
| Detour per POI | almost none | small | small, bounded |

Route score is a weighted mix of:

- **Route quality:** retrace, backtracking, detours and loop shape (existing `scoring.ts`
  metrics).
- **Flowline quality:** the share of the route on chosen Flowlines, times their scores.
- **Interruptions** (proxy, see above).
- **Distance fit.**
- **POI value**, with diminishing returns per category (a second castle is worth much less than
  the first) and a bonus for variety.

## Generation algorithm

One route, within the existing routing budget (`PLANNING_LIMITS.maxRoutingRequests`) and the
planning deadline.

1. **Skeleton:** pick intent-scored opportunity Flowlines and chain them into a loop from the
   start. Use the existing helpers (`flowlineRidePoints`, `destinationStops`, `areaAnchors`,
   Flowline snapping). Without a fitting Flowline, fall back to an area loop.
2. **POIs:** insert candidate collectibles greedily at the cheapest position, ranked by value and
   variety for the intent. Stop at the POI budget and the per-POI estimated detour.
3. **Route** a few variants: the skeleton only, the skeleton with POIs, and with fewer POIs. Reuse
   `routeCandidates`, the detour and backtrack filters, and bbox enforcement.
   When no routed round trip is usable (it leaves the area or a loop point is unroutable; not when
   rate limited), tighter area loops
   (reach 0.2–0.8) are routed with the remaining budget, so Generate finds a route wherever there
   are roads, even without collectibles.
   A round trip from a start more than 2 km outside the area adds one route-only point beside the
   way there and one on the other side of the way back, so it rides a loop instead of the same
   road out and back. The plain connector stays as a fallback variant.
   **Smooth riding:** collectibles are routed as `via` stops, while route-only helper points
   (area anchors, Flowline ride points, side points) are routed as `through` points, so the router
   never turns around just to touch them. Ferries are avoided. Only if every candidate then
   leaves the area (coasts, rivers) are the same candidates retried with helpers as `via` stops.
   Flowlines are only used along the route's direction there: a Flowline is chained into the
   skeleton or used instead of an area-loop anchor only when its axis is within 35° of the leg
   and it is reasonably straight (straightness ≥ 0.5); such a Flowline is ridden end to end in
   travel direction. Crossing Flowlines are ignored. Route quality is penalized for short
   sideways jogs (two opposite turns ≥ 45° within 80 m with a net heading change < 30°, e.g. a
   hop onto a cycle path and back). Forbidden roads (motorways, `bicycle=no`) are excluded by
   the router's bicycle access rules.
   **No knots:** a knot is a 200 m–3 km stretch where the routed line crosses itself (sampled
   every 25 m); longer crossings are the tour's own shape, shorter ones roundabouts. Each Flowline
   ride block of the chained skeleton is flipped when that shortens the estimated tour, so a
   Flowline is entered from the end facing the route. Route quality loses 0.35 per knot. If the
   best route still has a knot, up to two repair rounds drop the stops within 400 m of it (with
   the whole Flowline ride they belong to; never a pinned goal) and reroute, as long as the
   estimated tour keeps at least 60% of the ride length.
   **Aimed target:** the wizard sends a `target` instead of an area.
   - A target under 2 km from the start: an area loop within a 6 km square around it.
   - A farther target (at most 80 km): the area is the corridor box around start and target, with
     a margin of `max(1 km, 0.45 × distance)`. A round trip rides start → side point → target →
     side point on the other side → start, chaining in Flowlines aligned with those legs. If
     needed, it falls back to mirrored sides, narrower sides (±0.15), and then the target alone.
     A→B ends at the target.
   - The length is the start–target distance × 1.17 (× 2 for a round trip) plus the intent's loop
     share around the target.
   - Every chosen route passes within 1 km of the target.
   - The intents of one request share identical routing requests.
4. **Pick** the best route by intent score above the quality floor. Return one proposal. Its stops
   are its collectibles plus the opportunity Flowlines it rides in full (as today).
5. "Route to" (`destinationId`) and "via this Flowline" (`destinationFlowlineId`) become pinned
   stops of the same generator. A pinned goal adds no further collectibles around it.

The multi-strategy path (`generateExplorationRoutes`, `strategies.ts`, multi-proposal labelling) is
removed (`strategies.ts` is deleted). `PLANNER_VERSION` is bumped to 5.

## API

- `POST /api/explorations/generate`
  - Accepts `intent?: "flow" | "chill" | "explore"`. The default is `chill`; any other value
    returns 400.
  - The constraint is `areaConstraint(area)`, capped by the intent.
  - Instead of `area`, accepts `target: { lat, lon }` (requires `start`). The server derives the
    area and length from it; an A→B route ends at the target.
  - The response shape is unchanged. `proposals` has exactly one entry, with `recommended: true`.
- `POST /api/world/explore` clamps instead of rejecting a large area and returns the explored
  `area`. `exploreAllowed` stays in the `/api/world` viewport response for older clients. The
  generate area limit (2° span) accepts every clamped frame.
- `POST /api/world/explore` also accepts `circle: { center: { lat, lon }, radiusMeters }`, which
  takes precedence over `bbox`. The radius is capped at `MAX_EXPLORE_RADIUS_METERS` (half the
  width limit, `clamped: true` when cut). Only Flowlines reaching into the circle and collectibles
  inside it are returned, and `area.circle` echoes the explored circle. Clients that send only
  `bbox` (web) keep the rectangle.

## Clients

**Web** (`public/components/world/explore-reveal.js`, `route-planner.js`, `world-page.js`,
`world-map.js`, `public/app-locales.js`):

- The Explore CTA is always enabled once the map is ready. The session uses the server's `area`;
  a clamped frame is drawn as a map layer during the session and a short note explains it. The
  "Zoom in to explore" state is removed.
- An intent selector (Flow, Chill, Explore, each with a one-line description) sits next to
  Generate route and in the planner panel. Chill is preselected. The names Flow, Chill and
  Explore are marked `translate="no"` so the German UI keeps them.
- The start is the last Locate me position inside the explored area. Without one, the planner
  opens picking a start and Generate stays disabled until it is set.
- `suggestRoute` sends `intent` and uses the single proposal.
- en/de strings.

**iOS** explores a circle: the largest circle that fits the visible map above the sheet, with
padding, aligned to its top below the map controls. It sends the circle together with its
enclosing `bbox` for older servers. The explored circle is outlined and framed during the session.

**iOS** (`ExploreRevealViews.swift`, `ExploreModels.swift`, `RoutePlannerModel.swift`,
`WorldMapView.swift`, `WorldModel.swift`, `Localizable.xcstrings`): the same behaviour, mirrored.
`RouteIntent` names are not localized; `ExploreAction`/`exploreAllowed` are removed and the
explored `area` is decoded (optional for older servers). The World route planner presents sport,
route feeling, route shape, stops and then a missing-start prompt in one scrollable sheet. Flowline
and collectible map taps toggle stops directly; empty-map taps add waypoints unless start or end
selection is active; while picking a start or end, any map tap sets that point. A valid existing start is shown as a compact status, and a missing start is
picked only after the player asks for it. Tapping a stop highlights and centers it on the map; removing or
moving a stop recalculates a calculated route after a short pause.
Generate uses the Explore session area, otherwise only the map area visible above the sheet (the
whole viewport when the sheet covers almost all of it). A failed Generate says no route was found in
this map area instead of reporting unconnected stops.
The planned route is drawn as a dashed blue line (`plannedRoute` in the shared map palette) without
glow, so it does not read like a ridden route and Flowlines stay visible underneath.

## Implementation plan

1. **Intent policy:** intent types, policies, per-intent length caps and request parsing, with
   tests.
2. **Intent scoring:** Flowline quality, interruptions proxy, POI value with diminishing returns
   and variety, and the quality floor, with tests.
3. **Generator:** the single-route generator (skeleton, POIs, route, pick) with pinned
   destinations and Flowlines.
4. **Service wiring:** `ExplorationService.generate` uses the generator with `intent` and returns
   one proposal. Remove unused strategy code. Service tests.
5. **Area clamp:** Explore always allowed. Align the server limits with the shared clamp rule,
   with tests.
6. **Web client:** clamp and frame, intent selector, start requirement, single proposal, strings,
   client tests.
7. **iOS client:** mirrored changes and unit tests.
8. **Docs and e2e:** amendment notes on the related feature docs, and update
   `e2e/explore-reveal.e2e.ts` (wide-viewport explore → intent → generate → edit → save).

## Acceptance criteria

- Explore this area is enabled at every zoom level. Wide viewports explore a centered max-size
  frame, which is visible on the map.
- The player chooses Flow, Chill or Explore before generating. Chill is preselected.
- Generate returns exactly one route, which opens directly in the editor.
- Explore routes contain several POIs of different kinds when the area offers them, but never a
  detour beyond the intent's budget or below its quality floor. Synthetic regression tests show
  that castles off the loop are not pulled in.
- Flow prefers the route with more, better Flowline riding and fewer interruptions. POIs are
  secondary.
- Chill produces a shorter, simpler route with few or no POIs.
- The start comes from the last Locate me position inside the explored area. Without one, the
  player must select a start on the map before Generate is enabled; iOS asks for it in the final
  planner section.
- The editor (add or remove Flowlines and Collectibles, start, end point or round trip,
  waypoints, reorder, reroute, Save Exploration) works unchanged on the generated route. On iOS,
  map taps toggle Flowline/collectible stops directly and add waypoints on empty map by default.
- No UI text uses speed wording for the intents.

## Constraints

- Keep every intent tunable as a named constant in `intent.ts`.
- Generation stays deterministic for the same input.
- Preserve bbox enforcement, the outside-start connector, and route-only waypoint semantics.
- Older iOS builds that send no `intent` keep working (Chill).

## Validation

- Unit tests: intent parsing and length caps, scoring components, generator regressions
  (Explore does not zigzag for castles and picks diverse categories; Flow prefers Flowline-heavy,
  low-interruption routes; Chill is shorter with fewer POIs; exactly one proposal), service
  generate, area clamp.
- Web client tests: clamp helper, intent selector, start requirement, single proposal.
- iOS unit tests: intent request encoding and clamp.
- `npm test`, `npm run build`, and `npm run test:e2e -- e2e/explore-reveal.e2e.ts`.

## Notes

- Interruptions are approximated from geometry. Real stop data is a later improvement.
- The constants will need tuning on real areas.
