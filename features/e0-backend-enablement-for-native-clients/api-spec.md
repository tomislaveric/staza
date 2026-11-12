# Native client API spec

Base URL: the deployment origin (e.g. `https://play.staza.world`). All bodies are
JSON unless noted. Errors are always `{ "error": string }` (some add `code`);
unknown `/api/*` paths return `404 { "error": "Not found." }`.

## Authentication

### Opting in

Send `X-Staza-Client: native` on a register/login verify request. The response
then carries a `credentials` object and **no** `Set-Cookie`. Requests without the
header behave exactly as before (cookie session, no `credentials`).

```json
"credentials": {
  "tokenType": "Bearer",
  "accessToken": "…",          // opaque, valid ~15 minutes
  "accessTokenExpiresAt": "ISO-8601",
  "refreshToken": "…",         // opaque, single use
  "refreshTokenExpiresAt": "ISO-8601"  // absolute session limit (30 days)
}
```

### Using credentials

Send `Authorization: Bearer <accessToken>` on every authenticated request.

- A presented bearer header is authoritative; there is no cookie fallback.
  Invalid, expired, or revoked tokens yield `401 { "error": "Sign in is required." }`.
- Bearer requests need no `X-CSRF-Token` / `Origin` headers (they are not ambient
  credentials). Cookie requests still require them.
- Native sessions are independent of web sessions: native sign-in does not revoke
  web sessions, and web sign-in does not revoke native sessions. `logout-all`
  revokes both.

### Endpoints

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register/code` | none | `{ email }` | `202 { message }` |
| POST | `/api/auth/register/verify` | none | `{ email, code }` (+ native header) | `201 { user: { email, emailVerified }, csrfToken, passkeySetupRequired, credentials }` |
| POST | `/api/auth/email-code/request` | none | `{ email }` | `202 { message }` |
| POST | `/api/auth/email-code/verify` | none | `{ email, code }` (+ native header) | `{ authenticated, user?, csrfToken?, credentials? }` |
| POST | `/api/auth/passkeys/login/options` | none | No body | WebAuthn options: `challenge`, `timeout`, `rpId`, `allowCredentials`, `userVerification` |
| POST | `/api/auth/passkeys/login/verify` | none | WebAuthn `AuthenticationResponseJSON` (+ native header) | `{ user: { email, emailVerified }, csrfToken, credentials }` |
| POST | `/api/auth/native/refresh` | none (refresh token) | `{ refreshToken }` | `{ credentials }`; `401` if invalid, expired, revoked, or replayed |
| GET | `/api/auth/session` | optional | – | `{ authenticated, user?, csrfToken?, devTools? }` |
| POST | `/api/auth/logout` | bearer | – | `204`; revokes the presenting session |
| POST | `/api/auth/logout-all` | bearer | – | `204`; revokes every session of the user |
| POST | `/api/auth/passkeys/register/options` | bearer | No body | WebAuthn options: `challenge`, `rp`, `user`, `pubKeyCredParams`, `timeout`, `excludeCredentials`, `authenticatorSelection`, `attestation` |
| POST | `/api/auth/passkeys/register/verify` | bearer | WebAuthn `RegistrationResponseJSON` + optional `name` | Native bearer: `{ credentials }` (rotated access + refresh tokens); web cookie: `204` |
| GET | `/api/auth/passkeys` | bearer | – | `[{ id, name, createdAt, lastUsedAt? }]` |
| DELETE | `/api/auth/passkeys/:id` | bearer | – | `204` |

Refresh rotates both credentials: the old access token stops working
immediately and the old refresh token is retained only to detect replay.
Presenting an already-rotated refresh token revokes the whole session.
Refresh tokens are stored only as SHA-256 hashes (`sessions.refresh_token_hash`).

Native passkeys: iOS uses the `https` origin (`WEBAUTHN_ORIGIN`) via
Associated Domains; Android origins (`android:apk-key-hash:<base64url>`) must be
listed in `WEBAUTHN_EXTRA_ORIGINS`.

## Account

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/step-up/email/request` | bearer | – | `202 { message }` |
| POST | `/api/auth/step-up/email/verify` | bearer | `{ code }` | `204` |
| GET | `/api/account/export` | bearer + fresh step-up | – | JSON attachment `{ exportedAt, account, player, activities, events }` |
| POST | `/api/account/deletion-intent` | bearer + fresh step-up | – | `201 { confirmationToken, expiresAt }` |
| POST | `/api/account/delete` | bearer + fresh step-up | `{ confirmationToken }` | `204` |

