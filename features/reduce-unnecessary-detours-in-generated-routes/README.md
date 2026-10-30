# reduce-unnecessary-detours-in-generated-routes

## Goal

Improve generated area routes that sometimes take locally unnecessary detours or
zigzags. Prefer routes that follow a coherent loop and avoid redundant road
segments, while keeping the route geometry aligned with the roads selected by
the router.

## Scope

- Improve route quality for `generateAreaRoutes` and directly related shared
  routing logic.
- Evaluate routed area candidates for redundant detours and backtracking.
- Use route quality when filtering or ranking proposals.
- Preserve route bounds, requested destination coverage, route type, and
  deterministic proposal generation.

Out of scope: changes to the standalone routing service and display-only
geometry simplification.

## Decisions

- Prefer filtering or down-ranking low-quality candidates over trimming or
  rewriting returned geometry. Rewriting geometry could make the displayed
  line diverge from the roads the router selected.
- Keep viable alternatives where possible instead of returning a visibly poor
  route.
- Inspect anchor generation for contributors, and change it only when evidence
  points to it.
- The screenshot indicates a local zigzag but does not include route
  coordinates or the exact request. Use conservative thresholds and explicit
  synthetic regression cases; tune against the observed route if its source
  data becomes available.

## Implementation plan

1. Trace area-route generation and identify why existing quality checks permit
   the reported detours.
2. Add a focused route-quality signal and use it to filter or rank area
   proposals.
3. Add regression tests for redundant detours, fallback behavior, and preserved
   bounds and target behavior.
4. Run targeted planner tests and the TypeScript build.

## Acceptance criteria

- Generated area proposals avoid candidates with clearly redundant detours when
  a better valid alternative exists.
- When every candidate has a quality issue, fallback behavior does not silently
  return an obviously poor route; the planner handles the case consistently
  with its existing no-route behavior.
- Route geometry is not altered by cleanup, and valid bounds and destination
  coverage remain enforced.
- Candidate evaluation and proposal selection remain deterministic.
- Regression tests cover the detour and fallback behavior.

## Validation

- Add focused cases to `src/routePlanning/planner.test.ts` using explicit
  synthetic geometries.
- Run the targeted route-planner tests.
- Run `npm run build` to validate TypeScript.
