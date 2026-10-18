# saved-default-map-start-point

## Goal

Remember the most recent successful “Locate Me” position as the player's home point on the World map. Keep its home icon visible and use that location as the map's default starting point after a page refresh.

## Scope

- Persist the last successful device location in browser local storage.
- Replace the saved home coordinate whenever “Locate Me” succeeds; do not replace it on errors or denied permissions.
- Display the saved location on the World map with the existing `public/assets/nav-home.svg` icon.
- Replace category glyphs for castles, mountain passes, peaks, and waterfalls with matching outline SVGs on World and activity maps.
- Start the World map centered on the saved home location, with the bottom-left metric scale bar representing 5 km.
- Retain the existing default map center and zoom when there is no saved location.
- Keep the shared map defaults unchanged for other map consumers.

## Decisions

- Persistence is local to the browser/device; do not synchronize location to the account or server.
- Do not request geolocation automatically. Continue requesting it only when the user presses “Locate Me”.
- Reuse the existing `nav-home.svg` icon rather than introducing a new marker design.
- Match category icons to the home icon’s fine outline style, retaining muted unvisited and gold visited states.
- “5 km” refers to the distance represented by the metric scale bar (also called a map scale bar), not the total width of the map viewport.
- Invalid or missing stored data should be treated as no saved location.

## Implementation plan

1. Add a small browser-storage helper that reads, validates, and replaces the last successful coordinate.
2. Extend World map creation to accept a startup center/zoom and render/update the home marker from the saved coordinate.
3. Wire World page startup to the stored home point. On a successful Locate Me result, persist the new coordinate, update the marker, and recenter the map.
4. Replace Unicode category glyphs with shared outline SVG image layers, loaded before collectible layers on World and activity maps.
5. Determine the World startup zoom so the metric scale bar represents 5 km while accounting for the map's responsive dimensions and latitude.
6. Add focused tests for storage replacement and validation, marker updates, category image loading, and map startup framing.

## Acceptance criteria

- After a successful “Locate Me”, the new coordinate is saved in this browser and replaces any previous saved home.
- The home icon remains visible at the saved coordinate when the World map is reopened or refreshed.
- When a saved home exists, a new World map opens centered on it with a 5 km metric scale-bar distance.
- A failed or denied location request leaves the previous saved home unchanged.
- With no valid saved home, the World map continues to use its existing default center and zoom.
- Castle, mountain-pass, peak, and waterfall icons use the shared outline style on World and activity maps, with existing visited-state and quest dimming behavior preserved.
- Other screens using the shared map foundation retain their existing startup behavior.

## Validation

- Add and run targeted Vitest cases in the World page and World map test files for the behavior above.
- Run the project build (`npm run build`) to verify type safety and browser-module integration.