## Activities

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/activities` | bearer | – | `ActivityHistoryItem[]` |
| GET | `/api/activities/summary` | bearer | – | `ActivityHistorySummary` |
| GET | `/api/activities/:id` | bearer | – | `PersistedActivity` |
| POST | `/api/activities/inspect` | bearer | multipart `fit` file | `{ sport? }` |
| POST | `/api/activities/import` | bearer | `multipart/form-data`: `fit` file, optional `video`, `sport`; `Idempotency-Key` header | `201 ActivityImportResult`; `409 { error, code }` on duplicate |
| POST | `/api/jobs` | bearer | `multipart/form-data`: `fit` file, optional `video`, `sport` | `202 { token }` |
| GET | `/api/jobs/:token` | bearer | – | Job status and available processing results |
| GET | `/api/jobs/:token/activity` | bearer | – | `{ activity, activityResult }`; `409` until ready |

## World / game

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/world/basemap` | bearer | – | `{ styleUrl, attribution }` (see MapLibre) |
| GET | `/api/world?bbox=west,south,east,north` | bearer | Optional `bbox`, `collectibleBbox`, `skipCollectibles=1` | Viewport collectibles, stats, and Fartleks |
| GET | `/api/world/quest-targets` | bearer | Repeated `collectibleId` and/or `flowlineId` query fields | `{ collectibles, flowlines }` |
| GET | `/api/quest-instances` | bearer | – | `{ instances: QuestInstance[] }` |
| POST | `/api/quest-instances/:id/retry` | bearer | No body | `204` |
| DELETE | `/api/quest-instances/:id` | bearer | No body | `204` |
| POST | `/api/explorations/generate` | bearer | `{ area: { bbox: { west, south, east, north }, center: { lat, lon }, zoom }, start: { lat, lon }, sport? (cycling/running/hiking), routeType? (round_trip/point_to_point), constraint? ({ type: distance, meters } or { type: duration, seconds }), destinationId? }` | Generated exploration: `{ explorationId, proposals, catalog, truncated, limits, warnings }` |
| POST | `/api/explorations/:explorationId/reroute` | bearer | `{ proposalId, targetIds, waypoints? }` | `{ proposal }` |
| POST | `/api/explorations/confirm` | bearer | `{ proposalId }` | `{ instance, plannedRoute }` |
| GET | `/api/quest-instances/:id/planned-route` | bearer | – | `PlannedRoute` |
| GET | `/api/quest-instances/:id/planned-route.gpx` | bearer | – | GPX file |
| GET | `/api/skill-tree` | bearer | – | `SkillTreeView` |
| POST | `/api/skill-tree/unlock` | bearer | `{ nodeId }` | `SkillTreeView`; `201` new, `200` already unlocked |
| GET | `/api/authored-quests` | bearer | – | `{ quests: AuthoredQuestView[] }` |
| GET | `/api/rewards/new` | bearer | – | `{ hasNew, hasNewProgress }` |
| POST | `/api/rewards/seen` | bearer | No body | `204` |

## Player

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/player/progress` | bearer | – | `PlayerProgress` |
| GET | `/api/player/progress-dashboard` | bearer | – | `ProgressDashboard` |
| GET | `/api/player/capabilities` | bearer | – | `{ worldFilters, titles, badges, lockedWorldFilters }` |
| GET | `/api/player/profile` | bearer | – | `PlayerProfileOverview` + `collectibles` stats |

## Integrations (Strava)

Disabled unless configured server-side (`503`-style `{ error }` otherwise).

| Method | Path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/integrations/strava` | bearer | – | `{ enabled, recentLimit?, status, connectedAt? }` |
| POST | `/api/integrations/strava/authorize` | bearer | `{ locale?: "en" \| "de" }` | `{ authorizationUrl }`; open in a system browser |
| DELETE | `/api/integrations/strava` | bearer | No body | Updated `{ status, connectedAt? }` |
| GET | `/api/integrations/strava/activities` | bearer | – | `StravaRecentActivities` |
| POST | `/api/integrations/strava/activities/:id/import` | bearer | No body; Strava activity id in path | `ActivityImportResult` |

