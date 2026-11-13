# E2 — iOS app screens and features

## Goal

Build the native SwiftUI screens on top of the E1 iOS foundations, so the iOS app
reaches the core web feature set: sign-in, dashboards, activities with replay,
the world map, exploration, skills, profile, and activity import.

## Scope

| Issue | Area | iOS location |
| --- | --- | --- |
| #22 | Passkey sign-in and register (ASAuthorization) | `Features/Auth`, `Core/Auth` |
| #23 | Email-code sign-in/register fallback and step-up | `Features/Auth` |
| #24 | Home dashboard (level, XP, quests) | `Features/Home` |
| #25 | Activities list | `Features/Activities` |
| #26 | Activity detail shell and sub-tabs | `Features/Activities` |
| #27 | Activity replay animation (MapLibre) | `Features/Activities` (`ReplayModel`, `ReplayMapView`) |
| #28 | World map with collectible layers | `Features/World` |
| #29 | Collectible and quest detail sheets, quest list | `Features/World`, `Features/Quests` |
| #30 | Explore this Area (generate, reroute, confirm) | `Features/World` (`ExploreModel`, `ExplorePanel`) |
| #31 | Skill Atlas and unlock | `Features/SkillAtlas` |
| #32 | Progress dashboard and rewards | `Features/Progress` |
| #33 | Profile and account management (export, delete with step-up) | `Features/Profile`, `Features/More` |
| #34 | Add Activity: `.fit` file picker upload | `Features/AddActivity` |
| #35 | Add Activity: share sheet / open-with `.fit` | `App/StazaApp.swift` (`onOpenURL`), `App/AppContainer.swift` |
| #36 | Strava import (ASWebAuthenticationSession) | `Features/StravaImport` |

Out of scope: the web features listed as "Missing vs web" in the E2 audit (#65).
They are tracked separately.

## Decisions

- All screens use the shared `APIClient` with bearer sessions (`X-Staza-Client: native`)
  and the endpoints documented in
  [the E0 API spec](../e0-backend-enablement-for-native-clients/api-spec.md).
- Strings live in `Localizable.xcstrings` (en, de). Interpolated strings are keyed by
  their interpolated form (for example `home.level %@`) and translated on those keys.
- `.fit` files arriving through the picker, the share sheet, or open-with are copied
  into app-owned temporary storage. They are uploaded as a streamed multipart file,
  with one idempotency key per selected file.
- Strava connect uses `ASWebAuthenticationSession` with the `staza` callback scheme.
  The account link is completed by a bearer-authenticated
  `POST /api/integrations/strava/native/complete`, never by the browser callback alone.
- After a mutation (import, skill unlock, exploration confirm), `AppContainer.playerDataChanged()`
  bumps `dataRevision`, and Home, Progress, Activities, and Skill Atlas reload.

## Acceptance criteria

- Each listed screen loads live data, shows loading, empty, and error states, and is
  localized in English and German.
- Account deletion and data export require fresh step-up authentication.
- Imported activities show up in Activities and update Home and Progress without
  restarting the app.

## Validation

```
cd ios && xcodebuild test -project Staza.xcodeproj -scheme Staza \
  -destination 'platform=iOS Simulator,name=<available iPhone simulator>'
```

The audit remediation for this feature is documented in
[E2 iOS audit remediation](../e2-ios-audit-remediation/README.md).
