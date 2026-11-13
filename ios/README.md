# Staza iOS

Native SwiftUI app shell. Open `Staza.xcodeproj` in Xcode 16+.

- **Minimum iOS:** 17.0 (Observation framework, `.xcstrings` catalogs)
- **Bundle identifier:** `world.staza.app` (tests: `world.staza.app.tests`)
- **Dependencies:** MapLibre Native (SPM, `maplibre-gl-native-distribution` 6.31.0) for the activity replay map

## Layout

- `Staza/App` – entry point and composition root (`AppContainer`)
- `Staza/Features` – feature screens: `Shell` (`TabView`), `Auth`, `Home`, `World` (map, Explore), `Quests`,
  `SkillAtlas`, `Progress`, `Activities` (detail, replay), `AddActivity` (`.fit` import), `StravaImport`,
  `Profile`, and `More`
- `Staza/Core/Networking` – async/await `APIClient`, `TokenProvider` boundary
- `Staza/Core/Auth` – Keychain credentials, `SessionManager`, observable `AuthState`
- `Staza/Core/Formatting` – locale-aware number/date/distance formatting
- `Staza/DesignSystem` – color, type, spacing tokens and shared components
- `Staza/Resources` – `Localizable.xcstrings` (en, de) and assets

## Configuration

Debug builds use `http://localhost:3000`, release builds `https://play.staza.world`.
Override with the `STAZA_API_BASE_URL` environment variable.

## URL scheme and document types

- **Strava:** `ASWebAuthenticationSession` uses the `staza` callback scheme (`staza://strava`). The
  scheme does not need to be registered in `Info.plist`. The app finishes linking with
  `POST /api/integrations/strava/native/complete`.
- **`.fit` files:** `Staza-Info.plist` declares the imported type `world.staza.app.fit`
  (extension `fit`, MIME `application/vnd.ant.fit`) and a viewer document type. Files from
  open-with and the share sheet arrive through `onOpenURL` and are staged by `AppContainer.receive`.
  Picked and shared files are copied to `tmp/fit-imports` and uploaded as a streamed multipart file
  (`URLSession.upload(fromFile:)`), using one `Idempotency-Key` per selected file.
- **Data refresh:** mutations call `AppContainer.playerDataChanged()`, and screens reload with
  `.task(id: container.dataRevision)`.

## Auth notes

Requests send `X-Staza-Client: native` and `Authorization: Bearer`. On a 401 the
client refreshes via `POST /api/auth/native/refresh` (rotating stored credentials)
and retries once. A failed refresh, or a still-unauthorized retry, clears the Keychain and
publishes signed-out state.

## Tests

```
xcodebuild test -project Staza.xcodeproj -scheme Staza \
  -destination 'platform=iOS Simulator,name=<available iPhone simulator>'
```
