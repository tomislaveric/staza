# explore-sessions-and-saved-explorations

> Amends [explore-reveal-and-manual-planner](../explore-reveal-and-manual-planner/README.md)
> and [hidden-flowline-discovery](../hidden-flowline-discovery/README.md): Explore no longer
> persists reveals, and Start Exploration is split into **Save** and **Start**.

## Goal

Separate three layers of world state:

| Layer | Meaning | Persisted by |
|---|---|---|
| Temporary Opportunity | Flowlines and uncollected Collectibles shown for one Explore session | nothing (client memory only) |
| Saved Exploration | A planned route and its targets that the player chose to keep | **Save Exploration** |
| Experienced World | Ridden Flowlines and collected Collectibles | **Activities** only |

"Explore this area" never reveals the world permanently. Only saving an Exploration or
completing an Activity creates persistent world state.

```text
World → Explore this area (session) → Generate route → Edit (optional)
→ Save Exploration (planned) → … later … → Start → Ride → Activities
→ partially_completed / completed
```

## Starting point

- `POST /api/world/explore` persists reveals in `player_flowline_reveals` (source `explore`),
  and the planner accepts only persisted reveals.
- `GET /api/world` returns every collectible in the viewport and only the player's completed
  Flowlines.
- **Start Exploration** (`POST /api/explorations/confirm`) is the only persistence step. It
  creates an `active` QuestInstance and a PlannedRoute. The next activity resolves it as
  `completed` or `failed`, and a failed one can be retried.
- The manual planner is the primary flow. Generate exists only as "Suggest route" and
  proposes collectibles only.

## Scope

In: server, web and iOS clients, migration, en/de strings, docs, tests.

Out:

- Android. It has no World map, and Home still reads `status == "active"`.
- Re-evaluating Exploration progress when an activity is deleted.
- Surfacing planned Explorations in Home "Up next".
- Changes to Flowline extraction or scoring.

## Decisions

- **World default** shows only:
  - collected Collectibles
  - completed Flowlines
  - every saved Exploration route

  Uncollected Collectibles and unridden Flowlines appear only during an Explore session, or
  as a saved Exploration's targets while it is selected in the Explorations list.
- **Explore is stateless on the server.** It returns the area's opportunities and writes
  nothing:
  - eligible Flowlines, with the existing thresholds, cap of 12 and ordering
  - uncollected Collectibles

  Exploring an area again shows the same opportunities. Outcomes are `discovered` or
  `nothing_new`; the `already_explored*` outcomes are removed.
- **Existing `explore` reveals are deleted** by migration. Only `ride` reveals remain. They
  drive the "New Flowline discovered" activity label, which marks the first ride of a
  Flowline.
- **Planning is stateless.** `generate` and `plan` accept a Flowline if it is an eligible
  opportunity in the frozen bbox, using the same selector as Explore. They no longer check
  persisted reveals.
- **Generate Route is the primary action after Explore.**
  - It builds a route from the session's opportunities. Generated stops are the included
    Collectibles and the opportunity Flowlines the route rides in full.
  - The route opens in the editor, where the player can add or remove Flowlines and
    Collectibles, add waypoints, reorder and reroute.
  - **No route limits.** The player builds their own route: the former per-route caps
    (4 Flowlines, 12 Collectibles, 8 map points) are removed on server, web and iOS, and
    planner responses no longer carry `limits`. Only the area's opportunities can be added.
    The server keeps an anti-abuse ceiling of 100 stops per planning request
    (`maxRequestStops`, "This route has too many stops."), which normal use never reaches.
- **Save Exploration** is the explicit persistence step.
  - It stores the QuestInstance with `status = planned`, the PlannedRoute and the
    objectives (one `flowline_rule` per Flowline, plus the collectible objectives).
  - A player may save several Explorations.
- **Start Exploration** is a separate action on a saved Exploration in the Explorations list.
  - It moves the Exploration from `planned` to `active` and sets `started_at = now()`.
  - Several Explorations may be started at the same time.
  - Activities never resolve a planned (unstarted) Exploration.
- **Progress accumulates across activities.**
  - After Start, every activity that started at or after `started_at` contributes to the
    objectives.
  - Status flow:
    - `active` (Started, no progress yet)
    - `partially_completed` (at least one objective has progressed, but not all are done)
    - `completed` (all objectives done; XP is paid exactly once)
  - `failed` and Retry are removed.
- **Activities stay the source of truth.** Normal activity processing still records
  collected Collectibles and completed Flowlines as permanent world history, whether or not
  an Exploration is active.
- **Map rendering**
  - Every saved Exploration route, whatever its status, is drawn the same way: dotted, low
    prominence, always visible, beneath Flowlines and Collectibles.
  - The map has no status styling. Ridden Flowlines and collected Collectibles naturally draw
    on top.
  - Completed routes stay drawn.
  - Status (Planned, Started, Partially completed, Completed) appears only in the
    Explorations list (web panel, iOS sheet).
- **Delete** works for any status and removes the route from the map.
  - XP already granted stays, because it was credited to player totals at activity time.
  - A deleted completed Exploration disappears from quest history.
- **Back-compat:** `POST /api/explorations/confirm` remains as an alias for save plus start,
  for older iOS builds.