The OAuth callback (`/api/integrations/strava/callback`) is a browser redirect
that relies on the cookie session, so native apps must complete it in a browser
session that is signed in on the web, or re-authenticate there.

## Data response fields

These are the JSON fields returned by native-consumed data endpoints. Optional
fields are omitted when not available; nested object fields are listed below.

### Account

- `GET /api/account/export` returns `exportedAt`, `account` (`email`), `player`
  (`id`, `display_name`, `total_xp`, `journey_started_at`, `created_at`),
  `activities` (each with `id`, `source_type`, `started_at`,
  `distance_meters`, `duration_seconds`, `xp_earned`, `collected_count`,
  `has_video`, `created_at`), and `events` (each with `id`, `activity_id`,
  `source_id`, `event_type`, `activity_timestamp`, `value`, `latitude`,
  `longitude`, `collectible_name`, `collectible_type`).
- `POST /api/account/deletion-intent` returns `confirmationToken` and
  `expiresAt`; `POST /api/account/delete` accepts `confirmationToken`.
  Both require fresh step-up authentication.

### Activities and imports

- `GET /api/activities` returns an `ActivityHistoryItem[]` (not a wrapper).
  Each item has `id`, `type`, `title`, `startedAt`, optional `distanceMeters`
  and `durationSeconds`, `xpEarned`, `collectedCount`, `revisitCount`,
  `flowlineCount`, and `hasVideo`.
- `GET /api/activities/summary` returns `count`, `distanceMeters`, `xp`,
  `collected`, and `flowlines`.
- `GET /api/activities/:id` returns a `PersistedActivity`: the history fields
  above, `events`, and optional `replay` and `video`. Each event has `id`,
  `sourceId`, `type`, `collectible`, optional `collectibleCategory`, `value`,
  `latitude`, `longitude`, `activityTimestamp`, and optional `repeat`.
  `replay` has `version`, `activity`, `activityResult`, and optional `outcome`.
  `video` has `mediaId`, `sourceFilename`, `state`, and optional
  `sourceDuration`, `synchronization`, `events`, `selectedSourceIds`, `render`,
  `error`, `previewUrl`, and `downloadUrl`.
- `ActivityImportResult` has `activity`, `inserted`, and optional `videoError`.
  The activity's nested `activityResult` contains `activityId`, optional
  `distance` and `duration`, `collectedCount`, optional `revisitCount`,
  `totalPoints`, optional `baseXp`, `distanceXp`, `distanceXpRewards`,
  `collectibles`, `events`, `nearMisses`, and `fartlekCompletions`.
- `GET /api/jobs/:token` returns `token`, `state`, optional `error`,
  `resultMode`, `activityReady`, optional `events`, `render`,
  `synchronization`, `world`, and `downloadUrl`. `GET
  /api/jobs/:token/activity` returns `{ activity, activityResult }`.
- `POST /api/activities/inspect` accepts multipart `fit` and returns
  `{ sport? }`. The existing upload routes accept multipart `fit`, optional
  `video`, and `sport`; `/api/activities/import` also requires the
  `Idempotency-Key` header.

### World, quests, and route planning

- `GET /api/world` returns `collectibles`, `stats`, optional `truncated` or
  `collectiblesSkipped`, `fartlekTruncated`, and `fartleks`. `stats` has
  `totalCollectibles`, `discoveredCount`, and `remainingCount`. Each collectible
  includes its catalog fields (`id`, `name`, `type`, `latitude`, `longitude`,
  `radiusMeters`, `value`, and optional descriptive/source/category metadata)
  plus `found` and `visibility`. Each Fartlek has `id`, `name`, `geometry`,
  `lengthMeters`, `status`, `source`, `completed`, `completionCount`, and
  optional `flowScore`, `bestElapsedTimeS`, and `latestCompletion`.
  Fartlek geometry is `{ type: "LineString", coordinates: [longitude, latitude][] }`;
  source has `sourceType`, `sourceExternalId`, and optional `sourceAttribution`.
