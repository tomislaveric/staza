# road-cycling-segment-intelligence

## Goal

Refactor and extend the existing Flowline ("fartlek") extraction system into a generic
**road-cycling segment intelligence** model. A road segment carries multiple independent
quality scores at once — `flowScore`, `enduranceScore`, `exploreScore` — plus
`roadQualityScore` and `dataConfidence`. These scores are not mutually exclusive
categories: a segment may score highly for several styles. The same model is designed to
aggregate to route-level character scores and to feed future Rush / Endurance / Explore
route planning. The user-facing Flowline concept is preserved and becomes one expression
of this generic model: a `RoadCyclingSegment` whose `flowScore` exceeds a publication
threshold.

Road-bike suitability is foundational: a segment must be eligible for road cycling before
any style score matters. Bad road-bike segments must not receive strong style scores.

## Scope

- Keep the existing extraction, normalization, candidate generation, import, and
  persistence architecture; make focused, incremental changes rather than a risky rewrite.
- Introduce an internal generic `RoadCyclingSegment` model; the persisted `Fartlek` /
  `fartleks` table remains the published shape and gains score columns via an adapter.
- Candidate highway classes stay: primary(+link), secondary(+link), tertiary(+link),
  unclassified, cycleway. Residential/service/track/path/living_street remain excluded.
- Scoring is deterministic, inspectable, versioned, and reproducible from map/context
  data only. No LLM classification. No per-user personalization. No persisted hard style
  label (`type = rush/endurance/explore` is forbidden).
- Preserve all gameplay and historical truth (GameEvents, completions). Never physically
  delete Flowlines; archive instead.

## Decisions

- **Model**: add `src/osm/roadSegment/` with `RoadCyclingSegment`, `RoadCyclingEligibility`,
  `RoadCyclingSegmentFeatures`, and `SegmentQualityScores { flow, endurance, explore,
  roadQuality, dataConfidence }`. Do not rename `fartleks` table or `Fartlek` type now.
- **Eligibility** is non-overridable by style scoring. Extract current hard-rejection and
  access logic into a reusable layer with explicit named reasons (reuse existing
  `REJECT_*` strings). Ineligible segments get all style scores = 0.
- **Surface model** extends current 4-level enum to 6:
  `EXCELLENT | GOOD | ACCEPTABLE | UNKNOWN | BAD | FORBIDDEN`. Centralize raw-string sets;
  no scattered string compares. `paving_stones` / `concrete:plates` remain BAD for V1.
  Compound tags: worst constituent wins. Missing surface derives confidence from highway
  class, not auto-rejected.
- **Smoothness model**: `excellent | good | intermediate | bad | very_bad | horrible |
  very_horrible | impassable | unknown`, mapped to a suitability band. Supporting signal;
  surface dominates. Missing smoothness never rejects.
- **Cycleways**: keep stricter evidence gate (sealed surface, continuity, length). May
  score high for endurance/explore, moderately for flow. Bicycle tags interpreted in way
  context (`use_sidepath` rejects a carriageway, not the cycleway itself).
- **Segmentation**: in addition to the existing join-compatibility key and city-limit
  splits, add intra-chain re-splitting at material transitions in surface, smoothness,
  bicycle access, access restriction, highway class (base), and ref/name continuity. Hard
  boundary on `bicycle=yes → bicycle=no`. Preserve all coordinates.
- **Length curves** (score curves, not brittle thresholds): flow/rush favor ~2–8 km;
  endurance favors ~5–30+ km; explore is length-insensitive.
- **Scores** are computed from a shared `RoadCyclingSegmentFeatures` layer via named weight
  configs (no inline magic numbers). Flow = uninterrupted flowing character (speed is not a
  primary signal). Endurance = sustained continuity/efficiency over distance (not flow with
  a longer length threshold). Explore = reliable non-urban/POI-proximity signals only,
  explicitly less mature initially; never fabricate scenic value from highway class.
- **Confidence** is separate from quality; missing tags reduce it; gates publication and
  modulates route-preference strength.
- **Persistence**: extend `fartleks` (no new table) with `flow_score`, `endurance_score`,
  `explore_score`, `road_quality_score`, `data_confidence`, and integer `scoring_version`
  (default 1). Keep `suitability_score` as a transitional flow alias. Add score-filtered
  partial indexes for spatial lookup. Reuse the existing numeric-bbox + `box()/point()`
  GiST approach; do not introduce PostGIS.
- **Scoring version**: replace the free-form `FARTLEK_SCORING_VERSION` string with an
  integer `SEGMENT_SCORING_VERSION = 1`, persisted, to enable targeted recompute.
- **Publication**: a Flowline publishes when `eligible == true AND flowScore >=
  FLOWLINE_FLOW_THRESHOLD AND dataConfidence >= MIN_CONFIDENCE AND name present`
  (thresholds data-chosen, starting from 80 / 0.70). Endurance/explore scores persist on
  every eligible segment regardless. No `EnduranceLine` / `ExploreLine` object types.
- **Historical safety**: `fartlek_completions.fartlek_id` is `ON DELETE CASCADE`, so never
  delete — archive (`status='archived'`). `activity_events` are value-snapshotted and
  unaffected. Quest-target by-id lookup already ignores status.
- **Route-level aggregation** (design now, no UI): distance-weighted mean of per-style
  segment scores over eligible traversed distance, with documented route-level penalties
  (repeated stops, backtracking, discontinuity, bad-surface exceptions, urban transitions,
  fragmentation).
