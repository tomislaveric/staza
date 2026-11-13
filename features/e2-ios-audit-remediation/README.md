# e2-ios-audit-remediation

## Goal

Fix every checkbox finding of the E2 iOS audit (issue #65) on top of `e2-ios-app-screens-and-features`: bugs, the native Strava OAuth account-linking CSRF, improvements, test gaps, and documentation drift.

## Scope

In scope: all checkbox items of #65 (Bugs, Security, Improvements, Docs).

Out of scope (user decision):
- The unchecked "Missing vs web" parity list (pagination, replay speed/XP, World filters, quest start, Explore sport/GPX/abandon, Profile Strava/language, Share Extension). These are tracked in #66.
- UI/visual redesign.

## Decisions

- **Strava native OAuth fix:** the callback redirects `code` + `state` to `staza://strava`; the app completes the link via a bearer-authenticated `POST`, and the state is consumed only for the same player **and** session that created it. Revoked sessions are rejected.
- **Post-import lookup:** use `GET /api/activities/:id` instead of scanning the activity list.

## Implementation plan

### 1. Bugs (iOS)
- **Localization keys:** replace interpolated `Text("home.level \(…)")` / `LocalizedStringKey("addActivity.sport.\(…)")` with lookups of the translated keys (`home.level`, `home.xp`, `home.remaining`, `home.quest.reward`, `addActivity.sport.cycling|running|hiking`). Remove the untranslated `%@` keys from `Localizable.xcstrings` and clear their stale state.
- **Idempotency-Key:** generate a new key for each selected file instead of once per `AddActivityModel`.
- **Shared `.fit` while busy:** keep the pending import queued and consume it once the current upload finishes.
- **Inspect failure:** surface a notice when `/api/activities/inspect` fails; the user can still choose a sport manually.
- **Post-import lookup:** fetch `GET /api/activities/:id` after a 200/201 import.
- **Replay head marker:** clear the head when the traveled path is empty.
- **Deprecation:** replace `setVisibleCoordinateBounds(_:edgePadding:animated:)` with the non-deprecated camera API.

### 2. Security — native Strava OAuth
- Callback: for a valid native state, do not exchange the code; redirect to `staza://strava?code=…&state=…&scope=…`. Denied or missing-scope results redirect with `outcome=…`.
- New `POST /api/integrations/strava/native/complete` (bearer only, rate-limited): consumes the native state bound to the caller's player and session (session must still be active), then exchanges the code and saves the connection.
- iOS `StravaImportModel.connect()` parses the callback and posts `code`/`state`/`scope` to the new endpoint.
- Tests: service and repository tests for session-bound consumption, wrong-session rejection, denied/missing-scope native callbacks, callback redirect, and native state persistence (migration `040`); iOS `StravaImportModelTests`.

### 3. Improvements
- **Cross-tab refresh:** a shared invalidation signal in `AppContainer`, bumped on import, unlock, and exploration confirm; Home, Progress, and Activities reload when it changes.
- **Streaming upload:** write the multipart body to a temporary file and upload with `uploadTask(fromFile:)`; pass file URLs rather than `Data`.
- **ReplayModel.play():** no longer retains `self` strongly for the lifetime of the loop.
- **Test gaps:** auth resend/error paths, expired step-up on delete, logout failure, concurrent 401 refresh (single refresh), stale viewport responses, per-file idempotency, share-while-busy.

### 4. Docs
- Feature README for `e2-ios-app-screens-and-features` and its root index entry.
- `api-spec.md`: native Strava flow (`client: "native"`, `staza://strava` redirect, completion endpoint); exploration `area.bbox` is a comma-separated string.
- `ios/README.md`: current layout and Strava URL scheme / `.fit` document type configuration.

### 5. Follow-up
- File a GitHub issue for the "Missing vs web" parity gaps.

## Acceptance criteria

- No raw localization keys are rendered on Home, Quest list, or the Add Activity sport picker.
- Each imported file uses its own Idempotency-Key; a file shared during an upload is imported afterwards.
- A victim approving an attacker-started Strava authorization cannot link to the attacker's account.
- Home, Progress, and Activities reflect imports, unlocks, and confirmed explorations without manual reload.
- All listed tests exist and pass; documentation matches behavior.

## Validation

- `xcodebuild test` for the iOS app (no deprecation warning from the replay map).
- `npx tsc --noEmit`, `npm test`, and `npm run test:persistence` where a test database is available.
