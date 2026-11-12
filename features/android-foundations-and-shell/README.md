# android-foundations-and-shell

## Goal

Establish the native Android project and shared foundations for Staza in
`/android`, with a buildable Jetpack Compose application shell ready for later
feature screens.

## Scope

This feature covers Android foundations epic #4 and its six sub-issues:

- **#38 — Compose scaffold:** create a Gradle project and app structure with a
  documented minimum SDK and application ID, and launch a placeholder screen.
- **#39 — Networking:** configure development/production API URLs, attach bearer
  credentials, decode the standard `{ "error": "..." }` envelope into typed
  errors, and handle unauthorized requests.
- **#40 — Session and auth state:** securely persist credentials, expose
  observable signed-in/signed-out state and the current user from
  `/api/auth/session`, and clear credentials on sign-out or unrecoverable
  authorization failure.
- **#41 — Design system:** define Material 3 color, typography, shape, and
  spacing tokens, including dynamic color, light/dark appearance, and font
  scaling.
- **#42 — App shell:** provide native bottom navigation for Home, World, Skill
  Atlas, Progress, and More/Profile, plus a prominent Add Activity action.
- **#43 — Localization:** add English and German resources with locale-aware
  number, date, and distance formatting.

Feature-screen contents and authentication UI are out of scope; destinations
remain placeholders. Backend changes are out of scope.

## Decisions

- **Platform:** Kotlin and Jetpack Compose in the monorepo's `/android` folder.
- **Minimum SDK:** API 29 (Android 10).
- **Application ID:** `world.staza.app`, matching the iOS app identifier.
- **Networking:** Retrofit with OkHttp bearer-token interception and typed API
  error mapping.
- **Unauthorized requests:** refresh and rotate credentials, retry the failed
  request at most once, then clear the session and publish signed-out state if
  refresh fails or the retry remains unauthorized. This matches the iOS client.
- **Secure storage:** encrypted DataStore with key material protected by Android
  Keystore.
- **Navigation:** Material 3 `NavigationBar` with Navigation-Compose; use a
  prominent Add Activity action, preferring a FAB unless the shell layout calls
  for a top-app-bar action.
- **Localization:** Android English/German resources and locale-aware formatting
  helpers.
- Align client request and response assumptions with
  `features/e0-backend-enablement-for-native-clients/api-spec.md`.

## Implementation plan

1. Create `/android` Gradle settings and app module, Compose entry point,
   package/resource structure, API 29 configuration, application ID, and a
   launchable placeholder; document build/run instructions.
2. Add development and production base URL configuration and implement the
   Retrofit/OkHttp client, bearer injection, typed `{ error }` mapping, and
   single-refresh/single-retry unauthorized handling.
3. Implement encrypted credential persistence and observable auth/session state,
   including current-user session lookup, logout, and unrecoverable-401 behavior.
4. Define Material 3 color, typography, shape, and spacing tokens, with dynamic
   color and light/dark appearance; demonstrate them in a font-scalable sample.
5. Add English and German string resources and locale-aware number, date, and
   distance formatting; demonstrate localized values in a sample screen.
6. Compose the five-destination navigation shell, placeholder screens, and Add
   Activity action using the theme and localized labels.
7. Add focused tests and verify the Gradle build and issue acceptance criteria.

## Acceptance criteria

- `/android` builds with Gradle and launches to a placeholder Compose screen.
- A request helper performs GET and POST, attaches a bearer token, maps API error
  envelopes to typed errors, and handles a 401 through the configured
  refresh/retry policy.
- Credentials persist securely across launches; sign-out clears them, and
  observable auth state reflects session changes.
- A sample screen demonstrates the Material 3 theme in light and dark modes and
  respects system font scaling.
- A Material `NavigationBar` switches among the placeholder destinations; there
  is no custom tab bar.
- A sample screen renders English and German strings and locale-aware values.

## Constraints

- Keep backend behavior and API contracts unchanged; the native bearer API is
  the prerequisite.
- Keep authentication UI and per-screen feature implementation for later Android
  work.
- Follow Android-native Material 3 patterns while reusing the existing iOS
  client's networking, session, and localization behavior where applicable.

## Validation

- Run the Gradle build and focused unit tests for networking, credential/session
  behavior, formatting, and localization.
- Launch in an Android emulator and verify placeholder startup, bottom
  navigation, Add Activity action, light/dark appearance, and font scaling.
- Confirm each acceptance criterion for #38–#43 before considering the
  foundations epic complete.
