# explore-this-area

## Goal

Replace the bbox-generated multi-quest suggestion flow with one route-first
"Explore this Area" experience:

> I tell Staza how long I want to ride. Staza shows me good adventures. I pick one.
> Then I can tweak it.

World map → **Explore this Area** (bbox frozen) → choose start → choose round trip /
point-to-point and distance OR time → **Generate Routes** → Staza selects target
combinations internally and returns 2–3 route proposals → one proposal is selected →
its targets become visible and editable → add/remove re-routes that one route →
**Start Exploration** persists one exploration (QuestInstance) and one PlannedRoute.

This supersedes the suggestion-card entry point of `quest-route-exploration-v1` and the
bbox recommendation list of `default-quests`. There is one exploration creation flow.

## Product rules

1. The World map is the starting point; the visible bbox is frozen when
   **Explore this Area** is clicked (`{ bbox, center, zoom }`).
2. Before route generation the user configures only start (and end for A→B), route
   type and one ride constraint. No targets, objective lists or target editing appear.
3. Targets are internal planner details until a proposal is selected; afterwards they
   are user-editable route contents.
4. Proposals may contain different target subsets.
5. Customization edits ONE route; unrelated proposals are not regenerated.
6. Nothing is persisted before **Start Exploration**: no configuration, candidate
   subsets, unused proposals or abandoned customizations.
7. Planning never awards XP, discovers collectibles, completes Flowlines, or progresses
   objectives. Activity evaluation remains the only gameplay truth.

## Scope

In: map entry action, start selection (geolocation or map pick), route type, ride
constraint (presets + custom), automatic target selection, multi-route MapLibre
preview, inline customization with rerouting, confirmation, cancel.

Out: AI generation, quest archetype pickers, Garmin, GPX/FIT export, live navigation,
routing-service changes, discovery outside the frozen bbox, social/shared quests.

## Decisions

- After generation the best proposal is auto-selected (the only route line shown, with its
  targets).
- Selecting a proposal makes its target list editable inline (no separate Customize
  step).
- Normal World markers stay on the map during exploration but dimmed; only the selected
  proposal's targets are highlighted; eligible frozen-area targets appear as addable
  markers only while adding.
- A customized route may exceed the ride constraint; the card shows an over/under-length
  warning instead of rejecting the edit.
- Labels are relative: **Adventure** (most targets), **Quick** (shortest, ≤ 85 % of
  Adventure), **Balanced** (best remaining score), plus a composition hint
  (Flowline-rich / Discovery / Climb).

## State machine (client)

| Phase | UI | Map |
|---|---|---|
| `configure` | start, Round trip / A→B (+end), Distance/Time presets + custom, Generate Routes | World markers dimmed; start/end pins |
| `generating` | progress, Cancel | as configure |
| `proposals` | 2–3 proposal cards; best auto-selected → `customize` | only the selected or hovered route |
| `customize` | selected card, "Included in this route" list with remove, Add target mode, length warning, Reset, Start Exploration | selected route + its targets; add mode shows eligible targets |
| `confirming` | buttons disabled | — |

`customize` has a `rerouting` status while an edit is routed. Changing start, route type
or constraint (or pressing Change ride) returns to `configure` and discards proposals.
Reset restores a customized proposal to its generated version without a network call. Card
hover previews a route and clicking a card selects it; only that hovered or selected route
is drawn. Included targets use the same category and Flowline icons as the World filters
and map. Each proposal keeps its own customized version client-side. Cancel returns to the
normal World view without network calls.

## Planner

### Generation (`generateExplorationRoutes`)

