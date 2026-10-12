# quest-route-exploration-v1

> **Superseded by [Explore this Area](../explore-this-area/README.md).** Quest
> suggestions, curated templates, `POST /api/quest-instances/start` and
> `/api/quest-route-plans*` were removed. Quests started through this flow still load,
> progress, and can be cancelled.

## Goal

Let a player explore a generated quest by producing concrete ride-route proposals
that make meaningful progress toward it, preview them on the existing MapLibre map,
and commit to the quest only after selecting one route.

Flow: Quest card → **Explore Quest** → configure ride → Staza generates 2–3 scored
proposals → preview → **Start this Quest** → QuestInstance and selected PlannedRoute
are persisted together and the quest becomes active.

## Product rules

1. A Quest is not a Route; a route is one possible solution for a quest.
2. Explore Quest and proposal generation persist nothing; proposals are ephemeral.
3. Start this Quest commits; only the selected route is persisted.
4. The standalone routing service stays domain-agnostic; Staza owns target
   selection, ordering, and scoring.
5. Flowlines must be truly traversed by a proposal; no midpoint shortcuts.
6. No permutation brute force; distance/time are preferences with tolerance.
7. Partial-progress routes are allowed; predicted progress is shown before commitment.
8. Planning never awards XP, discovers collectibles, completes Flowlines, or updates
   quest progress. Existing activity evaluation remains the gameplay source of truth.

## Scope

In scope: Explore Quest entry point; planner UI (start, round trip or point-to-point
end, distance OR time); target extraction; deterministic candidate generation and
pruning; routing-client integration; scoring and ranking; up to 3 proposals; MapLibre
preview; tamper-resistant confirmation; PlannedRoute persistence; deferred quest
activation.

Out of scope: GPX/FIT export, Garmin/Wahoo, live navigation, background GPS,
AI-generated routes, quest-unrelated round trips, custom routing engine, changes to
the routing service, traffic data, turn-by-turn UI, native app work, quest-system
redesign, and archetype policy classes (extension points only).

## Existing architecture

- `src/domain.ts` — quest, objective, collectible (`WorldCollectible`) and Flowline
  (`WorldFartlek`) types.
- `src/questTemplates.ts` — deterministic quest suggestion generation and objective
  evaluation for `flowline_rule`, `collectible_count`, and `collectible_targets`.
- `src/persistence/questRepository.ts`, `src/persistence/questInstanceRepository.ts`
  — quest persistence.
- `src/worldQuery.ts`, `src/world.ts` — world data access.
- `public/components/world/quest-list.js` (+ `quest-ui.test.js`) — quest cards and
  current Start Quest flow.

API registration/auth, migration conventions, the MapLibre selection hooks, and the
current Start Quest persistence are verified before wiring; existing conventions win.

## Decisions

### Target model

`QuestRouteTarget` is a union referencing existing world objects (no duplicated
persistence):

- `point` — worldObjectId, objectiveId, category, real coordinate.
- `segment` — Flowline worldObjectId, objectiveId, geometry, entry/exit points,
  bidirectional flag.

Extraction (`src/questRouteTargets.ts`) resolves suggestion objectives against
current world data, respecting category and Flowline thresholds. `requiredCount` is
the progress requirement; extra eligible targets are optional candidates.

### Flowline routing points

Entry → a small number of evenly spaced interior shaping points (`through`) → exit.
Forward and reverse variants are generated when traversal in both directions is
allowed. Only neutral coordinates and waypoint types reach the routing service; IDs
remain in Staza-side correlation data.

### Candidate generation and pruning

1. Cap and spatially rank the eligible pool (distance from start, clustering).
2. Build a bounded set of combinations that satisfy objective requirements where
   feasible, plus limited "extra targets" variants.
3. Order each combination deterministically (angular sweep around start for round
   trips; nearest-neighbour progression toward end for point-to-point), choosing
   Flowline direction by nearest endpoint.
4. Estimate straight-line length and prune implausible candidates.
5. Route at most `MAX_ROUTING_REQUESTS` (default 8, configurable within 6–10).

No randomness; ties broken by ID. Identical inputs and planner version yield
identical candidates.

### Round-trip heuristic

