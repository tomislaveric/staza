# strava-oauth-manual-activity-import

## Goal

Let a signed-in Staza user connect Strava, review a small list of recent
activities, explicitly choose exactly one, and import it into Staza. The
imported activity must use the same canonical processing and persistence as a
FIT upload, so normal collectibles, Fartlek completions, XP, progression, and
replay continue to come from existing gameplay logic.

The first successfully accepted Staza activity establishes the player's
permanent journey start. No activity older than that boundary may be imported
from FIT, Strava, or a future source.

## Current architecture

`src/fit.ts` parses FIT GPS records into timestamped `TrackPoint`s.
`src/activity.ts` derives an `Activity` and `ActivityResult`; the result includes
collectible events, Fartlek completions, and XP. The authenticated import path
and legacy job path both persist through
`ActivityRepository.persistCompletedActivity`, which atomically stores the
activity, events, replay snapshot, Fartlek completions, and XP. The gameplay
derivation is source-independent in behavior, but `Activity.source` and the
database source constraint currently allow FIT only.

Strava will be a source adapter at the normalization boundary. FIT and Strava
must both feed the same activity/result derivation and repository transaction.
No Strava-specific gameplay or reward pipeline is introduced.

## Scope

- Server-side Strava OAuth connection for an authenticated Staza user.
- On-demand display of a small, fixed list of recent activities.
- User selection and import of exactly one activity per request.
- Retrieval and normalization of that activity's GPS/time streams.
- Shared canonical activity processing, replay, collectible/Fartlek handling,
  and progression.
- An immutable, source-independent journey-start boundary.
- A Strava connection status and disconnect action in the existing profile and
  activity-import experience.

Out of scope: automatic historical or bulk imports, “Import All,” pagination
through activity history, webhooks, polling, automatic future-activity sync,
Strava activity writes, segments, KOM/QOM, leaderboards, likes, comments,
social features, route publishing, Garmin, and scheduled synchronization.

## Decisions

### Strava authorization and API use

- Request only the `activity:read_all` scope, which is needed to include
  private activities. Do not request profile, write, segment, or social scopes.
  Explain the permission before redirecting; the feature does not fetch or
  retain privacy-zone settings or unrelated streams.
- Use the registered Strava web OAuth flow and a fixed callback. OAuth state is
  random, stored as a hash, bound to the current Staza user and session, short
  lived, and single use. Validate the returning session and state before
  exchanging the authorization code.
- Encrypt access and refresh tokens at rest. Keep token-bearing connection
  types server-only; never expose credentials in APIs, exports, logs, or UI.
- Refresh short-lived access tokens before requests, persist Strava's rotated
  refresh token, and serialize concurrent refreshes through a database lock.
  Invalid or revoked credentials produce an explicit reconnect-required state.
- Fetch recent activities on demand with one fixed first-page request (30
  items) and show only the newest 3 with GPS data. Fetch only the selected activity's `latlng` and
  `time` streams. No stored list/stream data for activities the user does not
  import.
- Apply endpoint throttling, honor rate-limit headers and 429 responses, and
  avoid polling. Current Strava limits and athlete capacity vary by application;
  verify the developer app's capacity and approval before enabling multiple
  athletes.

### Canonical activity and duplicate identity

- Generalize the normalized `Activity` source to support `fit` and `strava`;
  keep activity result, collectible, Fartlek, XP, replay, and persistence logic
  source-agnostic.
- Keep provider identity scoped by player and source type. FIT continues to use
  the existing client `Idempotency-Key` stored in `source_external_id`;
  Strava uses its activity ID in that field. Retrying either import returns the
  existing activity without duplicate events or XP.
- Add a versioned cross-source fingerprint based on activity type, UTC start
  rounded to a minute, duration and route-distance buckets, and a deterministic
  distance-resampled, quantized route. Backfill it from existing replay
  snapshots. Use route/time/distance similarity to reject only high-confidence
  FIT/Strava duplicates; report the existing activity rather than awarding
  gameplay twice.
