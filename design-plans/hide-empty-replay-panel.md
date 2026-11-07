# Don't show the replay panel when it has nothing to list

Written against: bac216d5c608d99c8ae662cd14b2e452610043d7

## Evidence chain

- Surface: Activity detail → Replay (`/activities/<id>`), phone and desktop, for an activity with no collectibles, near misses or completed Flowlines (the audited ride "bike2work").
- Problem: after the replay finishes, or when the reopen button is tapped, the panel shows only the title and distance/duration. It also shows an empty progress bar, "No collectibles yet", "0%" and "No collectibles on this activity", which is three statements of the same emptiness. On desktop the panel fills the full height of the map (`top: 14px; bottom: 14px`). On a 390px phone it covers the top third of the map and hides the route.
- Design evidence: `panelFitPadding` in `public/components/replay-tab.js` assumes the panel is "beside" the route. `mobile-responsiveness` requires overlays to fit narrow screens. You also said you dislike the map overlay and that there is too much text.
- Owner: `mountReplayTab` and `mountReplayPanel` in `public/components/replay-tab.js`. The markup comes from `ReplayTab()` in the same file.
- Scope and affected surfaces: Activity detail → Replay only. `CollectionPanel` is shared with the World quest detail and is not changed.
- Uncertainty: none for the empty case. Activities that do have collectibles keep the panel unchanged.

## Design decision

Render no panel and no reopen button when there is nothing to list: `replayPanelRows(replay)` is empty and `replay.activityResult.fartlekCompletions` is empty. The distance, duration and XP are already in the XP card above the map.

## Reuse

- `replayPanelRows`, `FartlekCompletionsSection`, `setPanelOpen`
- Exemplar: the existing `panelHost ? mountReplayPanel(...) : () => {}` guard in `mountReplayTab`.

## Changes

1. `public/components/replay-tab.js`
   - Change: in `mountReplayTab`, compute `hasPanelContent` (rows or Flowline completions). When false, remove `[data-replay-panel]` and `[data-replay-panel-reopen]` from `mountPoint` before use, and set `panelHost` and `reopenButton` to `undefined`. Guard `reopenButton.hidden = open` so it can't unhide.
   - Preserve: the autoplay, hide-on-play and show-on-complete behaviour for activities that have content. `panelFitPadding` returns the base padding when no panel exists.
   - Verify: for the empty activity the replay completes with no panel and no button.
2. `public/components/activity-detail-page.test.js` and/or `replay-tab.test.js`
   - Change: add one test for the empty case (no panel, no button after mount) and keep the existing assertion that `data-replay-panel` is rendered for an activity with collectibles.
   - Verify: both tests pass.

## Scope

- Inherit: all activities without collectibles, near misses or Flowlines.
- Verify: an activity with only a near miss, one with only a Flowline, and one with collectibles.
- Exclude: panel styling, the mobile panel size for non-empty activities, and `CollectionPanel`.

## Validation

- Product: finishing a replay on an empty activity leaves the full map visible.
- Interface: Playwright at 390 and 1440 wide on `/activities/<id>` for an empty and a non-empty activity.
- System: no new CSS and no change to the shared panel component.
- Repository: `npx vitest run public/components` → pass. `npm run test:e2e` → pass.

## Stop conditions

- Stop if a non-empty activity can reach the empty branch.
- Stop if the empty-state copy turns out to be needed elsewhere.

## Design documentation

- After acceptance and validation: none.
