# e0-backend-enablement-for-native-clients

## Goal

Enable the existing backend to support native iOS and Android clients alongside
the web application, without changing web cookie authentication behavior.

## Scope

- Accept bearer session credentials in authenticated API requests.
- Return native bearer credentials from passkey registration/login and
  email-code registration/login.
- Support short-lived access credentials with refresh-token rotation, logout,
  and logout-all.
- Host Apple App Site Association and Android Digital Asset Links files.
- Review CORS/preflight assumptions, error response consistency, and API
  versioning; document the resulting decisions.
- Document native-consumed auth, account, activities, world/game, player, and
  integration endpoints, including methods, auth requirements, and consumed
  request/response fields.
- Expose a MapLibre Native-compatible style and basemap source, reusing the web
  map style and documenting required keys/configuration.

## Decisions

- Native authentication responses are explicitly opted into with a request
  header. Existing web requests continue to use their current cookie flow.
- Use a short-lived access credential and refresh-token rotation for native
  sessions. Refresh credentials must be persisted securely, expire, rotate on
  use, and reject replay; logout revokes the presenting session and logout-all
  revokes every session for that user.
- App identifiers and Android signing fingerprints are configurable. Until
  final production values are supplied, use documented placeholders rather
  than hard-coded values.
- API versioning is a review decision: document the chosen strategy and only
  introduce versioning changes if compatibility requires them.
- Reuse existing database-backed sessions and authentication primitives where
  practical; do not introduce a parallel user/session model.

## Implementation plan

1. Extend request authentication to accept `Authorization: Bearer` while
   preserving cookie auth. Verify invalid, expired, and revoked credentials
   fail protected requests.
2. Add explicit native opt-in to passkey and email-code register/login flows.
   Return usable bearer credentials to native callers and preserve existing
   web responses.
3. Implement native access-token expiry and refresh-token rotation, including
   persistence, replay protection, current-session logout, and logout-all.
4. Serve the AASA and `assetlinks.json` files at their exact `/.well-known/`
   paths with required content types and no redirect. Wire configurable
   identifiers and document placeholder setup.
5. Review native access, CORS/preflight assumptions, common `{ error: string }`
   error responses, and API versioning; make and document the versioning
   decision.
6. Publish an API spec covering every native-consumed endpoint with method,
   authentication, request fields, and response fields.
7. Verify or expose a stable MapLibre Native-compatible style URL or style
   JSON and basemap/tile sources; document required keys and hosting settings.
8. Add focused regression tests and run the relevant backend tests.

## Acceptance criteria

- A valid bearer credential authenticates the same user as the cookie path;
  invalid, expired, revoked, or replayed credentials are rejected.
- Native passkey and email-code registration/login return usable credentials
  only for explicitly opted-in native requests; web behavior is unchanged.
- Refresh rotates credentials, and logout/logout-all prevent subsequent use as
  specified.
- Both association files are served at the required paths over HTTPS with
  correct content types and no redirects, using configurable values.
- Native-consumed endpoints have a documented auth and data contract, with
  consistent error behavior and a recorded API versioning decision.
- Native MapLibre can load the documented style and basemap source.
- Focused tests cover these behaviors and the existing backend suite passes.

## Constraints

- Preserve backward compatibility for existing web authentication and API
  clients.
- Keep secrets, bundle/package identifiers, and signing fingerprints out of
  source defaults; use deployment configuration for environment-specific
  values.
- Do not duplicate server-owned business logic in native clients or create a
  second session model.

## Validation

- Add unit/integration coverage for bearer authentication, native-vs-web auth
  response behavior, refresh rotation/replay/revocation, association-file
  delivery, API error/versioning behavior, and MapLibre style/source access.
- Run the existing targeted backend tests and the broader backend test command
  if targeted checks reveal cross-cutting changes.
- Verify association endpoints' status, content type, and redirect behavior,
  and check that the documented native style/source is reachable.
