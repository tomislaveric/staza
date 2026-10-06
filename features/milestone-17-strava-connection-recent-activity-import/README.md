# Milestone 17 — Strava Connection + Recent Activity Import

## Goal

Allow a Staza user to connect Strava via OAuth, browse recent Strava activities,
select exactly one activity to import at a time, and process it through the
existing canonical Staza activity/game pipeline.

Staza is a forward journey: historical backfilling must be intentionally limited
so users cannot connect/import years of past activity history and instantly
complete large parts of the game. This rule applies consistently across import
sources, including Strava and manual FIT upload.

## Core journey rule

The first activity ever accepted into Staza establishes the user's permanent
activity-history boundary, persisted as `players.journey_started_at`.

- No activity with a start time earlier than this boundary may ever be imported,
  from any source (Strava, FIT, future sources).
- The boundary never moves backward and is never recalculated dynamically from
  "oldest currently existing activity" (deletions must not change it).
- If the player has no accepted activities yet, the first **successfully
  accepted** activity becomes the permanent journey start. A failed/invalid
  import must not establish it.
- Equal timestamps: `activity.started_at < journey_started_at` → reject.
  `activity.started_at == journey_started_at` → allowed through normal
  duplicate/idempotency validation.
- Deleting an activity later must NOT reset or alter the journey boundary.

### Rejection UX

Reject cleanly before any gameplay processing (no XP, no GameEvents, no partial
activity state, no collectible detection, no replay snapshot). Example message:
"This activity is from before your Staza journey began and can't be imported."
Return a stable domain/API error usable by both the FIT upload UI and the Strava
import UI.

## Scope

### In scope

- Strava OAuth connect/callback/disconnect/status using the existing
  authenticated Staza user/session model.
- Recent-activity listing (latest ~10–20) with single-activity selection and
  import.
- Server-owned import endpoint that fetches streams, normalizes to the
  canonical activity input, and runs the existing game engine.
- Canonical, source-agnostic journey-boundary enforcement shared by FIT and
  Strava.
- Same-source (Strava) duplicate/idempotency protection.
- Token refresh, secure token handling conventions, minimal scopes.
- Add Activity UI integration (connect card, recent list, disabled
  older-than-journey items, single import action).
- Migration/backfill of `journey_started_at` for existing players.
- Account deletion/export integration for Strava connection metadata.
- Config/env/Compose updates for Strava credentials.
- Tests for the journey rule and for Strava OAuth/token/list/import/security
  flows using mocked HTTP.

### Out of scope

- Importing all Strava history or bulk/multi-select import.
- Strava webhooks, automatic sync, or background polling.
- Leaderboards, segment imports/popularity, route planning, automatic GPX
  export, social feed, followers, comments.
- A new/parallel gameplay engine.
- Retroactive XP backfill.
- Resetting the journey start after deletion.
- Automatic cross-source (Strava vs. FIT) fuzzy duplicate detection — flagged as
  a future decision, not built in this milestone (see Decisions).

## Decisions

1. **Shared enforcement point**: a new pure domain function
   `validateActivityImportEligibility(journeyStartedAt, activityStartedAt)` in
   `src/activity.ts`, called by both the FIT (`importActivity`) and Strava
   (`importStravaActivity`) import paths before `deriveActivityResult` runs, so
   rejected imports never touch collectibles/events/XP/replay. A typed
   `JourneyBoundaryError` is added to `src/errors.ts`.

2. **Schema**: add `players.journey_started_at TIMESTAMPTZ` (nullable) via a new
   migration. It is set once, inside the same Postgres transaction as the first
   `persistCompletedActivity` call
   (`UPDATE players SET journey_started_at = $1 WHERE id = $2 AND
   journey_started_at IS NULL`), so activity acceptance and boundary creation
   succeed or roll back together.

3. **Backfill for existing players**: a one-time migration step sets
   `journey_started_at` from `MIN(activities.started_at)` per player who already
   has activities but no boundary yet. This runs once during migration, not
   recalculated dynamically afterward.