- `GET /api/world/quest-targets` accepts repeated `collectibleId` and
  `flowlineId` query fields (at least one id; at most 100 total) and returns
  `{ collectibles, flowlines }` in the same shapes.
- `GET /api/quest-instances` returns `{ instances }`. Each instance has `id`,
  `suggestionId`, `templateId`, `templateVersion`, `title`, `description`,
  `recommendedLevel`, `status`, `difficulty`, `rewardXp`, `attemptCount`,
  `startedAt`, `objectives`, and optional `completedAt`, `failedAt`, and
  `resolvedActivityId`. Each objective contains `objective`, `progress`
  (`completed`, `required`, `complete`), and `targetProgress`.
- `POST /api/explorations/generate` returns `explorationId`, `proposals`,
  `catalog`, `truncated`, `limits` (`maxRouteTargets`, `maxRouteWaypoints`),
  and `warnings`. Each proposal has `id`, `label`, `recommended`, `routeType`,
  `distanceM`, `durationS`, `geometry`, `start`, `end`, `includedTargetIds`,
  `nearbyTargetIds`, `targetSummary`, `traversedFlowlines`, and
  `constraintFit`, plus optional hint/elevation/customization fields.
  `catalog` has `collectibles` and `flowlines`; each warning has `code`,
  `requestedType`, `requested`, `longest`, and `message`.
- `POST /api/explorations/:explorationId/reroute` returns `{ proposal }` with
  the proposal fields above. `POST /api/explorations/confirm` returns
  `{ instance, plannedRoute }`. Confirmation accepts only `proposalId`; route
  geometry, targets, and objectives are loaded from server state.
- `GET /api/quest-instances/:id/planned-route` returns `id`, `questInstanceId`,
  `proposalId`, `profile`, `routeType`, `start`, `end`, `distanceM`,
  `durationS`, `geometry`, `includedTargetIds`, `plannerVersion`, `createdAt`,
  and optional elevation fields. The `.gpx` variant returns a GPX attachment.
- `GET /api/authored-quests` returns `{ quests }`; each quest has `id`,
  `chainId`, `chainTitle`, `step`, `totalSteps`, `title`, `description`,
  `difficulty`, `xp`, `state`, and optional `availableSince`, `isNew`,
  `lastFailure`, `requiredNode`, `requiredQuestTitle`, and `completedAt`.
- `GET /api/rewards/new` returns `hasNew` and `hasNewProgress`;
  `POST /api/rewards/seen` has no body and returns `204`.

### Player and progression

- `GET /api/player/progress` returns `totalXp`, `level`, `currentLevelXp`,
  `nextLevelXp`, `progressToNextLevel`, `remainingXp`, and `progressPercent`.
- `GET /api/player/progress-dashboard` returns `progress`, `lifetime`,
  `sportRecords`, `milestones`, `recentActivities`, and `questHistory`.
  `lifetime` has `distanceMeters`, `totalCollectibles`, and `totalFlowlines`;
  each sport record has `type`, `activityCount`, `distanceMeters`,
  `longestDistanceMeters`, and optional `highestElevationGainM`; milestones
  count `places`, `peaks`, `mountainPasses`, and `flowlines`. Recent activities
  include the activity history fields plus `xpPercentOfBest`; each quest-history
  item has `id`, `kind`, `title`, `difficulty`, `xp`, `completedAt`, and
  optional `chainTitle` and `activityId`.
