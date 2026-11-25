# route-planning-v2

## Goal

Simplify the iOS World route-planner sheet shown in the approved screenshot. Replace its dense stack of controls and long instructions with a guided, compact flow that makes map-based stop selection clear and asks for a start only when one is not already available.

## Scope

In:

- The iOS World planner sheet and map taps while the planner is active.
- Planner-specific English and German strings.
- Focused iOS planner tests and this feature documentation.

Out:

- Web and Android planners.
- Explore UI changes; Explore is a visual reference only.
- Routing algorithms, API behavior, route generation/suggestion, save semantics, and start-location eligibility.

## Decisions

- Use guided sections in the existing scrollable sheet, not a strict one-step-at-a-time wizard or another navigation destination.
- Order the guidance as sport → route feeling → existing route-shape controls → stops → start selection only when the start is missing.
- Keep all sections accessible without gating. Preserve round-trip and endpoint options.
- In the active planner, tapping a Flowline or collectible directly toggles it as a stop. Tapping empty map adds a waypoint by default. An explicit start/end-pick action takes precedence while active.
- When a start is already set under the existing location rules, show a compact status instead of raw coordinates and provide one compact way to change it. When missing, show the map-pick prompt as the final guided section; routing remains unavailable until selected.
- Retain the stop list, reorder/remove controls, Suggest route, Route, Save, result/error states, and gameplay disclaimer.
- Tapping a stop in the list highlights it on the map and centers it, as Explore does for a tapped Flowline or collectible; waypoints are centered only.
- Removing or moving a stop recalculates an already calculated route after a short pause (about 0.8 s), so several quick moves send one request.
- Suggest route is the primary action while there are no stops; once stops exist, Route is primary. Suggest route asks before replacing stops the player chose or edited, but not stops it suggested itself.
- Use concise English and German copy, existing Staza tokens and components, and the existing `RouteIntentPicker`. Do not create a new design-system primitive.

## Implementation plan

1. Restructure `ios/Staza/Features/World/RoutePlannerPanel.swift` into the guided sections. Remove the Flowline, collectible, and waypoint mode buttons; replace the coordinate-heavy start row with a compact status/action or final missing-start prompt.
2. Update `ios/Staza/Features/World/RoutePlannerModel.swift` and `WorldView.swift` so active planner map taps select stops directly, empty-map taps add waypoints unless start/end selection is explicit, and missing-start picking is deferred until requested from the final section. Keep map details unchanged outside the planner.
3. Update planner strings in `ios/Staza/Resources/Localizable.xcstrings`, add focused cases to `ios/StazaTests/RoutePlannerModelTests.swift`, and amend this feature’s route-generation documentation to record the changed iOS interaction.

## Acceptance criteria

- The planner presents the chosen guided section order in one scrollable sheet without forced progression.
- Sport appears first, route feeling second and route shape third; stop selection has one concise instruction and no three add-mode buttons.
- Tapping Flowlines and collectibles adds/removes them directly while planning; empty map adds a waypoint unless start/end selection is explicitly active.
- A pre-set start is summarized without a coordinate-heavy row and can still be changed. A missing start is requested after stop/route-shape setup and must be selected before routing.
- Round-trip/endpoint selection, route generation, Suggest route, save, failure states, and planner behavior outside this sheet remain unchanged.
- English and German copy is concise, and the existing iOS unit tests plus new focused planner tests pass.

## Constraints

- Do not alter server/API or routing rules, location eligibility, or Explore UI.
- Keep the implementation within existing map-selection callbacks and Staza design-system owners.
- If start/end selection cannot be distinguished from stop selection without restoring large map-mode buttons, stop and revisit the interaction design rather than guessing.

## Validation

- Run `xcodebuild test -project ios/Staza.xcodeproj -scheme Staza -destination 'platform=iOS Simulator,id=57054F66-1BEE-4066-9AE4-A9E3FCFACEA1'`.
- Inspect the iPhone 17 planner in English and German with both pre-set and missing starts, round-trip and endpoint routes, and compact/expanded sheet states.
- Confirm the existing `RouteIntentPicker`, Staza tokens, button styles, and bottom sheet are reused without introducing a parallel pattern.
