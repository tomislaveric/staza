# app-host-redirects-and-locale-neutral-routes

## Goal

Make the application hosts open the app instead of the marketing landing page,
and use the same URLs for English and German while allowing a persistent
language preference.

## Scope

- On `localhost:3000`, `dev.play.staza.world`, and `play.staza.world`, route `/`
  into the app at `/home`.
- Keep the separately deployed `staza.world` landing page unchanged.
- Use locale-neutral paths for app screens, including `/home`, `/sign-in`,
  `/register`, `/activities`, `/activities/:id`, `/world`, `/skill-tree`,
  `/progress`, `/profile`, and `/add-activity`.
- Add a language selector for English and German in the user's Profile (with
  a flag in front of each language, no selector in the sidebar or auth screens), persisting the
  selected locale in a cookie.
- Use browser language as the first-visit fallback and English when no
  supported browser language is available.
- Keep the selected English/German landing-page language when a CTA opens the
  app by sharing the locale cookie across `staza.world` subdomains.
- Check internal landing-page navigation and asset URLs for relative,
  same-origin references.

## Decisions

- Remove `/en/...` and `/de/...` route handling. The app is in DEV, so do not
  add compatibility redirects for the old locale-prefixed URLs.
- A cookie preference takes precedence over browser language; a new selector
  choice updates the preference and immediately localizes the current screen.
- Landing-page CTAs open the matching DEV/PROD app host and apply the landing
  page's current language through the shared locale cookie.
- “Relative landing-page links” means internal navigation and asset URLs.
  Preserve external destinations and absolute canonical/hreflang SEO metadata.
- Unauthenticated users may still be directed to `/sign-in` by the existing
  authentication flow, but app hosts must not show the marketing landing page.
- Do not change API behavior, app screen functionality, or the separate
  marketing landing deployment.

## Implementation plan

1. Refactor app route parsing and navigation to shared, locale-neutral paths;
   remove locale prefixes and German-specific route slugs.
2. Add a language selector and persist its choice in a locale cookie. Resolve
   the initial locale from that preference, falling back to browser language
   and then English.
3. Change the app server's `/` route to enter `/home`.
4. Inspect and correct internal landing-page navigation and asset URLs, while
   preserving external destinations and canonical/hreflang metadata.
5. Add focused tests for route parsing, locale preference and fallback,
   app-root behavior, landing internal links, and landing deployment isolation.
   Update route/localization documentation.

## Acceptance criteria

- Opening `/` on localhost and either `play.staza.world` host enters the app
  at `/home`, not the marketing landing page.
- `staza.world` continues serving its separate English/German landing pages.
- English and German use identical app URLs and render the same requested
  screen in the selected language.
- A saved cookie preference wins over browser language; on a first visit,
  supported browser language is used, otherwise English.
- Landing-page CTAs open the matching app stage with the landing page's
  language selected.
- Old locale-prefixed routes are no longer supported.
- Internal landing navigation/assets remain same-origin relative references;
  external destinations and SEO canonical/hreflang URLs remain intact.
- Authentication and API behavior are unchanged.

## Constraints

- Store only the non-sensitive locale preference in the cookie.
- Keep changes limited to routing, locale selection/persistence, app-host root
  behavior, relevant landing URLs/tests, and associated documentation.

## Validation

- Run focused Vitest tests covering locale-neutral routes, preference cookie
  and browser fallback, root route behavior, landing-page internal URLs, and
  preservation of the separate landing deployment.
- Run the TypeScript build.