4. **Cross-source duplicates**: same-source Strava duplicates are prevented via
   the existing unique index pattern
   `(player_id, source_type, source_external_id)` extended to
   `source_type IN ('fit', 'strava')`. Cross-source duplicate detection (the
   same ride imported once via Strava and once via FIT) is **not** automated in
   this milestone; no fuzzy/GPS-similarity matching is implemented without a
   separate, explicit decision.

5. **Strava scopes**: request `read` (athlete identity) and `activity:read_all`
   (not `activity:read`, which only returns public activities and would
   silently exclude most private rides). No write scopes are requested. The
   actually granted scope string is persisted and validated before listing
   activities.

6. **Token storage**: no existing encryption-at-rest helper exists in the
   codebase (SMTP password support is base64-encoded only, not encrypted).
   Tokens are stored as plain columns in a new `strava_connections` table,
   relying on existing DB access controls and TLS, consistent with current
   secret-handling conventions. Introducing application-level envelope
   encryption is a separate decision to be made explicitly if required later.

7. **Sport type mapping**: Strava sport types map to the existing
   `ActivityType` domain enum (`cycling | running | hiking | walking |
   unknown`): `Ride`/`GravelRide`/`MountainBikeRide`/`EBikeRide` → `cycling`;
   `Run`/`TrailRun` → `running`; `Hike` → `hiking`; `Walk` → `walking`. All
   other sport types (e.g. `VirtualRide`, `Swim`, `WeightTraining`) are excluded
   or shown disabled, never imported.

8. **Streams**: only `latlng` and `time` are fetched (minimum needed to build
   canonical `TrackPoint[]`). Elevation/altitude is not currently modeled in
   `TrackPoint`/`Activity`, so altitude streams are not fetched in this
   milestone; adding elevation is a separate future decision.

## Implementation plan

1. **Database**: add migration(s) for `players.journey_started_at`, the
   `strava_connections` table (`player_id` PK, `strava_athlete_id`,
   `access_token`, `refresh_token`, `expires_at`, `scope`, `created_at`,
   `updated_at`), relax the `activities.source_type` CHECK to include
   `'strava'`, and the one-time backfill of `journey_started_at` for existing
   players.

2. **Journey boundary domain logic**: implement
   `validateActivityImportEligibility` and `JourneyBoundaryError`; wire the
   boundary-set into `persistCompletedActivity`'s existing transaction.

3. **FIT integration**: call `validateActivityImportEligibility` from
   `importActivity` (and the legacy job path) before gameplay processing; add
   tests proving an older FIT upload is rejected after the journey starts.

4. **Strava OAuth**:
   - `GET /api/integrations/strava/connect` (`requirePlayer`): generate and
     persist a server-side `state`, redirect to Strava's authorize URL.
   - `GET /api/integrations/strava/callback`: validate `state`, exchange the
     code for tokens, upsert `strava_connections` with the granted scope.
   - `POST /api/integrations/strava/disconnect` (`requirePlayer` +
     `requireCsrf`): revoke/delete local tokens, optionally call Strava's
     deauthorization endpoint; never deletes imported activities, XP, events,
     or `journey_started_at`.
   - `GET /api/integrations/strava/status`: connection state only, never
     tokens.
   - Implement access-token refresh (check expiration before each Strava call,
     persist refreshed credentials atomically) and clean handling of revoked
     refresh tokens (surfaced as a reconnect-required state).

5. **Recent activities API**: `GET /api/integrations/strava/activities` fetches
   and normalizes recent Strava activities into
   `{ externalId, name, sportType, startedAt, distance, elevationGain,
   duration, alreadyImported, beforeJourneyStart, importable }`. No tokens or
   raw Strava payloads are exposed to the browser.

6. **Import endpoint**: `POST
   /api/integrations/strava/activities/:externalId/import`. The browser
   supplies only the external Strava activity id. The server resolves the
   user's own Strava connection, fetches the activity and `latlng`/`time`
   streams, validates ownership/duplicate/journey-boundary, normalizes streams
   into `TrackPoint[]`, and runs the existing `deriveActivity` /
   `deriveActivityResult` / `persistCompletedActivity` pipeline with
   `source: "strava"` and `source_external_id` set to the Strava activity id.

