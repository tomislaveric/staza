# collectible-rarity-cleanup-and-category-icons

## Goal

Remove Rare and Epic collectible tiers throughout Staza and give Viewpoint and Place recognizable map icons instead of circle-only category markers.

## Scope

- Remove collectible rarity types, validation, rarity-based statistics, stored/API fields, and rarity-specific presentation from the domain, persistence, map, replay, activity, profile, progress, landing, and other affected surfaces.
- Normalize existing Rare/Epic collectible and activity data to the standard collectible representation. Preserve collectible records, XP/value, source data, and unrelated history.
- Remove obsolete rarity columns and constraints with a forward-only database migration after normalizing stored row and JSON snapshot data.
- Add colored and muted SVG pictograms for Viewpoint and Place, and render them through the shared MapLibre collectible icon layers.
- Update affected fixtures, tests, localization strings, and remove rarity-only assets and styles when no longer referenced.

## Decisions

- Rare and Epic are being removed as collectible distinctions, not merely hidden from the UI.
- Existing collectibles and historical activities remain; only rarity data and its dependent summary/presentation are removed.
- Viewpoint uses a lookout/view motif and Place uses a building/location motif, matching the existing outline icon style and visited/unvisited color convention.
- Preserve unrelated in-progress worktree changes while integrating the shared map updates.

## Implementation plan

1. Remove rarity from domain contracts, collectible input normalization, world and progression summaries, persistence interfaces/queries, and all user-facing presentation.
2. Add Viewpoint and Place SVG assets in the existing colored/muted variants; register both categories in the shared sprite loader and map icon layers.
3. Add an append-only migration that normalizes rarity from collectible and activity records and saved activity/replay payloads, then removes obsolete rarity columns and constraints.
4. Update catalog fixtures, localized strings, and focused tests; delete unused rarity-only assets and CSS.
5. Run targeted tests covering world stats, persistence and data normalization, activity/replay rendering, and category icon rendering; run the project TypeScript build.

## Acceptance criteria

- No Rare/Epic collectible tiers, rarity-only counters, labels, badges, styles, or map rings remain in active code or assets.
- Existing collectible rows and activity history remain readable after migration without rarity fields; other collectible properties and XP/value are unchanged.
- Viewpoint and Place use distinct SVG pictograms on the map rather than relying on category-colored circles.
- Visited/unvisited states, selection emphasis, quest dimming, and map interaction behavior continue to work with the new icons.
- Tests and build pass.

## Validation

- Run the focused Vitest files for collectible/world behavior, persistence, map layers, and activity/replay presentation.
- Run `npm run build`.
- Review the migration and fixture changes to confirm historical data is normalized without deleting collectibles or unrelated metadata.
