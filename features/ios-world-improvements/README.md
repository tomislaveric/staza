# ios-world-improvements

## Goal

Bring the iOS World tab to parity with the web World page, using native iOS patterns. Users can recenter on their location, filter map content, see visible-area discovery counts, and manage their explorations. Explore, explorations and item details all live in one persistent bottom sheet, styled like Apple Maps.

## Scope

- **Locate control:** add a floating button at the top right of the map. It recenters on the user and cycles through no tracking, follow, and follow-with-heading.
- **Bottom sheet:** add a persistent, custom in-tab draggable sheet over the MapLibre map. It has peek, medium, and large snap points, and the tab bar stays visible.
- **Sheet modes:**
  - **Browse** (default): visible-area stats, an "Explore this Area" button, a filter chip row, and the "Your Explorations" list.
  - **Explore:** the existing Explore flow (configure, generate, choose a proposal, edit destinations, confirm), moved out of the floating overlay.
  - **Detail:** the tapped collectible or flowline. This replaces the separate system sheet.
- **Filters:** match the web set: All, Found, Unfound, Flowlines, Viewpoint, Peak, Castle, Waterfall, Place and Mountain pass, plus the Skill Atlas advanced filters (Undiscovered only, Peaks only, High flow, Long Flowlines).
- **Your Explorations:** show each quest instance's status, objective progress and planned-route summary. Active explorations can be cancelled and failed ones retried. Tapping one highlights its targets on the map.

### Out of scope

- Server, API or web changes.
- Choosing the Explore start point by tapping the map. Start stays "map center" or "My location".
- GPX download of planned routes.
- Saving a home location from the locate button.

## Decisions

- **Sheet type:** use a custom in-tab sheet, not a system `.sheet`, so the World tab keeps the tab bar and tab switching.
- **Sheet contents:** Explore, Explorations, stats and item details all live in the sheet.
- **Filter placement:** filters appear as a horizontal chip row in the sheet, with marker swatches.
- **Filter behavior:**
  - Multi-select uses union semantics, and "All" resets the selection.
  - Quest targets stay visible regardless of filters.
  - Hidden collectibles are excluded.
- **Advanced filters:**
  - Rules:
    - Undiscovered only: unfound collectibles and incomplete flowlines.
    - Peaks only: peak collectibles.
    - High flow: `flowScore >= 70`.
    - Long Flowlines: `lengthMeters >= 5000`.
  - Granted filters come from `GET /api/player/capabilities` (`worldFilters`).
  - Locked filters are listed in `lockedWorldFilters`. They show a lock and name the Skill Atlas node that unlocks them.
- **Locate:** recenter only; it does not persist a home location. If permission is denied, the control offers to open Settings.
- **Map:** keep MapLibre Native. The map's bottom content inset and the route-fit padding follow the sheet height.
- **Platform:** keep the iOS 17 deployment target and avoid iOS 18-only APIs.

## Implementation plan

1. **Filter logic:** add `WorldFilters.swift` with the filter enum, availability rules, union filtering, advanced rules and quest-target merge. Extend the World models with `visibility`, `flowScore`, `lengthMeters` and viewport `stats`.
2. **Capabilities and explorations:** load granted and locked world filters. Keep the full quest instances in the World model. Add cancel (`DELETE /api/quest-instances/:id`), retry (`POST /api/quest-instances/:id/retry`) and highlight actions.
3. **Sheet component:** add a reusable `StazaBottomSheet` to the design system. It provides detents, drag and velocity-aware snapping, a grabber and a material background, hands scrolling to its content at the large detent, and reports its height.
4. **Sheet modes:** add a sheet mode state machine (browse, explore, detail) that returns to the previous mode and changes detents automatically. For example, it lowers the sheet so a proposed route is visible.
5. **Browse content:** stats header, Explore button, filter chips with swatches and locked state, and exploration cards.
6. **Explore in the sheet:** host `ExplorePanel` inside the sheet and adapt its layout.
7. **Detail in the sheet:** move the detail content into the sheet and remove the system `.sheet`.
8. **Locate control:** add a floating locate button that cycles tracking modes, stays in sync with MapLibre's tracking mode and handles denied permission.
9. **Map integration:** pass filtered data and highlighted exploration targets to the map, and make the map inset and route padding follow the sheet height.
10. **Localization and accessibility:** add string catalog entries and accessibility identifiers (`worldSheet`, `worldLocate`, `worldFilter.<id>`, `worldExploration.<id>`), and support VoiceOver and Dynamic Type.

## Acceptance criteria

- **Locate:** the World tab shows a locate button that recenters on the user and cycles tracking modes. Denied permission is handled gracefully.
- **Sheet behavior:**
  - A persistent sheet snaps between peek, medium and large, and never hides the tab bar.
  - The map remains usable above the sheet.
- **Browse mode:**
  - Shows visible-area counts and "Explore this Area".
  - Filter chips appear only for content present in the viewport. Granted advanced filters are always shown, and locked ones show a lock.
  - Selecting several filters shows the union of matching map items. Quest targets remain visible.
- **Your Explorations:**
  - Lists quest instances with status and progress.
  - Active ones can be cancelled and failed ones retried.
  - Tapping one highlights its targets on the map.
- **Explore and Detail:**
  - Explore runs fully inside the sheet, and a proposed route stays visible above it.
  - Tapping a map item shows its details in the sheet. Closing them returns to the previous mode.
- **No regressions:** existing World and Explore behavior and the tests for them keep passing.

## Validation

- Unit tests (`ios/StazaTests`) cover:
  - Filter availability and union and advanced filtering.
  - Cancel and retry actions.
  - Sheet mode transitions.
- Build the app and run the iOS test suite with the command in `ios/README.md`.
- Manually check in the simulator: locate, filters, sheet dragging, Explore inside the sheet, item details, and exploration cancel and retry.
