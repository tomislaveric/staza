# localize-public-app-ui-and-routes

> **Current routing and language selection:** The original locale-prefixed
> routes and no-language-switcher decision below are superseded by
> [App host redirects and locale-neutral routes](../app-host-redirects-and-locale-neutral-routes/README.md).
> The app now uses shared locale-neutral paths and a cookie-backed language
> selector.

## Goal

Localize the public app interface in English and German, and make locale and
screen state explicit in app URLs. Preserve the existing visual design and
functionality while ensuring that the URL reflects the app state.

## Scope

- Translate all user-visible app UI text in `public/`, including authentication,
  navigation, page copy, controls, status and error messages, empty states, and
  accessibility labels.
- Keep implementation code, API responses, activity/content data, user-provided
  text, and developer-facing text untranslated.
- Use locale-prefixed, root-relative paths for app screens, with localized
  German slugs.
- Preserve the existing landing routes (`/` in English and `/de` in German) and
  update its calls to action to enter the matching locale's sign-in route.
- Do not add an in-app language switcher.

## Decisions

- Support English (`en`) and German (`de`).
- Explicit locale-prefixed URLs determine the interface language.
- For legacy app entry routes such as `/app` and `/sign-in`, choose the first
  supported browser language and fall back to English.
- Navigation and authentication transitions update the current URL so direct
  links, browser refresh, and back/forward navigation retain the corresponding
  screen.
- Do not translate API or user/content data.

## Route proposal

| Screen | English | German |
| --- | --- | --- |
| Sign in | `/en/sign-in` | `/de/anmelden` |
| Registration | `/en/register` | `/de/registrieren` |
| Home | `/en/home` | `/de/start` |
| Activities | `/en/activities` | `/de/aktivitaeten` |
| Activity detail | `/en/activities/:id` | `/de/aktivitaeten/:id` |
| World | `/en/world` | `/de/welt` |
| Progress | `/en/progress` | `/de/fortschritt` |
| Profile | `/en/profile` | `/de/profil` |
| Add activity | `/en/add-activity` | `/de/aktivitaet-hinzufuegen` |

## Implementation plan

1. Add a reusable English/German app translation catalog and locale-resolution
   helper, following the existing landing localization patterns where useful.
2. Localize visible app copy across authentication, navigation, app pages,
   dialogs, controls, statuses, errors, empty states, and accessible text.
3. Add locale-aware route parsing and navigation for direct links, refreshes,
   and browser history; update landing calls to action and redirect legacy app
   entry routes using browser language preferences.
4. Add focused tests for translation coverage, locale resolution,
   route-to-screen mapping, browser-language redirects, explicit-locale
   precedence, and preservation of landing behavior.

## Acceptance criteria

- App UI is fully available in English and German for all listed app screens
  and their user-visible states.
- An explicit `/en/...` or `/de/...` URL renders the corresponding language and
  screen; localized routes remain correct after refresh and browser navigation.
- Legacy app entry routes select German for a supported German browser
  preference and English otherwise.
- Landing page routes remain unchanged, and landing calls to action direct
  users to the sign-in route for the landing page's language.
- API paths, API/data content, user-provided text, authentication behavior, and
  the existing visual design remain unaffected.

## Validation

- Add and run focused tests covering both locale catalogs, app component
  translations, URL parsing and screen mapping, and legacy entry locale
  selection.
- Verify that existing landing localization tests continue to pass with the
  updated call-to-action destinations.
- Run the relevant test suite and build/type-check after implementation.
