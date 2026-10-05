# coming-soon

## Goal
Introduce a reusable, multi-language "Coming Soon" mechanism for not-yet-supported
functionality, and remove the unsupported Komoot "external route" feature entirely.
The quest "View route" button becomes a "Create route" placeholder marked Coming Soon.

## Scope
- Reusable Coming Soon behavior usable on any element across the app.
- Quest detail "View route" button relabeled "Create route" as a Coming Soon placeholder.
- Complete removal of the Komoot / external-route feature across the full stack.

Out of scope: implementing actual route creation.

## Decisions
- **Komoot removal depth:** Full stack — UI, domain, validation, API, persistence,
  seed/fixtures, tests, docs — plus a new forward migration dropping the
  `quest_external_routes` table. (Migrations are forward-only; this is one-way.)
- **Create route button:** Same button/placement/styling as the former "View route"
  CTA (`quest-route-cta`), relabeled "Create route". Because Komoot data is removed,
  it becomes an always-present static placeholder in the quest detail footer.
- **Reusable form:** A `data-coming-soon` attribute plus shared CSS/JS behavior that
  can be added to any element.
- **Trigger:** Both click and hover/focus, keyboard accessible.
- **Multi-language:** New strings added to the German dictionary in `app-locales.js`
  so the existing i18n DOM-walker localizes them.

## Implementation plan

### Reusable Coming Soon mechanism
- New `public/components/shared/coming-soon.js` exporting `initComingSoon()`:
  - Delegated listeners attached once on `document.body` (survive re-renders):
    click (preventDefault + show tooltip), mouseover/mouseout, focusin/focusout.
  - Any element with `[data-coming-soon]` shows a floating "Coming soon" tooltip
    (`role="tooltip"`); optional custom text via `data-coming-soon="..."`.
  - Suppress default action/navigation for links/buttons.
  - Accessibility: `role="tooltip"` + `aria-describedby` wiring.
- Add `.coming-soon-tooltip` styling to the globally loaded stylesheet.
- Call `initComingSoon()` in `public/app.js` bootstrap.
- Add German `"Coming soon"` string in `public/app-locales.js`.

### Create route button
- In `public/components/world/quest-detail.js`: remove `ExternalRouteCta` /
  `externalRouteLabel`; add static `CreateRouteCta()` rendering the `quest-route-cta`
  button labeled "CREATE ROUTE" with `data-coming-soon`. Footer becomes
  `${CreateRouteCta()}${ownerActions}`.
- i18n: add `"Create route"` / `"CREATE ROUTE"` German strings; drop `"View route"` /
  `"VIEW ROUTE"`.

### Remove Komoot / external route (full stack)
- `src/domain.ts`: remove `ExternalRouteProvider`, `ExternalRoute`, and all
  `externalRoute` fields on quest interfaces.
- `src/quest.ts`: remove `externalRouteHosts`, `externalRouteProviders`,
  `parseExternalRoute`, `MAX_EXTERNAL_ROUTE_URL_LENGTH`, and external-route handling
  in `ParsedQuestInput` / `parseQuestInput`.
- `src/persistence/questRepository.ts`: remove externalRoute input fields,
  `replaceExternalRoute`, queries, `mapExternalRoute`, `hasExternalRoute`.
- `src/server.ts`: remove externalRoute passthrough.
- `src/persistence/seedCollectibles.ts`: remove externalRoute parsing/usage.
- `src/persistence/migrations.ts`: add migration `014` dropping
  `quest_external_routes`.
- `fixtures/world-v1-seed.json`: remove `externalRoute` blocks.
- `public/components/world/quest-editor.js`: remove external route field/state/payload.
- `public/components/world/quest-list.js`: remove `hasExternalRoute` "External route"
  badge.
- `public/app-locales.js`: remove `"External route"`, `"External route link (optional)"`.
- Docs: update active Komoot references in
  `features/milestone-15-staza-world-v1/README.md`.

## Acceptance criteria
- No remaining references to Komoot or `externalRoute` in source (outside historical
  migration `011` definition), tests, fixtures, or active docs.
- `quest_external_routes` table is dropped by a new forward migration.
- Quest detail shows a "Create route" button that, on both click and hover/focus,
  shows a "Coming soon" tooltip and performs no navigation, in both EN and DE.
- `data-coming-soon` works as a reusable annotation on arbitrary elements.

## Validation
- Update/remove external-route cases in `src/quest.test.ts`,
  `src/persistence/questRepository.test.ts`,
  `public/components/world/quest-ui.test.js`.
- Run targeted tests and `tsc`/build; rely on build to regenerate `dist/`.
- Manually verify the Create route Coming Soon tooltip in EN and DE.
