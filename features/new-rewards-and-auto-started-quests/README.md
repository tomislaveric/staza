# new-rewards-and-auto-started-quests

## Goal

1. Newly unlocked Skill Atlas rewards, especially quest chains, are visibly flagged as new (pulsing like the Skill Points CTA on the activity detail page). Clicking leads to Progress, which lists current quests.
2. Quests no longer need to be started. A quest is active from the moment it becomes available; the Start button on Progress is removed.

## Decisions

- Only activities started **after the quest became available** count. Available-since = latest of the chain node's `skill_tree_unlocks.unlocked_at`, the previous quest's `completed_at`, and the last failure's `failed_at`.
- A failed attempt **auto-restarts**: the quest stays `active` and the missed criteria are shown as a hint. No Retry button.
- "New" is tracked **server-side** (persisted seen flag, consistent across devices).
- Highlight appears in the Atlas node-detail reward block, in quest-list entries, and as an indicator on the Skill Atlas navigation item.

## Current state

- `public/components/progress-page.js`: `questAction` renders Start/Retry (`data-start-quest`); click handler in `mountProgressPage`.
- `src/server.ts`: `GET /api/authored-quests`, `POST /api/authored-quests/:questId/start`.
- `src/persistence/authoredQuestRepository.ts`: `start()`, `list()`, `resolveAuthoredQuestAttemptsWithClient` (resolves only `active` attempts); table `authored_quest_attempts` (migration 034).
- `src/authoredQuests/evaluator.ts`: `buildAuthoredQuestViews` yields completed/active/failed/available/locked.
- Atlas: `skill-tree-page.js` `SkillNodeDetail` (`.skill-detail-reward`, `.skill-quest-chain`); pulse keyframes `skill-point-pulse` in `app-shell.css`.
- `home-page.js` `homeNextAction` uses available/failed copy ("Start …").

## Implementation plan

1. **Backend auto-start** – Remove `POST …/start` and `AuthoredQuestRepository.start`. In `buildAuthoredQuestViews`, an unlocked, uncompleted quest whose predecessor is done is `active` (no `available`/`failed` states); expose `lastFailure { criteria, failedAt }`. The resolver evaluates every such quest against an activity with `activityStartedAt >= availableSince` (sport mismatch still skipped); pass → completion row (XP once); fail → record failure (`failed_at`, criteria, attempt count) and stay active.
2. **Migration** – New migration: `authored_quest_attempts` becomes a failure log; add a seen-tracking table (`player_id`, `quest_id`/node id, `seen_at`). Existing `active` rows keep working (availableSince is a lower bound). Update `cleanUserData`/`resetPlayerData` if they enumerate tables.
3. **Seen API** – Expose `isNew` on quest views and skill-tree nodes; `POST /api/rewards/seen` (CSRF-protected) marks ids seen; a count endpoint/field drives the nav indicator.
4. **Atlas UI** – Pulse the reward block and quest entries when `isNew` (reuse `skill-point-pop/pulse`, honor `prefers-reduced-motion`), show a "NEW" tag, click navigates to Progress and marks seen; add nav indicator on Skill Atlas.
5. **Progress UI** – Remove `questAction`, the `data-start-quest` handler, the "Available" status and dead `.authored-quest-action` CSS. Active copy: "Active · your next activity decides"; show last-failure criteria hint. New quests pulse until seen.
6. **Home copy** – Update `homeNextAction` (no Start/Retry wording) and related tests/locale strings.
7. **Tests** – Update/add tests for evaluator, repository (availableSince gating, auto-restart, seen flag), progress page, skill-tree page, home page; update e2e if it references Start.

## Acceptance criteria

- No Start or Retry control exists on Progress; unlocked quests appear as active.
- Activities before a quest became available never complete or fail it.
- A failed attempt leaves the quest active with missed criteria displayed.
- Newly unlocked rewards/quests pulse and show "NEW" on the Atlas and nav until opened; clicking leads to Progress; seen state persists across devices.
- Reduced-motion users see a static "NEW" tag.

## Follow-up refinements

- Dev environments (`config.devTools`) ignore the availability-date gate so uploaded or mock-imported activities can complete quests.
- The "Quests you unlock" list pulses text and glow only (no box animation).
- The Progress nav item shows the same "new" dot for freshly completed quests; completed-but-unseen quests are listed first on Progress with a NEW tag.
- Activity Detail shows a "Quest completed" card beside the Skill Points card at the moment the replay reaches the quest bonus, and Skill Points count up per level with a pulse on each increase.
- Onboarding: each sport's hub node (Cycling, Running, Hiking) unlocks a single first quest (Flow Quest I: 1 Flowline in a ride; Run Quest I: 2 km; Hike Quest I: 1 collectible). Rusher I now unlocks Flow Quest II and III (3 and 4 Flowlines per ride). Hub grants changed from `tree_access` to `quest_unlock`.

## Validation

`npm test`, TypeScript build/typecheck, and `npm run test:e2e` where applicable.

## Constraints

- Removing the start endpoint is an API break; only the Progress page uses it.
- No new frontend dependencies.
