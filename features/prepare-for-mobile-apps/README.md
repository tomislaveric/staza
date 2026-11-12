# prepare-for-mobile-apps

## Goal

Prepare native **iOS (Swift/SwiftUI)** and **Android (Kotlin/Jetpack Compose)**
clients that are feature-complete with the existing server-driven web app. The
clients stay "thin": they render server-owned data and keep only
presentation/interaction logic, leaning on OS-native navigation and components
(system tab bars, navigation stacks, pickers, share sheets) while respecting
Apple Human Interface Guidelines and Material 3. iOS and Android may differ
visually and keep their platform feel.

This feature is **preparation**: gather all needed information and reflect the
full program of work on the GitHub Issues board as small, well-scoped issues
(sized for a small model), grouped into epics with labels and milestones.

## Decisions

- **Stack:** iOS = Swift/SwiftUI; Android = Kotlin/Jetpack Compose.
- **Code location:** monorepo folders `/ios` and `/android` in `tomislaveric/locus`.
- **Auth:** add a bearer-token session API for native clients plus native passkey
  and email-code flows (backend work included). The existing web cookie flow is
  left unchanged.
- **Maps:** MapLibre Native on both platforms, reusing the existing web vector
  style and collectible layering concept.
- **v1 scope (both platforms, feature-complete):** auth, home, activities list +
  detail, replay, world map, explore-this-area, skill atlas, progress, profile +
  account management, add activity (FIT upload), Strava import. **Video highlight
  is out of v1.**
- **Activity input:** device file picker (.fit), Strava import, Apple Health /
  Health Connect, and share-sheet / open-with .fit.
- **GitHub board:** create new labels, phase-based milestones, and epic tracking
  issues that link their sub-issues. No GitHub Project v2 board.
- **Backend issues:** include backend changes required to support native clients,
  not just client issues.

## Scope

In scope: the full native client program for both platforms covering the v1
feature set above, plus the backend enablement (token auth, native passkey/email
endpoints, associated-domains / asset-links, API docs, map style access) and
release-readiness work (icons, accessibility, CI, store metadata, QA).

Out of scope: GoPro highlight video on mobile; a GitHub Project v2 board;
re-implementing server-owned business logic on device (new derived/aggregate data
is added server-side, consistent with the existing "Make UI Stupid" initiative).

## Existing API surface reused by native

- Auth: `/api/auth/register/code|verify`, `/api/auth/email-code/request|verify`,
  `/api/auth/passkeys/login/options|verify`, `/api/auth/passkeys/register/options|verify`,
  `/api/auth/session`, `/api/auth/logout|logout-all`, `/api/auth/step-up/email/*`.
- Account: `/api/account/export|deletion-intent|delete`.
- Activities: `GET /api/activities`, `/api/activities/summary`, `GET /api/activities/:id`.
- World/game: `/api/world`, `/api/world/basemap`, `/api/world/quest-targets`,
  `/api/quest-instances*`, `/api/explorations/generate|reroute|confirm`,
  `/api/authored-quests`, `/api/rewards/new|seen`.
- Player: `/api/player/progress`, `/api/player/progress-dashboard`,
  `/api/player/capabilities`, `/api/player/profile`, `/api/skill-tree`,
  `POST /api/skill-tree/unlock`.
- Integrations: `/api/integrations/strava*`.

The current session transport is an httpOnly cookie (`src/server.ts`). Web
passkeys use `@simplewebauthn`. Native requires bearer tokens plus platform
passkey/credential APIs. Primary navigation mirrors
`public/components/sidebar.js`: primary = home, world, skill-tree, progress;
secondary = activities, profile; plus an Add Activity action.

## Implementation plan (GitHub board structure)

**Labels:** `mobile`, `ios`, `android`, `backend`, `epic`, `auth`, `maps`,
`design-system`, `activity-input` (reuse existing `enhancement`, `documentation`,
`accessibility`, `good first issue`).

