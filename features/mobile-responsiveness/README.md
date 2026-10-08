# mobile-responsiveness

## Goal

Make the authenticated Staza app and its sign-in/authentication screens usable on mobile devices through focused responsive layout changes that preserve the existing visual language and avoid unnecessary UI hierarchy.

## Scope

- Cover the authenticated app shell and its Home, Activities, Activity Detail, Progress, Add Activity/processing, Profile, and World/map views.
- Review sign-in and authentication screens for narrow-screen overflow and usability.
- Keep the public landing page out of scope; it is already responsive.

## Decisions

- On narrow screens, show the five existing primary destinations in a compact bottom navigation.
- Keep Add Activity as a separate, easy-to-reach action rather than making it a sixth navigation destination.
- Keep `src/landing/locales.ts` where it is. `src/server.ts` imports it to render English and German landing pages; moving it into static public assets would require changing server runtime/build handling and is not needed for this work.

## Implementation plan

1. Make the app shell responsive: add the mobile bottom navigation, preserve the separate Add Activity action, and reserve enough viewport space so navigation does not cover content.
2. Adapt app views for narrow screens: review Home, activity list/detail, Progress, upload/processing, Profile, and World/map layouts; adjust wrapping, spacing, sizing, and overlays only where needed.
3. Review authentication screens on phone widths, preserving existing behavior while addressing any remaining overflow or touch-target issues.
4. Add or update focused responsive regression tests and validate the relevant tests and TypeScript build.

## Acceptance criteria

- App screens remain readable and operable at phone widths without horizontal overflow or content hidden behind navigation.
- The five primary destinations remain identifiable and the active destination is communicated in the mobile navigation.
- Add Activity remains available as a distinct action.
- Forms, activity details, and map/detail overlays fit narrow screens and retain usable controls.
- Sign-in/authentication flows remain usable on mobile.
- Existing desktop behavior is preserved, and the landing page is unchanged.

## Constraints

- Prefer straightforward responsive CSS and only the markup changes required for navigation; do not introduce a new UI hierarchy or mobile-only feature flow.
- Preserve existing app routing, localization, and interaction behavior.
- Leave landing-page localization code in `src/landing` because it is used by the server.

## Validation

- Add or update focused regression coverage for mobile shell and layout behavior.
- Run the relevant tests and `npm run build`.
