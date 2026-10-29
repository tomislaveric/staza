# explore-area-v2-polish

## Goal

Polish the route-first Explore this Area flow while preserving its existing route-planning and confirmation model. The selected map viewport should meaningfully constrain generated routes, a successful Locate Me position should carry into exploration, and any map coordinate should be addable as a route destination.

## Scope

- Constrain destination candidates and route geometry to the frozen exploration bbox.
- Permit an outside start coordinate, allowing only the required start-connected route segment to travel between it and the bbox.
- Prefill exploration start from the last successful or saved Locate Me position without requesting geolocation again.
- Allow map clicks anywhere during route customization to open an “Add destination” tooltip for the clicked coordinate.
- Add confirmed arbitrary coordinates as route-only waypoints; they do not create collectibles or gameplay objectives.
- Preserve existing collectible selection, route editing, confirmation, and map behavior outside this flow.

## Decisions

- The bbox is a strict boundary for destinations and route geometry except for the connector required by an outside start (including the return connector for round trips).
- Use the last successful or saved Locate Me coordinate as the initial start, while retaining the ability to change it in the exploration panel.
- A map click opens an “Add destination” tooltip; the player confirms from the tooltip to add the clicked point.
- Arbitrary street/map points shape the route only and never count as collectible or objective progress.
- Do not request geolocation automatically.

## Implementation plan

1. Trace route generation, rerouting, route-provider behavior, bbox handling, and tests to choose the narrowest safe boundary-enforcement approach.
2. Extend route-planning models and generation/rerouting to support arbitrary clicked coordinates as non-gameplay waypoints.
3. Update World map interactions and exploration state for location reuse and tooltip-based waypoint addition.
4. Add focused regression tests for bbox enforcement and outside-start connectors, location reuse, map waypoint interaction, and route-only semantics.
5. Run relevant tests and the build; inspect the diff while preserving existing worktree changes.

## Acceptance criteria

- Generated and customized routes stay within the frozen bbox, except for the necessary connector from an outside start; destinations remain inside the bbox.
- Opening Explore this Area uses the last successful or saved Locate Me position as the start and makes no new geolocation request.
- During customization, clicking any map location opens an “Add destination” action for that coordinate without first enabling an add mode.
- Confirming the tooltip adds that coordinate as a route waypoint and reroutes the selected route without creating collectible/objective progress.
- Existing collectible selection, route planning, and confirmation behavior remain intact.

## Constraints

- Preserve unrelated existing worktree edits, including edits to files that may also need feature changes.
- Keep outside-start handling explicit for both generated and customized routes; do not allow unrelated route excursions beyond the bbox.
- Keep arbitrary map waypoints separate from collectible persistence and gameplay objectives.

## Validation

- Run focused tests for the changed route-planning, exploration, World map, and exploration-panel behavior.
- Run `npm run build`.
- Review the resulting diff and verify pre-existing user changes remain intact.
