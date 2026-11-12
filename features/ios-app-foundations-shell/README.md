# ios-app-foundations-shell

## Goal

Establish the native iOS project and shared foundations for Staza in `/ios`, with a buildable SwiftUI app shell ready for later feature screens.

## Scope

- **#16 — SwiftUI scaffold:** create an Xcode project using Swift Package Manager, document the minimum iOS target and bundle identifier, establish App, Features, Core/Networking, DesignSystem, and Resources areas, and launch a placeholder view.
- **#17 — Networking:** implement an async/await JSON client with development/production base URL configuration, bearer-token injection, typed decoding for the standard `{ "error": "..." }` envelope, GET/POST support, and 401 handling.
- **#18 — Session and auth state:** securely store native session credentials in Keychain, expose observable signed-in/signed-out state and the current user from `/api/auth/session`, and clear the session on logout or unrecoverable authorization failure.
- **#19 — Design system:** define reusable color, typography, and spacing tokens aligned with the web design language, supporting light/dark appearance and Dynamic Type.
- **#20 — App shell:** use the system `TabView` with Home, World, Skill Atlas, Progress, and More/Profile destinations; give each tab a `NavigationStack` and provide a prominent Add Activity action.
- **#21 — Localization:** add English and German string catalogs and locale-aware number, date, and distance formatting.

## Decisions and constraints

- Implement automatic refresh using `POST /api/auth/native/refresh`: persist access and refresh credentials securely, rotate credentials on refresh, and retry the failed authenticated request at most once. If refresh fails or the retry remains unauthorized, clear the session and expose signed-out state.
- Treat E0 backend bearer support as a prerequisite and align client assumptions with `features/e0-backend-enablement-for-native-clients/api-spec.md`; backend changes are not in scope.
- Keep authentication UI, feature-screen contents, and custom tab-bar UI out of scope.
- Use a token-provider boundary and dependency injection to avoid a circular dependency between session bootstrap and authenticated networking.
- Choose and document the minimum iOS deployment target during scaffolding; keep dependencies minimal and use Swift Package Manager.
- Adapt the web tokens, navigation labels, and English/German terms to iOS Human Interface Guidelines rather than copying web layouts.

## Implementation plan

1. Create the `/ios` SwiftUI app scaffold, source/resource structure, and buildable placeholder.
2. Add design tokens and localization resources, each demonstrated by a small sample view.
3. Implement secure credential storage and observable auth state, then inject the token provider into the typed API client.
4. Compose the native tabs and per-tab navigation with localized labels and design-system styles.
5. Add focused tests and verify the project and acceptance criteria.

## Acceptance criteria

- The iOS project builds in Xcode and launches to a placeholder screen.
- A typed GET/POST request helper sends bearer credentials and surfaces decoded API errors.
- Session credentials persist securely across launches; logout or unrecoverable refresh/401 clears them and views react to auth-state changes.
- A reusable sample view works in light and dark appearance and scales with Dynamic Type.
- The native tab bar switches among placeholder destinations using system navigation; no custom tab bar is used.
- A sample screen renders in English and German with locale-aware values.

## Validation

- Build the iOS app in Xcode and launch it in a simulator.
- Add focused tests for bearer attachment, error-envelope decoding, refresh/rotation and single retry, refresh failure/sign-out, and session state.
- Verify tab switching and per-tab navigation, English/German strings and formatting, light/dark appearance, and Dynamic Type using the sample views.