- Normalize Strava GPS points to finite, valid coordinates and monotonically
  increasing absolute UTC timestamps (`start_date` plus the `time` stream).
  Require at least two usable points. Map Strava sport type to the existing
  `ActivityType` set and calculate route distance consistently with the
  canonical pipeline.

### Journey start and transaction boundary

- Store nullable `players.journey_started_at`. For existing players with
  activities, backfill from the `started_at` of the earliest accepted activity,
  ordered by `created_at, id`; do not backfill from the oldest activity date.
  Players without activities start with a null boundary.
- Check exact import identity before the journey rule so a retry of an
  already-accepted import remains idempotent. Normalize and validate source
  data, then check cross-source duplication, then enforce the journey boundary
  before a new activity is accepted.
- In the canonical persistence transaction, lock the player row. If the
  boundary is unset, set it to the first successfully committed activity's
  `startedAt`. Otherwise reject an activity whose `startedAt` is earlier.
  Persist the activity, events, replay snapshot, Fartlek completions, XP, and
  initial boundary atomically. Failed/invalid imports and duplicates do not set
  or change the boundary.
- The boundary belongs to the Player lifecycle and cannot be moved backward or
  reset by any import source or by disconnecting Strava. Existing account
  deletion semantics remove the Player and all associated data; a subsequently
  created account is a new Player journey.

### Connection and privacy lifecycle

- Disconnect removes the local connection, encrypted tokens, and pending OAuth
  states, stopping future Strava access. Keep already imported Staza activities,
  replay, events, and XP. Attempt remote Strava deauthorization when possible
  and report if remote revocation fails without retaining tokens for an
  automatic retry.
- Unimported activity summaries and route streams are transient. An explicitly
  imported activity is persisted only in the existing Staza activity/replay
  format. Do not fetch heart rate, segments, leaderboards, or social data.
- Explicitly handle OAuth denial, missing scope, expired/revoked connection,
  provider 401/403/404/429/5xx, missing/invalid streams, duplicate activity,
  and pre-journey activity. Sanitize provider error bodies and credentials.

## Implementation plan

1. Add configuration for Strava client credentials, fixed redirect URI, and
   token-encryption key. Keep the integration disabled unless required
   configuration is present; document deployment configuration without
   committing secrets.
2. Add migrations for `players.journey_started_at`, Strava connections and
   one-time OAuth states, the expanded activity source constraint, and
   versioned cross-source fingerprints. Backfill journey boundaries and
   fingerprints for existing activities from accepted timestamps and replay
   snapshots.
3. Add a server-side Strava API/OAuth adapter and connection repository:
   one-time session-bound state, authorization-code exchange, scope validation,
   encrypted token storage, token refresh/rotation, safe connection status,
   activity listing, selected-stream retrieval, and disconnect.
4. Generalize the canonical activity source model and constructors without
   changing FIT parsing behavior or gameplay derivation. Implement Strava
   stream normalization to the same `TrackPoint[]`/`Activity` contract.
5. Enforce source identity, cross-source duplicate checks, and the immutable
   journey boundary in `ActivityRepository.persistCompletedActivity`, covering
   both the direct import and legacy FIT job call paths.
6. Add authenticated, CSRF-protected OAuth-start, connection-status,
   disconnect, recent-activities, and selected-activity import routes. The
   import route accepts one Strava activity ID only and runs the canonical
   pipeline.
7. Extend Add Activity with connection and recent-activity selection states;
   add connection management to Profile. Display explicit loading, empty,
   disconnected, reconnect, error, duplicate, and journey-boundary states.
8. Update environment examples, root/feature documentation, and localization
   strings for new user-visible text.

## Implementation notes

- Configuration: `src/config.ts` (`config.strava`) enables the integration only
  when `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REDIRECT_URI`, and
  `STRAVA_TOKEN_ENCRYPTION_KEY` are valid; `STRAVA_RECENT_ACTIVITY_LIMIT`
  (number of GPS activities shown) defaults to 3 (maximum 30).
