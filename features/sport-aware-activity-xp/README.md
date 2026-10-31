# sport-aware-activity-xp

## Goal

Refactor Activity XP so it rewards every valid meaningful activity without a
universal distance threshold, while using sport-specific distance weighting.
Calculate XP deterministically on the server in the canonical activity
processor.

## Scope and decisions

- Award +50 base XP to every activity accepted by the existing import validity
  rules.
- Award distance XP proportionally to route distance at these rates:

  | Activity type | XP per km |
  | --- | ---: |
  | Cycling | 2 |
  | Running | 10 |
  | Hiking | 7 |
  | Walking / unknown | 0 |

- Do not use speed or pace for base or distance XP. Unknown sports must never
  receive Cycling's distance rate.
- Preserve current structural route validation: FIT and Strava tracks need at
  least two usable points, but there is no minimum-distance gate. A valid
  zero-distance track receives base XP and no distance XP. Missing distance
  yields no distance XP; malformed negative or non-finite inputs must not be
  silently converted into a reward.
- Preserve collectible, Flowline, and Quest XP values and composition; preserve
  the Player Level model, Skill Point award rules, and Skill Atlas unlock
  semantics.
- Do not award elevation XP yet. Keep the additive XP model extensible for a
  future elevation component.
- Historical `GameEvents`, activity XP, and replay snapshots remain
  authoritative. Do not silently recalculate or backfill persisted XP.

## Review findings and resolutions

- **Precision policy.** Distance XP is `rate * km` rounded once per activity
  with `Math.round`, so every stored and displayed XP value is an integer
  (7.5 km Hiking = 52.5 rounds to 53). Replay reward items are one whole-XP
  item per completed kilometre (`rate`) plus a final partial-kilometre item
  carrying `roundedTotal - sum(previous items)`, omitted when 0. Items sum
  exactly to `distanceXp`. Ignore remainders below 1e-9 km.
- **Malformed input.** Reject, do not base-award. `usableFitTrackPoints`
  (`src/fit.ts`) drops points with non-finite or out-of-range coordinates
  (`|lat| <= 90`, `|lon| <= 180`), matching `trackFile.ts` and
  `strava/normalize.ts`; fewer than two usable points keeps the existing
  failure. In the XP calculation, missing distance yields 0 distance XP;
  negative or non-finite distance throws `RangeError`.
- **Replay reconciliation.** Replay must reach `outcome.xp.total` exactly,
  including base and Quest XP (see implementation step 2).
- **Walking normalization.** Intentionally unchanged: FIT/GPX `walking` stays
  `unknown`, Strava `Walk` stays `walking`. Both earn 0 XP/km; changing it
  would alter Flowline eligibility. A test pins this.
- **Legacy snapshots.** Missing `baseXp` / `outcome.xp.base` default to 0 at
  runtime; never inferred or recalculated.
- **Old API.** Remove `DISTANCE_XP_MILESTONES`, `distanceXpForMeters` and
  their tests; only `src/activity.ts` and its test use them.

## Implementation plan

1. In `src/activity.ts`, replace universal distance milestones with a pure
   sport-aware calculation (`DISTANCE_XP_PER_KM` map plus
   `distanceXpForActivity(type, meters)`) and +50 base XP. Extend
   `ActivityResult` in `src/domain.ts` with `baseXp`. Keep the existing
   collectible and Flowline calculation unchanged. Produce timestamped
   distance reward items per the precision policy, with interpolated
   timestamps on the segment crossing each kilometre, the final partial item
   at the last point, and zero-length segments guarded against NaN.
   Harden `usableFitTrackPoints` as described above.
2. Extend the additive XP breakdown in `src/domain.ts` and
   `src/persistence/activityOutcome.ts` with base XP. Keep Quest bonuses
   separately added by `src/persistence/activityRepository.ts`. Update
   `public/components/replay-tab.js` `replayRewardItems`: add a `base` item at
   activity start (`activityResult.baseXp ?? 0`) and a `quest` item at
   activity end (`outcome.xp.quests`, only if > 0); the Flowline fallback
   becomes `total - base - collectible - distance - quests` (clamped at 0),
   still preferring `outcome.xp.flowlines`. Update
   `public/components/activity-outcome.js` to show base and sport-weighted
   distance awards. Keep compatibility with snapshots lacking the new fields.
3. Keep the existing persistence transaction and idempotency behavior. Store
   the activity total and replay snapshot at import, add Quest XP to player
   totals as today, and keep Progress/replay based on stored values rather than
   recomputing historical XP.
4. Add focused tests for sport rates, reward composition, short/missing
   distance, replay compatibility, and persistence idempotency.

## Acceptance criteria

- A 40 km Cycling activity earns 130 activity XP: 50 base + 80 distance.
- A 7.5 km Running activity earns 125 activity XP: 50 base + 75 distance.
- A 10 km Hiking activity earns 120 activity XP: 50 base + 70 distance.
- Unknown and Walking activities earn base XP only and never use the Cycling
  rate.
- No universal minimum distance is required for XP. Short and zero-distance
  activities that pass existing structural validity checks earn base XP only;
  activities rejected by existing validity checks remain rejected.
- Collectible, Flowline, and Quest rewards retain their values and are composed
  exactly once. Speed/pace does not affect base or distance XP.
- Replay reward progression and activity outcome breakdown reconcile to the
  persisted activity XP. Progress and replay continue to show historical stored
  XP without recalculation.
- All XP values are integers; items from partial kilometres sum exactly to
  the persisted distance XP.
- Final replay cumulative XP equals `outcome.xp.total` with and without
  Flowlines and Quests.
- FIT points with NaN, infinite or out-of-range coordinates are discarded;
  negative or non-finite distance is never rewarded.
- Repeated imports do not award the activity XP again.
- Player levels, Skill Points, and Skill Atlas unlock rules are unchanged.

## Migration and backfill

No relational database migration is expected: the current `activities.xp_earned`
column and replay JSON snapshot can hold the new values. Add the base component
as an optional snapshot/outcome field while keeping snapshot version 1. Do not
recalculate old activity XP, rewrite historical GameEvents, or change player
totals. Legacy snapshots without the new field retain their existing values and
presentation.

## Validation

- In `src/activity.test.ts`, cover the three example rates, unknown/Walking
  fallback, very short and zero-distance routes, missing distance, malformed
  distance inputs, and unchanged collectible/Flowline composition.
- Update replay tests to cover per-kilometer and partial-distance rewards,
  cumulative XP, and snapshots without the new optional field.
- Add replay tests: base-only and zero-distance routes replay to the full
  persisted total; base + distance + collectible + Flowline + Quest sums to
  `outcome.xp.total`; partial-final-km timestamps are finite and lie on the
  final non-zero segment; a legacy version-1 fixture without base fields keeps
  its totals and reward sequence.
- Add FIT parsing tests (NaN, infinity, out-of-range coordinates) and sport
  normalization parity tests across FIT, GPX and Strava (walking, unknown).
- Verify persistence keeps the new activity total exactly once and Quest XP
  separately, including a result with base and fractional/partial distance
  XP and no second player-total increase on re-import; retain existing
  Progress behavior for historical records.
- Run the focused activity, replay, and persistence tests, then `npm run build`.