Inputs: frozen-area targets, start, optional end, route type, ride constraint.
Eligible targets reuse `buildExplorationTargets` (published, visible collectibles with a
category and published Flowlines; already achieved stay eligible with lower value).
Three internal strategies — `flowline_focus`, `balanced`, `discovery` — are expressed as
synthetic objectives (per-kind required counts scaled to the budget:
`clamp(round(budgetKm / 12), 2, 8)` targets, shares redistributed when a kind is absent).
Each strategy reuses `selectTargetPool` and `generateCandidates` (seeded greedy cheapest
insertion + bounded 2-opt; no brute-force permutations). Candidates are interleaved across
strategies, deduplicated by target set and routed under one shared budget (≤ 9 requests,
concurrency 3, 20 s deadline). Flowline shaping and traversal validation are unchanged.
Scores combine the strategy's objective progress, constraint fit, loop quality, route
shape, target freshness and detour penalty. Proposals must be distinct (target-set
Jaccard < 0.6 or distance difference > 15 %). Strategies are never shown to users.

### Reroute (`rerouteTargets`)

For a selected proposal and an edited target set: removal keeps the stored stop order;
addition inserts at the cheapest position; then bounded 2-opt. One route is requested
(retrying without unroutable targets, ≤ 3 requests). The result carries
`droppedTargetIds` and a `constraintFit` flag (`within` / `short` / `long`).

### Proposal model

`{ id, label: quick|balanced|adventure, hint?, routeType, distanceM, durationS,
elevationGainM?, elevationLossM?, geometry, start, end, includedTargetIds,
nearbyTargetIds, targetSummary, constraintFit, customized?, basedOn?, droppedTargetIds? }`.
Server-side `StoredProposal` additionally holds the ordered stops, included targets,
exploration id and planner version (`PLANNER_VERSION = 3`).

## API

All require authentication and CSRF.

- `POST /api/explorations/generate` `{ area: { bbox, center, zoom }, start, end?,
  routeType, constraint }` → `{ explorationId, proposals, catalog:
  { collectibles, flowlines }, truncated, limits }` (rate limited). Creates an ephemeral
  in-memory exploration session (area, input, eligible targets; 60 min idle TTL).
- `POST /api/explorations/:explorationId/reroute` `{ proposalId, targetIds }` →
  `{ proposal }` (rate limited). Ids must belong to the session's frozen area; 1–12
  targets.
- `POST /api/explorations/confirm` `{ proposalId }` → `{ instance, plannedRoute }`.

`questSuggestions`, `POST /api/quest-instances/start`, `/api/quest-route-plans*`,
`/api/explorations/draft*` and `/api/explorations/route` do not exist.

## Persistence

No schema change beyond migration `028_exploration_instances` (inactive `exploration`
template row). Confirmation reads the stored (possibly customized) proposal and persists
one QuestInstance (objectives from the route's included and nearby targets: one
`flowline_rule` and one `collectible_targets` per category; `scope_hash` = proposal id
for idempotency; `fresh_progress = true`) and one PlannedRoute atomically. Historical
instances keep loading and progressing.

## Implementation plan

1. Strategies + generation entry point in the planner; new labels, hints, distinctness.
2. Fixed-set reroute entry point with stored stop order.
3. Exploration session store and service (`generate`, `reroute`, `confirm`); server
   endpoints; remove draft/selection code and the initial-target selector.
4. MapLibre: show only the selected or hovered route; dim World markers.
5. Panel + world page: explicit phase state machine, proposal cards, inline target list,
   add mode, reroute, reset, length warning.
6. Tests and docs.

## Acceptance criteria

- No target list, target markers or editing appear before Generate Routes.
- Generate returns 2–3 distinct proposals, possibly with different target subsets.
- All proposals are available in the cards; only the selected or hovered one renders on
  the map, and its targets are shown with the World map/filter icons.
- Remove/add reroutes only the selected proposal and updates geometry, distance,
  duration and summary; failures keep the previous route.
- Targets outside the frozen area and foreign proposals are rejected.
- Confirm persists exactly one instance and route; repeats are idempotent; nothing is
  persisted on cancel.

## Validation

Unit tests for strategy objectives, generation (subset variety, distinctness, labels),
reroute ordering and drops, session service (generate/reroute/confirm, tampering,
expiry), request parsing, UI phases (no targets in configure, auto-selection, alternate
selection, inline edit/reroute/reset, warning, cancel), map alternates and dimming.
`npx tsc --noEmit -p .` and `npm test`.
