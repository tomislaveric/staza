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
| Objective scope | Resolve and freeze target collectible / Flowline IDs and criteria at Start. |
| History | All canonical player history counts; an instance may be complete as soon as it is started. |
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
- Visit a frozen set of specific collectible IDs.
- Combine multiple objective groups, including collectible and Flowline rules.

Templates must support examples including:

- Complete 4 Flowlines in one Activity.
- Complete 5 Flowlines, each at least 2 km.
- Complete 3 Flowlines satisfying a performance condition.
- Discover 3 Peaks.
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
  and a collectible-category event snapshot, with a best-effort backfill from
  catalog records that still exist.
- `GET /api/world?bbox=...` returns feasible `questSuggestions` without
  progress or persistence. `POST /api/quest-instances/start` re-resolves the
  suggestion against the submitted bbox and stores its frozen objective scope.
- `GET /api/quest-instances` evaluates all-time collectible and Flowline
  history, persists first completion, and lists instances without bbox filtering.
- The World UI separates untracked recommendations from active/completed
  instances. The legacy authoring, publish, and activity-to-quest APIs/actions
  are no longer exposed; legacy quest rows are retained.

## Acceptance criteria

- Every recommendation comes from a curated template and feasible content in
  the selected bbox.
- Suggestions remain ephemeral and have no tracked progress or persistence.
- Explicit Start creates an idempotent instance with a frozen,
  server-validated objective scope.
- Started instances remain active after bbox changes and use all-time history,
  including history predating Start.
- An instance whose objectives are already satisfied completes immediately on
  Start.
- Rule-based, target-based, and mixed objectives work, including same-Activity,
  minimum Flowline length, segment-average-speed, category count, and named
  target-set requirements.
- Cardinality rules prevent a single collectible or other World object from
  appearing as a normal Quest.
- Existing Quest CRUD/publish behavior is replaced without silently deleting
  its historical data.
- No active-instance cap or level gate is added.

## Validation

- Unit-test schema validation, objective cardinalities, onboarding exceptions,
  deterministic generation, and bbox feasibility.
- Test objective evaluation for distinct completions, same Activity,
  length/performance thresholds, historical collection, and category snapshots.
- Test Start idempotency, scope freezing, immediate all-history completion,
  persistence, and reads outside the source bbox.
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