**Milestones (phases, shared by both platforms):**
- `M1 — Backend enablement`
- `M2 — App foundations`
- `M3 — Auth & onboarding`
- `M4 — Core read screens`
- `M5 — Maps & gamification`
- `M6 — Activity input`
- `M7 — Release readiness`

**Epic tracking issues (label `epic`):**
- E0 Backend enablement for native clients (`backend`)
- E1 iOS app — foundations & shell (`ios`)
- E2 iOS app — screens & features (`ios`)
- E3 Android app — foundations & shell (`android`)
- E4 Android app — screens & features (`android`)
- E5 Cross-platform release readiness (`mobile`)

**Sub-issues (one screen/concern each):**

E0 — Backend enablement (M1): bearer-token session middleware; native passkey
register endpoints returning a token; native passkey login endpoints; native
email-code register + login endpoints; token refresh + revoke; Apple App Site
Association + Android `assetlinks.json` hosting; CORS / error-envelope / API
versioning review; OpenAPI/markdown spec + `features/` doc; MapLibre style /
basemap access for native.

E1 — iOS foundations (M2): Xcode/SwiftUI scaffold in `/ios`; networking layer
with bearer injection; Keychain session storage + auth manager; design tokens
(light/dark, Dynamic Type); app shell with system `TabView` + `NavigationStack`;
localization scaffolding (en/de).

E2 — iOS screens (M3–M6): passkey sign-in/register (`ASAuthorizationController`);
email-code fallback + step-up; home dashboard; activities list; activity detail
shell + sub-tabs; replay animation; World map (MapLibre Native); collectible/quest
detail + quest list; Explore this Area; Skill Atlas + unlock; progress dashboard +
rewards; profile + account management; Add Activity file picker upload;
share-sheet / open-with `.fit`; Strava import (`ASWebAuthenticationSession`);
Apple Health import.

E3 — Android foundations (M2): Compose/Gradle scaffold in `/android`; networking
layer with bearer interceptor; secure session storage (EncryptedSharedPreferences
/ DataStore) + auth state; Material 3 theme / design tokens; app shell with
`NavigationBar` + Navigation-Compose; localization scaffolding (en/de).

E4 — Android screens (M3–M6): passkey sign-in/register (Credential Manager);
email-code fallback + step-up; home dashboard; activities list; activity detail
shell + sub-tabs; replay animation; World map (MapLibre Native Android);
collectible/quest detail + quest list; Explore this Area; Skill Atlas + unlock;
progress dashboard + rewards; profile + account management; Add Activity picker
upload (Storage Access Framework); share/open-with `.fit`; Strava import (Custom
Tabs + deep link); Health Connect import.

E5 — Release readiness (M7): app icons, splash/launch and adaptive icons;
accessibility pass (VoiceOver/TalkBack, Dynamic Type/font scaling, contrast); CI
workflows building and testing `/ios` and `/android`; store metadata prep
(App Store + Play, privacy/data-safety); manual QA checklist / smoke matrix.

Each sub-issue body includes context, the exact endpoint(s) to consume, expected
response/field list, OS-native UI/UX notes (HIG / Material 3), acceptance
criteria, and out-of-scope notes, so a small model can complete it.

## Acceptance criteria

- New labels, 7 phase milestones, and 6 epic tracking issues exist on
  `tomislaveric/locus`.
- Every sub-issue in the breakdown exists, carrying the correct platform label,
  `mobile`, relevant topical label, and milestone, with a self-contained body.
- Each epic issue links its sub-issues as a checklist.
- The board collectively reflects the full v1 program for both platforms, with
  backend enablement and release readiness included, and no time/date estimates.

## Validation

- Verify labels, milestones, and issues via `gh` (list/view) after creation.
- Confirm each epic body links the created sub-issue numbers.
- Confirm milestone and label assignments on a sample of sub-issues across both
  platforms.
