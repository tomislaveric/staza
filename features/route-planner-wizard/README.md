# route-planner-wizard

## Goal

Planning a route should take two taps. The player taps a sport and a route shape. Staza then
generates **one** route towards the aimed target: the crosshair in the middle of the map the player
is looking at. The route's card sits above its stops, which the player can edit. (KISS: the earlier
Glide / Chill / Explore alternatives were removed.)

## Scope

- iOS World route planner sheet and map.
- Web World route planner side panel and map.
- Server: `POST /api/explorations/generate` returns exactly one proposal.
- Out of scope: Android and regenerating automatically on every map pan.

## Decisions

- **Wizard steps**:
  - Sport uses icon buttons (bicycle, running, hiking).
  - Route shape uses icon buttons (Round trip, A→B); A→B then asks for the end point on the map.
  - Completed steps collapse into one summary row (for example "🚲 Cycling · ⟳ Round trip"). Its **Change** action reopens the steps, and changing a choice generates again.
- **Automatic generation**: once sport, shape, start (and the end for A→B) are known, one request generates the route. There is no Generate button.
- **One route, no intents**: there is no route feel (Glide / Chill / Explore) any more, neither in the planner nor on the Explore card. The server uses one fixed generation policy and ignores `intent`/`intents` sent by older clients.
- **Aimed target** (replaces the earlier planning-area frame): the player must see where the route goes.
  - Round trips ride from the start to the aimed target and back. The target does not need to be exact; the route passes within 1 km of it.
  - iOS: the aim (crosshair) sits in the middle of the map above the sheet, with the caption "Target: crosshair". Web: the crosshair sits in the middle of the map viewport, and the panel says that routes ride to it and back.
  - No frame is drawn around a planning area. An Explore session keeps its own outline.
  - The crosshair shows before generating and again when the map center is more than 1 km away from the generated target. In that case a "Generate here" action also appears. Pans never regenerate automatically.
  - A→B routes aim at the picked end, so they show no crosshair.
- **Result**: the generated route is shown right away as the card (title "Suggested route", metrics and Save) **above its stops**. Its collectibles and ridden opportunity Flowlines become the stops.
- **Editing**:
  - Stops can be edited once a route exists, or when the player already has own stops ("Add to route" picks): map taps add or remove stops, and the list allows reordering and removing.
  - Once a route exists, every edit reroutes automatically after a short debounce (about 0.8 s on web), so several quick moves route once. A new start or end reroutes an existing route and generates otherwise.
  - The player's own (or edited) stops are never replaced silently: a new sport, shape or endpoint reroutes them instead, and "Generate here" asks for confirmation first.
  - Own stops without a route keep one "Route my stops" action; a retry action appears only after a failure.
- **Explore card**: its "Generate route" opens the planner with cycling and Round trip already chosen and generates the route towards the map center.
- **Route styling**: the route uses the `plannedRoute` palette color (blue, dashed).

## Implementation plan

1. **Server** (`src/exploration/request.ts`, `service.ts`, `src/routePlanning/generationPolicy.ts`, `routeGenerator.ts`):
   - One `GENERATION_POLICY` (balanced Flowlines, at most 2 Flowlines and 2 POIs, length factor 0.6 of the area, capped at 50 km) and `generateRoute` without intents.
   - `parseGenerateRequest` returns one ride input and ignores `intent`/`intents`.
   - `ExplorationService.generate` plans one route and returns a one-entry `proposals` list; one request counts once against the route-planning rate limiter.
2. **iOS model** (`RoutePlannerModel.swift`):
   - Step state (sport chosen, shape chosen), `generated` and the generated target; automatic generation when the steps are complete.
   - `generate(toward:)` adopts the single proposal and sets its stops.
   - Reroute after adding, removing or moving stops.
3. **iOS sheet and map** (`RoutePlannerPanel.swift`, `WorldView.swift`, `WorldMapView.swift`, `ExploreRevealViews.swift`, `Localizable.xcstrings`):
   - Icon steps, summary row, route card above the stops.
   - The aim crosshair, its caption and the "Generate here" chip (with confirmation over own stops).
   - No intent picker and no alternative routes layer.
4. **Web** (`route-planner.js`, `world-page.js`, `world-map.js`, `explore-reveal.js`, `world.css`; planner strings stay inline in English like the rest of the planner):
   - The same steps, summary row, automatic generation, route card above the stops and "Generate here".
   - No intent picker and no alternative routes layer.
5. **Docs**: keep `route-planning-v2` and `route-generation-v2` consistent with this feature.

## Acceptance criteria

- Tapping a sport and Round trip produces one route without any further tap, towards the center of the map visible above the sheet (iOS) or of the viewport (web).
- Before generation, the map shows the crosshair the route will ride to.
- Completed steps collapse into one summary row, and the steps can be reopened from it.
- The route's card sits above its editable stops, and the route can be saved.
- Editing the stops reroutes automatically.
- No UI shows Glide, Chill or Explore; older clients sending `intent`/`intents` still receive one proposal.

## Validation

- Server vitest: request parsing ignores legacy intents; generation returns exactly one saveable proposal; aimed routes pass the target.
- iOS `RoutePlannerModelTests`: automatic generation after the steps, the adopted route and its stops, rerouting after edits, own stops kept on a sport change, and the 1 km target check.
- Web `route-planner.test.js` and `world-page.test.js`: the steps, the request body without intents, the route card above the stops, and "Generate here".
- Full iOS planner tests and the affected vitest suites.
