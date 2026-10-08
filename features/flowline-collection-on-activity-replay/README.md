# flowline-collection-on-activity-replay

## Goal

Show flowlines (formerly Fartleks) on the activity replay map when the activity completes them, using the same gold completed-state treatment as collected point items.

## Scope

- Include the flowline geometry used during activity processing in the completion data saved in new replay snapshots.
- Render completed flowlines on both animated replay maps and static replay thumbnails.
- Show a grey flowline swatch beside each flowline in the replay overlay and turn it gold at its completion timestamp.
- Keep existing point collectible replay states, activity processing semantics, and World map behavior unchanged.

## Decisions

- A flowline is not shown before its completion timestamp. At that timestamp it appears in its completed/gold state.
- New rides only: existing replay snapshots are not backfilled and are not resolved against current flowline geometry, which could differ from the geometry used during the activity.
- Reuse the existing shared Fartlek/Flowline MapLibre line-layer conventions rather than drawing point markers.

## Implementation plan

1. Extend the flowline completion draft to retain its geometry and populate it when a completion is detected.
2. On replay maps, derive visible flowline features from completion timestamps and send them to the shared line layers during playback.
3. Render all completed flowlines on static replay thumbnails using a timestamp after activity completion.
4. Add timestamp-driven grey-to-gold state to the flowline swatches in the replay overlay.
5. Add focused tests for geometry propagation, completion timing, replay-map rendering, and overlay state.

## Acceptance criteria

- A newly imported activity replay snapshot retains each completed flowline's collected geometry.
- Before a flowline's completion timestamp, its line is absent from the replay map.
- At and after the completion timestamp, its line is visible in the completed/gold state.
- Each flowline in the replay overlay has a grey line swatch the same width as the collectible circles, turning gold at the completion timestamp.
- Static replay thumbnails show all flowlines completed in that activity.
- Existing collectible replay behavior and World map rendering remain unchanged.
- Older snapshots without flowline geometry continue to render without errors and are not retroactively populated.

## Validation

- Focused coverage: `npx vitest run src/fartlekDetection.test.ts public/components/activity-replay-map.test.js public/components/replay-tab.test.js`.
- Build/type-check: `npm run build`.
- Full regression suite: `npm test`.
