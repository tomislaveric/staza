# p1-audit

## Goal

Resolve all nine P1 findings from the October 2026 product playthrough and UX
audit so that the activity, progression, exploration, collection, and quest
loops are visible and understandable to players. P0 findings are already
resolved. This is a coordinated P1 batch, as requested, rather than one
finding per session. No Figma work is included.

## Scope

In scope: P1-1 through P1-9 in
[UX audit remediation](../ux-audit-remediation/README.md).

Out of scope: P0 work, P2 findings, unrelated features, Strava OAuth, and the
GoPro video flow.

## Decisions

- Quests are one-activity attempts. Missing objectives fails the attempt, and
  the player can retry.
- Quests are authored or templated and unlocked through the Skill Atlas.
- Quest completion grants difficulty-based bonus XP: Easy +100 XP, Medium
  +250 XP, Hard +500 XP, and Prestige/special +1000 XP. Quests never grant
  Skill Points directly. Completion may advance a quest chain; special quests
  may grant a badge or title.
- Ranks are removed; the product will not maintain a rank table.
- Collectible claims are one-time. Revisits grant no XP and are labelled in
  the result and replay.

## Implementation plan

1. **P1-3 — Quest semantics:** implement the one-activity attempt, failure,
   and retry lifecycle consistently across objective evaluation, persistence,
   API, UI, and landing-page copy.
2. **P1-2 — Quest completion:** evaluate completion during activity processing;
   grant the approved reward exactly once; show completions in results, replay,
   and Progress history; and suggest the next eligible quest.
3. **P1-5 — Collectibles:** define collected as a unique claim across Home,
   Activities, Progress, Profile, and World; prevent repeat XP and label
   revisits.
4. **P1-6 — Flowlines:** attribute their rewards and counts consistently,
   provide readable names and fallbacks instead of raw coordinates or poor OSM
   labels, filter implausible speeds, and use sport-appropriate routes and
   units.
5. **P1-1 — Activity summary:** report XP, levels and Skill Points earned,
   newly unlockable nodes, quest progress and completions, and new/repeat
   discoveries. Animate replay level transitions at the earned frame and show
   unspent Skill Points on Home with a link to the Atlas.
6. **P1-4 — Terminology:** remove rank labels and apply one English/German
   glossary across navigation, pages, Atlas, quests, and collection language.
7. **P1-7 — Explore this Area:** honor requested route distance by widening the
   target search or reporting insufficient area; close round trips; allow sport
   selection; export GPX; and align objective copy and counts.
8. **P1-9 — Activity lists:** sort lists by activity start time and show sport
   and activity title.
9. **P1-8 — Home next action:** explain Staza and how to import on first run;
   for returning players, suggest an action based on unspent Skill Points,
   active or suggested quests, nearby targets, and suggested explorations.

## Dependencies and constraints

- P1-3 precedes P1-2 because completion and retry behavior depend on the
  attempt lifecycle.
- P1-2, P1-5, and P1-6 provide authoritative outcomes for the P1-1 summary.
- P1-8 follows P1-1, P1-2, P1-5, P1-6, and P1-7 so its recommendations can
  use those finished sources.
- P1-4, P1-7, and P1-9 can proceed independently from the quest/summary work.
- Preserve the resolved P0 behavior, including FIT sport handling needed by
  Flowlines and activity lists.
- Do not add P2 work or unrelated features. Do not grant quests Skill Points.
- If route constraints or unavailable data prevent the requested outcome,
  explain that explicitly rather than silently returning a materially shorter
  route.

## Acceptance criteria

- All nine P1 findings are resolved and ticked in the UX audit remediation
  README with one-line resolutions.
- The quest decisions above are recorded in the UX audit README.
- Counts and rewards use consistent definitions; quest and collectible rewards
  are not duplicated on retries or revisits.
- Each loop is visible end to end:
  - Activity → XP → Level → Skill Points → Atlas unlock → new content.
  - World target → route → Activity → collection → Progress.
  - Quest start → attempt → result → reward → next quest.
- Focused tests cover changed behavior, including quest failure/retry and
  exactly-once rewards, collectible revisits, result/replay data, route
  distance/closure/sport/GPX/objective consistency, and activity ordering.

## Validation

- Run the smallest relevant Vitest selectors while implementing, then
  `npm test` and `npm run build`.
- Run persistence tests when `TEST_DATABASE_URL` is available.
- Verify affected UI at desktop width (1440 px) and mobile width (390 px).
- After the P1 batch, perform the audit's short playthrough for a new player,
  first activity, Skill Atlas, and quest completion.

## Relevant existing code and tests

The audit identifies `src/questObjectives.ts`,
`src/persistence/questInstanceRepository.ts`, `public/components/home-page.js`,
`public/components/activity-progress.js`, and
`public/components/progress-page.js`. Existing test coverage includes quest
objective and quest-instance repository tests, Home page tests, replay tests,
activity replay map tests, and World home-location tests. Inspect the related
activity-processing, route-generation, repository/API, localization, and
landing-page paths before implementation.
