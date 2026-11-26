# world-destination-route-enhancements

## Goal

Make World destination-focused and simple to plan: Explore opens a route flow to a chosen map
destination, Valhalla returns a fast baseline route without Flowlines, and the player may optionally
enhance a cycling route with nearby Flowlines after seeing their added distance, time, elevation,
and character. Curated POIs stay visible and selectable; rides can still discover other POIs they
pass.

## Scope

In:

- Web and iOS World and route-planning experiences.
- Destination-first baseline generation for cycling, running, and hiking.
- Optional, combinable cycling Flowline enhancements shown after baseline generation.
- Always-visible curated POIs, selectable as destinations and discoverable during rides.
- Focused server, web, and iOS tests and feature documentation.

Out:

- Android World; it has no World map.
- Flowline enhancements for running and hiking; current Flowline domain behavior is cycling-only.
- New persistent Flowline-reveal semantics.
- New `flowline_rule` progression objectives from route enhancements. Existing authored/legacy
  Flowline quests and activity completion remain unchanged.

## Decisions

- **Explore is the only route-planning entry point.** It opens destination selection and sport
  selection, followed by one generated baseline route.
- **Destination:** any map point can be selected; curated POIs remain visible and may be selected
  as named destinations.
- **Route lifecycle:** generation shows an editable preview. Saving is explicit, and starting the
  saved exploration remains a separate action.
- **Baseline:** route first with the selected sport's normal routing profile and no Flowline
  waypoints or Flowline-based scoring. Keep baseline metrics available for comparison.
- **Flowline enhancements:** after baseline routing, show a small set of nearby cycling Flowlines
  as separate optional choices. None are included until selected; multiple choices can be combined.
- **Comparison:** show actual added distance, duration, and elevation from the rerouted proposal,
  plus a short reason based on Flowline character/quality and fit to the route. If elevation is
  unavailable, do not imply a known delta.
- **Progression:** selecting an optional Flowline never makes it required to plan or save and does
  not create a `flowline_rule` objective.
- **POIs:** all curated POIs are visible in World. The selected POI may be the destination, while
  other POIs remain accidental discoveries when an activity passes them. Do not silently add
  unselected POIs as mandatory route stops.
- **Discovery:** nearby Flowlines surfaced after generation are temporary session opportunities.
  Do not introduce persistent reveal state.

### iOS simplification (follow-up decision)

- The iOS World tab is the route planner, titled **Explore**. The former browse sheet (filters, the
  area-Explore button, discoveries and Flowline reveals) and its Explore-area sessions are removed.
- iOS loads no viewport Flowlines. Flowlines appear only as optional enhancements of a generated
  cycling route, or after the ride in the activity replay.
- Tapping a POI opens its detail with **Route here** (it becomes the named destination and, for A→B,
  the end) or, once a route exists, add/remove as a stop. A reset button starts the plan over.
- Saved Explorations stay listed below a fresh plan so they can be shown, started or deleted.
- The web client keeps its current World UI; `/api/world` still returns Flowlines for it.
- Enhancement candidate search samples route and Flowline vertices and avoids spreading large
  arrays into `Math.min`, which overflowed the call stack on long routes with dense Flowlines.

## Implementation plan

1. **Destination-first baseline routing**
   - Refactor route generation so the initial Valhalla route is independent of available Flowlines
     for all supported sports.
   - Preserve target routing for arbitrary map coordinates and selected curated POIs.
   - Retain baseline distance, duration, and elevation for comparisons.
   - Add regression coverage proving available Flowlines cannot alter the baseline.
2. **Optional cycling Flowline enhancements**
   - Find a small, relevant candidate set near the baseline route after it is routed.
   - Return candidates separately; do not silently add them as baseline stops.
   - Allow selected candidates to be combined and rerouted using existing Flowline geometry
     constraints without attaching progression objectives.
   - Report actual incremental distance, duration, and elevation plus a concise rationale.
   - Test candidate relevance, combinations, metric deltas, and absence of Flowline objectives.
3. **World planning clients and POIs**
   - Update web and iOS so Explore opens destination selection, sport selection, and baseline
     generation; remove the separate route-planning entry point if present.
   - Keep all curated POIs visible and selectable as named destinations.
   - Show baseline and optional Flowline choices clearly; reroute and update deltas when the player
     changes enhancement selections.
   - Preserve accidental POI collection and add focused client tests for selection, route state,
     metrics, and parity.
4. **Documentation and end-to-end validation**
   - Update the route-planner, Explore, and Flowline feature documentation where it conflicts with
     the new behavior.
   - Run focused server and web tests plus relevant iOS World/route-planner tests.
   - Verify Explore → destination and sport → baseline preview → optional Flowlines → save → start.

## Acceptance criteria

- Explore leads to a destination-first route preview for cycling, running, and hiking.
- Initial baseline routing uses no Flowline geometry or Flowline-based scoring.
- Curated POIs are visible in World and selectable as named destinations; any map point may also be
  the target.
- POIs not selected as the goal are not silently added as mandatory stops, but remain discoverable
  when a ride passes them.
- After baseline generation, cycling routes can show nearby Flowlines as optional enhancements.
- Selecting multiple enhancements updates the route and shows actual added distance, time, and
  elevation, with a reason to consider each option.
- No Flowline is required to plan or save, and optional enhancements create no progression
  objectives.
- The route remains editable, saving is explicit, and starting the saved exploration remains
  separate.
- Web and iOS implement the same product behavior. Android remains out of scope.

## Constraints

- Keep the baseline request independent of Flowline geometry so the route can be returned first.
- Calculate displayed deltas from routed proposals, not estimated detours.
- Preserve existing collectible found-state and activity detection behavior.
- Preserve existing authored/legacy Flowline quests and activity completion semantics.
- Do not add persistent Flowline reveal behavior as part of this feature.

## Validation

- Server tests: baseline independence from Flowlines, routing profiles, selected destinations,
  nearby candidate filtering, combined enhancements, actual metric deltas, and no new Flowline
  progression objectives.
- Web tests: Explore entry point, destination/POI selection, always-visible POIs, baseline and
  enhancement selection state, metrics, and accidental POI collection behavior.
- iOS tests: mirrored World and route-planner behavior, request/response decoding, and enhancement
  metric presentation.
- Run the focused repository test selectors and relevant iOS World/route-planner test suite.
