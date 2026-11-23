# route-generation-v2

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
  - The response shape is unchanged. `proposals` has exactly one entry, with `recommended: true`.
- `POST /api/world/explore` clamps instead of rejecting a large area and returns the explored
  `area`. `exploreAllowed` stays in the `/api/world` viewport response for older clients. The
  generate area limit (2° span) accepts every clamped frame.

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

**iOS** (`ExploreRevealViews.swift`, `ExploreModels.swift`, `RoutePlannerModel.swift`,
`WorldMapView.swift`, `WorldModel.swift`, `Localizable.xcstrings`): the same behaviour, mirrored.
`RouteIntent` names are not localized; `ExploreAction`/`exploreAllowed` are removed and the
explored `area` is decoded (optional for older servers).

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
  player must tap the map before Generate is enabled.
- The editor (add or remove Flowlines and Collectibles, start, end point or round trip,
  waypoints, reorder, reroute, Save Exploration) works unchanged on the generated route.
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
