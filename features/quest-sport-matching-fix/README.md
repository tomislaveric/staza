# quest-sport-matching-fix

## Goal
Authored quests (e.g. Flow quests I, unlocked on the Cycling branch) must only be evaluated against activities of the sport they require. A run must not fail a cycling quest, and a later ride must still count.

## Findings
- Unlock chain: Skill Atlas node (`rusher-i`) -> `quest_unlock` grant -> authored chain (`src/authoredQuests/catalog.ts`) with `sport: "cycling"` criteria. Catalog and start gating (`AuthoredQuestRepository.start`) are correct.
- Root cause: `resolveAuthoredQuestAttemptsWithClient` (`src/persistence/authoredQuestRepository.ts`) evaluates every criterion, including `Activity type`, against the first activity after the attempt started. A run vs. a cycling quest marks the attempt `failed`.
- Consequence: a failed attempt is no longer `active`, so the next ride is ignored until manually retried. `unknown`-typed activities would fail every sport quest too.

## Decisions
- An activity of the wrong sport is ignored; the quest stays active, with no failure outcome and no XP.
- Attempts still count only activities that started at or after the attempt start.

## Scope
In: authored quest resolution, repair of wrongly failed attempts, tests. Out: exploration quests, UI changes.

## Implementation plan
1. In the resolver loop, skip (no DB writes, no outcome) when `quest.criteria.sport` is set and differs from `metrics.sport` (including `unknown`). Update the doc comment.
2. Add a migration in `src/persistence/migrations.ts` resetting `authored_quest_attempts` rows with `status = 'failed'` whose stored `result.criteria` has an unmet `Activity type` criterion back to `active` (keep `started_at`; clear `failed_at`, `activity_id`, `result`; decrement `attempt_count` but not below 1).
3. Update `authoredQuestRepository.test.ts`: wrong-sport activity leaves the attempt active; run then ride completes the quest; a matching-sport shortfall still fails.

## Acceptance criteria
- A run never fails or completes a cycling quest; the quest stays active.
- A subsequent ride meeting the criteria completes the quest and grants XP once.
- Same-sport shortfalls still fail the attempt.
- Previously wrongly failed attempts are restored to active.

## Validation
Targeted authored quest and activity repository tests (need `DATABASE_URL`), plus `npx tsc --noEmit`.
