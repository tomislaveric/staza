# route-planner-wizard

## Goal

Planning a route should take two taps. The player taps a sport and a route shape. Staza then
generates Glide, Chill and Explore routes for the map area the player is looking at. Tapping one
of them shows its card above its stops; the other two stay available as collapsed rows.

## Scope

- iOS World route planner sheet and map.
- Web World route planner side panel and map.
- Server: `POST /api/explorations/generate` returns all intents in one request.
- Out of scope: Android, regenerating automatically on every map pan, and deduplicating
  identical alternatives.

## Decisions

- **Wizard steps**:
  - Sport uses icon buttons (bicycle, running, hiking).
  - Route shape uses icon buttons (Round trip, A→B); A→B then asks for the end point on the map.
  - Completed steps collapse into one summary row (for example "🚲 Cycling · ⟳ Round trip"). Its **Change** action reopens the steps, and changing a choice regenerates the routes.
- **Automatic generation**: once sport, shape, start (and the end for A→B) are known, one request generates all three intents. There is no Generate button.
- **Area indication**: the player must see which area is used.
  - iOS: while no routes are generated, show a dashed frame around the visible map area above the sheet, a center target marker and the caption "Routes in this map area".
  - If the map is later moved clearly away from the used area, show a "Generate here" chip. "Clearly" means the visible center lies outside the used area, or the visible width is more than twice the used width; zooming in never counts. Pans never regenerate automatically.
  - During an Explore session the session's explored area is used; "Generate here" (web) uses the current viewport.
  - Web: the panel is beside the map, so the whole viewport is used. Show the same caption and the "Generate here" action.
- **Results**:
  - Three compact rows (name, distance, duration, one-line feel). All three are drawn on the map, subdued and dashed.
  - Tapping a route makes it the expanded card (metrics and Save) **above the stops**. The other two become slim rows under the card ("Other routes") and can be tapped to switch.
  - Switching after the player edited the stops asks for confirmation (the existing replace dialog).
- **Editing**:
  - Stops can be edited once a route is chosen, or when the player already has own stops ("Add to route" picks): map taps add or remove stops, and the list allows reordering and removing.
  - Once a route exists, every edit reroutes automatically after a short debounce (about 0.8 s on web), so several quick moves route once. A new start or end reroutes a chosen route and regenerates the routes otherwise.
  - The separate Calculate button is removed. Own stops without a route keep one "Route my stops" action; a retry action appears only after a failure.
- **Explore card**: its "Generate route" opens the planner with cycling and Round trip already chosen, generates the three routes for the explored area and opens the feel chosen on the card.
- **Route styling**: the chosen route uses the `plannedRoute` palette color (blue, dashed). The alternatives are subdued.
- **Generation**: one server call with `intents`. Every alternative belongs to the same exploration session, so each one can be saved.

## Implementation plan

1. **Server** (`src/exploration/request.ts`, `service.ts`, route types):
   - Accept `intents: ("flow"|"chill"|"explore")[]`, 1–3 unique values. The legacy `intent` field is treated as `[intent]`; anything invalid returns 400.
   - Run `generateIntentRoute` once per intent within one session; each proposal carries its `intent`.
   - Store all proposals together so each stays saveable. Intents that fail are omitted; return 422 only if all fail.
   - One request counts once against the route-planning rate limiter.
2. **iOS model** (`RoutePlannerModel.swift`):
   - Step state (sport chosen, shape chosen) and `alternatives` with their intent.
   - The chosen intent and the generated area; automatic generation when the steps are complete.
   - `choose(_:)` sets the stops from the chosen proposal; switching uses the replace confirmation.
   - Reroute after adding stops as well as after removing or moving them.
3. **iOS sheet** (`RoutePlannerPanel.swift`, `Localizable.xcstrings`):
   - Icon steps and the summary row.
   - Results list, the chosen card above the stops, and the collapsed alternatives.
   - Remove the Generate and Calculate buttons. The planner stops using `RouteIntentPicker`; the Explore card keeps it.
4. **iOS map** (`WorldView.swift`, `WorldMapView.swift`, `StazaMapLayers.swift`):
   - Planning-area frame, center marker, caption and the "Generate here" chip.
   - Subdued alternative routes and the chosen route in planned-route blue.
5. **Web** (`route-planner.js`, `world-page.js`, `world-map.js`, `world.css`; planner strings stay inline in English like the rest of the planner):
   - The same steps, summary row and automatic generation with `intents`.
   - Results list, the chosen card above the stops, the alternatives and "Generate here".
   - The chosen route in planned-route blue, dashed.
6. **Docs**: keep `route-planning-v2` and `route-generation-v2` consistent with this feature.

## Acceptance criteria

- Tapping a sport and Round trip produces Glide, Chill and Explore routes without any further tap, for the map area visible above the sheet (iOS) or the viewport (web).
- Before generation, the map clearly shows which area will be used.
- Completed steps collapse into one summary row, and the steps can be reopened from it.
- Tapping a route shows its card above its stops; the other routes are collapsed rows that switch on tap.
- Every alternative can be saved.
- Editing the stops of the chosen route reroutes automatically.
- Older clients sending `intent` still receive one proposal.

## Validation

- Server vitest:
  - Parsing of `intents` and the legacy `intent`, including invalid input.
  - One proposal per intent in a single session.
  - A failing intent is omitted; if all fail, the request returns 422.
  - Every returned proposal can be saved.
- iOS `RoutePlannerModelTests`:
  - Automatic generation after the steps.
  - Choosing and switching routes, including the confirmation.
  - Rerouting after adding a stop.
  - Detecting that the map moved away from the generated area.
- Web `route-planner.test.js` and `world-page.test.js`:
  - The steps and the request body of the automatic generation.
  - Choosing and switching routes.
- Full iOS test suite and the affected vitest suites.
