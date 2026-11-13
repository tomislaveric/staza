# ios-collectible-category-icons

## Goal

On the iOS maps, collectibles should look like they do on the web: a category icon for each
collectible instead of a plain circle, with a gold icon when found and a muted blue icon when not.
Today the iOS World and activity replay maps draw every collectible as a plain circle.

## Scope

- iOS World map (`ios/Staza/Features/World/WorldMapView.swift`).
- iOS activity replay map (`ios/Staza/Features/Activities/ReplayMapView.swift`).
- Out of scope: web and Android rendering, and backend changes beyond what the iOS client needs
  to read a collectible's category.

## Decisions

- **Artwork:** SF Symbols, not the web SVGs. The icons look native on iOS and close to the web,
  but not identical (filled glyphs instead of the web's outlined ones).
- **Category mapping** (one shared mapping, also used by the World detail sheet):
  peak/mountain → `mountain.2.fill`, mountain_pass → `road.lanes`, castle →
  `building.columns.fill`, viewpoint → `binoculars.fill`, waterfall → `drop.fill`, place → a
  place glyph. Coin and other categories stay as circles, as on the web.
- **Colors:** found = gold `#E8B80A`; not found = muted `#7FBAD0`. Fallback circles use the web
  colors (gold when found, `#315B68` fill with a `#7FBAD0` ring when not).
- **Highlights:** quest targets and the selected collectible get the web's soft gold glow and
  ring under the icon instead of a solid gold disc. The selected collectible uses the brighter
  `#FFF1A8` ring.
- **Sizing:** icon scale follows the web's zoom stops (0.67 at z9, 0.83 at z12, 1.0 at z15,
  1.17 at z17).

## Implementation plan

1. Add a shared helper that:
   - maps a category to its SF Symbol;
   - lists which categories get an icon;
   - draws each symbol as a gold and a muted `UIImage` with a dark backing so it stays readable
     on the dark basemap;
   - adds the images to the map style after the style loads;
   - provides the icon-image and zoom-scale expressions.
2. World map:
   - Add `category`, `selected` and `questTarget` values to each point.
   - Draw a fallback circle layer for categories without an icon.
   - Draw quest/selection glow and ring layers, with the icon symbol layer on top. Icons may
     overlap and ignore placement so none are hidden.
   - Pass the selected collectible id into the map.
   - Update tap detection for the new layer ids.
3. Replay map:
   - Read the collectible category from activity events.
   - Add it to `ReplayReveal`.
   - Show collected items as icons on a subtle collected halo, with a circle fallback for
     categories without an icon.
4. Keep `WorldCategory.systemImage` and the map icons on the same mapping.

## Acceptance criteria

- On the World map, collectibles in mapped categories show as category icons: gold when found,
  muted when not.
- Coin and other unmapped categories still show as circles.
- Quest targets and the selected collectible show the glow and ring highlight.
- Tapping an icon or circle still opens the collectible's details.
- Collected items on the replay map show their category icons.
- Icons stay readable from zoom 9 to zoom 17.

## Validation

- Unit tests for the category → image-name mapping (found and not found, plus fallback) and for
  `ReplayTimeline` carrying the category.
- Run `xcodebuild test -project ios/Staza.xcodeproj -scheme Staza` on an iOS simulator.
- Check visually in the simulator at several zoom levels, with and without an active quest.