7. **Config**: add `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
   `STRAVA_REDIRECT_URI` to `src/config.ts` using existing env-validation
   helpers, with a production fail-fast check; update `.env.example`, add an
   application service environment block to `docker-compose.yml`, and update
   ops documentation.

8. **Account lifecycle**: extend `AuthService.exportAccount` to include Strava
   connection metadata (athlete id, scopes, timestamps) without token values;
   extend account deletion to remove the `strava_connections` row.

9. **UI**: integrate into the existing Add Activity flow — "Upload FIT" /
   "Import from Strava" options; connect/disconnect card; recent-activity list
   with single-select and disabled styling plus a "Before your Staza journey"
   label for ineligible items; "Import selected activity" action; reuse
   existing real backend state (fetching, processing, discovering
   collectibles, saving, complete, failed) rather than fabricated progress.

10. **Rate-limit handling**: fetch the recent list only on-demand page load;
    fetch streams only on explicit import; handle Strava 429s with a clean
    user-facing message; no polling or background sync.

## Acceptance criteria

- Connecting Strava imports nothing by itself; import requires an explicit
  per-activity user action.
- The first successfully accepted activity (FIT or Strava) establishes
  `journey_started_at` exactly once, transactionally with that activity's
  persistence.
- Any later activity (FIT or Strava) with `started_at < journey_started_at` is
  rejected before gameplay processing, with no XP, events, replay snapshot, or
  partial state created.
- An activity with `started_at == journey_started_at` is allowed through normal
  duplicate/idempotency checks.
- Deleting an activity, including the first one, never changes
  `journey_started_at`.
- Existing players with prior activities but no boundary get it backfilled once
  from their earliest existing accepted activity.
- Repeated import of the same Strava activity is idempotent: no duplicate
  Activity, GameEvents, or XP.
- Only activity types mappable to the existing `ActivityType` enum are
  importable; unsupported types are excluded or shown disabled.
- Strava tokens are never returned via API, logged, exposed in HTML, or stored
  in GameEvents.
- A user cannot import another athlete's activity or choose another player's
  id; the server resolves player/connection identity from the session.
- Disconnecting Strava removes local tokens but preserves all previously
  imported activities, XP, events, and the journey boundary.
- Account deletion removes stored Strava tokens and connection metadata.
- Reconnecting after a revoked/expired refresh token works without manual
  intervention beyond the standard OAuth consent flow.

## Validation

1. Add unit tests for the journey rule: first activity establishes the
   boundary; older FIT/Strava activities are rejected after the boundary
   exists; newer FIT/Strava activities succeed; equal-timestamp semantics;
   failed first import does not establish the boundary; deletion does not move
   or reset the boundary; existing-user migration backfill behavior.
2. Add Strava tests with mocked HTTP (no live Strava dependency) covering
   OAuth (connect URL/state, valid/invalid callback, granted scopes,
   disconnect), tokens (reuse, expired refresh, persisted refresh, revoked →
   reconnect), the recent list (normalization, eligibility flags, excluded
   unsupported types), import (valid import, stream normalization, reused game
   engine, source identity, single XP award, idempotent repeat import,
   rejected older activity), and security (cannot import another athlete's
   activity, cannot choose another player, tokens never exposed).
3. Manual validation: configure Strava dev app credentials; connect Strava in
   Staza DEV; verify OAuth redirect/callback and connection status; list recent
   activities; import one valid activity and verify route/map, collectibles,
   XP/progression, and replay; retry the same activity and confirm no
   duplicate; attempt an older recent activity and confirm rejection; attempt
   an older FIT upload and confirm the same journey-boundary rejection; import
   a newer activity successfully; disconnect Strava and verify imported
   activities remain; reconnect and verify the token refresh path; confirm no
   browser console errors; run the full test suite, `tsc`, and persistence
   tests.
