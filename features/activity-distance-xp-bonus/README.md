# activity-distance-xp-bonus

## Goal

Reward activity distance with XP while preserving current collectible and
Flowline rewards. The distance award contributes to activity XP and is shown
separately so players can understand the reward.

## Scope and decisions

- Award distance XP incrementally as each distance milestone is reached, for
  every activity type.
- Activities ending before 10 km receive no distance XP.
- Use the following milestone awards:

  | Milestone | XP awarded at milestone | Cumulative distance XP |
  | --- | ---: | ---: |
  | 10 km | +10 | 10 |
  | 20 km | +20 | 30 |
  | 50 km | +20 | 50 |
  | 100 km | +25 | 75 |
  | 150 km | +25 | 100 |

- Keep collectible values and the fixed XP per Flowline unchanged. Add
  distance XP to the existing activity XP total.
- Show each distance milestone as a separate replay reward when the route
  reaches that distance.
- Do not retroactively recalculate or re-award XP for already persisted
  activities.
- Keep existing persistent XP storage and transaction/idempotency behavior;
  no database migration is expected.

## Implementation plan

1. Add a pure, tested distance-milestone XP calculation and expose cumulative
   `distanceXp` in `ActivityResult`. Include it in `totalPoints` alongside
   collectible and Flowline XP.
2. Keep persistence and progression on the existing `totalPoints` path and
   verify persisted activities receive the updated total exactly once.
3. Map each milestone to its route-crossing timestamp and show the incremental
   distance reward during replay. Account for distance XP separately from
   Flowline XP, preserve cumulative replay totals, and show the component
   separately in activity reward details.
4. Test tier boundaries, composition with existing reward sources, replay
   totals, and legacy snapshots; run focused tests and the build.

## Acceptance criteria

- Every activity reaching a milestone receives its confirmed incremental
  award; activities ending before 10 km receive none.
- The collectible and Flowline award values and detection behavior do not
  change.
- Distance XP contributes to activity XP and persistent player progression.
- The activity reward breakdown identifies the distance component separately.
- Replay shows each distance award when its kilometer milestone is reached and
  cumulative replay XP ends at the activity total.
- Older replay snapshots without a `distanceXp` field retain their existing
  reward totals and presentation.
- Repeated persistence of an existing activity does not apply XP again.

## Validation

Add focused tests for routes just below, at, and beyond each milestone,
distances beyond the cap, crossing timestamps, and unchanged
collectible/Flowline XP. Verify replay item values and cumulative totals with
and without distance XP, including legacy snapshots. Run the focused activity,
replay, and persistence tests, then the build.

## Constraints

Do not change collectible detection, collectible values, Flowline detection or
its 50 XP completion award, progression level mathematics, or persistent XP
transaction/idempotency behavior. Do not retroactively modify saved activities
or introduce a database migration.
