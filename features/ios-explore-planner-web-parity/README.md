# ios-explore-planner-web-parity

## Goal

Bring the iOS Explore route planner to parity with the web planner. The server changes are already
shared (see `features/world-destination-route-enhancements/README.md` and
`features/e0-backend-enablement-for-native-clients/api-spec.md`); this feature is iOS client work only.
The web reference is `public/components/world/route-planner.js` (`routeEdit`, `nearbyChoices`) and
`public/components/world-page.js`.

## Product behaviour

- One Explore planner: destination (POI or aimed map point) + sport + shape → one baseline route.
- After the baseline: optional nearby Flowlines (cycling only) and a "Nearby places" list.
- Adding a POI or map point bends the baseline locally (`POST /api/explorations/:id/reroute`); it does
  not regenerate a different route.
- Removing all added stops restores the exact baseline instantly (no request), including its optional
  Flowlines and nearby list.
- A failing edit keeps the last working route and shows the error.

## Scope

- `ios/Staza/Features/World/ExploreModels.swift`, `RoutePlannerModel.swift`, `RoutePlannerPanel.swift`,
  `WorldView.swift`, `WorldMapView.swift`, `ios/Staza/Resources/Localizable.xcstrings`,
  `ios/StazaTests/RoutePlannerModelTests.swift`.
- Out of scope: server, web, Android.

## Decisions

- **Highlighting** (iOS has no hover): tapping a nearby place, optional Flowline or stop row body
  highlights and centers that POI/Flowline on the map; the row's add/toggle control performs the action.
  The planner row of the POI/Flowline selected on the map gets a yellow (accent) border.
- **Start row** keeps its ⋯ menu (Select on map / Locate me). The End row shows only its label or
  "Not set", without coordinates.
- The "Let Staza order" button is removed together with the stop-order note; `keepOrder` resets when
  the baseline is restored.
- A changed start, end, sport or shape drops the old baseline, so the player's stops are planned from
  scratch (`/plan`) instead of detouring a baseline that no longer fits.
- `no_reachable_targets` errors get their own localized message.
- The iOS `noRoute` / `noSuggestion` copy (en + de) matches the server messages:
  "No route was found. Try another start or destination." and
  "No places can be reached from this start. Try another start or destination."

## Implementation plan

1. **Models** — `RerouteRequest { proposalId, targetIds, waypoints: [GeoPoint] }`,
   `ReroutedExploration { proposal, nearbyCollectibles? }`; decode `nearbyCollectibles` on
   `PlannedExploration` and `FlowlineEnhancementResponse`.
2. **Route editing** in `RoutePlannerModel`, mirroring web `routeEdit`:
   - Not generated / no baseline / no exploration id → `/plan`.
   - Suggested stops = the baseline's chosen destination POI. Edited stops missing a suggested one → `/plan`.
   - Edited stops == suggested → restore the baseline locally: baseline proposal, suggested stops,
     `stopsAreSuggested = true`, `keepOrder = false`, no selected enhancements/metrics,
     `nearbyCollectibles = baselineNearbyCollectibles`; no request.
   - `keepOrder` → `/plan`.
   - Otherwise `/reroute` with the baseline proposal id, collectible `targetIds` and map-point
     `waypoints`; on failure fall back to `/plan` once.
   - Success: adopt the proposal, `nearbyCollectibles = result.nearbyCollectibles ?? current`, order
     stops by `stopOrder` unless `keepOrder`.
   - Failure: restore the last working route (stops, proposal, `stopsAreSuggested`, enhancements,
     metrics, `keepOrder`) and show the error.
   - Store `baselineNearbyCollectibles` on generate and reset it with the planner; `enhance` also
     updates `nearbyCollectibles`.
   - `nearbyChoices` = nearby places not already stops (empty unless generated).
   - Highlight state for a collectible or Flowline, with a request counter for map centering.
3. **Panel** — nearby section lists `nearbyChoices`, hidden when empty, no explanatory note; remove the
   header subtitle and stop-order note/button; End row without coordinates; Save Exploration with a solid
   accent border and accent text; Optional Flowlines and Nearby places titles styled like the
   "Baseline route" title; highlighted rows get an accent border.
4. **Map** — the highlighted POI/Flowline is drawn selected and centered; map POI/Flowline taps set the
   row highlight; tapping a POI or Flowline never adds a map-point stop.
5. **Strings** — remove now-unused planner keys, update error copy, add new keys (en + de).
6. **Tests** and **documentation** (update the "Web parity" section of
   `features/world-destination-route-enhancements/README.md` to state iOS matches).

## Acceptance criteria

- Adding a stop to a generated route calls `/reroute` with the baseline proposal id; reordered stops use `/plan`.
- Removing all added stops restores the baseline and its nearby list without a request.
- A failed reroute falls back to `/plan`; a failed edit keeps the last route and shows the error.
- Nearby places exclude current stops and update from generate/plan/reroute/enhance responses.
- Panel UI matches the cleanup decisions above.

## Validation

- `cd ios && xcodebuild -project Staza.xcodeproj -scheme Staza -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/staza-dd2 test -only-testing:StazaTests`
- New `RoutePlannerModelTests`: reroute body, baseline restore without request, nearby filtering and
  updates, failed edit keeps last route, `keepOrder` → `/plan`, reroute → plan fallback.
- Server/web unchanged: `npx tsc --noEmit -p .`, `npx vitest run`.
