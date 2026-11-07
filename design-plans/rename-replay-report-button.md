# Name the replay reopen button after what it opens

Written against: bac216d5c608d99c8ae662cd14b2e452610043d7

## Evidence chain

- Surface: Activity detail → Replay, the pill at the map's top right (phone and desktop).
- Problem: the pill reads `REPORT` with aria-label "Show activity report", but it opens a collectibles list (collected and near-miss rows, progress, completed Flowlines).
- Design evidence: `ReplayTab()` in `public/components/replay-tab.js` (line 19) holds the `REPORT` label. The same file passes `ariaLabel: "Replay collection"` and the fallback title "Collectibles on this route" to the panel. The CSS comment in `app-shell.css` ("below the Collectibles button") and `features/mobile-ux-audit/README.md` ("Collectibles button") both call it the Collectibles button.
- Owner: `ReplayTab()` in `public/components/replay-tab.js`.
- Scope and affected surfaces: Activity detail → Replay only.
- Uncertainty: the label is hardcoded English like the rest of the replay panel. No locale entry exists for it.

## Design decision

Rename the label to `COLLECTIBLES` and the aria-label to "Show collectibles", so the control matches its content and the project's own name for it.

## Reuse

- Existing `.activity-replay-panel-reopen` styling (unchanged).
- Exemplar: the "Replay collection" aria-label on the panel.

## Changes

1. `public/components/replay-tab.js`
   - Change: line 19 button text `REPORT` → `COLLECTIBLES`; aria-label "Show activity report" → "Show collectibles".
   - Preserve: classes, data attributes, position and the hidden logic.
   - Verify: the pill reads COLLECTIBLES after a replay starts and still fits at 320px wide.
2. `public/styles/app-shell.css`
   - Change: only if the longer label wraps or overlaps the zoom controls at 320px, adjust the `.activity-replay-map .maplibregl-ctrl-top-right { top: 54px }` offset to clear the pill.
   - Preserve: the mobile `min-height: 36px` rule.
   - Verify: no overlap at 320, 390 and 1440 wide.

## Scope

- Inherit: both viewports.
- Verify: German locale, since the button is not localized today.
- Exclude: localizing the replay panel.

## Validation

- Product: the pill names the list it opens.
- Interface: Playwright on `/activities/<id>`, check the label, tap target and zoom-control clearance.
- System: no new class or component.
- Repository: `npx vitest run public/components` → pass.

## Stop conditions

- Stop if the `hide-empty-replay-panel` plan lands first and removes the button for the activity being tested. Use an activity with collectibles.

## Design documentation

- After acceptance and validation: none.
