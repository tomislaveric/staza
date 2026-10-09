# default-quests

## Goal

Replace the provisional bbox-generated default-quest suggestions with curated
`QuestTemplate`s, local generated `QuestInstance` recommendations, and generic
`QuestObjective`s. World objects are objective targets or candidates, never
standalone Quests.

## Scope

- Curate versioned templates for rule-based, target-based, and mixed objectives.
- Generate a small deterministic set of feasible recommendations from the
  selected map bbox.
- Keep suggestions ephemeral and untracked until the player explicitly starts
  one.
- Persist started instances with frozen, server-validated objective scope.
- Allow active instances to be cancelled; delete the instance and its progress.
- Start a cancelled scope with fresh progress while preserving canonical
  activity and collectible history.
- Keep active instances visible and progressing independently of the current
  bbox.
- Derive progress from the player's all-time collectible and Flowline history,
  including events before acceptance.
- Replace the current user-authored Quest CRUD/publish workflow. Preserve old
  quest rows during migration rather than silently deleting them.
- Keep recommended levels as non-gating guidance. Do not implement an active
  instance cap in v1.

## Decisions

| Decision | Choice |
|---|---|
| Model | Curated `QuestTemplate` → bbox-generated `QuestInstance` → typed objectives. |
| Start behavior | Suggestions create no database state; explicit Start creates the persistent player instance. |
| Cancellation | Cancelling deletes the active instance and objective scope. Activity and collectible history remain untouched; starting the same scope again begins fresh. |
| Objective scope | Resolve and freeze target collectible / Flowline IDs and criteria at Start. |
| History | First-time starts use all canonical player history and may complete immediately. After cancelling and restarting the same scope, only history from the new start counts. |
| Flowline counting | Count distinct Flowlines by default; same-Activity rules group completions by `activity_id`. |
| Performance | Apply speed thresholds to each Flowline segment's average speed (m/s; UI may display km/h). |
| Objective logic | All objectives are required (AND) in v1; mixed objectives are first-class. |
| Existing Quest CRUD | Replace it with curated templates and started player instances; keep old rows recoverable. |
| Active limit | Do not enforce a limit yet; retain an instance status/index model that supports one later. |

## Objective rules and challenge sizing

Support:

- Complete N distinct Flowlines, optionally requiring every Flowline to meet a
  minimum length, requiring all N in the same Activity, or meeting a segment
  average-speed threshold.
- Discover N distinct collectibles of a category such as peak or place.
- Discover mountain passes as a category-based objective.
- Visit a frozen set of specific collectible IDs.
- Combine multiple objective groups, including Mountain Pass and Flowline
  objectives.

Templates must support examples including:

- Complete 4 Flowlines in one Activity.
- Complete 5 Flowlines, each at least 2 km.
- Complete 3 Flowlines satisfying a performance condition.
- Discover 3 Peaks.
- Discover 3 Mountain Passes.
- Discover 2 Mountain Passes and complete 2 Flowlines.
- Discover 2 landmarks and complete 2 Flowlines.
- Visit a generated set of 4 local places.
- An explicit starter combining a simple collectible target with a Flowline
  objective.

Avoid trivial quests:

- Collectible-count objectives require at least 3 targets by default.
- Target-based collectible objectives contain at least 3 specific targets.
- Flowline quests generally require multiple distinct completions.
- Mixed instances have at least two objective groups and enough total work to
  form a meaningful challenge.
- Only explicit onboarding templates may use a single-target exception. A lone
  collectible is never a Quest by itself, including onboarding.

The bbox defines candidate availability and instance scope only. For example,
“Visit Wartturm” can be one of four local place targets; after the player starts
that instance, it remains active outside the bbox. `activity_events.source_id`
continues to identify its discovery globally.

## Implementation plan

1. Define typed, versioned `QuestTemplate`, generated/persisted `QuestInstance`,
   and discriminated `QuestObjective` contracts. Include feasibility,
   recommendation level, frozen candidate IDs, progress, and completion state.
2. Add a dedicated curated template seed source and strict validation for
   objective types, minimum counts, target sets, onboarding exceptions, and
   mixed-quest size.
3. Add migrations and repositories for templates and player instances.
   Starting a recommendation revalidates it server-side, freezes its scope,
   avoids duplicate instances for the same player/template/scope, and makes the
   instance independent of future map bounds. Prepare for a future active limit
   without enforcing one.
4. Add reusable evaluation against canonical all-time history: targeted
   collectibles, category counts, distinct Flowline counts, minimum length,
   same-Activity grouping, and segment-average-speed requirements. Snapshot
   collectible category on activity events and backfill existing history where
   possible. Persist `completed_at` once an instance evaluates complete.
5. Replace the provisional default generator with deterministic, bounded
   template instantiation against the current bbox. Suggestions have no
   progress and cause no writes until the player explicitly starts one.
