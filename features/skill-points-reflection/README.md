# skill-points-reflection

## Goal

Make it clear on the Progress page that reaching certain player levels awards
Skill Points for spending in the Skill Tree.

## Scope

- Add a concise explanation that level-ups award Skill Points.
- Mark displayed levels that grant Skill Points in the existing level journey.
- Keep the existing Progress page structure, visual hierarchy, and responsive
  layout.
- Use the Skill Tree's canonical award curve; do not duplicate award rules in
  browser code.

Out of scope: a separate earned-points balance on the Progress page, a new screen,
or a broader redesign.

## Decisions

- Show an explanation plus per-level award markers; do not add a total-earned
  balance.
- Calculate each displayed level's award as the difference between
  `earnedSkillPointsForLevel(level)` and `earnedSkillPointsForLevel(level - 1)`.
- The current dashboard's level window remains unchanged; markers apply to levels
  in that displayed window.
- Provide the new copy in English and German using the existing locale map.

## Implementation plan

1. Extend the progress dashboard level entries with their Skill Point award
   deltas, derived from the canonical Skill Tree award curve.
2. Update the Progress page to explain the level-up reward and show a `+1 Skill
   Point` marker only on levels that award one. Reuse its current components and
   styling; preserve responsive behavior.
3. Add focused tests for dashboard milestone data and rendered award information.

Expected implementation areas: `src/domain.ts`,
`src/persistence/activityRepository.ts` and its tests,
`public/components/progress-page.js` and its tests,
`public/styles/app-shell.css`, and `public/app-locales.js`.

## Acceptance criteria

- A player can understand from the Progress page that Skill Points are earned by
  reaching certain levels and are used by the Skill Tree.
- Only qualifying levels show the Skill Point award marker, consistent with the
  Skill Tree's actual award curve.
- The new copy is available in English and German.
- The existing progress journey and earned-points behavior elsewhere remain
  unchanged.

## Validation

- Run the focused progress dashboard and Progress page tests.
- Run the project build (`npm run build`).