- Migration `021_strava_import_and_journey_start` adds
  `players.journey_started_at` (backfilled from each player's first accepted
  activity), `strava` as an activity source, versioned activity fingerprints
  (backfilled from replay snapshots), `strava_connections`, and
  `strava_oauth_states` (hashed, 10-minute, single-use, player+session bound).
- `src/strava/`: `client.ts` (OAuth, first-page list, `latlng,time` streams,
  deauthorize, application-wide rate gate, sanitized errors), `tokenCipher.ts`
  (AES-256-GCM with owner/purpose-bound associated data), `normalize.ts`
  (streams → canonical `TrackPoint[]`/`Activity`, sport mapping), and
  `service.ts` (callback validation, list eligibility, single import).
- `src/activityProcessing.ts` is the one canonical gameplay derivation used by
  FIT upload, legacy FIT jobs, and Strava.
- `ActivityRepository.persistCompletedActivity` locks the player row, then
  resolves exact source identity, rejects high-confidence cross-source
  duplicates (`src/activityFingerprint.ts`), rejects activities before the
  journey boundary, and sets the boundary with `COALESCE` in the same
  transaction as the activity, events, and XP. Same-source FIT re-uploads with a
  new idempotency key keep their previous behavior.
- The recent list is one first-page request of 30 items, filtered to
  activities with GPS data (not manual, with a polyline or start position) and
  cut to the configured limit.
- Import requires the selected ID to be in the current recent list, which
  enforces no-history access without a separate detail request.
- UI: a Strava section below the FIT form in Add Activity and a Connections
  section in Profile, reusing the existing panel, button, error, processing, and
  completion components.

## Acceptance criteria

- A signed-in user can connect Strava and see no more than the configured small
  recent list; the app never paginates through history or imports automatically.
- The user must explicitly select one activity. Only that activity's required
  GPS/time streams are fetched and normalized.
- FIT and Strava activities use the same canonical activity/result derivation
  and persistence transaction. Collectibles, Fartlek completions, replay, XP,
  and progression remain source-agnostic.
- Repeating a request for the same provider identity cannot create another
  activity, event set, or XP award. A high-confidence cross-source duplicate
  cannot award gameplay twice.
- The first successfully accepted activity establishes the journey boundary.
  Every source rejects activities before it; failed attempts, retries, and
  disconnects cannot move or reset it.
- Disconnect removes local credentials and stops future access while retaining
  imported Staza activity and progression.
- OAuth state, CSRF, session ownership, token encryption, rate limiting, and
  safe error handling are covered. Tokens and private provider payloads are not
  exposed in export or logs.
- No historical bulk import, automatic sync, webhook, polling, scheduled job,
  Strava write, or Garmin support is introduced.

## Validation

- Unit-test FIT and Strava source normalization, route/time validation, sport
  mapping, fingerprint stability, and high-confidence duplicate behavior.
- Test OAuth state/session binding and replay, consent denial and missing
  scopes, token encryption and refresh rotation, revoked connections, provider
  errors, request throttling, and safe error responses.
- Persistence-test migration backfills, player isolation, exact-source
  idempotency, cross-source duplicates, journey-boundary rejection, first
  accepted activity, failed-import non-mutation, atomic XP/event writes, and
  concurrent first imports.
- UI-test connection, list selection of exactly one activity, import success,
  empty/loading/error/reconnect/disconnect states, and the journey-boundary
  message.
- Run focused tests, persistence tests with `TEST_DATABASE_URL`, the TypeScript
  build, and the existing test suite.
- Manually validate with a dedicated test account and registered Strava app:
  connect, inspect the limited list, import one activity, retry it, verify
  canonical replay/rewards, attempt a pre-boundary activity, disconnect, and
  confirm the imported Staza activity remains.
