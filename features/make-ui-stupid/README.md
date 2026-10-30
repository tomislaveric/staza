# make-ui-stupid

## Goal

Review the authenticated product UI to ensure derived product logic is owned by
the backend wherever feasible. Keep the browser focused on rendering and
interaction so future Android and iOS clients can reuse the same canonical
behavior.

## Scope

- Review the authenticated app mounted by `public/index.html` and
  `public/app.js`, including shared modules in `public/components/`.
- Trace UI-derived values through API routes in `src/server.ts` into domain,
  query, and persistence modules.
- Include derived business/data behavior that can be served by backend APIs:
  calculations, aggregates, summaries, sorting, and filters.
- Exclude the marketing site in `public/landing/` and the unauthenticated
  replay surface.

## Decisions

- Move derived data and product rules to backend read models wherever feasible,
  including browse filters and aggregates.
- Keep rendering, formatting, visual effects, map viewport/layout, and
  interaction state in the browser when they are presentation concerns.
- Preserve existing user-visible behavior and API compatibility unless a
  reviewed migration requires a documented contract change.
- Maintain player-scoped API responses, authorization, and server-side
  validation.

## Implementation plan

1. Inventory authenticated UI logic and trace calculated, aggregated, sorted,
   and filtered values to their API and backend ownership.
2. Specify server-owned read models/endpoints for client-derived behavior,
   including response shapes and compatibility requirements.
3. Move feasible calculations, aggregates, sorting, and filters to the backend;
   simplify UI consumers while retaining presentation and interaction logic.
4. Add focused backend and UI regression coverage for migrated behavior.
5. Run relevant tests and the TypeScript build.

## Acceptance criteria

- The authenticated UI inventory identifies where derived behavior lives and
  distinguishes backend-worthy data decisions from presentation-only work.
- Migrated derived data and product rules have one canonical backend
  implementation; UI consumers render returned data instead of duplicating
  those rules.
- Existing user-visible behavior is preserved, with tests covering migrated
  behavior and relevant edge cases.
- Existing API authorization and player-scoping guarantees remain intact.

## Validation

- Run focused tests for changed backend and UI behavior.
- Run the repository test suite as appropriate to the final set of changes.
- Run `npm run build` to verify the TypeScript backend.

## Implementation notes

Migrated to the backend (additive, backward-compatible):

- `PlayerProgress` now includes `remainingXp` and `progressPercent`
  (`src/progression.ts`); Home, Progress and Profile render them.
- `GET /api/activities/summary` returns history totals (`count`,
  `distanceMeters`, `xp`, `collected`, `flowlines`) from
  `src/activitySummary.ts`; the Activities page renders them.
- Progress dashboard `recentActivities` include `xpPercentOfBest`.
- Home stats come only from the dashboard `lifetime` totals.

Intentionally left in the browser (presentation/interaction): replay XP
animation and `levelStateAt` (frozen level table), map viewport/layout, tooltip
positioning, formatting, and quest open/locked/completed grouping and world
filters (follow-ups; world filters need a reviewed `/api/world` contract).