## API

- `POST /api/world/explore` `{ bbox }`
  - Returns `{ outcome, flowlines, collectibles, availableCount, summary }`.
  - Writes nothing. Unrevealed geometry is returned only inside this session response.
- `GET /api/world`
  - `collectibles` contains only the player's collected Collectibles in the area.
  - `fartleks` contains the completed Flowlines.
  - New `explorationRoutes: [{ id, status, title, geometry }]`: saved routes that intersect
    the bbox.
- `POST /api/explorations/generate` and `POST /api/explorations/plan`
  - Validate Flowlines against the area's opportunities.
  - Generate proposals also carry their Flowline stops.
- New `POST /api/explorations/save` `{ proposalId }`
  - Returns `{ instance, plannedRoute }` with `instance.status = "planned"`.
  - Idempotent by proposal id.
- New `POST /api/quest-instances/:id/start`
  - Moves the Exploration from `planned` to `active`. Any other status returns 409.
- `DELETE /api/quest-instances/:id` works for any status.
- `POST /api/quest-instances/:id/retry` is removed.
- `QuestInstance.status`: `planned | active | partially_completed | completed`.
  `startedAt` is absent while the Exploration is planned.
- Activity outcome quests:
  - `result: "completed"`: the Exploration completed with this activity; carries XP.
  - `result: "progressed"`: this activity advanced it without completing it; no XP.

## Implementation plan

1. **Migration**
   - Delete `explore` reveals and restrict the reveal source CHECK to `ride`.
   - `quest_instances`:
     - The status CHECK becomes `planned | active | partially_completed | completed`.
     - `started_at` becomes nullable; it is NULL only while planned.
     - Rewrite the resolution check.
   - Migrate `failed` rows:
     - Any progressed objective in `attempt_result` → `partially_completed`.
     - Otherwise → `active`.
   - `planned_routes`: add bbox columns, backfilled from geometry, and an index.
2. **Opportunity selector:** a pure function for eligible Flowlines and uncollected
   Collectibles in a bbox, with tests.
3. **Explore endpoint:** stateless, with the new response and tests (no writes).
4. **World endpoint:** collected-only Collectibles and `explorationRoutes` in the bbox, with
   tests.
5. **ExplorationService and repository**
   - Use the opportunity selector, and return Flowline stops from generate.
   - Add `save`, `start` and delete for any status.
   - Remove retry, and keep `confirm` as the alias.
   - Tests for all of the above.
6. **Accumulated resolution**
   - Evaluate the `active` and `partially_completed` Explorations against all activities
     since `started_at`.
   - Update their status, pay XP once on completion, and emit the `completed` and
     `progressed` outcomes.
   - Planned Explorations and activities before Start are ignored.
   - Tests for all of the above.
7. **Web**
   - Dotted saved-route layer.
   - Explore session state for opportunities.
   - Generate as the primary action, with the editor and **Save Exploration**.
   - Explorations list: statuses, Start, Delete and GPX; no Retry.
   - Activity outcome shows progress.
   - Client tests.
8. **iOS**
   - Models and decoding.
   - Dotted saved-route map layer.
   - Session opportunities.
   - Generate as the primary action, and Save in the planner.
   - Browse sheet: statuses, Start and Delete; no Retry.
   - Unit tests.
9. **Strings and docs:** en/de strings (`public/app-locales.js`, `Localizable.xcstrings`),
   and amendment notes on the superseded feature docs.
10. **e2e:** update `e2e/explore-reveal.e2e.ts` to cover explore → generate → save → route on
    World → start.

## Acceptance criteria

- Explore returns opportunities and writes no rows. After a reload, World shows none of them.
- World shows only collected Collectibles, completed Flowlines and saved Exploration routes,
  which are dotted, low in prominence and drawn under other layers.
- Generate builds a route from the session's opportunities, Flowlines included. The player
  can edit it by adding or removing Flowlines and Collectibles, adding waypoints and
  rerouting.
- Save persists a `planned` Exploration whose route stays visible on World. Saving several
  is possible.
- Start moves a planned Exploration to `active`. Activities before Start, and activities
  while the Exploration is planned, never change it.
- After Start, activities accumulate progress: `partially_completed` while some objectives
  are done, `completed` when all are, with XP paid exactly once.
- Deleting an Exploration removes it from the list and the map.
- Existing `explore` reveals are gone after the migration, `ride` reveals remain, and former
  `failed` Explorations become `active` or `partially_completed`.
- No response outside the Explore session and planning leaks geometry of unridden
  Flowlines.

## Constraints

- Keep eligibility thresholds and caps as named constants.
- Preserve existing PlannedRoutes and ride reveals.
- Keep Home Exploration selection mirrored across web, iOS and Android. It is unchanged:
  the first `active` Exploration.

## Validation

- Unit tests:
  - opportunity selector
  - explore (no writes)
  - World payload
  - service save, start and plan validation
  - repository transitions and migration
  - accumulated resolution
- Web client tests: explore session, planner save, Explorations list, activity outcome.
- iOS unit tests: models and decoding.
- `npm test`, `npm run build`, and the targeted Playwright `e2e/explore-reveal.e2e.ts`.