Prefer angular spread of targets around the start and balanced radial distance;
penalize linear/out-and-back distributions. Final loop quality is computed from the
routed geometry (overlap of outbound/return paths).

### Distance/time fit

Target value with preferred band ±10% (score 1.0) and acceptable band ±20% (linear
taper); beyond it the score decays toward 0 without hard rejection. Tolerances are
named constants.

### Scoring

Invalid/unroutable candidates are rejected first. Viable candidates are ranked by
named, normalized weights:

| Component | Weight |
| --- | --- |
| Quest progress potential | 0.35 |
| Distance/time fit | 0.25 |
| Loop quality (round trip; redistributed to shape for point-to-point) | 0.15 |
| Target quality / coverage | 0.10 |
| Route shape | 0.10 |
| Detour / backtracking penalty | −0.05 |

Weights live in one planner-policy object so future archetypes (Rush, Climb,
Discovery, Circuit, Adventure) can supply different policies without class
hierarchies.

### Quest progress potential

Per objective, `min(includedQualifying, requiredCount) / requiredCount`, combined
weighted by required count. Extra targets are reported as extra opportunity. This is
prediction only.

### Proposals

Up to 3 meaningfully different proposals. **Balanced** is always the best overall
score. **Quick** is added only when it reaches the same maximum quest progress at no
more than 90% of Balanced's distance. **Full Quest** is added only when it includes
more targets than Balanced. Remaining slots are labelled **Alternative**. Two routes
are distinct when their target sets differ or their distances differ by more than 5%.

DTO: `id`, `label` (`quick` | `balanced` | `full_quest` | `alternative`), `routeType`,
`distanceM`, `durationS`, `elevationGainM?`, `elevationLossM?`, `geometry`, `start`,
`end`, `includedTargetIds`, `nearbyTargetIds`, `targetSummary`,
`questProgressPotential` (per objective and overall). Score internals are stripped
from the public response.

### Routing client

`src/routePlanning/routingClient.ts`: the only module calling the routing service. Validates
`ROUTING_SERVICE_URL` and `ROUTING_SERVICE_TIMEOUT_MS` at startup, maps requests,
applies per-call timeout, validates responses, and maps failures to stable errors
(`timeout`, `unavailable`, `no_route`, `invalid_response`, plus the routing
service's own codes such as `snap_distance_exceeded`, `point_not_routable`, and
`rate_limited`). The URL is server-side only; only its origin is used.

Configuration: `ROUTING_SERVICE_URL` (optional; without it planning endpoints return
`planning_unavailable`) and `ROUTING_SERVICE_TIMEOUT_MS` (default 15000).

### API

- `POST /api/quest-route-plans` (authenticated, rate limited to 10/min per player) —
  body `{ suggestionId, bbox, routeType, start: {lat, lon}, end?, constraint: { type:
  "distance" | "duration", value } }` with meters or seconds. The server regenerates
  the suggestion from the bbox, plans, and returns `{ proposals }`.
- `POST /api/quest-route-plans/confirm` (authenticated) — body `{ proposalId }`;
  returns `{ instance, plannedRoute }`.
- `GET /api/quest-instances/:instanceId/planned-route` (authenticated) — the quest's
  PlannedRoute, or 404 when the quest was started without one.

Errors return `{ error, code }`: `suggestion_unavailable` (409), `proposal_expired`
(409), `no_reachable_targets` (422), `no_route` (422), `planning_unavailable` (503),
and 400 for invalid input. Start points must lie near the quest's targets.

Validation: coordinate ranges, required end for point-to-point, positive bounded
constraint (max 300 km / 12 h), request body size limit, target-count cap. Planning
requires a valid quest suggestion visible to the player, so the endpoint is not a
general routing proxy.

### Tamper resistance

Proposals are kept server-side in an in-memory proposal store keyed by an opaque
random proposal ID and bound to the player (geometry exceeds the JSON body limit, so
signed client-held tokens were rejected). Entries expire after 30 minutes, the store
is capped at 2000 entries, and a new plan replaces the player's earlier proposals.
Confirmation sends only the proposal ID; the server checks owner and expiry and
re-validates that the suggestion is still available. Client-supplied geometry is
never accepted. Proposals do not survive a server restart; the player re-plans.

### Persistence and transactions