6. Replace the current Quest CRUD/publish UI and APIs with suggestions, Start,
   active-instance listing, progress, and completion states. Keep active quests
   visible outside the originating bbox and retain legacy database rows during
   migration.
7. Add unit, persistence, API, and UI regression tests. Update this README and
   the root feature index to describe the implemented model.

## Implemented behavior

- `fixtures/quest-templates.json` is the curated template source. Startup and
  `npm run seed:collectibles` validate and synchronize versioned templates.
- Migration `023_quest_templates_and_instances` adds template/instance storage
  and a collectible-category event snapshot. Migration
  `024_mountain_pass_quest_categories` backfills Mountain Pass categories on
  existing collectibles and activity events.
- Migration `025_quest_instance_pause` is retired by
  `026_cancel_quest_instances`, which restores any paused instances to active,
  removes pause history, adds restart tracking, and enables fresh progress
  after cancellation.
- `GET /api/world?bbox=...` returns feasible `questSuggestions` without
  progress or persistence. `POST /api/quest-instances/start` re-resolves the
  suggestion against the submitted bbox and stores its frozen objective scope.
- `GET /api/quest-instances` evaluates all-time collectible and Flowline
  history, persists first completion, and lists instances without bbox filtering.
- `DELETE /api/quest-instances/:instanceId` cancels an active instance for its
  owner and deletes its objective scope.
- Cancelling an active quest deletes its instance and frozen objective scope.
  A minimal scope marker ensures a later start begins with fresh progress;
  canonical activity and collectible history is preserved. Completed quests
  remain listed with a Complete status.
- The World UI separates untracked recommendations from active/completed
  instances. The legacy authoring, publish, and activity-to-quest APIs/actions
  are no longer exposed; legacy quest rows are retained.
- Quest cards reuse the World map's Flowline line and Mountain Pass glyphs,
  share a consistent-height layout, and use a quieter Start action. The
  recommendation grid initially shows up to three suggestions with an
  accessible show-more/show-less control; active and completed instances remain
  visible. Recommendations and instances use the same target-list card
  structure. Each objective lists every eligible or frozen target beneath the
  description and states the required count, such as completing five of seven
  listed Flowlines. Length, average-speed, and same-Activity constraints remain
  explicit. Started instances show progress for every listed target; completed
  Flowlines include their qualifying average speed.
- Selecting a recommendation or started/completed quest highlights all of its
  collectible and Flowline targets on the World map and frames them together.
  Target geometry is loaded by ID, independent of the current viewport and
  filters; targets remain visible when normal World filters would hide them.
  Start and Cancel remain separate from map selection.

## Acceptance criteria

- Every recommendation comes from a curated template and feasible content in
  the selected bbox.
- Suggestions remain ephemeral and have no tracked progress or persistence.
- Explicit Start creates an idempotent instance with a frozen,
  server-validated objective scope.
- Started instances remain active after bbox changes and use all-time history,
  including history predating Start.
- Cancelling deletes the instance and its progress while preserving canonical
  activity history.
- Restarting a cancelled scope counts only qualifying history from the new
  start time; first-time starts continue to use all-time history.
- An instance whose objectives are already satisfied completes immediately on
  Start.
- Rule-based, target-based, and mixed objectives work, including same-Activity,
  minimum Flowline length, segment-average-speed, category count, and named
  target-set requirements.
- World recommendation and instance cards list all targets and clearly
  distinguish required counts from available candidates.
- Selecting a World quest highlights and frames all point and Flowline targets,
  including those outside the current bbox and current filter set.
- Cardinality rules prevent a single collectible or other World object from
  appearing as a normal Quest.
- Existing Quest CRUD/publish behavior is replaced without silently deleting
  its historical data.
- No active-instance cap or level gate is added.

## Validation

- Unit-test schema validation, objective cardinalities, onboarding exceptions,
  deterministic generation, and bbox feasibility.
- Test objective evaluation for distinct completions, same Activity,
  length/performance thresholds, per-target completion and average speed,
  historical collection, and category snapshots.
- Test Start idempotency, scope freezing, immediate all-history completion,
  persistence, and reads outside the source bbox.
- Test cancellation deletion, fresh progress boundaries after restart, and the
  confirmation UI.
- Test the UI distinction between recommendations and started instances,
  including Start, progress, and completed presentation.
- Run the TypeScript build, focused quest/persistence/UI tests, and full test
  suite. Run migration/persistence tests when a test database is available.

## Constraints

- Do not trust client-provided scope or progress; validate and resolve
  suggestions server-side at Start.
- Do not evaluate started quests using only current viewport contents or mutable
  collectible metadata.
- Use immutable event/source identifiers and snapshots for historical
  evaluation.
- Do not add rewards, social quest sharing, a template editor, an active limit,
  or level-gated content in this work.