- **RideStylePolicy**: Rush/Endurance/Explore are Staza planning policies, never inside
  Valhalla. Extend `DEFAULT_PLANNER_POLICY`. Valhalla (behind `staza-routing`) stays the
  generic engine; Staza chooses destinations, corridors, segment preferences, and ranking.
- **Planner integration**: bounded corridor variants only — generate baseline, find strong
  nearby segments, create limited variants, re-score, accept only on net quality
  improvement. Never chain all high-scoring segments as waypoints.
- **Tooling**: dev-only `npm run analyze:road-segments` CLI and `road-segment-debug.geojson`
  export; never used in production runtime.

## Implementation plan

1. Centralize surface/smoothness/eligibility into reusable modules (behaviour-preserving
   refactor of `roadCyclingFlowlineQuality.ts`).
2. Add `RoadCyclingSegmentFeatures` extraction; prove flow == current suitability via tests.
3. Add endurance + explore scorers (Phase-1 signals from reliably present data).
4. Add schema columns + integer `scoring_version`; persist all scores via a
   `Fartlek`↔`RoadCyclingSegment` adapter.
5. Make Flowline publication depend on `flowScore` (alias current score).
6. Add intra-chain suitability re-splitting in candidate generation.
7. Dry-run + calibrate thresholds against the Germany extract; reimport; validate world map
   and historical behavior.
8. Add analysis CLI + GeoJSON debug export.
9. Route-level aggregation semantics + `RideStylePolicy` (no UI).
10. Planner corridor integration (bounded variants).
11. Explore Phase-2 enrichment (POI proximity from `collectibles`/quaeldich passes,
    elevation variation).

## Derived feature model

Phase-1 (reliably present): `lengthM`, `highwayClass`, `surfaceClass`, `smoothnessClass`,
`bicycleAccess`, `generalAccess`, `maxspeed`, `priorityRoad`, `lit`, `junctionCount`,
`junctionDensity`, `trafficControlCount`, `trafficControlDensity`, `cityLimitCrossings`,
`nameContinuity`, `refContinuity`, `roadClassChanges`, `surfaceChanges`, `cyclewayFlag`,
`metadataCompleteness`, `nonUrbanRatio`.

Phase-2 (needs geometry math / new extraction): `geometryCurvature`, `headingChangeRate`,
`deadEndRisk`, `urbanRatio`, `elevationVariation`, explore POI proximity.

## Calibration strategy

Before freezing weights/thresholds, run the scorer across the full Germany extract in
dry-run and report, per candidate highway class: length distribution; surface + missing
surface; smoothness + missing smoothness; bicycle/access values; junction density;
traffic-control density; urban/non-urban ratio; maxspeed; cycleway counts; existing
published Flowline count. Then report flow/endurance/explore distributions, pairwise
correlation, top-N and bottom-N examples, ambiguous mid-scores, and rejected samples with
reasons. Choose thresholds from data; never blind. Reuse the existing threshold-sweep
harness in `importFartleks.ts`.

## Acceptance criteria

- Every eligible road-cycling segment carries independent `flowScore`, `enduranceScore`,
  and `exploreScore`; scores may overlap and are not mutually exclusive.
- Flowlines are derived from high `flowScore` with eligibility and confidence gates.
- Route planning can later consume all three scores; full routes can later display the
  three-character profile via distance-weighted aggregation.
- Scoring is deterministic, inspectable, and versioned (`scoring_version` persisted).
- Historical Flowline/gameplay data remains safe: archived (never deleted), completions and
  GameEvent snapshots intact.
- Eligibility tests pass: paved secondary accepted; gravel unclassified rejected;
  `bicycle=no` rejected; private rejected; good cycleway accepted; rough cycleway rejected;
  missing surface handled by confidence.
- Flow tests: long smooth uninterrupted high; interrupted urban lower; rough low/rejected.
- Endurance tests: long continuous paved high; short fragmented lower; repeated traffic
  controls lower.
- Explore tests: context-rich higher; urban/industrial lower where reliable data exists.
- Segmentation tests: asphalt/gravel/asphalt splits; `bicycle=yes → no` hard boundary.
- Overlap test: one segment scores highly in flow AND endurance.
- Versioning test: `scoring_version` persisted/read correctly.
- Historical test: an archived/unpublished Flowline does not break completions or quest
  targets.

## Validation

- Unit tests via `vitest` extending `roadCyclingFlowlineQuality.test.ts`,
  `fartlekCandidates.test.ts`, `fartlekScore.test.ts`, plus new scorer/feature tests.
- `tsc` build must pass.
- Dry-run import with distribution + threshold-sweep report before any operational
  reimport; DB backup and archive-only (never delete) behavior on reimport.
- Dev-only map inspection via `road-segment-debug.geojson` and the analysis CLI for
  real-world sampling (top-50 per style, mid-score, rejected).

## Risks and unknowns

- Explore data poverty; Phase-1 explore is coarse and documented as such.
- Flow/endurance may correlate on good rural roads; calibration must confirm divergence.
- Intra-chain splitting may shift segment counts; measure before production import.
- Cascade delete on completions is the sharpest hazard — enforce archive-only.
- Corridor biasing risks detours/perf regressions; gate on net-quality improvement.
- No PostGIS: score-filtered spatial queries at Germany scale need index validation.
- Cycleway continuity data is thin; flow scoring of cycleways may need manual samples.
- Committed extract may lag OSM; calibration numbers are extract-specific.
