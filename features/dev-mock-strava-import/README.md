# dev-mock-strava-import

## Goal
On localhost and the DEV stage, allow importing real Strava activities regardless of the account-creation date, so the app can be tested with realistic data. Production behaviour is unchanged.

## Scope
- Strava imports only; FIT uploads keep the existing cutoff.
- The Strava list shows the last 30 GPS activities, all selectable.
- Out of scope: storing a fake start date, rewriting `players.created_at`, bulk import.

## Decisions
- Stage detection: `NODE_ENV !== "production"` (same rule as `dev-data-reset`); no new env flag.
- The cutoff is disabled on DEV: any Strava activity can be imported in any order. The user imports in chronological order manually. No fake date is stored, so the DEV data reset needs no change.
- Duplicate and idempotency checks stay active.
- Out-of-order imports may affect XP, progression and quests; acceptable on DEV.
- Strava rate limits still apply (one list request plus streams per import).

## Implementation plan
1. Add an `isDevStage` helper in `src/config.ts` (reuse if `dev-data-reset` already added one).
2. In `ActivityRepository.persistCompletedActivity` skip the `before_journey_start` rejection for `source === "strava"` when the dev flag is on. Inject the flag (constructor/option) so tests can toggle it.
3. In `src/strava/service.ts` use a limit of 30 on DEV in `recentWithRoute`/`listRecent` and set `beforeJourneyStart = false`; wire the flag in `src/server.ts`.
4. Optionally expose a `devMode` flag in the list payload and show a DEV note ("import oldest first") in `public/components/strava-import.js` with EN/DE strings.
5. Tests: `src/persistence/stravaImport.test.ts` (dev accepts pre-account Strava beyond 3 imports; non-dev rejects as before; FIT still rejected) and `src/strava/service.test.ts` (dev lists up to 30, `beforeJourneyStart` false).
6. Docs: update `.env.example` / `ops/app/dev.env.example` comments and the `strava-oauth-manual-activity-import` README with a DEV-only note.

## Acceptance criteria
- On DEV, a Strava activity older than the account can be imported, in any order, beyond the first three.
- On DEV the list shows up to 30 activities, none flagged as before account creation.
- In production the cutoff, onboarding allowance and list limit behave as before.
- FIT uploads are unaffected.

## Validation
- Vitest for the new cases; existing suite and `tsc` pass.
- Manual check on localhost with a connected Strava account.
