# Staza iOS

Native SwiftUI app shell. Open `Staza.xcodeproj` in Xcode 16+.

- **Minimum iOS:** 17.0 (Observation framework, `.xcstrings` catalogs)
- **Bundle identifier:** `world.staza.app` (tests: `world.staza.app.tests`)
- **Dependencies:** none (Swift Package Manager ready; nothing to resolve yet)

## Layout

- `Staza/App` – entry point and composition root (`AppContainer`)
- `Staza/Features` – per-tab placeholder screens and the `TabView` shell
- `Staza/Core/Networking` – async/await `APIClient`, `TokenProvider` boundary
- `Staza/Core/Auth` – Keychain credentials, `SessionManager`, observable `AuthState`
- `Staza/Core/Formatting` – locale-aware number/date/distance formatting
- `Staza/DesignSystem` – color, type, spacing tokens and shared components
- `Staza/Resources` – `Localizable.xcstrings` (en, de) and assets

## Configuration

Debug builds use `http://localhost:3000`, release builds `https://play.staza.world`.
Override with the `STAZA_API_BASE_URL` environment variable.

## Auth notes

Requests send `X-Staza-Client: native` and `Authorization: Bearer`. On a 401 the
client refreshes via `POST /api/auth/native/refresh` (rotating stored credentials)
and retries once. A failed refresh, or a still-unauthorized retry, clears the Keychain and
publishes signed-out state.

## Tests

```
xcodebuild test -project Staza.xcodeproj -scheme Staza \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```