- `GET /api/skill-tree` and `POST /api/skill-tree/unlock` return a skill-tree
  view with `isPremium`, `earnedPoints`, `spentPoints`, `balance`,
  `nextSkillPoint`, `stats`, and `nodes`. Each node has `id`,
  `name`, `description`, `sport`, `branch`, `tier`, `cost`, `premium`, `grant`,
  `prerequisites`, `layout`, `state`, `requirements`, `requirementsMet`, and
  `prerequisitesMet`, with optional `isNew` and `questChain`. Unlock accepts
  `{ nodeId }`; success is `201` for a new unlock or `200` for an existing one.
  `nextSkillPoint` has `level`, `xpRemaining`, and `progress`; each requirement
  has `metric`, `target`, `label`, `current`, and `met`. `stats` includes XP,
  level, per-sport distances/activity counts, longest distances, elevation,
  Flowline and collectible totals, and category counts. Category counts have
  `viewpoint`, `peak`, `castle`, `waterfall`, `place`, and `mountain_pass`.
- `GET /api/player/capabilities` returns `worldFilters`, `titles`, `badges`,
  and `lockedWorldFilters`; title and badge entries have `id` and `label`,
  locked filters have `id`, `nodeId`, and `nodeName`.
- `GET /api/player/profile` returns `displayName`, `progress`,
  `distanceMeters`, `activityCount`, `flowlineCount`, and `collectibles`
  (`totalCollectibles`, `discoveredCount`, `remainingCount`).

### Integrations

- `GET /api/integrations/strava` returns `status` (`disconnected`, `connected`,
  or `reconnect_required`) and optional `connectedAt`.
- `GET /api/integrations/strava/activities` returns `activities`, `limit`, and
  `journeyStartedAt`. Each activity has `id`, `activityType`, `hasRoute`,
  `beforeJourneyStart`, and optional `name`, `sportType`, `startDate`,
  `distanceMeters`, `movingTimeSeconds`, and `importedActivityId`.
- `POST /api/integrations/strava/authorize` returns `authorizationUrl`;
  `POST /api/integrations/strava/activities/:id/import` returns
  `ActivityImportResult`; `DELETE /api/integrations/strava` returns the updated
  connection status.

## App association files

Served by the app at exact paths, no redirects, `Content-Type: application/json`:

- `/.well-known/apple-app-site-association` — from `APPLE_APP_IDS`
  (comma-separated `<TeamID>.<bundle id>`); `applinks` and `webcredentials`.
- `/.well-known/assetlinks.json` — from `ANDROID_PACKAGE_NAME` and
  `ANDROID_SHA256_CERT_FINGERPRINTS`; returns `[]` until both are set.

No identifiers are committed; **placeholders to replace in deployment config**:
`APPLE_APP_IDS=TEAMID.world.staza.app`, `ANDROID_PACKAGE_NAME=world.staza.app`,
`ANDROID_SHA256_CERT_FINGERPRINTS=AA:BB:…`. HTTPS is terminated by Caddy
(`proxy/Caddyfile`); the app is only reachable via HTTPS in production.

## Review decisions

- **CORS / preflight:** not enabled. Native HTTP clients do not enforce CORS and
  send no preflight; the web app is same-origin. Do not add CORS headers.
- **Errors:** every API error is `{ error: string }`; invalid or revoked
  credentials are `401`, failed CSRF (cookie only) is `403`, unknown API paths `404`.
- **Versioning:** no URL versioning now. Changes to native-consumed endpoints
  must be additive; a breaking change requires introducing `/api/v2/…` for the
  affected route while keeping the old one until supported app versions expire.
- **Sessions:** reuse the existing `sessions` table (`kind = 'native'`,
  refresh hash columns); no parallel user/session model.

## MapLibre Native

`GET /api/world/basemap` (bearer) returns `{ styleUrl, attribution }`. The style
is the same one the web map uses, `BASEMAP_STYLE_URL` (default keyless
OpenFreeMap Liberty: `https://tiles.openfreemap.org/styles/liberty`), a standard
MapLibre style JSON with vector tile, sprite, and glyph sources that MapLibre
Native loads directly over HTTPS. No API key is required for the default; a
keyed provider must embed its key in the configured style URL. Show
`attribution` in the app UI. No extra hosting settings are needed besides
`BASEMAP_EXTRA_ORIGINS` for the web CSP when the style uses other hosts.
