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
| POST | `/api/auth/passkeys/login/options` | none | – | WebAuthn authentication options |
| POST | `/api/auth/passkeys/login/verify` | none | WebAuthn `AuthenticationResponseJSON` (+ native header) | `{ user: { email, emailVerified }, csrfToken, credentials }` |
| POST | `/api/auth/native/refresh` | none (refresh token) | `{ refreshToken }` | `{ credentials }`; `401` if invalid, expired, revoked, or replayed |
| GET | `/api/auth/session` | optional | – | `{ authenticated, user?, csrfToken?, devTools? }` |
| POST | `/api/auth/logout` | bearer | – | `204`; revokes the presenting session |
| POST | `/api/auth/logout-all` | bearer | – | `204`; revokes every session of the user |
| POST | `/api/auth/passkeys/register/options` | bearer | – | WebAuthn registration options |
| POST | `/api/auth/passkeys/register/verify` | bearer | WebAuthn `RegistrationResponseJSON` + optional `name` | `204` |
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

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/activities` | bearer | Player's activity list |
| GET | `/api/activities/summary` | bearer | Aggregated totals |
| GET | `/api/activities/:id` | bearer | Activity detail incl. replay snapshot |
| POST | `/api/activities/import` (+ the sibling upload routes) | bearer | `multipart/form-data` with the FIT/GPX/etc. file; returns `202 { token }` for job polling or `409 { error, code }` on duplicate |
| GET | `/api/jobs/:token`, `/api/jobs/:token/activity` | bearer | Import job status / resulting activity |

## World / game

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/world/basemap` | bearer | `{ styleUrl, attribution }` (see MapLibre) |
| GET | `/api/world?bbox=west,south,east,north` | bearer | Collectibles, quests, flowlines in the viewport |
| GET | `/api/world/quest-targets` | bearer | Quest target geometry |
| GET | `/api/quest-instances` | bearer | Player's quest instances |
| POST | `/api/quest-instances/:id/retry`, DELETE `/api/quest-instances/:id` | bearer | Mutations |
| POST | `/api/explorations/generate`, `/:id/reroute`, `/confirm` | bearer | Route planning |
| GET | `/api/quest-instances/:id/planned-route` (`.gpx`) | bearer | Planned route |
| GET | `/api/skill-tree`, POST `/api/skill-tree/unlock` | bearer | Atlas |
| GET | `/api/authored-quests` | bearer | `{ quests }` |
| GET | `/api/rewards/new`, POST `/api/rewards/seen` | bearer | `{ hasNew, hasNewProgress }` |

## Player

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/player/progress` | bearer | XP / level |
| GET | `/api/player/progress-dashboard` | bearer | Dashboard data |
| GET | `/api/player/capabilities` | bearer | Feature capabilities |
| GET | `/api/player/profile` | bearer | Profile |

## Integrations (Strava)

Disabled unless configured server-side (`503`-style `{ error }` otherwise).

| Method | Path | Auth | Request / Response |
| --- | --- | --- | --- |
| GET | `/api/integrations/strava` | bearer | Connection status |
| POST | `/api/integrations/strava/authorize` | bearer | `{ authorizationUrl }`; open in a system browser |
| DELETE | `/api/integrations/strava` | bearer | Disconnect |
| GET | `/api/integrations/strava/activities` | bearer | Recent Strava activities |
| POST | `/api/integrations/strava/activities/:id/import` | bearer | Import one activity |

The OAuth callback (`/api/integrations/strava/callback`) is a browser redirect
that relies on the cookie session, so native apps must complete it in a browser
session that is signed in on the web, or re-authenticate there.

Field-level shapes for the data endpoints are defined by the server types in
`src/` (e.g. `src/domain.ts`, `src/world.ts`) and are unchanged by this feature.

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