New `planned_routes` table (existing PostgreSQL conventions, JSONB): id, player_id,
quest_instance_id, profile, route_type, start/end lat/lon, distance_m, duration_s,
elevation_gain_m, elevation_loss_m, geometry, included_target_ids, planner_version,
created_at. No PostGIS. Proposals are never persisted.

Confirmation resolves the stored proposal first, then in one transaction: create or
resolve the QuestInstance, insert or replace the PlannedRoute linked to it (unique per
instance), and activate the quest. Repeated confirmation is idempotent (no duplicate
instance/route). Cancelling a quest cascades to its PlannedRoute.
Opening the planner or generating proposals creates no rows. Existing Start Quest
persistence is moved behind confirmation.

### Peak / unroutable points

Route to the real coordinate; accept the router's snapped location only within
`MAX_POINT_ACCESS_DISTANCE_M` = 500 m. If the routed path does not pass within that
distance, the candidate is rejected. The real target coordinate is kept for UI and
gameplay.

### Flowline traversal validation

After routing, require that at least 80% of each selected Flowline's sampled points
lie within a 30 m corridor of the route geometry, in the expected order for the chosen
direction. Otherwise the candidate is rejected. Flowline completion rules are
unchanged.

### Failures, limits, observability

Candidate failures are isolated; proposals are returned if any candidate succeeds.
If none do, a stable user-facing error is returned. Routing calls run with
concurrency 3 and an overall planning deadline (20 s). Structured logs: requestId,
playerId (per existing policy), suggestion ID, eligibleTargetCount, candidateCount,
routingRequests, routingFailures, planningDurationMs, proposalCount. No geometry,
raw responses, or precise locations are logged.

`PLANNER_VERSION = 1` is persisted with each PlannedRoute.

### UI

Quest card shows **Explore Quest**. The planner (existing World/MapLibre map, no
new map library): start (current location only if geolocation permission is already
granted, otherwise map click; editable), route type, end via map click for
point-to-point, distance presets 30/50/80 km or custom, time presets 1/2/3 h or
custom, Generate. Proposal cards show label, distance, estimated time, elevation if
available, objective summary, and predicted completion. Selecting a card previews
route geometry and highlights included targets. Final CTA: **Start this Quest**. The
current location is never persisted except as the chosen start of the confirmed
route.

## Implementation plan

1. Verify integration points (Start Quest flow, API/auth, migrations, map hooks,
   routing response snap metadata).
2. Routing client and config validation.
3. Planner domain types and policy constants.
4. Quest → target extraction.
5. Candidate generation and pruning.
6. Scoring and proposal ranking.
7. Routing integration with concurrency limit and deadline.
8. Point access and Flowline traversal validation.
9. Planning API and server-side proposal store.
10. `planned_routes` migration and repository.
11. Confirmation transaction and deferred quest activation.
12. Planner UI and MapLibre preview.
13. Tests, logging, polish.

## Acceptance criteria

- Explore Quest opens the planner without persisting anything.
- Planner returns up to 3 distinct proposals with metrics, targets, and predicted
  progress, using at most `MAX_ROUTING_REQUESTS` routing calls.
- Subset quests (e.g. 3 of 5 Flowlines) never require all eligible targets.
- Proposals bypassing a selected Flowline or too far from a point target are rejected.
- One failing candidate does not fail planning.
- Start this Quest atomically persists the QuestInstance and PlannedRoute and
  activates the quest; repeated confirmation is idempotent; unknown, foreign, or
  expired proposal IDs are rejected.
- Planning never changes XP, collectibles, Flowline completion, or quest progress.

## Validation

- Unit: target extraction, point/Flowline conversion, reverse direction, pruning,
  round-trip heuristic, distance/time fit, progress score, loop quality, final score,
  ranking, bounded candidate count, determinism.
- Routing client: valid, timeout, connection failure, malformed, no route.
- Planner scenarios: 5 Flowlines/require 3; linear vs. surrounding distributions;
  mixed quest; 48 km beats 80 km for 50 km request; one failing candidate; unroutable
  Peak; Flowline bypass rejected.
- API: auth required, malformed/invalid input, unknown suggestion, success, confirm,
  foreign/expired proposal confirmation.
- Persistence: no rows from planning, atomic confirm, idempotent repeat.
