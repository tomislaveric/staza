# flowline-riding-character-rules

## Goal

Distinguish short High-flow segments from longer Endurance segments using the
existing scores. Keep qualifying Exploration as fallback and unmatched segments
as plain Flowlines, without changing extraction, publication, geometry or XP.

## Decisions

Apply these rules in order, using unrounded scores and meters:

| Character | Requirement |
| --- | --- |
| High-flow | Flow >82 and 0 < length <5,000 m |
| Endurance | Length >=5,000 m and Endurance >=65 |
| Exploration | Neither earlier rule qualifies, and Explore >=65 |
| Plain Flowline | No qualifying rule; primary null and empty tags |

Each specialist has one tag. Missing/invalid length cannot qualify High-flow or
Endurance. Missing/invalid scores do not qualify. Exactly 82 is not High-flow;
exactly 5,000 m belongs on the Endurance side of the boundary.

Preserve independent Explore scoring, Explore route intent, existing Endurance
formulas and all extraction/publication thresholds. High-flow remains a riding
character based on map evidence, not a promise of safe speed.

Align the High-flow map filter with the badge predicate. Keep Long Flowlines
length-only (>=5,000 m), with its existing grant/filter identifier. Plain Flowlines
remain discoverable and routable under existing score/quality/confidence checks.

## Scope and implementation plan

1. Make canonical character classification length-aware and primary nullable.
   Keep raw scores separate from badge qualification; add exact boundary,
   precedence, missing-data and neutral tests.
2. Include `length_meters` in lightweight opportunity projections. Separate
   opportunity ranking from primary character, retaining existing selection,
   score cutoffs, deterministic tie-breaking and completed-road behavior.
   Add `unclassifiedFlowlineCount` to Explore summaries without changing totals.
   Preserve the historical ranking preference for scores meeting 70/65/65,
   falling back to the highest available score only when none qualifies; these
   ranking cutoffs do not grant specialist badges.
3. Update web badges, facts, summaries, legacy payload handling and High-flow
   filters. Plain Flowlines have no invented specialist score.
4. Update native World decoding, summaries, filters, discovery sorting, chips,
   details and localization for nullable primary and legacy payloads. Update
   all directly dependent consumers; do not create a new Android surface.
5. Extend offline analysis/GeoJSON with character counts and old-to-new
   transitions on identical scores. Identify source/version and sample scope.
6. Run targeted server/web/native tests and build. Preserve publication IDs,
   counts, geometry, score formulas, completion and route-intent semantics.

Canonical policy precedes integration; analysis reuses canonical policy;
integrated validation follows server and client work.

## Compatibility and stale data

Character is derived on read, not stored. Compatible client/server deployment and
fresh World/Explore requests update labels without database migration. Legacy
payload handling must not assume missing character means High-flow. Explicit
neutral character is authoritative.
New character objects carry `policyVersion: 2`; clients trust that policy and
reclassify older unversioned specialist objects from their scores/length.

Old native clients with non-optional primary cannot decode null. Deploy compatible
clients before enabling the new server contract for those clients. Do not treat
this as backward-compatible with every released app.

Stale catalog suitability/scores require a separate, explicitly authorized
operational refresh. Do not run imports or database writes as part of this task.
The existing normalized snapshot cannot recover lane/shoulder tags dropped by an
older extractor. A current PBF plus current extraction code is needed for those.

Future operator procedure (not executed by this feature):

```sh
npm run build
OUTPUT=/path/to/refreshed-flowlines.ndjson \
  npm run extract:osm-germany-fartleks -- /path/to/germany-latest.osm.pbf
npm run import:fartleks -- --snapshot /path/to/refreshed-flowlines.ndjson --dry-run
NODE_OPTIONS=--max-old-space-size=8192 npm run analyze:road-segments -- \
  --snapshot /path/to/refreshed-flowlines.ndjson \
  --geojson /path/to/review.geojson --sample-per-group 3
```

Inspect source coverage, versions, counts and GeoJSON; take and verify a database
backup before separately authorizing the real import:

```sh
# Future manual operation only; writes to DATABASE_URL.
npm run import:fartleks -- --snapshot /path/to/refreshed-flowlines.ndjson
```

Verified complete-snapshot imports archive absent OSM identities while preserving
history; candidate/direct-object input is not a substitute for complete coverage.
Never delete the catalog or completion rows to refresh it.

## Elevation

Flowline extraction currently stores 2D coordinates only, drops extra coordinate
dimensions, does not retain OSM `ele`, and has no profile/gain/loss/gradient fields.
Point collectibles separately read OSM `ele`. Route planning accepts optional
route-level gain/loss from the routing service, but does not feed that back into
stored Flowlines or establish the upstream elevation dataset.

Elevation enrichment is out of scope. A future feature could sample a digital
elevation model along lines, track source/resolution/no-data and bridge/tunnel
limitations, smooth noise and derive gain/loss/gradients.

## Acceptance criteria and validation

- Server/web/native apply the same exact ordered thresholds, including all
  boundaries, missing/invalid inputs and explicit neutral objects.
- Plain Flowlines remain visible/plannable and included in Explore totals.
- High-flow filter and badge agree; Long Flowlines stays length-only.
- Publication/score/geometry/history semantics do not change; no live refresh,
  database write/reset, provider integration or elevation claim occurs.
- Run focused Vitest suites for characters, opportunities, World Explore,
  offline analysis and web World/detail/reveal/filter behavior; add an isolated
  mock-query length-projection test instead of running destructive DB suites.
- Run `npm run build` and World-focused native tests using `xcodebuild test`
  with the existing Staza project/scheme and an available simulator. Report
  toolchain/simulator blockers explicitly.
- Report offline source/version and distinguish sample analysis from live data.

## Validation results

The focused suites passed: 107 server/web tests and 24 native World tests.
`npm run build` and `git diff --check` passed.

Full offline analysis used `geofabrik-germany-2026-10-03`, snapshot v2 generated
2026-10-12, and scoring version 2. This is historical input, not a live-catalog
query. The candidate count (897,657), named publications (28,747), candidate
geometry digest and all reported score distributions remain unchanged.

On the same currently publishable roads and scores:

| Character | Previous policy | New policy |
| --- | ---: | ---: |
| High-flow | 27,657 | 27,417 |
| Endurance | 1,090 | 444 |
| Exploration | 0 | 11 |
| Plain Flowline | 0 | 875 |

Exploration therefore remains possible, but rare under the existing Flow-first
publication criteria. These are label transitions, not new publication removals.

A stratified GeoJSON export contained 404 features, including 55 published
examples covering all four character outcomes. Programmatic inspection confirmed
badge predicates, no published high-speed motor-road examples, and retention of
tertiary/unclassified roads and cycleways. No visual map review, database refresh
or import was performed.
